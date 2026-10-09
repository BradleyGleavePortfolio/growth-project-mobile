import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { SUPPORT_EMAIL } from '../../constants/support';
import { cancelOutcomeCopy, disputePauseFacts, type DunningErrorCopy } from './dunningErrorCopy';
import { dunningLockoutStore } from './dunningLockoutStore';
import type { EndPlanOwner, EndPlanResult } from './DunningLockoutProvider';

export interface DunningLockoutScreenProps {
  status: ClientDunningStatus | null;
  loadError: DunningErrorCopy | null;
  refreshing: boolean;
  onRefresh: () => Promise<void> | void;
  /** Opens the native Update card screen (reachable while locked). */
  onUpdateCard: (surface: string) => void;
  /**
   * 2A: void the unpaid invoice and end the plan now. `owner` is bound when
   * the confirmation opens (B-353-2): a retired owner sends nothing.
   */
  onEndPlan: (surface: string, owner: EndPlanOwner) => Promise<EndPlanResult>;
  onMessageCoach: () => void;
  onOpenDataExport: () => void;
  onOpenDeleteAccount: () => void;
  onSignOut: () => void;
  /** Request id of the 403 that locked the app, for the support email. */
  supportReference: string | null;
  /** Set over a screen that stays open while locked: Back returns there. */
  onBack?: () => void;
  /** Own logging stays open (owner ruling 2026-10-08 23:5x); the lockout covers the tab bar. */
  onOpenFood?: () => void;
  onOpenTrain?: () => void;
}

/**
 * True when the bank opened a dispute or an inquiry about a payment
 * (R-DISPUTE-PAUSE: access has ended, billing is paused, the coach decides on
 * restarting). The envelope does not say whether money was withdrawn (an
 * inquiry moves none), so no surface claims a reversal (B-353-8).
 */
export function isDisputeCycle(status: ClientDunningStatus | null | undefined): boolean {
  // Compatibility name shared by the action gates: both pauses require
  // the coach to restart, never a card update or an automatic recovery.
  return status?.kind === 'dispute' || status?.reason === 'dispute_paused' || isRefundCycle(status);
}

export function isRefundCycle(status: ClientDunningStatus | null | undefined): boolean {
  return status?.kind === 'refund' || status?.reason === 'refund_paused';
}

/** 'account' when the dispute locks the whole app, 'plan' when another plan keeps access. */
export function disputeScope(status: ClientDunningStatus | null | undefined): 'account' | 'plan' {
  return status?.state === 'locked' && !status.lock_waived ? 'account' : 'plan';
}

/** True while a payment is overdue or disputed and the plan is not ended. */
function inDunning(status: ClientDunningStatus | null | undefined): boolean {
  return Boolean(status?.enabled && (status.state === 'past_due' || status.state === 'locked'));
}

/**
 * What happened, in one calm paragraph. Never invents an amount, a date or
 * a cause: before the status loads it says only that a payment problem
 * paused the plan (the 403 does not say which kind).
 */
export function lockoutSummary(status: ClientDunningStatus | null): string {
  const safe = 'Your data is safe and nothing has been deleted.';
  if (!status) return `Your plan is paused because of a payment problem. ${safe}`;
  const amount = formatDunningAmount(status.amount_cents ?? null, status.currency ?? null);
  const coach = status.coach_name ?? 'your coach';
  if (isRefundCycle(status)) {
    const facts = status.billing_paused === false
      ? 'Access to this plan has ended. The billing pause is being completed; pull down to refresh or message your coach.'
      : disputePauseFacts(status.coach_name, disputeScope(status));
    return `A payment for your plan with ${coach} was fully refunded. ${facts} ${safe}`;
  }
  if (isDisputeCycle(status)) {
    // R-DISPUTE-PAUSE (B-353-3 / B-353-6): the three facts, no lock date, no card fix.
    return `Your bank opened a dispute or inquiry about a payment${amount ? ` of ${amount}` : ''} to ${coach}. ${disputePauseFacts(
      status.coach_name,
      disputeScope(status),
    )} ${safe}`;
  }
  const since = formatDunningDate(status.failed_at ?? null);
  const what = amount ? `Your payment of ${amount} to ${coach}` : `Your payment to ${coach}`;
  const when = since ? ` has not gone through since ${since}` : ' has not gone through for 10 days';
  return `${what}${when}, so your plan is paused. ${safe}`;
}

