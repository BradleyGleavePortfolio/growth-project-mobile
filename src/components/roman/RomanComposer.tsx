/**
 * RomanComposer — the message input + send control.
 *
 * Controlled input: the parent screen owns the draft so a send-FAILURE can
 * preserve the text in the composer for retry (brief §3) — the composer never
 * clears optimistically. Send is disabled while empty/over-cap/sending so a
 * blank or oversized turn can never reach the backend (mirrors SendMessageDto
 * @MinLength(1)/@MaxLength(8000), roman.dto.ts L30-33).
 *
 * Touch target: the send control is a minimum 48x48dp hit area (brief §7 /
 * Apple HIG), enforced in `styles.sendButton`.
 *
 * Composer growth (R1 UX finding P2): the input grows with its content rather
 * than being pinned to a fixed 120dp cap, which becomes cramped at large
 * dynamic-type sizes. The cap is derived from the current window height (a
 * fraction of the viewport, floored at a sensible minimum), and the input only
 * starts to scroll once it reaches that dynamic ceiling.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
} from 'react-native';
import { ROMAN_MESSAGE_MAX_LENGTH } from '../../api/romanApi';
import { colors, radius, spacing, typography } from '../../theme/tokens';

/** Single-line input floor (matches the 48dp touch target). */
const COMPOSER_MIN_HEIGHT = 48;
/**
 * Fraction of the window height the composer may grow to before it scrolls.
 * Viewport-relative (not a fixed 120dp) so it stays comfortable under large
 * accessibility font scales; floored so a very short window still allows a few
 * lines.
 */
const COMPOSER_MAX_HEIGHT_FRACTION = 0.3;
const COMPOSER_MAX_HEIGHT_FLOOR = 120;

export interface RomanComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  /** Disables input + send entirely (e.g. Roman unavailable). */
  disabled?: boolean;
  testID?: string;
}

export default function RomanComposer({
  value,
  onChangeText,
  onSend,
  sending,
  disabled = false,
  testID,
}: RomanComposerProps): React.ReactElement {
  const trimmed = value.trim();
  const overCap = value.length > ROMAN_MESSAGE_MAX_LENGTH;
  const canSend = !disabled && !sending && trimmed.length > 0 && !overCap;

  const { height: windowHeight } = useWindowDimensions();
  const maxHeight = Math.max(
    COMPOSER_MAX_HEIGHT_FLOOR,
    Math.round(windowHeight * COMPOSER_MAX_HEIGHT_FRACTION),
  );
  const [contentHeight, setContentHeight] = useState(COMPOSER_MIN_HEIGHT);
  const inputHeight = Math.min(
    Math.max(COMPOSER_MIN_HEIGHT, contentHeight),
    maxHeight,
  );
  // Only scroll inside the input once it has reached the dynamic ceiling.
  const inputScrollEnabled = contentHeight >= maxHeight;

  const onContentSizeChange = (
    e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>,
  ): void => {
    setContentHeight(e.nativeEvent.contentSize.height);
  };

  return (
    <View style={styles.container} testID={testID}>
      {overCap ? (
        <Text style={styles.capNote} accessibilityRole="text">
          {`Message is too long by ${value.length - ROMAN_MESSAGE_MAX_LENGTH} characters.`}
        </Text>
      ) : null}
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { height: inputHeight, maxHeight }]}
          value={value}
          onChangeText={onChangeText}
          onContentSizeChange={onContentSizeChange}
          scrollEnabled={inputScrollEnabled}
          editable={!disabled && !sending}
          placeholder="Message Roman"
          placeholderTextColor={colors.stone}
          multiline
          maxLength={ROMAN_MESSAGE_MAX_LENGTH + 1}
          accessibilityLabel="Message Roman"
          testID="roman-composer-input"
        />
        <TouchableOpacity
          style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
          onPress={onSend}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend, busy: sending }}
          accessibilityLabel={sending ? 'Sending message' : 'Send message'}
          testID="roman-composer-send"
        >
          {sending ? (
            <ActivityIndicator color={colors.bone} testID="roman-composer-spinner" />
          ) : (
            <Text style={styles.sendLabel}>Send</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 0.5,
    borderTopColor: colors.stone,
    backgroundColor: colors.bone,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: COMPOSER_MIN_HEIGHT,
    ...typography.body,
    color: colors.ink,
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sendButton: {
    minWidth: 48,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.forest,
    borderRadius: radius.lg,
  },
  sendButtonDisabled: {
    backgroundColor: colors.stone,
  },
  sendLabel: {
    ...typography.bodyMd,
    color: colors.bone,
  },
  capNote: {
    ...typography.bodySmall,
    color: colors.error,
  },
});
