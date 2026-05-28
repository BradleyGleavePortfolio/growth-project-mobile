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
 *      confetti micro-interaction, invalidate the budget query, then route
 *      back to Coach Home. On `cancel`, return to the selection phase.
 *
 * Optimistic UI: NONE. Stripe Checkout is the source of truth for payment
 * success; the budget query is invalidated only after the webhook applies
 * the credit on the backend (the React Query refetch on Coach Home picks
 * it up). Showing a "credit added" balance before the backend confirms
 * would be the optimistic-without-rollback failure mode the spec calls out.
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
import { PackOptionsRow } from '../../components/coach/ai-budget/PackOptionsRow';
import {
  coachAiBudgetApi,
  CUSTOM_PACK_MAX_CENTS,
  CUSTOM_PACK_MIN_CENTS,
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
  | { kind: 'success'; amountCents: number }
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
        const res = await coachAiBudgetApi.createCheckout({ amount_cents: amountCents });
        const data: CreateCheckoutResponse = res.data;
        if (!data?.url) {
          throw new Error('Checkout session URL missing');
        }
        // Reject any URL not in the same origin allow-list as the existing
        // client checkout webview. The backend should only emit Stripe URLs,
        // but defence-in-depth — never trust a remote URL.
        if (!isOriginAllowed(data.url)) {
          throw new Error('Checkout URL origin not allowed');
        }
        setPhase({
          kind: 'webview',
          url: data.url,
          sessionId: data.session_id,
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
      // Confetti haptic — `Haptics.notificationAsync` Success is the right
      // pairing for a purchase-confirm moment per the Duolingo doctrine.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
      // Invalidate budget so Coach Home re-fetches with the new pack credit.
      // The backend webhook applies the credit asynchronously — invalidating
      // here triggers a refetch but the UI must tolerate the credit not
      // being visible for a few seconds while the webhook fires.
      queryClient.invalidateQueries({ queryKey: COACH_AI_BUDGET_QUERY_KEY });
      setPhase({ kind: 'success', amountCents });
    },
    [queryClient],
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
          originWhitelist={['https://*']}
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
        <SuccessConfetti
          amountCents={phase.amountCents}
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

// ─── Confetti success view ───────────────────────────────────────────────────

interface SuccessProps {
  amountCents: number;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  onDone: () => void;
}

/**
 * Lightweight CSS-confetti: 18 small colored dots fall+spin into view with
 * staggered delays. Uses RN Animated (rather than Reanimated) for the
 * particles because each particle only needs simple opacity + translateY +
 * rotate; building it on Reanimated would not buy us anything for these
 * short, fire-and-forget animations.
 *
 * Auto-dismisses after ~1.8s so the coach is dropped back into Coach Home
 * with a freshly invalidated budget query.
 */
function SuccessConfetti({ amountCents, colors, styles, onDone }: SuccessProps) {
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  const particles = useRef(
    new Array(18).fill(0).map(() => ({
      x: Math.random() * 320 - 160,
      delay: Math.random() * 250,
      rotate: new Animated.Value(0),
      translate: new Animated.Value(-40),
      opacity: new Animated.Value(0),
    })),
  ).current;

  React.useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    particles.forEach((p) => {
      Animated.parallel([
        Animated.sequence([
          Animated.delay(p.delay),
          Animated.timing(p.opacity, {
            toValue: 1,
            duration: 120,
            useNativeDriver: true,
          }),
          Animated.delay(1100),
          Animated.timing(p.opacity, {
            toValue: 0,
            duration: 280,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(p.translate, {
          toValue: 320,
          duration: 1500,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(p.rotate, {
          toValue: 1,
          duration: 1500,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]).start();
    });

    dismissTimer.current = setTimeout(onDone, 1800);
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [fade, particles, onDone]);

  return (
    <Animated.View
      style={[styles.successWrap, { opacity: fade }]}
      testID="credit-pack-success"
    >
      <View style={styles.successContent}>
        <View style={styles.successIconWrap}>
          <Ionicons name="checkmark-circle" size={56} color={colors.success} />
        </View>
        <Text style={styles.successTitle}>Credits added</Text>
        <Text style={styles.successBody}>
          {formatCents(amountCents)} of AI credit is now on your account.
        </Text>
      </View>
      <View style={styles.confettiLayer} pointerEvents="none">
        {particles.map((p, i) => {
          const rotateStr = p.rotate.interpolate({
            inputRange: [0, 1],
            outputRange: ['0deg', '720deg'],
          });
          const tone =
            i % 3 === 0 ? colors.primary : i % 3 === 1 ? colors.gold : colors.success;
          return (
            <Animated.View
              key={i}
              style={[
                styles.confettiDot,
                {
                  backgroundColor: tone,
                  transform: [
                    { translateX: p.x },
                    { translateY: p.translate },
                    { rotate: rotateStr },
                  ],
                  opacity: p.opacity,
                },
              ]}
            />
          );
        })}
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
    successContent: { alignItems: 'center', gap: 12, paddingHorizontal: 24 },
    successIconWrap: { marginBottom: 4 },
    successTitle: {
      fontSize: 24,
      fontWeight: '600',
      color: colors.textPrimary,
      letterSpacing: 0.2,
    },
    successBody: {
      fontSize: 15,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    confettiLayer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingTop: 80,
    },
    confettiDot: {
      position: 'absolute',
      width: 10,
      height: 10,
      borderRadius: 2,
    },
  });
}