/** The lockout's headline; the open logging screens' notice reuses it. */
export function lockoutTitle(status: ClientDunningStatus | null | undefined): string {
  return isDisputeCycle(status) ? 'Your access has ended' : 'Your plan is paused';
}

/**
 * The next step, true for the lock kind. A failed payment: a working card is
 * charged right away and the plan comes back once it clears (ruling D12). A
 * dispute or inquiry: only the coach restarts the plan, so the step is a
 * message to the coach; support answers questions, it does not restore access.
 */
export function lockoutNextStep(status: ClientDunningStatus | null): string {
  if (!status) return 'Pull down to load the details, or email support.';
  if (isDisputeCycle(status)) {
    const coach = status.coach_name ? `Message ${status.coach_name}` : 'Message your coach';
    return `${coach} to talk about restarting. For any other question, email ${SUPPORT_EMAIL}.`;
  }
  return 'To restore access, tap Update card and add a card that works. The card is charged right away, and your plan comes back as soon as the payment clears.';
}

/**
 * The End my plan confirmation, shared by the lockout and the Update card
 * screen. In dunning (2A) access ends now; a payment that landed in the
 * meantime keeps the paid period (backend cancel rule). A dispute or inquiry:
 * access has already ended and billing is paused (R-DISPUTE-PAUSE); the
 * screens offer no End my plan for it (D2c has no cancel route), so this
 * body only keeps any older entry point truthful. Outside dunning (option A)
 * access runs to the end of the paid period.
 */
