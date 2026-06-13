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
   * Submit handler. May be async: the field is cleared optimistically and, if
   * the promise rejects, the captured draft is restored ONLY when the field is
   * still empty (the user has not typed something new while the send was in
   * flight) — so a failed send never silently loses what the user typed, and
   * never clobbers a newer draft typed meanwhile.
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
  // Tracks the current field text without forcing the catch handler to re-run
  // when `value` changes (avoids a stale closure restoring over a newer draft).
  const valueRef = useRef('');
  valueRef.current = value;
  // Synchronous in-flight guard. The parent `sending` prop only disables the
  // button on the NEXT render, so a rapid double-tap can invoke this render's
  // `submit` closure twice before `sending` lands. This ref is set BEFORE
  // `onSubmit` and checked at the top of `submit`, so the second tap returns
  // early and exactly one `onSubmit` fires per submit intent. It is cleared
  // only after the promise settles (success AND failure) so a later send works.
  const submittingRef = useRef(false);
  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !sending;

  const setField = (next: string) => {
    valueRef.current = next;
    setValue(next);
  };

  const submit = () => {
    if (!canSend) return;
    // Reject a rapid second tap before the parent `sending` prop catches up:
    // exactly one onSubmit per submit intent.
    if (submittingRef.current) return;
    submittingRef.current = true;
    // Clear optimistically, but if onSubmit is async and rejects, restore the
    // draft so the user does not lose their text on a failed send. The field
    // stays editable during `sending` (slow-network UX), so on rejection only
    // restore the captured draft when the field is STILL empty — if the user
    // typed something new meanwhile, keep theirs and never clobber it. The sync
    // path keeps the existing immediate-clear behaviour.
    const draft = trimmed;
    const result = onSubmit(draft);
    if (result && typeof result.then === 'function') {
      setField('');
      result
        .catch(() => {
          if (valueRef.current === '') setField(draft);
        })
        .finally(() => {
          // Cleared only after the promise settles so the guard spans the whole
          // in-flight window; a later send works once this resolves.
          submittingRef.current = false;
        });
    } else {
      setField('');
      // Synchronous path: the call is already complete, so release immediately.
      submittingRef.current = false;
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
        onChangeText={setField}
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
