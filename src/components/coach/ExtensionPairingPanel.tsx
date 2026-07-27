/**
 * ExtensionPairingPanel — the live pairing surface of the v0.3 import flow
 * (PR-M2). Mounted only once the coach has opened their prior platform's login
 * page (ImportDataScreen `awaitingExtension`). It mints a pairing code, shows it
 * for the coach to read into the browser extension, and reflects honest,
 * contract-backed lifecycle states via useExtensionPairing.
 *
 * Honesty guardrails: the mobile contract has no import-progress read, so the
 * terminal this panel can truthfully show is `paired` ("running in the
 * extension") — it never renders importing/partial/complete or any page/entity
 * count. Once paired, the panel offers a truthful, roster-derived review: the
 * ONLY progress it reports is how many clients have appeared in the coach's
 * authoritative roster since the import started (useRosterReviewDelta), plus a
 * typed CTA into the existing Clients list. Cancel is a local abandon (no server
 * cancel exists).
 *
 * Accessibility + copy (M5-F): the code is rendered at 34pt with 6pt letter
 * spacing, which at large accessibility text sizes used to clip mid-code — and
 * a clipped pairing code is unusable, not merely ugly. It is now capped and
 * shrink-to-fit on a single line, exposed to screen readers digit-by-digit
 * (so "482913" is never read as "four hundred eighty-two thousand..."), and
 * backed by a copy control, because reading six digits back and forth to a
 * browser is exactly the task that motor and vision impairments make hardest.
 * The copy confirmation reflects the ACTUAL clipboard result (Rule 18) — a
 * failed write says so rather than claiming success.
 *
 * Support correlation (M5-D): when the backend supplies a request id on a
 * failure, the panel shows it as a quotable reference. It is displayed only
 * when real, and never presented as an explanation of what went wrong.
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
import { useExtensionPairing } from '../../hooks/useExtensionPairing';
import { useRosterReviewDelta } from '../../hooks/useRosterReviewDelta';
import {
  useReconstructCounts,
  type ReconstructFamilyCounts,
} from '../../hooks/useReconstructCounts';
import { FAMILY_LABELS } from '../../types/importReview';
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
  const { status, code, supportReference, start, retry, cancel } = pairing;
  const { delta } = useRosterReviewDelta();
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
    // Roster truth is the ONLY progress source: delta > 0 states the real number
    // of new clients since journey start; delta == 0 is a calm, honest
    // still-running message. Neither ever claims imported/complete/partial/%.
    const reviewCopy =
      delta > 0
        ? `${delta} new ${delta === 1 ? 'client' : 'clients'} since you started this import`
        : 'No new clients have arrived yet. Your import is still running in the browser extension.';
    return (
      <View style={[styles.card, styles.cardOk]} accessibilityLiveRegion="polite" testID="pairing-paired">
        <Ionicons name="checkmark-circle-outline" size={22} color={colors.primary} />
        <Text style={styles.title}>Paired</Text>
        <Text style={styles.body} testID="pairing-review-delta">
          {reviewCopy}
        </Text>
        <Text style={styles.body}>
          Your import runs in the browser extension. Your client roster is the source of
          truth — open it to review new clients as they arrive.
        </Text>
        <ReconstructCountsSection />
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={openReview}
          accessibilityRole="button"
          accessibilityLabel="Review clients"
          testID="pairing-review-cta"
        >
          <Text style={styles.primaryBtnText}>Review clients</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Terminal, retryable/attention states share one honest, calm layout.
  const recoverable: Record<string, { title: string; message: string; cta: string | null }> = {
    expired: {
      title: 'That code expired',
      message: 'Pairing codes are short-lived for your security. Generate a new one to continue.',
      cta: 'Get a new code',
    },
    failed: {
      title: "We couldn't reach the pairing service",
      message: 'Check your connection and try again. Nothing was imported.',
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
      message: 'No import was started. You can begin again whenever you’re ready.',
      cta: 'Start again',
    },
  };
  const view = recoverable[status];
  return (
    <View style={[styles.card, styles.cardAttention]} accessibilityLiveRegion="polite" testID={`pairing-${status}`}>
      <Text style={styles.title}>{view.title}</Text>
      <Text style={styles.body}>{view.message}</Text>
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

// PR-M4 per-family counts/reasons block inside the paired panel. Page-local
// counts + stable reasons only — never a total/percentage/ETA/completion.
// Renders nothing when the kill switch is off (hook fails closed).
function ReconstructCountsSection(): React.ReactElement | null {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { enabled, families } = useReconstructCounts();
  if (!enabled) return null;
  return (
    <View
      style={styles.reviewBlock}
      accessibilityLiveRegion="polite"
      testID="reconstruct-counts"
    >
      <Text style={styles.label}>What we’ve reconstructed so far</Text>
      {families.map((f) => (
        <ReconstructFamilyRow
          key={f.family}
          family={f}
          styles={styles}
          colors={colors}
        />
      ))}
    </View>
  );
}

function ReconstructFamilyRow({
  family,
  styles,
  colors,
}: {
  family: ReconstructFamilyCounts;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}): React.ReactElement {
  const {
    family: name,
    count,
    reasons,
    isLoading,
    isRefreshing,
    errorKind,
    hasData,
    hasMore,
    fetchMore,
    retry,
  } = family;
  const label = FAMILY_LABELS[name];

  // First load, nothing to show yet.
  if (isLoading && !hasData) {
    return (
      <View style={styles.familyRow} testID={`reconstruct-${name}-loading`}>
        <Text style={styles.familyLabel}>{label}</Text>
        <ActivityIndicator
          color={colors.primary}
          accessibilityRole="progressbar"
          accessibilityLabel={`Loading ${label}`}
        />
      </View>
    );
  }

  // Hard failure with no prior data → explicit error + retry (never a silent
  // zero that would read as "nothing to import").
  if (errorKind && !hasData) {
    return (
      <View style={styles.familyRow} testID={`reconstruct-${name}-error`}>
        <Text style={styles.familyLabel}>{label}</Text>
        <View style={styles.familyErrorRow}>
          <Text style={styles.familyMuted}>Couldn’t load. </Text>
          <TouchableOpacity
            onPress={retry}
            accessibilityRole="button"
            accessibilityLabel={`Retry ${label}`}
            testID={`reconstruct-${name}-retry`}
          >
            <Text style={styles.linkText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Page-local truth only: "N loaded so far" (never a total/percentage), or a
  // calm "None yet" when the loaded pages are empty.
  const countLabel = count === 0 ? 'None yet' : `${count} loaded so far`;
  return (
    <View style={styles.familyRow} testID={`reconstruct-${name}`}>
      <View style={styles.familyHeader}>
        <Text style={styles.familyLabel}>{label}</Text>
        <Text style={styles.familyCount} testID={`reconstruct-${name}-count`}>
          {countLabel}
          {isRefreshing ? ' · refreshing…' : ''}
        </Text>
      </View>
      {reasons.map((r) => (
        <Text
          key={r.code}
          style={styles.familyReason}
          testID={`reconstruct-${name}-reason`}
        >
          {r.message}
        </Text>
      ))}
      {errorKind && hasData ? (
        <Text style={styles.familyMuted} testID={`reconstruct-${name}-stale`}>
          Couldn’t refresh just now — showing what loaded earlier.
        </Text>
      ) : null}
      {hasMore ? (
        <TouchableOpacity
          onPress={fetchMore}
          accessibilityRole="button"
          accessibilityLabel={`Load more ${label}`}
          testID={`reconstruct-${name}-more`}
        >
          <Text style={styles.linkText}>Load more</Text>
        </TouchableOpacity>
      ) : null}
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
    reviewBlock: {
      gap: 8,
      paddingTop: 12,
      marginTop: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    familyRow: { gap: 4 },
    familyHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    familyErrorRow: { flexDirection: 'row', alignItems: 'center' },
    familyLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
    familyCount: { fontSize: 13, color: colors.textSecondary },
    familyReason: { fontSize: 13, lineHeight: 18, color: colors.textSecondary },
    familyMuted: { fontSize: 13, color: colors.textMuted },
    linkText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  });
}
