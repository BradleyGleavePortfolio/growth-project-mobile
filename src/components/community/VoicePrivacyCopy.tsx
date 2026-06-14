/**
 * VoicePrivacyCopy — the audience-disclosure line shown in the v3-3 voice
 * composer BEFORE a note is sent. This is an AUDIT REQUIREMENT: the user must
 * see a REAL, specific description of who will be able to hear the recording —
 * never a vague "shared with the community" placeholder. A voice recording is
 * more personal than text, so the disclosure is explicit and computed from the
 * actual send target, not a generic string.
 *
 * The audience is derived from the resolved target:
 *   - DM         → "Only <recipient name> can hear this." (or "the person you're
 *                   messaging" when the name is unknown — still scoped, never
 *                   "everyone").
 *   - cohort     → "Everyone in <cohort name> can hear this." (or "this group"
 *                   when the name is unknown).
 *   - hall       → "Everyone in <workspace/community name> can hear this."
 *
 * `describeVoiceAudience` is exported as a pure function so the exact audience
 * string is unit-tested (the audit check asserts a concrete audience, not a
 * placeholder). The component renders it with a lock icon and an
 * `accessibilityRole="text"` so a screen reader announces the full disclosure
 * as one statement.
 *
 * Tokens only (no raw hex). Line Ionicons only (no emoji). fontWeight ≤ 600.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';

export type VoiceAudienceTarget =
  | { kind: 'dm'; recipientName?: string | null }
  | { kind: 'cohort'; cohortName?: string | null }
  | { kind: 'hall'; communityName?: string | null };

/**
 * Build the concrete audience disclosure sentence. Pure + exported so the
 * audit/unit tests can assert a SPECIFIC audience (never a vague placeholder).
 */
export function describeVoiceAudience(target: VoiceAudienceTarget): string {
  switch (target.kind) {
    case 'dm': {
      const who =
        target.recipientName && target.recipientName.trim().length > 0
          ? target.recipientName.trim()
          : 'the person you’re messaging';
      return `Only ${who} can hear this voice note.`;
    }
    case 'cohort': {
      const where =
        target.cohortName && target.cohortName.trim().length > 0
          ? target.cohortName.trim()
          : 'this group';
      return `Everyone in ${where} can hear this voice note.`;
    }
    case 'hall':
    default: {
      const where =
        target.kind === 'hall' &&
        target.communityName &&
        target.communityName.trim().length > 0
          ? target.communityName.trim()
          : 'your community';
      return `Everyone in ${where} can hear this voice note.`;
    }
  }
}

export interface VoicePrivacyCopyProps {
  target: VoiceAudienceTarget;
  testID?: string;
}

export default function VoicePrivacyCopy({
  target,
  testID,
}: VoicePrivacyCopyProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const sentence = describeVoiceAudience(target);

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: semanticColors.bgSurface,
          borderColor: semanticColors.border,
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={sentence}
      testID={testID ?? 'voice-privacy-copy'}
    >
      <Ionicons
        name="lock-closed-outline"
        size={16}
        color={semanticColors.textMuted}
      />
      <Text
        style={[styles.text, { color: semanticColors.textMuted }]}
        testID="voice-privacy-text"
      >
        {sentence}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
});
