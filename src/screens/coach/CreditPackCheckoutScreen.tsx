/**
 * CreditPackCheckoutScreen — Stripe-webview entry point for AI credit packs.
 *
 * Apple App Review Rule 3.1.3(b)/(e) B2B exemption applies (same posture as
 * `BrandedCheckoutWebViewScreen` for coach packages). Coach saaS, sold to a
 * business, billed outside of IAP via a branded Stripe Checkout in a webview.
 * NEVER use IAP for these packs — mega-prompt failure mode.
 *
 * Two-phase flow:
 *   1. Selection phase — render `<PackOptionsRow />` plus a custom-amount
 *      input. On select, call `coachAiBudgetApi.createCheckout()` to mint
 *      a Stripe Checkout Session URL.
 *   2. Webview phase — embed `react-native-webview` pointing at the minted
 *      URL with the same origin allow-list / deep-link parser as
 *      `BrandedCheckoutWebViewScreen`. On `success` deep link, render the
 *      SuccessReceipt component, invalidate the budget query, then route
 *      back to Coach Home. On `cancel`, return to the selection phase.
 *
 * Round-3 fix: the success state was previously a particle burst that
 * violated QUIET_LUXURY_DOCTRINE.md §3 (no celebrations). It is now a
 * quiet receipt — opacity fade-in + a single icon pulse, two metadata
 * rows ("New balance" + "Receipt sent to your inbox"), auto-dismiss
 * after 1800ms. Same confidence as an Amex statement.
 *
 * Optimistic UI: NONE. Stripe Checkout is the source of truth for payment
 * success; the budget query is invalidated only after the webhook applies
 * the credit on the backend (the React Query refetch on Coach Home picks
 * it up). The "New balance" line on the receipt is a SNAPSHOT projection
 * (previous balance + amount paid) for the glance moment; the source of
 * truth is the next budget refetch.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  SafeAreaView,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import WebView, {
  type WebViewNavigation,
} from 'react-native-webview';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';

import HapticPressable from '../../components/HapticPressable';
import { useTheme, type ThemeColors } from '../../theme/ThemeProvider';
import { motion, typography } from '../../theme/tokens';
import { PackOptionsRow } from '../../components/coach/ai-budget/PackOptionsRow';
import {
  coachAiBudgetApi,
  CUSTOM_PACK_MAX_CENTS,
  CUSTOM_PACK_MIN_CENTS,
  buildCheckoutInput,
  type CreateCheckoutResponse,
} from '../../api/coachAiBudgetApi';
import { useAIBudget, COACH_AI_BUDGET_QUERY_KEY } from '../../hooks/useAIBudget';
import { formatCents } from '../../api/types/coachAIBudget';
import {
  CHECKOUT_ALLOWED_HOSTS,
  isOriginAllowed,
  parseReturnDeepLink,
} from '../client/BrandedCheckoutWebViewScreen';
import { parseDollarsToCents } from './creditPackCheckoutHelpers';

// Re-export so consumers (tests, navigator) can verify allow-list parity.
export { CHECKOUT_ALLOWED_HOSTS };
// Re-export so older imports of `parseDollarsToCents` from this screen
// continue to work; the canonical home is `creditPackCheckoutHelpers.ts`.
export { parseDollarsToCents } from './creditPackCheckoutHelpers';

const DEFAULT_RETURN_SCHEME = 'com.growthproject.app';

type Phase =
  | { kind: 'select' }
  | { kind: 'minting'; amountCents: number }
  | { kind: 'webview'; url: string; sessionId: string; amountCents: number }
  /**
   * Round-3: success carries `newBalanceCents`, the SNAPSHOT projection of
   * the coach's balance after the just-completed purchase. Computed in
   * `handleSuccess` BEFORE the budget query is invalidated so the value
   * reflects "previous remaining + amount paid", not whatever the next
   * refetch (which races with the backend webhook) happens to return.
   * `null` when the previous balance was unavailable at success time (rare
   * — only if the budget query was in error state when the user paid);
   * the receipt falls back to the pack amount in that case.
   */
  | { kind: 'success'; amountCents: number; newBalanceCents: number | null }
  | { kind: 'error'; message: string };

