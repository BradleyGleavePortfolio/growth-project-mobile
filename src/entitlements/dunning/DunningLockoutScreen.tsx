import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';
import { formatDunningAmount, formatDunningDate, type ClientDunningStatus } from './dunningApi';
import { SUPPORT_EMAIL, type DunningErrorCopy } from './dunningErrorCopy';

export interface DunningLockoutScreenProps {
  status: ClientDunningStatus | null;
  loadError: DunningErrorCopy | null;
  refreshing: boolean;
  onRefresh: () => Promise<void> | void;
  onUpdateCard: (surface: string) => Promise<DunningErrorCopy | null>;
  onMessageCoach: () => void;
  onOpenDataExport: () => void;
  onOpenDeleteAccount: () => void;
  onSignOut: () => void;
  /** Request id of the 403 that locked the app, for the support email. */
  supportReference: string | null;
}

/** What happened, in one calm paragraph. Never invents an amount or a date. */
export function lockoutSummary(status: ClientDunningStatus | null): string {
  const amount = formatDunningAmount(status?.amount_cents ?? null, status?.currency ?? null);
  const since = formatDunningDate(status?.failed_at ?? null);
  const coach = status?.coach_name ?? 'your coach';
  const what = amount ? `Your payment of ${amount} to ${coach}` : `Your payment to ${coach}`;
  const when = since ? ` has not gone through since ${since}` : ' has not gone through for 10 days';
  return `${what}${when}, so your plan is paused. Your data is safe and nothing has been deleted.`;
}

export function supportMailto(reference: string | null): string {
  const subject = encodeURIComponent('Paused plan: payment help');
  const body = encodeURIComponent(
    reference ? `Request reference: ${reference}\n\n` : 'My plan is paused after a failed payment.\n\n',
  );
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}

export function DunningLockoutScreen({
  status,
  loadError,
  refreshing,
  onRefresh,
  onUpdateCard,
  onMessageCoach,
  onOpenDataExport,
  onOpenDeleteAccount,
  onSignOut,
  supportReference,
}: DunningLockoutScreenProps) {
  const { semanticColors } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors), [semanticColors]);
  const [busy, setBusy] = useState(false);
  const [cardError, setCardError] = useState<DunningErrorCopy | null>(null);
  const [mailError, setMailError] = useState<string | null>(null);

  const handleUpdateCard = useCallback(async () => {
    setBusy(true);
    setCardError(null);
    const failure = await onUpdateCard('DunningLockoutScreen');
    setCardError(failure);
    setBusy(false);
  }, [onUpdateCard]);

  const handleContactSupport = useCallback(async () => {
    setMailError(null);
    const reference = cardError?.reference ?? loadError?.reference ?? supportReference;
    try {
      await Linking.openURL(supportMailto(reference));
    } catch {
      setMailError(
        `No email app opened on this device. Write to ${SUPPORT_EMAIL}${reference ? ` and include reference ${reference}` : ''}.`,
      );
    }
  }, [cardError, loadError, supportReference]);

  const card = status?.card_last4 ? ` The card ending ${status.card_last4} was declined.` : '';
  const coachLabel = status?.coach_name ? `Message ${status.coach_name}` : 'Message your coach';

  return (
    <SafeAreaView style={styles.root} testID="dunning-lockout-screen">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.eyebrow}>Payment</Text>
        <Text style={styles.title} accessibilityRole="header">
          Your plan is paused
        </Text>
        <Text style={styles.body} testID="dunning-lockout-summary">
          {lockoutSummary(status)}
          {card}
        </Text>
        <Text style={styles.body}>
          To restore access, tap Update card, add a card that works, then pay the open invoice
          under Invoice history. Access returns within a few minutes of the payment clearing.
        </Text>
        {loadError ? (
          <Text style={styles.notice} testID="dunning-lockout-load-error">
            {loadError.message}
          </Text>
        ) : null}

        <TouchableOpacity
          style={[styles.primary, busy && styles.disabled]}
          onPress={handleUpdateCard}
          disabled={busy}
          accessibilityRole="button"
          testID="dunning-lockout-update-card"
        >
          {busy ? (
            <ActivityIndicator color={semanticColors.textOnAccent} />
          ) : (
            <Text style={styles.primaryText}>Update card</Text>
          )}
        </TouchableOpacity>
        {cardError ? (
          <Text style={styles.notice} testID="dunning-lockout-card-error">
            {cardError.message}
          </Text>
        ) : null}

        <TouchableOpacity
          style={styles.secondary}
          onPress={onMessageCoach}
          accessibilityRole="button"
          testID="dunning-lockout-message-coach"
        >
          <Text style={styles.secondaryText}>{coachLabel}</Text>
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>Still available while your plan is paused</Text>
        <Row label="Download my data" onPress={onOpenDataExport} styles={styles} testID="dunning-lockout-data-export" />
        <Row label="Delete my account" onPress={onOpenDeleteAccount} styles={styles} testID="dunning-lockout-delete-account" />
        <Row label="Email support" onPress={handleContactSupport} styles={styles} testID="dunning-lockout-support" />
        {mailError ? <Text style={styles.notice}>{mailError}</Text> : null}
        <Row label="Sign out" onPress={onSignOut} styles={styles} testID="dunning-lockout-sign-out" />

        <Text style={styles.footnote}>
          Already paid? Pull down to check again.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  onPress,
  styles,
  testID,
}: {
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  testID: string;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} accessibilityRole="button" testID={testID}>
      <Text style={styles.rowText}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c: SemanticTokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bgPrimary },
    content: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 40 },
    eyebrow: { fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: c.textMuted, marginBottom: 8 },
    title: { fontSize: 26, fontWeight: '600', color: c.textPrimary, marginBottom: 16 },
    body: { fontSize: 15, lineHeight: 22, color: c.textPrimary, marginBottom: 12 },
    notice: { fontSize: 13, lineHeight: 19, color: c.accentText, marginTop: 8, marginBottom: 4 },
    primary: {
      backgroundColor: c.accent,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 12,
    },
    disabled: { opacity: 0.6 },
    primaryText: { color: c.textOnAccent, fontSize: 15, fontWeight: '600' },
    secondary: {
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 12,
    },
    secondaryText: { color: c.textPrimary, fontSize: 15, fontWeight: '500' },
    sectionLabel: { fontSize: 13, color: c.textMuted, marginTop: 32, marginBottom: 4 },
    row: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    rowText: { fontSize: 15, color: c.textPrimary },
    footnote: { fontSize: 12, color: c.textMuted, marginTop: 24 },
  });
