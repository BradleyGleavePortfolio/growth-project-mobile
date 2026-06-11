/**
 * CoachEmptyState — the FACE + VOICE contract component for every v1-6 coach
 * community empty state (operator-locked 2026-06-10).
 *
 * OPERATOR RULE: Roman's voice is never disembodied. Every empty state that
 * speaks in Roman's voice MUST render his face above the copy so the coach
 * immediately knows it is Roman speaking — not generic app copy. This component
 * is the single enforcement point: it always renders `<RomanAvatar />` above a
 * centered copy line, with >= 12pt spacing between them.
 *
 * Crop selection per surface (per ROMAN_VOICE_POLICY.md §4 avatar matrix):
 *   - `neutral` — generic empty states (home blank, inbox empty, cohorts empty,
 *     lab empty, cohort-detail empty members). DEFAULT here.
 *   - `smile`   — celebratory empty states only (moderation queue cleared).
 *   - `monogram` — compact accents in dense rows, NOT empty states (use
 *     MonogramBadge for those).
 *
 * Size: 64pt on full-screen empty states. The RomanAvatar carries its own
 * `accessibilityLabel` defaults, so screen readers announce "Roman".
 *
 * Copy rules (enforced by review, surfaced here for callers): no exclamation
 * points, no emoji, no "Oops/Whoops/Uh oh", one next step per message. The
 * locked copy strings live in coachVoice.ts and are passed in by each screen.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import RomanAvatar, { type RomanCrop } from '../RomanAvatar';
import { useTheme } from '../../../theme/useTheme';
import { spacing } from '../../../theme/tokens';

export interface CoachEmptyStateProps {
  /** Which approved crop to show. `neutral` for generic, `smile` for cleared. */
  crop?: Extract<RomanCrop, 'neutral' | 'smile'>;
  /** The locked Roman copy string for this surface. */
  copy: string;
  /** Root testID — the avatar nested inside uses `${testID}-avatar`. */
  testID?: string;
}

export default function CoachEmptyState({
  crop = 'neutral',
  copy,
  testID,
}: CoachEmptyStateProps): React.ReactElement {
  const { semanticColors } = useTheme();
  return (
    <View style={styles.container} testID={testID}>
      <RomanAvatar
        crop={crop}
        size={64}
        testID={testID ? `${testID}-avatar` : 'empty-roman-avatar'}
      />
      <Text style={[styles.copy, { color: semanticColors.textMuted }]}>
        {copy}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['3xl'],
    paddingHorizontal: spacing.xl,
    // Face above text, centered, with >= 12pt spacing (spacing.md === 12).
    gap: spacing.md,
  },
  copy: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 320,
  },
});
