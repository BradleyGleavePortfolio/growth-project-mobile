/**
 * ChallengeCard — a single community challenge in a list (v3-1).
 *
 * BEHAVIORAL DESIGN (DESIGN_INTELLIGENCE Part III):
 *   - Participation-focused: the card foregrounds the caller's OWN progress
 *     (a compact bar + "X of Y") — a competence signal (§3.7), never a ranking
 *     and never a "behind" framing (§3.4, no public failure).
 *   - One clear action: "Join" when not joined, "Continue" when joined and in
 *     progress, and a calm "Goal reached" closure chip when complete. Hick's Law:
 *     a single primary affordance per card.
 *   - Completed state is a positive closure, shown with a line check icon — not
 *     a trophy/badge (avoids badge theater) and never a comparison.
 *
 * Tokens only (no raw hex). Line Ionicons only (no emoji). >=48dp touch target.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import type {
  CommunityChallenge,
  CommunityChallengeParticipation,
} from '../../api/communityChallengesApi';

export interface ChallengeCardProps {
  challenge: CommunityChallenge;
  /** The caller's participation, or null when they have not joined. */
  participation: CommunityChallengeParticipation | null;
  /** Open the challenge detail. */
  onPress: (challenge: CommunityChallenge) => void;
  testID?: string;
}

function fractionFor(value: number, target: number | null): number | null {
  if (target === null || target <= 0) return null;
  return Math.min(Math.max(value / target, 0), 1);
}

export default function ChallengeCard({
  challenge,
  participation,
  onPress,
  testID,
}: ChallengeCardProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const joined = participation !== null;
  const completed = participation?.completed ?? false;
  const value = participation?.progress_value ?? 0;
  const target = challenge.target_value;
  const unit = challenge.unit ?? '';
  const fraction = fractionFor(value, target);

  const statusLabel = completed
    ? 'Goal reached'
    : joined
      ? 'In progress'
      : 'Open to join';
  const actionLabel = completed ? 'View' : joined ? 'Continue' : 'Join';

  const progressLabel =
    !joined
      ? challenge.description ?? 'Tap to see what this challenge is about.'
      : target === null
        ? `${value}${unit ? ` ${unit}` : ''} logged so far`
        : `${value} of ${target}${unit ? ` ${unit}` : ''}`;

  return (
    <HapticPressable
      intent="light"
      onPress={() => onPress(challenge)}
      accessibilityRole="button"
      accessibilityLabel={`Open challenge ${challenge.title}. ${statusLabel}.`}
      testID={testID}
      style={[
        styles.card,
        { backgroundColor: semanticColors.bgSurface, borderColor: semanticColors.border },
      ]}
    >
      <View style={styles.headerRow}>
        <Text
          style={[styles.title, { color: semanticColors.textPrimary }]}
          numberOfLines={2}
        >
          {challenge.title}
        </Text>
        {completed ? (
          <Ionicons
            name="checkmark-circle-outline"
            size={20}
            color={semanticColors.accent}
            testID={`${testID ?? 'challenge-card'}-complete-icon`}
          />
        ) : null}
      </View>

      <Text
        style={[styles.progress, { color: semanticColors.textMuted }]}
        numberOfLines={2}
      >
        {progressLabel}
      </Text>

      {joined && fraction !== null ? (
        <View
          style={[styles.track, { backgroundColor: semanticColors.bgPrimary }]}
          accessibilityRole="progressbar"
          accessibilityLabel={`Your progress: ${Math.round(fraction * 100)} percent`}
        >
          <View
            style={[
              styles.fill,
              { backgroundColor: semanticColors.accent, width: `${fraction * 100}%` },
            ]}
            testID={`${testID ?? 'challenge-card'}-fill`}
          />
        </View>
      ) : null}

      <View style={styles.footerRow}>
        <Text style={[styles.status, { color: semanticColors.textMuted }]}>
          {statusLabel}
        </Text>
        <View style={[styles.actionChip, { borderColor: semanticColors.accent }]}>
          <Text style={[styles.actionLabel, { color: semanticColors.accent }]}>
            {actionLabel}
          </Text>
        </View>
      </View>
    </HapticPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    minHeight: 48,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: { flex: 1, fontSize: 17, fontWeight: '600' },
  progress: { fontSize: 14, lineHeight: 20 },
  track: {
    height: 8,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  fill: { height: '100%', borderRadius: radius.pill },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  status: { fontSize: 13, fontWeight: '500' },
  actionChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  actionLabel: { fontSize: 13, fontWeight: '600' },
});
