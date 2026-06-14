/**
 * RomanBriefCard — §2.3 Coach Brief delivery (coach app, morning ritual).
 *
 * Roman P3 surface — co-locates <RomanAvatar /> with the §2.3 Roman copy
 * rendered below, in this same component tree, per the operator rule "his
 * voice always appears WITH HIS FACE" and "wire him up for COACH SCREENS TOO".
 * See FACE+VOICE invariant in src/lib/roman/copy.ts.
 *
 * Mascot expression: neutral by default; the knowing slight smile (§3.8) on a
 * record morning (celebration mode). The brief is a daily surface, so the
 * default line ships quip-free (the §2.3 quip is left for a future budgeted
 * pass — see the deferred note below).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import RomanAvatar from './RomanAvatar';
import { romanCoachBrief, type RomanVoiceMode } from '../../lib/roman/copy';
import { colors, spacing, typography } from '../../theme/tokens';

export interface RomanBriefCardProps {
  coachName: string;
  clientCount: number;
  /** default | celebration (record morning) | error (brief not assembled). */
  mode: RomanVoiceMode;
  testID?: string;
}

export default function RomanBriefCard({
  coachName,
  clientCount,
  mode,
  testID,
}: RomanBriefCardProps): React.ReactElement {
  // §3.8: the slight smile is reserved for celebration (record-morning) here.
  const crop = mode === 'celebration' ? 'smile' : 'neutral';
  // Deferred (roman-quip-budget): §2.3 permits a sparing self-deprecating quip
  // on this daily surface; gate it on the ~1-in-8 ceiling (spec §1.5) before
  // shipping a quip variant. P3 ships the quip-free line only.
  const line = romanCoachBrief({ coachName, clientCount, mode });
  return (
    <View style={styles.card} testID={testID} accessibilityRole="summary">
      {/* FACE+VOICE: avatar co-located with the §2.3 brief copy. */}
      <RomanAvatar crop={crop} size={40} testID="roman-brief-avatar" />
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
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.cream,
    borderRadius: 4,
    marginBottom: spacing.lg,
  },
  copy: {
    ...typography.body,
    color: colors.ink,
    flex: 1,
  },
});
