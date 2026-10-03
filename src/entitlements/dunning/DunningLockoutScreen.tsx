import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { SupportEmailFallback, useSupportEmail } from '../../components/support/SupportEmailFallback';
import { cancelOutcomeCopy, type DunningErrorCopy } from './dunningErrorCopy';
import type { EndPlanResult } from './DunningLockoutProvider';

export interface DunningLockoutScreenProps {
  status: ClientDunningStatus | null;
  loadError: DunningErrorCopy | null;
  refreshing: boolean;
  onRefresh: () => Promise<void> | void;
  /** Opens the native Update card screen (reachable while locked). */
  onUpdateCard: (surface: string) => void;
  /** 2A: void the unpaid invoice and end the plan now. */
  onEndPlan: (surface: string) => Promise<EndPlanResult>;
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

/** Subject of every support email from the payment screens. */
export const DUNNING_SUPPORT_SUBJECT = 'Paused plan: payment help';

/** Prefilled support email body: the request reference when there is one. */
export function dunningSupportBody(reference: string | null): string {
  return reference
    ? `Request reference: ${reference}\n\n`
    : 'My plan is paused after a failed payment.\n\n';
}

/** Shown with the copy-address fallback so the reference is never lost. */
export function dunningSupportReferenceNote(reference: string | null): string | null {
  return reference ? `Include reference ${reference} in your email.` : null;
}

export function DunningLockoutScreen({
  status,
  loadError,
  refreshing,
  onRefresh,
  onUpdateCard,
  onEndPlan,
  onMessageCoach,
  onOpenDataExport,
  onOpenDeleteAccount,
  onSignOut,
  supportReference,
}: DunningLockoutScreenProps) {
  const { semanticColors } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors), [semanticColors]);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<DunningErrorCopy | null>(null);

  const handleUpdateCard = useCallback(() => {
    onUpdateCard('DunningLockoutScreen');
  }, [onUpdateCard]);

  const handleEndPlan = useCallback(() => {
    if (ending) return;
    const amount = formatDunningAmount(status?.amount_cents ?? null, status?.currency ?? null);
    Alert.alert(
      'End your plan now?',
      `${amount ? `The unpaid ${amount} is canceled, so you are not charged for it.` : 'The unpaid balance is canceled, so you are not charged for it.'} Your plan ends today. Your data stays in your account.`,
      [
        { text: 'Keep my plan', style: 'cancel' },
        {
          text: 'End my plan',
          style: 'destructive',
          onPress: () => {
            setEnding(true);
            setEndError(null);
            void onEndPlan('DunningLockoutScreen')
              .then((out) => {
                if (out.ok) {
                  const c = cancelOutcomeCopy(out.response);
                  Alert.alert(c.title, c.body);
                } else {
                  setEndError(out.error);
                }
              })
              .finally(() => setEnding(false));
          },
        },
      ],
    );
  }, [ending, onEndPlan, status]);

  const reference = endError?.reference ?? loadError?.reference ?? supportReference;
  const supportEmail = useSupportEmail(DUNNING_SUPPORT_SUBJECT, dunningSupportBody(reference));
  const referenceNote = dunningSupportReferenceNote(reference);
  const handleContactSupport = useCallback(() => {
    void supportEmail.open();
  }, [supportEmail]);

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
          To restore access, tap Update card and add a card that works. We charge it right away,
          and your plan comes back as soon as the payment clears.
        </Text>
        {loadError ? (
          <Text style={styles.notice} testID="dunning-lockout-load-error">
            {loadError.message}
          </Text>
        ) : null}

        <TouchableOpacity
          style={styles.primary}
          onPress={handleUpdateCard}
          accessibilityRole="button"
          testID="dunning-lockout-update-card"
        >
          <Text style={styles.primaryText}>Update card</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondary}
          onPress={onMessageCoach}
          accessibilityRole="button"
          testID="dunning-lockout-message-coach"
        >
          <Text style={styles.secondaryText}>{coachLabel}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondary, ending && styles.disabled]}
          onPress={handleEndPlan}
          disabled={ending}
          accessibilityRole="button"
          testID="dunning-lockout-end-plan"
        >
          {ending ? (
            <ActivityIndicator color={semanticColors.textPrimary} />
          ) : (
            <Text style={styles.secondaryText}>End my plan</Text>
          )}
        </TouchableOpacity>
        {endError ? (
          <Text style={styles.notice} testID="dunning-lockout-end-error">
            {endError.message}
          </Text>
        ) : null}

        <Text style={styles.sectionLabel}>Still available while your plan is paused</Text>
        <Row label="Download my data" onPress={onOpenDataExport} styles={styles} testID="dunning-lockout-data-export" />
        <Row label="Delete my account" onPress={onOpenDeleteAccount} styles={styles} testID="dunning-lockout-delete-account" />
        <Row label="Email support" onPress={handleContactSupport} styles={styles} testID="dunning-lockout-support" />
        <SupportEmailFallback
          handle={supportEmail}
          textStyle={styles.notice}
          linkColor={semanticColors.textPrimary}
          testID="dunning-lockout-support-fallback"
        />
        {supportEmail.state !== 'idle' && referenceNote ? (
          <Text style={styles.notice} selectable testID="dunning-lockout-support-reference">
            {referenceNote}
          </Text>
        ) : null}
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
