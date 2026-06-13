/**
 * RomanPayoutNotice — §2.12 Coach payout sent to bank (coach app).
 *
 * FACE+VOICE: <RomanAvatar /> appears at line 46 — co-located with the §2.12
 * copy from src/lib/roman/copy.ts. The mascot is "optional" per the spec table
 * but INCLUDED per the cross-cutting operator rule ("wire him up for COACH
 * SCREENS TOO").
 *
 * Mascot expression: neutral default; slight smile on a record payout
 * (celebration, §3.8). On an initiation failure the mascot stays neutral.
 * Payouts are delivered with plain reassurance — no quip (spec §2.12).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import RomanAvatar from './RomanAvatar';
import { romanPayout, type RomanVoiceMode } from '../../lib/roman/copy';
import { colors, spacing, typography } from '../../theme/tokens';

export interface RomanPayoutNoticeProps {
  /** Pre-formatted currency string, e.g. "$240.00". */
  amount: string;
  /**
   * Last four digits of the destination bank account. OPTIONAL — when omitted,
   * the copy drops the "account ending …" clause rather than ship a placeholder
   * token (see lib/roman/copy.ts romanPayout).
   */
  bankLast4?: string;
  /**
   * Pre-formatted date the last payout was sent, e.g. "June 9". Past-tense
   * framing: the mobile earnings contract carries only the historical send
   * timestamp, not an in-transit signal (see lib/roman/copy.ts romanPayout).
   */
  sentOn: string;
  /** default | celebration (record payout) | error (bank declined). */
  mode: RomanVoiceMode;
  testID?: string;
}

export default function RomanPayoutNotice({
  amount,
  bankLast4,
  sentOn,
  mode,
  testID,
}: RomanPayoutNoticeProps): React.ReactElement {
  const crop = mode === 'celebration' ? 'smile' : 'neutral';
  const line = romanPayout({ amount, bankLast4, sentOn, mode });
  return (
    <View style={styles.row} testID={testID} accessibilityRole="summary">
      {/* FACE+VOICE: avatar co-located with the §2.12 payout copy. */}
      <RomanAvatar crop={crop} size={32} testID="roman-payout-avatar" />
      <Text
        style={styles.copy}
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
      >
        {line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  copy: {
    ...typography.body,
    color: colors.ink,
    flex: 1,
  },
});