export function endPlanAlertBody(status: ClientDunningStatus | null | undefined): string {
  const amount = formatDunningAmount(status?.amount_cents ?? null, status?.currency ?? null);
  if (inDunning(status) && isDisputeCycle(status)) {
    return `Access to this plan has already ended and its billing is paused. Your coach decides whether to restart it. If you end it, the plan ends now instead. Your data stays in your account.`;
  }
  if (inDunning(status)) {
    return `${amount ? `The unpaid ${amount} is canceled, so you are not charged for it.` : 'The unpaid balance is canceled, so you are not charged for it.'} Your access ends now. If a payment went through in the meantime, you keep the period you paid for instead. Your data stays in your account.`;
  }
  return 'Your plan ends at the end of the period you already paid for, and you will not be charged again. There is no refund for the current period. Your data stays in your account.';
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
  onBack,
  onOpenFood,
  onOpenTrain,
}: DunningLockoutScreenProps) {
  const { semanticColors } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors), [semanticColors]);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<DunningErrorCopy | null>(null);
  // B-353-1: a lockout that went away (account switch, unlock) never shows a
  // late End my plan answer or writes state.
  const aliveRef = useRef(true);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );
  const dispute = isDisputeCycle(status);

  const handleUpdateCard = useCallback(() => {
    onUpdateCard('DunningLockoutScreen');
  }, [onUpdateCard]);

  const handleEndPlan = useCallback(() => {
    if (ending) return;
    // B-353-2: the confirmation belongs to this screen, this account and the
    // plan on screen when it opened. Accepted after any of them is gone, it
    // sends nothing.
    const generation = dunningLockoutStore.currentGeneration();
    const isCurrent = () => aliveRef.current && generation === dunningLockoutStore.currentGeneration();
    const owner: EndPlanOwner = { purchaseId: status?.purchase_id ?? null, isCurrent };
    Alert.alert('End your plan now?', endPlanAlertBody(status), [
      { text: 'Keep my plan', style: 'cancel' },
      {
        text: 'End my plan',
        style: 'destructive',
        onPress: () => {
          if (!isCurrent()) return;
          setEnding(true);
          setEndError(null);
          void onEndPlan('DunningLockoutScreen', owner)
            .then((out) => {
              if (!isCurrent() || ('retired' in out && out.retired)) return;
              if (out.ok) {
                const c = cancelOutcomeCopy(out.response, { dispute });
                Alert.alert(c.title, c.body);
              } else if (out.error) {
                setEndError(out.error);
              }
            })
            .finally(() => {
              if (isCurrent()) setEnding(false);
            });
        },
      },
    ]);
  }, [ending, onEndPlan, status, dispute]);

  const reference = endError?.reference ?? loadError?.reference ?? supportReference;
  const supportEmail = useSupportEmail(DUNNING_SUPPORT_SUBJECT, dunningSupportBody(reference));
  const referenceNote = dunningSupportReferenceNote(reference);
  const handleContactSupport = useCallback(() => {
    void supportEmail.open();
  }, [supportEmail]);

  // C-353-2: "declined" only for a failed payment, never for a dispute.
  const card = status?.card_last4 && status && !dispute ? ` The card ending ${status.card_last4} was declined.` : '';
  const coachLabel = status?.coach_name ? `Message ${status.coach_name}` : 'Message your coach';

  return (
    <SafeAreaView style={styles.root} testID="dunning-lockout-screen">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {onBack ? (
          <TouchableOpacity style={styles.back} onPress={onBack} accessibilityRole="button" testID="dunning-lockout-back">
            <Text style={styles.rowText}>Back</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={styles.eyebrow}>Payment</Text>
        <Text style={styles.title} accessibilityRole="header">
          {lockoutTitle(status)}
        </Text>
        <Text style={styles.body} testID="dunning-lockout-summary">
          {lockoutSummary(status)}
          {card}
        </Text>
        <Text style={styles.body} testID="dunning-lockout-next-step">
          {lockoutNextStep(status)}
        </Text>
        {loadError ? (
          <Text style={styles.notice} testID="dunning-lockout-load-error">
            {loadError.message}
          </Text>
        ) : null}

        {/* R-DISPUTE-PAUSE: for a dispute or inquiry the coach is the only way
            back, so Message coach leads and there is no card or End my plan
            path (D2c sends neither route). */}
        {dispute ? null : (
          <TouchableOpacity
            style={styles.primary}
            onPress={handleUpdateCard}
            accessibilityRole="button"
            testID="dunning-lockout-update-card"
          >
            <Text style={styles.primaryText}>Update card</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={dispute ? styles.primary : styles.secondary}
          onPress={onMessageCoach}
          accessibilityRole="button"
          testID="dunning-lockout-message-coach"
        >
          <Text style={dispute ? styles.primaryText : styles.secondaryText}>{coachLabel}</Text>
        </TouchableOpacity>

        {dispute ? null : (
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
        )}
        {endError ? (
          <Text style={styles.notice} testID="dunning-lockout-end-error">
            {endError.message}
          </Text>
        ) : null}

        <Text style={styles.sectionLabel}>{dispute ? 'Still available' : 'Still available while your plan is paused'}</Text>
        {onOpenFood ? <Row label="Log food" onPress={onOpenFood} styles={styles} testID="dunning-lockout-food" /> : null}
        {onOpenTrain ? <Row label="Log a workout" onPress={onOpenTrain} styles={styles} testID="dunning-lockout-train" /> : null}
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

        {dispute ? null : <Text style={styles.footnote}>Already paid? Pull down to check again.</Text>}
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
    back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginBottom: 8 },
    row: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    rowText: { fontSize: 15, color: c.textPrimary },
    footnote: { fontSize: 12, color: c.textMuted, marginTop: 24 },
  });
