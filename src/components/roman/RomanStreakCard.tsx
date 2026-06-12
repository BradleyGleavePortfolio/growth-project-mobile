/**
 * RomanStreakCard — §2.7 Streak milestone (client app), 3 / 7 / 30 day.
 *
 * FACE+VOICE: <RomanAvatar /> appears at line 52 — co-located with the §2.7
 * copy from src/lib/roman/copy.ts.
 *
 * Mascot expression (spec §3.8 / §4 table): NEUTRAL on the 3-day tier (which
 * is `default` mode), the knowing SLIGHT SMILE on 7-day and 30-day (which are
 * `celebration` mode). On an error (count failed to tally) the mascot stays
 * neutral.
 *
 * The 30-day celebration line carries the session's one permitted exclamation
 * (spec §1.4 / §2.7). P3 ships the spec variants; the dry-quip option on the
 * lower tiers is deferred to the quip-budget pass (see the deferred note
 * below).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import RomanAvatar from './RomanAvatar';
import {
  romanStreak,
  type RomanStreakTier,
  type RomanVoiceMode,
} from '../../lib/roman/copy';
import { colors, spacing, typography } from '../../theme/tokens';

export interface RomanStreakCardProps {
  /** Milestone tier reached (3 / 7 / 30). */
  tier: RomanStreakTier;
  firstName: string;
  /**
   * default (3-day) | celebration (7/30-day) | error (count failed). When the
   * tier is 7 or 30 and there is no error, pass `celebration`; the 3-day tier
   * uses `default`.
   */
  mode: RomanVoiceMode;
  testID?: string;
}

export default function RomanStreakCard({
  tier,
  firstName,
  mode,
  testID,
}: RomanStreakCardProps): React.ReactElement {
  // §3.8: slight smile ONLY on the 7/30-day celebration (never on 3-day, never
  // on the error tally state).
  const crop = mode === 'celebration' ? 'smile' : 'neutral';
  // Deferred (roman-quip-budget): §2.7 permits a situation-aimed quip on the
  // lower tiers (e.g. 3-day "I'm keeping count so you don't have to."). Gate it
  // on the ~1-in-8 ceiling (§1.5) before shipping a quip variant.
  const line = romanStreak({ tier, firstName, mode });
  return (
    <View style={styles.card} testID={testID} accessibilityRole="summary">
      {/* FACE+VOICE: avatar co-located with the §2.7 streak copy. */}
      <RomanAvatar crop={crop} size={48} testID="roman-streak-avatar" />
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
  card: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.cream,
    borderRadius: 4,
  },
  copy: {
    ...typography.h4,
    color: colors.ink,
    textAlign: 'center',
  },
});
