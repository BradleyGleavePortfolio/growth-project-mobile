import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { layout, typography, type SemanticTokens } from '../../theme/tokens';
import { QuietOverline, QuietSection, quietActions } from '../../ui/sections/QuietSection';
import { formatDunningAmount, formatDunningDate, type ClientDunningStatus } from './dunningApi';
import { disputePauseFacts } from './dunningErrorCopy';
import { useDunning } from './DunningLockoutProvider';
import { isDisputeCycle, isRefundCycle, lockoutTitle } from './DunningLockoutScreen';

/**
 * The lock date, only while it is still ahead and the lock is not waived
 * (C-353-3: a waived lock keeps access past its date, so no past date).
 */
function upcomingLockDate(status: ClientDunningStatus, now: number): string | null {
  if (status.lock_waived || !status.lockout_at) return null;
  const at = Date.parse(status.lockout_at);
  if (!Number.isFinite(at) || at <= now) return null;
  return formatDunningDate(status.lockout_at);
}

/** Banner copy for Days 0-9. Never invents an amount or a date. */
export function bannerCopy(status: ClientDunningStatus, now: number = Date.now()): { title: string; body: string } {
  const amount = formatDunningAmount(status.amount_cents, status.currency);
  const lockOn = upcomingLockDate(status, now);
  if (isRefundCycle(status)) {
    return {
      title: 'Your plan is paused after a full refund',
      body: status.billing_paused === false
        ? 'A full refund was completed. Access to this plan has ended. The billing pause is being completed; pull down to refresh or message your coach.'
        : `A full refund was completed. ${disputePauseFacts(status.coach_name, 'plan')}`,
    };
  }
  if (isDisputeCycle(status)) {
    // R-DISPUTE-PAUSE (B-353-3 / B-353-6): access to the disputed plan has
    // already ended, so no lock date, no condition and no card fix. B-353-8:
    // an inquiry arrives in the same envelope and moves no money, so the copy
    // says the bank opened a dispute or inquiry, never that money went back.
    const what = `Your bank opened a dispute or inquiry about a payment${amount ? ` of ${amount}` : ''}${
      status.coach_name ? ` to ${status.coach_name}` : ''
    }.`;
    return {
      title: 'Your plan is paused after a payment dispute or inquiry',
      body: `${what} ${disputePauseFacts(status.coach_name, 'plan')}`,
    };
  }
  const failedOn = formatDunningDate(status.failed_at);
  const charge = amount ? `Your payment of ${amount} did not go through` : 'Your last payment did not go through';
  const when = amount && failedOn ? ` on ${failedOn}` : '';
  const keep = lockOn
    ? `Update your card by ${lockOn} to keep access to your plan.`
    : status.lock_waived
      ? 'Update your card to settle it.'
      : 'Update your card to keep access to your plan.';
  return { title: 'Your payment did not go through', body: `${charge}${when}. ${keep}` };
}

/** Day 10+ on an open logging screen: the lockout's own title, no new copy. */
function lockedCopy(status: ClientDunningStatus): { title: string; body: null } {
  return { title: isDisputeCycle(status) ? bannerCopy(status).title : lockoutTitle(status), body: null };
}

/**
 * Inline (in-screen, not floating) past-due notice for Days 0-9 of a failed
 * payment (S-DUNNING). Renders nothing unless the backend reports an active,
 * unlocked v2 cycle, so it is invisible while FEATURE_DUNNING_V2 is off.
 */
export function DunningBanner({
  surface,
  presentation = 'card',
}: {
  surface: string;
  /**
   * 'section' = Home's hairline look (DES-K2-128); 'locked' = the same look at
   * the foot of an open logging screen, only while locked (DunningOwnScreen);
   * other callers keep the card.
   */
  presentation?: 'card' | 'section' | 'locked';
}) {
  const dunning = useDunning();
  const { semanticColors } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors), [semanticColors]);

  // Opens the native Update card screen, which starts the card form.
  const onUpdate = useCallback(() => {
    dunning?.updateCard(surface);
  }, [dunning, surface]);

  const status = dunning?.status;
  const lockedHere = presentation === 'locked';
  if (!dunning || !status || !status.enabled) return null;
  if (lockedHere ? !dunning.locked : status.state !== 'past_due') return null;
  const copy = lockedHere ? lockedCopy(status) : bannerCopy(status);
  const dispute = isDisputeCycle(status);

  if (presentation === 'section' || lockedHere) {
    return (
      <QuietSection testID="dunning-banner" accessibilityRole="alert" style={lockedHere ? styles.locked : undefined}>
        <QuietOverline>PAYMENT</QuietOverline>
        <Text style={[styles.sectionTitle, { color: semanticColors.textPrimary }]}>{copy.title}</Text>
        {copy.body ? <Text style={[styles.sectionBody, { color: semanticColors.textPrimary }]}>{copy.body}</Text> : null}
        <View style={quietActions.row}>
          {dispute ? null : (
            <TouchableOpacity
              style={quietActions.action}
              onPress={onUpdate}
              accessibilityRole="button"
              testID="dunning-banner-update-card"
            >
              <Text style={[quietActions.label, { color: semanticColors.accentText }]}>Update card</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={quietActions.action}
            onPress={dunning.messageCoach}
            accessibilityRole="button"
            testID="dunning-banner-message-coach"
          >
            <Text style={[quietActions.label, { color: dispute ? semanticColors.accentText : semanticColors.textMuted }]}>
              Message coach
            </Text>
          </TouchableOpacity>
        </View>
      </QuietSection>
    );
  }

  return (
    <View style={styles.wrap} testID="dunning-banner" accessibilityRole="alert">
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.body}>{copy.body}</Text>
      <View style={styles.actions}>
        {dispute ? null : (
          <TouchableOpacity
            style={styles.primary}
            onPress={onUpdate}
            accessibilityRole="button"
            testID="dunning-banner-update-card"
          >
            <Text style={styles.primaryText}>Update card</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.secondary}
          onPress={dunning.messageCoach}
          accessibilityRole="button"
          testID="dunning-banner-message-coach"
        >
          <Text style={styles.secondaryText}>Message coach</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (c: SemanticTokens) =>
  StyleSheet.create({
    wrap: {
      borderWidth: 1,
      borderColor: c.accent,
      backgroundColor: c.bgSurface,
      padding: 14,
      borderRadius: 4,
      marginBottom: 16,
    },
    title: { fontSize: 15, fontWeight: '600', color: c.textPrimary, marginBottom: 4 },
    body: { fontSize: 13, lineHeight: 19, color: c.textPrimary },
    actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
    primary: {
      backgroundColor: c.accent,
      paddingHorizontal: 14,
      paddingVertical: 9,
      minWidth: 110,
      alignItems: 'center',
    },
    primaryText: { color: c.textOnAccent, fontSize: 13, fontWeight: '600' },
    secondary: { borderWidth: 1, borderColor: c.border, paddingHorizontal: 14, paddingVertical: 9 },
    secondaryText: { color: c.textPrimary, fontSize: 13, fontWeight: '500' },
    sectionTitle: { ...typography.bodyMd, marginBottom: 4 },
    sectionBody: { ...typography.bodySmall },
    // Above the tab bar, which owns the bottom inset.
    locked: { marginBottom: 0, paddingHorizontal: layout.gutter, paddingVertical: 12, backgroundColor: c.bgPrimary },
  });
