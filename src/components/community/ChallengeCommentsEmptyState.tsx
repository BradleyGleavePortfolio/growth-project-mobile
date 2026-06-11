/**
 * ChallengeCommentsEmptyState — the TRUE-EMPTY state for the challenge comments
 * surface (v3-1).
 *
 * FACE+VOICE CONTRACT (gate 9 / DESIGN_INTELLIGENCE Part III): the copy here is
 * rendered from the OPERATOR-LOCKED Roman payload the BACKEND composes
 * (`{ text, avatar_crop, surface_key, voice_variant }`), NOT from a local
 * `romanVoice.ts` constant. A local copy fallback on this surface is a P0; when
 * the payload is missing or drifted the caller renders an honest loading/error
 * state instead of this component (see CommunityChallengeDetailScreen).
 *
 * The CTA is a REAL action (no dead no-op, UX finding 3): pressing it focuses
 * the composer below so the member can leave the first note immediately.
 *
 * Tokens only (no raw hex). Line/face Roman avatar only. >=48dp touch target.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import RomanAvatar from './RomanAvatar';
import type { ChallengeEmptyStatePayload } from '../../api/communityChallengesApi';

export interface ChallengeCommentsEmptyStateProps {
  /** Operator-locked Roman copy payload, validated at the API boundary. */
  payload: ChallengeEmptyStatePayload;
  /** Primary action label (kept local — a UI affordance label, not Roman copy). */
  actionLabel: string;
  /** REAL action — focuses/scrolls the composer into view (no dead no-op). */
  onAction: () => void;
  testID?: string;
}

export default function ChallengeCommentsEmptyState({
  payload,
  actionLabel,
  onAction,
  testID,
}: ChallengeCommentsEmptyStateProps): React.ReactElement {
  const { semanticColors } = useTheme();

  return (
    <View style={styles.container} testID={testID}>
      <RomanAvatar
        crop={payload.avatar_crop}
        size={48}
        testID="community-challenge-comments-empty-roman"
      />
      <Text
        style={[styles.body, { color: semanticColors.textMuted }]}
        testID="community-challenge-comments-empty-text"
      >
        {payload.text}
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
