/**
 * ComposerInput — a multiline text input + send control used by the DM thread
 * and (in a fuller form) the post composer. Enforces the backend length caps
 * client-side (so an over-cap body fails before the round-trip) and disables
 * send on empty / mid-send. Send button is a >= 44pt/48dp touch target.
 *
 * Standardized on semanticColors / tokens.ts.
 */
import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';

export interface ComposerInputProps {
  placeholder: string;
  /** Max characters (mirror backend: DM/message 4000, comment 2000). */
  maxLength: number;
  /** Disabled while a send is in flight. */
  sending?: boolean;
  /**
   * Submit handler. May be async: when it returns a promise the draft is
   * cleared only after it resolves, and is preserved if it rejects, so a
   * failed send never silently loses what the user typed.
   */
  onSubmit: (value: string) => void | Promise<void>;
  testID?: string;
}

/**
 * Imperative handle so a caller can focus the composer programmatically.
 */
export interface ComposerInputHandle {
  focus: () => void;
}

const ComposerInput = forwardRef<ComposerInputHandle, ComposerInputProps>(
  function ComposerInput(
    { placeholder, maxLength, sending = false, onSubmit, testID },
    ref,
  ): React.ReactElement {
  const { semanticColors } = useTheme();
  const inputRef = useRef<TextInput>(null);
  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !sending;

  const submit = () => {
    if (!canSend) return;
    // Clear optimistically, but if onSubmit is async and rejects, restore the
    // draft so the user does not lose their text on a failed send. The sync
    // path keeps the existing immediate-clear behaviour.
    const draft = trimmed;
    const result = onSubmit(draft);
    if (result && typeof result.then === 'function') {
      setValue('');
      result.catch(() => setValue(draft));
    } else {
      setValue('');
    }
  };

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: semanticColors.bgSurface,
          borderTopColor: semanticColors.border,
        },
      ]}
      testID={testID}
    >
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={semanticColors.textMuted}
        maxLength={maxLength}
        multiline
        accessibilityLabel={placeholder}
        testID={`${testID ?? 'composer'}-field`}
        style={[
          styles.input,
          {
            color: semanticColors.textPrimary,
            borderColor: semanticColors.border,
          },
        ]}
      />
      <HapticPressable
        intent="success"
        onPress={submit}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send"
        accessibilityState={{ disabled: !canSend }}
        testID={`${testID ?? 'composer'}-send`}
        style={[
          styles.send,
          {
            backgroundColor: canSend
              ? semanticColors.accent
              : semanticColors.disabledBg,
          },
        ]}
      >
        <Ionicons
          name="arrow-up"
          size={20}
          color={canSend ? semanticColors.textOnAccent : semanticColors.textOnDisabled}
        />
      </HapticPressable>
    </View>
  );
  },
);

export default ComposerInput;

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
