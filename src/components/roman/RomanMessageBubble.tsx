/**
 * RomanMessageBubble — one chat turn.
 *
 * FACE+VOICE (operator rule, P0 if violated): every ASSISTANT bubble renders
 * Roman's face (reused RomanAvatar, neutral crop) to the left of the text, so
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
import { colors, radius, spacing, typography, withAlpha } from '../../theme/tokens';

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
      <View style={styles.assistantRow} testID={testID}>
        <RomanAvatar crop="neutral" size={32} testID="roman-bubble-avatar" />
        <View style={styles.assistantBubble}>
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
    <View style={styles.userRow} testID={testID}>
      <View style={styles.userBubble}>
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
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  assistantBubble: {
    flex: 1,
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  assistantText: {
    ...typography.body,
    color: colors.ink,
  },
  interruptedNote: {
    ...typography.bodySmall,
    color: colors.charcoal,
    marginTop: spacing.xs,
  },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  userBubble: {
    // Product plan §5.1: the forest accent is for outlines/text, NOT a filled
    // block (R1 UX finding P2). The user turn reads as a faint forest-tinted
    // surface (token-derived via withAlpha, no raw hex) with a hairline accent
    // border, and the text uses the forest accent itself — ink-legible on the
    // pale tint while keeping the surface calm rather than a saturated fill.
    maxWidth: '82%',
    backgroundColor: withAlpha(colors.forest, 0.08),
    borderWidth: 0.5,
    borderColor: withAlpha(colors.forest, 0.35),
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  userText: {
    ...typography.body,
    color: colors.ink,
  },
});
