/**
 * ChallengeCommentsEmptyState — the true-empty state for the challenge comments
 * surface (v3-1).
 *
 * This surface renders a neutral encouragement line as plain UI copy, not a
 * localized voice payload: the backend serves no empty-state payload for this
 * participant-facing surface, so a local voiced fallback would be inventing a
 * contract that does not exist.
 *
 * The CTA is a real action: pressing it focuses the composer below so the
 * member can leave the first note immediately.
 *
 * Tokens only (no raw hex). >=48dp touch target.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';

export interface ChallengeCommentsEmptyStateProps {
  /**
   * Neutral UI copy for the true-empty surface, supplied by the caller as a
   * plain string (a UI label) so the component never reaches for a local
   * voiced constant.
   */
  message: string;
  /** Primary action label (a UI affordance label). */
  actionLabel: string;
  /** REAL action — focuses/scrolls the composer into view (no dead no-op). */
  onAction: () => void;
  testID?: string;
}

export default function ChallengeCommentsEmptyState({
  message,
  actionLabel,
  onAction,
  testID,
}: ChallengeCommentsEmptyStateProps): React.ReactElement {
  const { semanticColors } = useTheme();

  return (
    <View style={styles.container} testID={testID}>
      <Ionicons
        name="chatbubble-ellipses-outline"
        size={28}
        color={semanticColors.textMuted}
      />
      <Text
        style={[styles.body, { color: semanticColors.textMuted }]}
        testID="community-challenge-comments-empty-text"
      >
        {message}
      </Text>
      <HapticPressable
        intent="medium"
        onPress={onAction}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        testID={`${testID ?? 'community-challenge-comments-empty'}-action`}
        style={[styles.cta, { backgroundColor: semanticColors.accent }]}
      >
        <Text style={[styles.ctaLabel, { color: semanticColors.textOnAccent }]}>
          {actionLabel}
        </Text>
      </HapticPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing['3xl'],
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  cta: {
    marginTop: spacing.lg,
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  ctaLabel: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});
