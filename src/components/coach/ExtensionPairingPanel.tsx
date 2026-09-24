/**
 * ExtensionPairingPanel — the live pairing surface of the v0.3 import flow
 * (PR-M2, corrected UX-03a). Mounted only once the coach has opened their
 * prior platform's login page (ImportDataScreen `awaitingExtension`). It
 * mints a pairing code, shows it for the coach to read into the browser
 * extension, and reflects honest, contract-backed lifecycle states via
 * useExtensionPairing.
 *
 * Honesty guardrails (UX-03a paired-state truth correction): the mobile
 * contract has no import-progress read, and `pair/status` returning `paired`
 * proves only that this code was redeemed for this coach's account — nothing
 * about install, capability, or a previous platform (brief §2 row 4). The
 * `paired` view therefore shows a calm confirmation ("Connected to your
 * computer") and a truthful, server-owned-identity checklist. It NEVER shows
 * roster delta, "reconstructed so far", per-family counts, or any claim that
 * an import is "running" — those were borrowed progress the accepted contract
 * cannot back. "Review clients" remains a neutral secondary link with no
 * count or progress claim (Q1). The primary action is purely instructional
 * ("Continue on your computer") and carries no URL or locator — no
 * non-authorizing setup locator exists in accepted source (brief §2 row 2).
 * Cancel remains a local abandon (no server cancel exists).
 *
 * Accessibility + copy (M5-F): the code is rendered at 34pt with 6pt letter
 * spacing, which at large accessibility text sizes used to clip mid-code — and
 * a clipped pairing code is unusable, not merely ugly. It is now capped and
 * shrink-to-fit on a single line, exposed to screen readers digit-by-digit
 * (so "482913" is never read as "four hundred eighty-two thousand..."), and
 * backed by a copy control, because reading six digits back and forth to a
 * browser is exactly the task that motor and vision impairments make hardest.
 * The copy confirmation reflects the ACTUAL clipboard result (Rule 18) — a
 * failed write says so rather than claiming success. The 6-digit code never
 * enters a URL, log, analytics event, or any new storage.
 *
 * Support correlation (M5-D): when the backend supplies a request id on a
 * failure, the panel shows it as a quotable reference. It is displayed only
 * when real, and never presented as an explanation of what went wrong.
 *
 * Every other status (`minting`, `waiting`, `expired`, `authExpired`,
 * `unavailable`, `failed`, `cancelled`, `identityUnavailable`) keeps its
 * existing behaviour; copy is adjusted only to fit the fact → remedy →
 * retained-setup pattern, and makes no retirement, revocation, or disconnect
 * claim (there is no such endpoint — brief §2 row 5).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import {
  useNavigation,
  CompositeNavigationProp,
} from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/useTheme';
import type { ThemeColors } from '../../theme/ThemeProvider';
import type { CoachTabParamList, ClientsStackParamList } from '../../navigation/CoachNavigator';
import { useExtensionPairing, PAIRING_REASON_COPY } from '../../hooks/useExtensionPairing';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { track } from '../../analytics/posthog.service';
import { AnalyticsEvents } from '../../analytics/events';

interface Props {
  platformId: string;
}

// R27: typed cross-tab nav — the panel lives in SettingsStack but the review CTA
// jumps to the Clients tab, so the tab nav + destination stack are composed and
// compile-checked (mirrors StripeSetupBanner).
type ReviewNav = CompositeNavigationProp<
  BottomTabNavigationProp<CoachTabParamList, 'ClientsStack'>,
  NativeStackNavigationProp<ClientsStackParamList, 'ClientsList'>
>;

export default function ExtensionPairingPanel({ platformId }: Props): React.ReactElement {
  const { colors } = useTheme();
  const navigation = useNavigation<ReviewNav>();
  const pairing = useExtensionPairing(platformId);
  const { status, code, supportReference, reason, start, retry, cancel } = pairing;
  const currentUser = useCurrentUser();
  const startedRef = useRef(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  // A re-minted code invalidates any prior copy confirmation.
  useEffect(() => {
    setCopyState('idle');
  }, [code]);

  const copyCode = useCallback(async () => {
    if (!code) return;
    try {
      await Clipboard.setStringAsync(code);
      setCopyState('copied');
    } catch {
      // Never claim a copy that did not happen — the coach would paste stale
      // clipboard contents into the extension and see an opaque rejection.
      setCopyState('failed');
    }
  }, [code]);

  const openReview = useCallback(() => {
    track(AnalyticsEvents.IMPORT_REVIEW_OPENED, { platform: platformId });
    navigation.navigate('ClientsStack', { screen: 'ClientsList' });
  }, [navigation, platformId]);

  // Auto-mint once on mount; the hook's single-flight guard makes this safe.
  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      start();
    }
  }, [start]);

  const styles = makeStyles(colors);

  if (status === 'minting' || status === 'idle') {
    return (
      <View style={styles.card} accessibilityLiveRegion="polite" testID="pairing-minting">
        <ActivityIndicator
          color={colors.primary}
          accessibilityRole="progressbar"
          accessibilityLabel="Preparing your secure pairing code"
        />
        <Text style={styles.body}>Preparing your secure pairing code…</Text>
      </View>
    );
  }

  if (status === 'waiting') {
    return (
      <View style={styles.card} accessibilityLiveRegion="polite" testID="pairing-waiting">
        <Text style={styles.label}>Enter this code in the browser extension</Text>
        <Text
          style={styles.code}
          accessibilityRole="text"
          // Digit-by-digit, so VoiceOver/TalkBack dictate a code the coach can
          // transcribe instead of reading it as one large number.
          accessibilityLabel={`Pairing code ${(code ?? '').split('').join(' ')}`}
          // The code must never clip or wrap at large accessibility text sizes:
          // cap the multiplier and shrink to fit rather than lose a digit.
          maxFontSizeMultiplier={1.6}
          numberOfLines={1}
          adjustsFontSizeToFit
          testID="pairing-code"
        >
          {code}
        </Text>
        <TouchableOpacity
          style={styles.copyBtn}
          onPress={copyCode}
          accessibilityRole="button"
          accessibilityLabel="Copy pairing code"
          accessibilityHint="Copies the six digit code so you can paste it into the browser extension"
          testID="pairing-copy"
        >
          <Ionicons name="copy-outline" size={16} color={colors.primary} />
          <Text style={styles.linkText}>Copy code</Text>
        </TouchableOpacity>
        {copyState !== 'idle' ? (
          <Text
            style={styles.familyMuted}
            accessibilityLiveRegion="polite"
            testID="pairing-copy-status"
          >
            {copyState === 'copied'
              ? 'Copied to clipboard.'
              : 'Couldn’t copy — enter the code manually.'}
          </Text>
        ) : null}
        <Text style={styles.body}>
          Open the Growth Project extension on the page you just logged into and enter this
          code. It’s short-lived for your security, so enter it soon — we’ll let you know here
          if it expires.
        </Text>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={cancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel pairing"
          testID="pairing-cancel"
        >
          <Text style={styles.secondaryBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'paired') {
    // Truth boundary (brief §2 row 4): `pair/status` returning `paired` proves
    // only that this code was redeemed for this coach's account. It is NOT
    // installed-and-running, capability-known, or previous-platform-connected.
    // Every checklist line beyond the redemption fact and the server-owned
    // identity therefore reads "Not yet known" rather than inferring anything.
    // Server-owned identity comes from useCurrentUser only (Q2) — never a
    // client-edited field — and falls back to email when no display name has
    // resolved yet.
    const identityLabel = currentUser?.name || currentUser?.email || 'your account';
    return (
      <View style={[styles.card, styles.cardOk]} accessibilityLiveRegion="polite" testID="pairing-paired">
        <Ionicons name="checkmark-circle-outline" size={22} color={colors.primary} />
        <Text style={styles.title}>Connected to your computer</Text>
        <View style={styles.checklist} testID="pairing-checklist">
          <ChecklistRow styles={styles} colors={colors} label="Importer available" testID="pairing-check-importer" />
          <ChecklistRow
            styles={styles}
            colors={colors}
            label={`Connected to TGP as ${identityLabel}`}
            testID="pairing-check-identity"
          />
          <ChecklistRow
            styles={styles}
            colors={colors}
            label="Previous platform"
            value="Not yet known"
            testID="pairing-check-platform"
            pending
          />
        </View>
        <Text style={styles.body}>Continue on your computer</Text>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={openReview}
          accessibilityRole="button"
          accessibilityLabel="Review clients"
          testID="pairing-review-cta"
        >
          <Text style={styles.secondaryBtnText}>Review clients</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Terminal, retryable/attention states share one honest, calm layout.
  //
  // Copy truthfulness (S6 R3, reaffirmed by brief §4): mobile has no
  // import-progress or server-cancel contract, so no state here may assert
  // what the extension did or did not do, or that anything was retired,
  // revoked, or disconnected — no such endpoint exists (brief §2 row 5). Each
  // message follows fact → remedy → retained-setup: state what happened, what
  // to do next, and that the coach's setup/attempt is kept, not discarded.
  const recoverable: Record<string, { title: string; message: string; cta: string | null }> = {
    expired: {
      title: 'This code expired',
      message: 'Your setup is kept — get a new code to continue.',
      cta: 'Get a new code',
    },
    failed: {
      title: "We couldn't reach the pairing service",
      message:
        'We could not check the pairing status from this device. If you already entered a ' +
        'code in the browser extension, check there. Otherwise check your connection and try again.',
      cta: 'Try again',
    },
    identityUnavailable: {
      title: "We couldn't confirm your account",
      message:
        'Your signed-in account did not load on this device, so no pairing code was created. ' +
        'Try again, or sign out and back in if this keeps happening.',
      cta: 'Try again',
    },
    authExpired: {
      title: 'Your session needs a refresh',
      message: 'Please sign in again, then retry the import from here.',
      cta: 'Retry',
    },
    unavailable: {
      title: 'Import isn’t available yet',
      message: 'Data import isn’t enabled on your account right now. Please check back soon.',
      cta: null,
    },
    cancelled: {
      title: 'Pairing cancelled',
      message:
        'This device stopped checking for the pairing. If you already entered the code in the ' +
        'browser extension, the import may still run there — check the extension. You can ' +
        'start again here whenever you’re ready.',
      cta: 'Start again',
    },
  };
  const baseView = recoverable[status];
  // Contract-named reasons (UX-03c): when the hook supplies a frozen
  // PAIRING_REASON_COPY reason for the current failed/expired state, render
  // that fact→remedy copy verbatim instead of the generic fallback. A null
  // or unrecognized reason keeps the UX-03a/pre-existing copy unchanged.
  const reasonCopy = reason ? PAIRING_REASON_COPY[reason] : null;
  const view =
    reasonCopy && (status === 'failed' || status === 'expired')
      ? { title: baseView.title, message: reasonCopy.message, cta: reasonCopy.remedy }
      : baseView;
  return (
    <View style={[styles.card, styles.cardAttention]} accessibilityLiveRegion="polite" testID={`pairing-${status}`}>
      <Text style={styles.title}>{view.title}</Text>
      <Text style={styles.body} testID="pairing-reason-message">{view.message}</Text>
      {supportReference ? (
        <Text
          style={styles.familyMuted}
          accessibilityLabel={`Support reference ${supportReference}`}
          testID="pairing-support-reference"
        >
          Support reference: {supportReference}
        </Text>
      ) : null}
      {view.cta && (
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={retry}
          accessibilityRole="button"
          accessibilityLabel={view.cta}
          testID="pairing-retry"
        >
          <Text style={styles.primaryBtnText}>{view.cta}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Truthful checklist row for the `paired` state (UX-03a). Each row states
// either a known fact (checkmark) or an explicit "Not yet known" — never an
// inferred or borrowed claim.
function ChecklistRow({
  styles,
  colors,
  label,
  value,
  pending = false,
  testID,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  label: string;
  value?: string;
  pending?: boolean;
  testID: string;
}): React.ReactElement {
  return (
    <View style={styles.checklistRow} testID={testID}>
      {pending ? (
        <Ionicons name="ellipse-outline" size={16} color={colors.textMuted} />
      ) : (
        <Ionicons name="checkmark" size={16} color={colors.primary} />
      )}
      <Text style={styles.checklistLabel}>
        {label}
        {pending ? '' : ' ✓'}
      </Text>
      {value ? <Text style={styles.checklistValue}>{value}</Text> : null}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      gap: 10,
      padding: 16,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    cardOk: { borderColor: colors.primary },
    cardAttention: { borderColor: colors.border },
    label: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    title: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
    code: { fontSize: 34, fontWeight: '600', letterSpacing: 6, color: colors.textPrimary },
    body: { fontSize: 14, lineHeight: 20, color: colors.textSecondary },
    primaryBtn: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 4,
    },
    primaryBtnText: { color: colors.textOnPrimary, fontSize: 16, fontWeight: '600' },
    copyBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      // 44pt minimum touch target (WCAG 2.5.5 / iOS HIG).
      minHeight: 44,
      minWidth: 44,
      paddingRight: 8,
    },
    secondaryBtn: { paddingVertical: 12, alignItems: 'center' },
    secondaryBtnText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
    checklist: {
      gap: 8,
      paddingTop: 12,
      marginTop: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    checklistRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    checklistLabel: { fontSize: 14, color: colors.textPrimary, flexShrink: 1 },
    checklistValue: { fontSize: 14, color: colors.textMuted },
    familyMuted: { fontSize: 13, color: colors.textMuted },
    linkText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  });
}
