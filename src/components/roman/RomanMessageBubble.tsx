/**
 * RomanMessageBubble — one editorial chat turn (legacy component name).
 *
 * FACE+VOICE (operator rule, P0 if violated): every ASSISTANT turn renders
 * Roman's face (reused RomanAvatar, neutral crop) beside its speaker label, so
 * Roman's voice is never disembodied. User turns render right-aligned with no
 * avatar. An interrupted assistant turn (backend persisted a partial on client
 * disconnect — toMessageView.interrupted, controller L210) shows a calm, typed
 * note rather than silently presenting a truncated reply as complete.
 *
 * The bubble text is rendered as plain Text (never dangerouslySetInnerHTML /
 * HTML) — FIFTY_FAILURES #4 (XSS via unescaped output) does not apply.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import RomanAvatar from './RomanAvatar';
import { ROMAN_INTERRUPTED_NOTE } from './romanVoice';
import type { RomanMessage } from '../../api/romanApi';
import { colors, lightTokens, spacing, typography } from '../../theme/tokens';

export interface RomanMessageBubbleProps {
  message: RomanMessage;
  testID?: string;
}

function RomanMessageBubbleComponent({
  message,
  testID,
}: RomanMessageBubbleProps): React.ReactElement {
  const isAssistant = message.role === 'assistant';

  if (isAssistant) {
    return (
      <View style={styles.assistantRow} testID={testID} role="listitem">
        <View style={styles.speakerRow}>
          <RomanAvatar crop="neutral" size={24} testID="roman-bubble-avatar" />
          <Text style={styles.speakerLabel}>ROMAN</Text>
        </View>
        <View style={styles.assistantBody}>
          <Text
            style={styles.assistantText}
            accessibilityLabel={`Roman said: ${message.content}`}
          >
            {message.content}
          </Text>
          {message.interrupted ? (
            <Text style={styles.interruptedNote} accessibilityRole="text">
              {ROMAN_INTERRUPTED_NOTE}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.userRow} testID={testID} role="listitem">
      <View style={styles.userBody}>
        <Text style={[styles.speakerLabel, styles.userLabel]}>YOU</Text>
        <Text style={styles.userText} accessibilityLabel={`You said: ${message.content}`}>
          {message.content}
        </Text>
      </View>
    </View>
  );
}

const RomanMessageBubble = React.memo(RomanMessageBubbleComponent);
export default RomanMessageBubble;

const styles = StyleSheet.create({
  assistantRow: {
    gap: spacing.md,
    paddingVertical: spacing.xl,
    marginHorizontal: spacing.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: lightTokens.border,
  },
  speakerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  speakerLabel: {
    ...typography.caption,
    fontSize: 13,
    letterSpacing: 1.6,
    color: lightTokens.textMuted,
  },
  assistantBody: {
    gap: spacing.xs,
  },
  assistantText: {
    ...typography.h3,
    lineHeight: 28,
    color: colors.ink,
  },
  interruptedNote: {
    ...typography.bodySmall,
    color: colors.charcoal,
    marginTop: spacing.xs,
  },
  userRow: {
    alignItems: 'flex-end',
    paddingVertical: spacing.xl,
    marginHorizontal: spacing.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: lightTokens.border,
  },
  userBody: {
    maxWidth: '82%',
    gap: spacing.sm,
  },
  userLabel: {
    textAlign: 'right',
  },
  userText: {
    ...typography.body,
    color: colors.ink,
    textAlign: 'right',
  },
});
