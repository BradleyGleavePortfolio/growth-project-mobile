/**
 * RomanComposer — the message input + send control.
 *
 * Controlled input: the parent screen owns the draft so a send-FAILURE can
 * preserve the text in the composer for retry (brief §3) — the composer never
 * clears optimistically. Send is disabled while empty/over-cap/sending so a
 * blank or oversized turn can never reach the backend (mirrors SendMessageDto
 * @MinLength(1)/@MaxLength(8000), roman.dto.ts L30-33).
 *
 * Touch target: the send control is a 44x44 pt forest square inside the field
 * (prototype 69, Apple HIG minimum), enforced in `styles.sendButton`. It stays
 * forest while the draft is empty (the arrow rests at half strength) so the
 * room never shows a grey dead square (owner S8, B30).
 *
 * Composer growth (R1 UX finding P2): the input grows with its content rather
 * than being pinned to a fixed 120dp cap, which becomes cramped at large
 * dynamic-type sizes. The cap is derived from the current window height (a
 * fraction of the viewport, floored at a sensible minimum), and the input only
 * starts to scroll once it reaches that dynamic ceiling.
 */
import React, { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
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
import { radius, spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { ROMAN_COMPOSER_PLACEHOLDER } from './romanVoice';

/** Single-line input floor (matches the 44pt send square inside the field). */
const COMPOSER_MIN_HEIGHT = 44;
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
  /** Quick-start chips (prototype 69) rendered above the field. */
  accessory?: React.ReactNode;
  /** One quiet line under the field (prototype 69 footer). */
  footer?: string | null;
  testID?: string;
}

export default function RomanComposer({
  value,
  onChangeText,
  onSend,
  sending,
  disabled = false,
  accessory,
  footer,
  testID,
}: RomanComposerProps): React.ReactElement {
  const { semanticColors: c, colors: themeColors } = useTheme();
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
    // Sits in the Screen footer (src/ui), which owns the gutter, the gesture
    // bar inset and the keyboard: the composer floats above both.
    <View style={styles.container} testID={testID}>
      {accessory}
      {overCap ? (
        <Text style={[styles.capNote, { color: themeColors.error }]} accessibilityRole="text">
          {`Message is too long by ${value.length - ROMAN_MESSAGE_MAX_LENGTH} characters.`}
        </Text>
      ) : null}
      <View style={[styles.field, { backgroundColor: c.bgSurface, borderColor: c.border }]} testID="roman-composer-field">
        <TextInput
          style={[styles.input, { height: inputHeight, maxHeight, color: c.textPrimary }]}
          value={value}
          onChangeText={onChangeText}
          onContentSizeChange={onContentSizeChange}
          scrollEnabled={inputScrollEnabled}
          editable={!disabled && !sending}
          placeholder={ROMAN_COMPOSER_PLACEHOLDER}
          placeholderTextColor={c.textMuted}
          multiline
          maxLength={ROMAN_MESSAGE_MAX_LENGTH + 1}
          accessibilityLabel="Message Roman"
          testID="roman-composer-input"
        />
        <TouchableOpacity
          style={[styles.sendButton, { backgroundColor: c.accent }]}
          onPress={onSend}
          disabled={!canSend}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend, busy: sending }}
          accessibilityLabel={sending ? 'Sending message' : 'Send message'}
          testID="roman-composer-send"
        >
          {sending ? (
            <ActivityIndicator color={c.textOnAccent} testID="roman-composer-spinner" />
          ) : (
            <Ionicons
              name="arrow-forward"
              size={20}
              color={c.textOnAccent}
              style={canSend ? undefined : styles.sendIconIdle}
              accessible={false}
            />
          )}
        </TouchableOpacity>
      </View>
      {footer ? (
        <Text style={[styles.footer, { color: c.textMuted }]} testID="roman-composer-footer">
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    // Owner 17:07: rounded, never a rectangle (radius tokens, Q10b).
    borderRadius: radius.input,
    paddingLeft: spacing.lg,
    padding: spacing.xs,
  },
  input: {
    flex: 1,
    minHeight: COMPOSER_MIN_HEIGHT,
    ...typography.body,
    paddingHorizontal: 0,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    textAlignVertical: 'center',
  },
  sendButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
    marginBottom: 2,
  },
  /** Empty draft: the forest square stays, its arrow rests at half strength. */
  sendIconIdle: {
    opacity: 0.5,
  },
  footer: {
    ...typography.bodySmall,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  capNote: {
    ...typography.bodySmall,
  },
});
