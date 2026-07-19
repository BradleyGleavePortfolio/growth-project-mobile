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
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
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
  const { status, code, start, retry, cancel } = pairing;
  const { delta } = useRosterReviewDelta();
  const startedRef = useRef(false);

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
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.body}>Preparing your secure pairing code…</Text>
      </View>
    );
  }

  if (status === 'waiting') {
    return (
      <View style={styles.card} accessibilityLiveRegion="polite" testID="pairing-waiting">
        <Text style={styles.label}>Enter this code in the browser extension</Text>
        <Text style={styles.code} accessibilityLabel={`Pairing code ${code?.split('').join(' ')}`} testID="pairing-code">
          {code}
        </Text>
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
    secondaryBtn: { paddingVertical: 12, alignItems: 'center' },
    secondaryBtnText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  });
}
