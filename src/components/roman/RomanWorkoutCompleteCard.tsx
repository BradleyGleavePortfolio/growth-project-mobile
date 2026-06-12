/**
 * RomanWorkoutCompleteCard — §2.8 Workout completed (client app).
 *
 * FACE+VOICE: <RomanAvatar /> appears at line 48 — co-located with the §2.8
 * copy from src/lib/roman/copy.ts.
 *
 * Mascot expression (spec §4 table): neutral default; the knowing slight smile
 * on a personal best (celebration). On a save error the mascot stays neutral.
 *
 * PR detection: the host passes `mode="celebration"` and `liftName` when the
 * session contained a personal best (derive from session deltas if not already
 * wired). The copy function falls back to the default line if a celebration is
 * requested with no lift name, so a hollow "personal best on ." never renders.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import RomanAvatar from './RomanAvatar';
import { romanWorkoutComplete, type RomanVoiceMode } from '../../lib/roman/copy';
import { colors, spacing, typography } from '../../theme/tokens';

export interface RomanWorkoutCompleteCardProps {
  /** default | celebration (personal best) | error (finished but unsaved). */
  mode: RomanVoiceMode;
  /** Lift name for the PR celebration line. */
  liftName?: string;
  testID?: string;
}

export default function RomanWorkoutCompleteCard({
  mode,
  liftName,
  testID,
}: RomanWorkoutCompleteCardProps): React.ReactElement {
  // §3.8 / §4: slight smile only on the PR celebration.
  const crop = mode === 'celebration' ? 'smile' : 'neutral';
  // Deferred (roman-quip-budget): §2.8 permits a situation-aimed quip
  // ("The weights have no comment."). Gate on the ~1-in-8 ceiling (§1.5).
  const line = romanWorkoutComplete({ mode, liftName });
  return (
    <View style={styles.card} testID={testID} accessibilityRole="summary">
      {/* FACE+VOICE: avatar co-located with the §2.8 workout-complete copy. */}
      <RomanAvatar crop={crop} size={48} testID="roman-workout-avatar" />
      <Text style={styles.copy} accessibilityRole="text">
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
