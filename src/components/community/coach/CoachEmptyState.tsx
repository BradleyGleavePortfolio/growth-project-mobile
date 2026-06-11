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
 * Payload source of truth (fixer R1, face+voice contract): the `text` and
 * `avatar_crop` come from the backend Roman voice-policy payload
 * (`GET /community/coach/empty-states`, surfaced via `useCoachEmptyStates`).
 * The screen passes the resolved `RomanCopyPayload` straight through here, so
 * the copy and crop are NEVER hardcoded at the call site — they are whatever
 * the backend policy says they are. On a network/5xx error the screen renders
 * `CoachErrorState` instead (honest error copy), never this celebratory/calm
 * empty state, so an error can never masquerade as "all clear".
 *
 * Crop selection per surface is decided by the backend policy
 * (SURFACE_AVATAR_CROP):
 *   - `neutral` — generic empty states (home blank, inbox empty, cohorts empty,
 *     empty cohort members).
 *   - `smile`   — celebratory empty states only (moderation queue cleared).
 *
 * Size: 64pt on full-screen empty states. The RomanAvatar carries its own
 * `accessibilityLabel` defaults, so screen readers announce "Roman".
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import RomanAvatar from '../RomanAvatar';
import { useTheme } from '../../../theme/useTheme';
import { spacing } from '../../../theme/tokens';
import type { RomanCopyPayload } from '../../../api/coachCommunityApi';

export interface CoachEmptyStateProps {
  /**
   * The backend Roman copy payload for this surface. The component renders
   * `payload.text` beneath `<RomanAvatar crop={payload.avatar_crop} />` so the
   * face + voice contract is satisfied with backend-driven content only.
   */
  payload: RomanCopyPayload;
  /** Root testID — the avatar nested inside uses `${testID}-avatar`. */
  testID?: string;
}

export default function CoachEmptyState({
  payload,
  testID,
}: CoachEmptyStateProps): React.ReactElement {
  const { semanticColors } = useTheme();
  // The backend payload only ever carries `neutral` or `smile` for an empty
  // state; `monogram` is a dense-row crop and never reaches an empty surface.
  const crop = payload.avatar_crop === 'smile' ? 'smile' : 'neutral';
  return (
    <View style={styles.container} testID={testID}>
      <RomanAvatar
        crop={crop}
        size={64}
        testID={testID ? `${testID}-avatar` : 'empty-roman-avatar'}
      />
      <Text style={[styles.copy, { color: semanticColors.textMuted }]}>
        {payload.text}
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