export default function CreditPackCheckoutScreen(): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const queryClient = useQueryClient();
  const { data: budget } = useAIBudget();

  const [phase, setPhase] = useState<Phase>({ kind: 'select' });
  const [customInput, setCustomInput] = useState<string>('');

  const packOptions = budget?.pack_options_cents ?? [1000, 2500, 9900];
  const bounds = budget?.custom_pack_bounds_cents ?? {
    min: CUSTOM_PACK_MIN_CENTS,
    max: CUSTOM_PACK_MAX_CENTS,
  };

  const mintCheckout = useCallback(
    async (amountCents: number) => {
      setPhase({ kind: 'minting', amountCents });
      try {
        // Cents → tier mapping happens at the API boundary (`buildCheckoutInput`)
        // so the rest of this screen keeps speaking in cents while the wire
        // contract carries the discriminated `tier` the backend's
        // class-validator @IsIn(...) requires.
        const res = await coachAiBudgetApi.createCheckout(
          buildCheckoutInput(amountCents),
        );
        const data: CreateCheckoutResponse = res.data;
        if (!data?.checkout_url) {
          throw new Error('Checkout session URL missing');
        }
        // Reject any URL not in the same origin allow-list as the existing
        // client checkout webview. The backend should only emit Stripe URLs,
        // but defence-in-depth — never trust a remote URL.
        if (!isOriginAllowed(data.checkout_url)) {
          throw new Error('Checkout URL origin not allowed');
        }
        setPhase({
          kind: 'webview',
          url: data.checkout_url,
          sessionId: data.checkout_session_id,
          amountCents,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not start checkout';
        setPhase({ kind: 'error', message: msg });
      }
    },
    [],
  );

  const handleSelect = useCallback(
    (choice: number | 'custom') => {
      if (choice === 'custom') {
        const cents = parseDollarsToCents(customInput);
        if (cents === null) {
          setPhase({
            kind: 'error',
            message: `Enter an amount between ${formatCents(bounds.min)} and ${formatCents(bounds.max)}.`,
          });
          return;
        }
        if (cents < bounds.min || cents > bounds.max) {
          setPhase({
            kind: 'error',
            message: `Custom packs must be between ${formatCents(bounds.min)} and ${formatCents(bounds.max)}.`,
          });
          return;
        }
        mintCheckout(cents);
        return;
      }
      mintCheckout(choice);
    },
    [customInput, bounds.min, bounds.max, mintCheckout],
  );

  const handleSuccess = useCallback(
    (amountCents: number) => {
      // Quiet success haptic — `Haptics.notificationAsync` Success is the
      // single tactile cue for the purchase-confirm moment. Doctrine §5
      // caps motion at one decel fade; this haptic is the only beat.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
      // Round-3: snapshot the projected new balance BEFORE invalidating the
      // budget query. `budget` is the hook's data at the moment the
      // user completed checkout; once we invalidate, the cache may show
      // stale-while-revalidating data or undefined depending on React
      // Query's state — neither is what we want on the receipt. The
      // snapshot is the deterministic "what you just paid for" value.
      const previousRemaining = budget?.remaining_displayed_cents;
      const newBalanceCents =
        typeof previousRemaining === 'number'
          ? previousRemaining + amountCents
          : null;
      // Invalidate budget so Coach Home re-fetches with the new pack credit.
      // The backend webhook applies the credit asynchronously — invalidating
      // here triggers a refetch but the UI must tolerate the credit not
      // being visible for a few seconds while the webhook fires.
      queryClient.invalidateQueries({ queryKey: COACH_AI_BUDGET_QUERY_KEY });
      setPhase({ kind: 'success', amountCents, newBalanceCents });
    },
    [queryClient, budget],
  );

  const handleCancel = useCallback(() => {
    setPhase({ kind: 'select' });
  }, []);

  const handleWebViewNavigation = useCallback(
    (nav: WebViewNavigation) => {
      const link = parseReturnDeepLink(nav.url, DEFAULT_RETURN_SCHEME);
      if (!link) return;
      if (link.outcome === 'success') {
        if (phase.kind === 'webview') handleSuccess(phase.amountCents);
      } else {
        handleCancel();
      }
    },
    [handleCancel, handleSuccess, phase],
  );

  const handleShouldStartLoad = useCallback(
    (request: { url: string }) => {
      const link = parseReturnDeepLink(request.url, DEFAULT_RETURN_SCHEME);
      if (link) {
        if (link.outcome === 'success' && phase.kind === 'webview') {
          handleSuccess(phase.amountCents);
        } else if (link.outcome === 'cancel') {
          handleCancel();
        }
        return false;
      }
      return isOriginAllowed(request.url);
    },
    [phase, handleSuccess, handleCancel],
  );

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <HapticPressable
          intent="light"
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.headerBtn}
          testID="credit-pack-back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.textOnPrimary} />
        </HapticPressable>
        <Text style={styles.headerTitle}>Buy AI Credits</Text>
        <View style={styles.headerBtn} />
      </View>

      {phase.kind === 'select' && (
        <View style={styles.body} testID="credit-pack-select">
          <Text style={styles.heading}>Pick a pack</Text>
          <Text style={styles.helper}>
            You pay face value. {formatCents(1000)} of credit = {formatCents(1000)} of AI usage —
            no multiplier math.
          </Text>
          <PackOptionsRow options={packOptions} onSelect={handleSelect} />
          <View style={styles.customRow}>
            <Text style={styles.customLabel}>Custom amount</Text>
            <View style={styles.customInputWrap}>
              <Text style={styles.customInputPrefix}>$</Text>
              <TextInput
                value={customInput}
                onChangeText={setCustomInput}
                keyboardType="decimal-pad"
                placeholder="25.00"
                placeholderTextColor={colors.textMuted}
                style={styles.customInput}
                testID="credit-pack-custom-input"
                accessibilityLabel="Custom credit pack amount in dollars"
              />
            </View>
            <Text style={styles.customBounds}>
              Between {formatCents(bounds.min)} and {formatCents(bounds.max)}
            </Text>
          </View>
        </View>
      )}

      {phase.kind === 'minting' && (
        <View style={[styles.body, styles.centered]} testID="credit-pack-minting">
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.helper}>Starting secure checkout…</Text>
        </View>
      )}

      {phase.kind === 'webview' && (
        <WebView
          source={{ uri: phase.url }}
          // P1-1 fix: tighten the outer WebView origin gate from the
          // wildcard `https://*` to the same Stripe host allow-list that
          // `onShouldStartLoadWithRequest` (line below) and the mint-time
          // `isOriginAllowed` check enforce. The wildcard would have been
          // the only line of defence if the JS-side checks were ever
          // accidentally removed in a refactor; this closes that gap.
          originWhitelist={CHECKOUT_ALLOWED_HOSTS.map((h) => `https://${h}`)}
          onNavigationStateChange={handleWebViewNavigation}
          onShouldStartLoadWithRequest={handleShouldStartLoad}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          mixedContentMode="never"
          style={styles.webview}
          testID="credit-pack-webview"
          {...(Platform.OS === 'ios'
            ? { allowsInlineMediaPlayback: true, decelerationRate: 'normal' as const }
            : {})}
        />
      )}

      {phase.kind === 'success' && (
        <SuccessReceipt
          amountCents={phase.amountCents}
          newBalanceCents={phase.newBalanceCents}
          colors={colors}
          styles={styles}
          onDone={() => navigation.goBack()}
        />
      )}

      {phase.kind === 'error' && (
        <View style={[styles.body, styles.centered]} testID="credit-pack-error">
          <Ionicons name="alert-circle" size={36} color={colors.error} />
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorBody}>{phase.message}</Text>
          <HapticPressable
            intent="medium"
            onPress={() => setPhase({ kind: 'select' })}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            style={styles.retryBtn}
            testID="credit-pack-retry"
          >
            <Text style={styles.retryBtnText}>Try again</Text>
          </HapticPressable>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Success receipt view (quiet-luxury) ─────────────────────────────────────

interface SuccessProps {
  amountCents: number;
  /** SNAPSHOT projection (previous remaining + amount paid). null when
   *  the previous remaining was unavailable at success time. */
  newBalanceCents: number | null;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  onDone: () => void;
}

/**
 * SuccessReceipt — the quiet-luxury success state for the credit-pack purchase.
 *
 * Replaces the prior particle burst that violated QUIET_LUXURY_DOCTRINE.md §3
 * (no celebrations, no particle bursts). The visual language is now an Amex
 * statement or Loro Piana confirmation page — confident, restrained, and
 * over in under two seconds.
 *
 * Motion (doctrine §5 — capped at base=400ms decel, single forest accent):
 *   1. Wrapper opacity 0 → 1 over `motion.duration.base` (400ms) with
 *      `Easing.out(Easing.cubic)` (the `decel` curve from tokens).
 *   2. ONE icon pulse: scale 1.0 → 1.02 → 1.0 over 600ms total
 *      (300ms out, 300ms back) with `Easing.inOut(Easing.cubic)`. The
 *      pulse fires once after the wrapper fade completes; it is the
 *      only animated cue besides the fade.
 * Nothing else animates. No translateY, no rotate, no springs, no
 * particles. Both animations use `useNativeDriver: true` so the
 * tactile haptic (fired in handleSuccess) and the visual settle land
 * on the same frame.
 *
 * Auto-dismiss: 1800ms after mount the wrapper calls `onDone()` which
 * routes the coach back to Coach Home. The receipt is meant to be
 * glanced at, not lingered on — Coach Home's refetch will surface the
 * actual confirmed balance once the backend webhook applies the credit.
 */
function SuccessReceipt({
  amountCents,
  newBalanceCents,
  colors,
  styles,
  onDone,
}: SuccessProps) {
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(1)).current;
  // mounted ref: the icon pulse runs as the fade-in's onComplete callback,
  // which can fire AFTER the component unmounts in tests (or in
  // production if the coach navigates away mid-fade). Without this guard
  // the Animated.sequence would attempt to attach to a detached fiber
  // and emit a noisy `Unable to find node on an unmounted component`
  // warning that Jest treats as a test failure.
  const mounted = useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    // Phase 1: opacity fade-in.
    Animated.timing(fade, {
      toValue: 1,
      duration: motion.duration.base, // 400ms — doctrine §5 default
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      // Phase 2: single icon pulse. 600ms total (no token at this exact
      // value — `base` is 400 and `slow` is 800; doctrine §5 allows
      // explicit values when between tokens. The pulse is intentionally
      // subtler than a `slow` reveal but more deliberate than a snap).
      // Guarded by `mounted` so an unmount during the fade does not
      // attach a follow-on animation to a detached fiber.
      if (!mounted.current) return;
      Animated.sequence([
        Animated.timing(iconScale, {
          toValue: 1.02,
          duration: 300,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(iconScale, {
          toValue: 1,
          duration: 300,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    });

    dismissTimer.current = setTimeout(onDone, 1800);
    return () => {
      mounted.current = false;
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [fade, iconScale, onDone]);

  // Fallback: when the previous-balance snapshot was unavailable (the hook
  // was in error state at success time), surface the pack amount alone.
  // Never show NaN, undefined, or a wrong number — silence is better than
  // a misleading balance on a receipt.
  const balanceDisplay =
    typeof newBalanceCents === 'number'
      ? formatCents(newBalanceCents)
      : formatCents(amountCents);

  // Accessibility: each metadata row composes label + value into a single
  // a11y label so screen readers say "New balance, twelve fifty" rather
  // than landing on disjoint nodes.
  const balanceA11y = `New balance, ${balanceDisplay}`;
  const receiptA11y = 'Receipt, sent to your inbox.';

  return (
    <Animated.View
      style={[styles.successWrap, { opacity: fade }]}
      testID="credit-pack-success"
    >
      <View style={styles.successContent}>
        <Animated.View
          style={[styles.successIconWrap, { transform: [{ scale: iconScale }] }]}
        >
          <Ionicons name="checkmark-circle" size={56} color={colors.success} />
        </Animated.View>
        <Text style={styles.successTitle}>Credits added</Text>
        <Text style={styles.successBody}>
          {formatCents(amountCents)} of AI credit is now on your account.
        </Text>

        <View style={styles.metaHairline} />

        <View
          style={styles.metaRow}
          accessible
          accessibilityLabel={balanceA11y}
          testID="credit-pack-success-balance-row"
        >
          <Text style={styles.metaLabel}>New balance</Text>
          <Text style={styles.metaValue} testID="credit-pack-success-balance-value">
            {balanceDisplay}
          </Text>
        </View>

        <View
          style={styles.metaRow}
          accessible
          accessibilityLabel={receiptA11y}
          testID="credit-pack-success-receipt-row"
        >
          <Text style={styles.metaLabel}>Receipt</Text>
          <Text style={styles.metaValue}>Sent to your inbox</Text>
        </View>
      </View>
    </Animated.View>
  );
}

// ─── styles ─────────────────────────────────────────────────────────────────

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.primaryDark,
    },
    headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitle: {
      flex: 1,
      color: colors.textOnPrimary,
      fontSize: 17,
      fontWeight: '600',
      textAlign: 'center',
    },
    body: {
      flex: 1,
      paddingHorizontal: 20,
      paddingTop: 24,
      gap: 16,
    },
    centered: { alignItems: 'center', justifyContent: 'center', gap: 12 },
    heading: {
      fontSize: 24,
      fontWeight: '600',
      color: colors.textPrimary,
      letterSpacing: 0.2,
    },
    helper: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    customRow: { marginTop: 8, gap: 6 },
    customLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
    customInputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.surface,
      gap: 6,
    },
    customInputPrefix: {
      color: colors.textSecondary,
      fontSize: 16,
      fontWeight: '600',
    },
    customInput: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: 16,
      paddingVertical: Platform.OS === 'ios' ? 4 : 0,
    },
    customBounds: { fontSize: 12, color: colors.textMuted },
    webview: { flex: 1, backgroundColor: colors.background },
    errorTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary },
    errorBody: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
      paddingHorizontal: 32,
    },
    retryBtn: {
      marginTop: 12,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.primary,
    },
    retryBtnText: {
      color: colors.textOnPrimary,
      fontWeight: '600',
      fontSize: 15,
    },
    successWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    successContent: {
      alignItems: 'stretch',
      gap: 12,
      paddingHorizontal: 24,
      // Cap the width so the meta rows align like a printed receipt
      // rather than stretching edge-to-edge on tablets.
      maxWidth: 360,
      width: '100%',
    },
    successIconWrap: { marginBottom: 4, alignSelf: 'center' },
    // Doctrine §1: display weight ≤ 500. Was '600' (banned for display).
    // Pulls the family + size + letterSpacing from tokens so a future
    // typography change doesn't have to special-case this screen.
    successTitle: {
      ...typography.h2,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    successBody: {
      ...typography.body,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    // R3: quiet receipt rows. Hairline above, label muted on left, value
    // ink on right. Same visual register the rest of the app uses for
    // label/value lists.
    metaHairline: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: 12,
      width: '100%',
    },
    metaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      width: '100%',
    },
    metaLabel: {
      ...typography.bodySmall,
      color: colors.textMuted,
    },
    metaValue: {
      ...typography.bodyMd,
      color: colors.textPrimary,
    },
  });
}
