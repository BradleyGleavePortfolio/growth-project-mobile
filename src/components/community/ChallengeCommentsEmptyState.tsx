/**
 * ChallengeCommentsEmptyState — the TRUE-EMPTY state for the challenge comments
 * surface (v3-1).
 *
 * FACE+VOICE CONTRACT (gate 9 / DESIGN_INTELLIGENCE Part III): the original P0
 * was that this surface rendered LOCAL Roman-voiced copy from `romanVoice.ts`
 * (`threadEmpty`). The face+voice rule is that Roman's *voice* may only be
 * emitted alongside a backend-composed `{ text, avatar_crop, surface_key,
 * voice_variant }` payload — never from a local constant.
 *
 * There is NO backend payload source for this participant-facing surface: the
 * binding backend branch (PR #390 head) exposes no challenge `comments/empty-
 * state` route, and the Roman voice-policy has no `challenge_comments_empty`
 * surface key (it covers only the ten P2 notification surfaces and the five
 * coach-community surfaces). Per the brief ("missing payload ⇒ honest state,
 * never local fallback") the honest resolution is to render a NEUTRAL,
 * non-Roman-voiced encouragement line here: plain UI copy, no RomanAvatar, no
 * Roman voice. This satisfies the P0 (no local Roman copy) without inventing a
 * backend contract.
 *
 * The CTA is a REAL action (no dead no-op, UX finding 3 / F8): pressing it
 * focuses the composer below so the member can leave the first note immediately.
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
   * Neutral, non-Roman UI copy for the true-empty surface. Supplied by the
   * caller as a plain string (a UI label, not Roman voice) so the component
   * never reaches for a local Roman constant.
   */
  message: string;
  /** Primary action label (a UI affordance label, not Roman copy). */
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
