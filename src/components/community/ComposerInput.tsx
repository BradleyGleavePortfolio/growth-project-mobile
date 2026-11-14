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
} from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { useChatDraft } from '../../lib/chatDrafts';
import { failedSendKeepsKey } from '../../lib/sendOnce';
import { generateIdempotencyKey } from '../../utils/idempotency';
import { forestPop, neutral, spacing, radius, voiceShades } from '../../theme/tokens';

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
   * SEND-ONCE-PHONE (b#1228): `idempotencyKey` is this draft's send-once key. The same words sent again after a
   * failed send that may have reached the server get the same key (kept with the draft, lib/sendOnce.ts); new words,
   * a success or a 400 / 409 answer get a new one.
   */
  onSubmit: (value: string, idempotencyKey: string) => void | Promise<void>;
  /**
   * CHAT-DISCARD (owner 10-21): the chat this box belongs to (e.g. `dm:<userId>`). Given, half-typed text stays with
   * that chat on the device and is back when it opens again (src/lib/chatDrafts.ts); omitted, the box keeps nothing.
   */
  draftKey?: string;
  /**
   * REFINE-962 (Studio composer, S_thread_ios.html:79-:83): a white pill with a sage line, and Send as a pale sage disc
   * with a forest arrow until the box holds words (still disabled, and said so). Only the coach's DM thread passes it;
   * unset, the box draws as before. A dark theme keeps its own colours.
   */
  studio?: boolean;
  /**
   * REFINE-985 (Voice B Studio 05b, B-05b-feed-1000_ios.html .comp :47, .field :48, .cbtn :49): a white dock with a 1 pt
   * line on top, a pill box with a 1 pt line, and Send in C6CHAT-S-V2 c08's colours (pale sage with a brand 400 arrow
   * until the box holds words, still disabled and said so; then forest). Only the client's DM thread passes it; unset, the
   * box draws as before. A dark theme keeps its own colours.
   */
  voiceB?: boolean;
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
    { placeholder, maxLength, sending = false, onSubmit, draftKey, studio = false, voiceB = false, testID },
    ref,
  ): React.ReactElement {
  const { semanticColors, colorScheme } = useTheme();
  const studioLight = studio && colorScheme !== 'dark';
  const voiceBLight = voiceB && colorScheme !== 'dark';
  const inputRef = useRef<TextInput>(null);
  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));
  const [value, setValue, sendKey] = useChatDraft(draftKey ?? null);
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
    const key = sendKey.keyFor(draft) ?? generateIdempotencyKey();
    // The key goes with these words before the request, beside the box that clears now (LS-953R2 B1): the same
    // words sent again before this send ends (typed again, after a Back, a reopen or a restart) send it again.
    sendKey.keepAside(draft, key);
    const result = onSubmit(draft, key);
    if (result && typeof result.then === 'function') {
      setField('');
      result
        .then(() => sendKey.dropFailed(draft), (err: unknown) => {
          const keep = failedSendKeepsKey(err);
          sendKey.dropFailed(draft);
          // A new draft typed meanwhile: the words do not come back, and a kept key stays beside the box.
          if (valueRef.current !== '') {
            if (keep) sendKey.keepAside(draft, key);
            return;
          }
          setField(draft);
          if (keep) sendKey.keepFailed(draft, key);
        })
        .finally(() => {
          // Cleared only after the promise settles so the guard spans the whole
          // in-flight window; a later send works once this resolves.
          submittingRef.current = false;
        });
    } else {
      setField('');
      sendKey.dropFailed(draft); // the call is already complete: nothing is left to send again
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
        studio ? [styles.studioBar, studioLight ? { borderTopColor: forestPop.sageLine } : null] : null,
        voiceB ? [styles.voiceBBar, voiceBLight ? { backgroundColor: neutral[0], borderTopColor: voiceShades.hairline } : null] : null,
      ]}
      testID={testID}
    >
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={setField}
        placeholder={placeholder}
        placeholderTextColor={studioLight || voiceBLight ? forestPop.n700 : semanticColors.textMuted}
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
          studio ? [styles.studioInput, studioLight ? { borderColor: forestPop.sageLine, backgroundColor: neutral[0] } : null] : null,
          voiceB ? [styles.voiceBInput, voiceBLight ? { borderColor: voiceShades.track, backgroundColor: neutral[0] } : null] : null,
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
          studio ? styles.studioSend : null,
          studioLight || voiceBLight ? { backgroundColor: canSend ? forestPop.forest : forestPop.sage } : null,
        ]}
      >
        <Ionicons
          name="arrow-up"
          size={20}
          color={studioLight
            ? (canSend ? forestPop.onDeep : forestPop.forest) // forest on sage 7.9:1 (KT-5)
            : voiceBLight ? (canSend ? forestPop.onDeep : forestPop.brand400) // c08 .send.off: brand 400 on sage 4.55:1 (KT-5)
            : canSend ? semanticColors.textOnAccent : semanticColors.textOnDisabled}
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
  // REFINE-962 `studio`: .comp padding 12px 14px 8px, gap 10px, a 1 pt line; .field 46 tall, radius 23, a 1.5 pt line,
  // 16 pt words, padding 12px 18px; .sendb 46.
  studioBar: { alignItems: 'center', gap: 10, paddingTop: 12, paddingBottom: 8, paddingHorizontal: 14, borderTopWidth: 1 },
  studioInput: { minHeight: 46, borderRadius: 23, borderWidth: 1.5, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 12, fontSize: 16 },
  studioSend: { width: 46, height: 46, borderRadius: 23 },
  // REFINE-985 `voiceB`: 05b .comp padding 8px 10px 8px 6px, gap 6px, centred, a 1 px line; the left inset is 10, as the
  // right, because 05b's 6 sits beside an Attach "+" this dock does not draw. .field min-height 44px, radius 22px, a 1 px
  // line, padding 11px 16px, .9375rem/1.3.
  voiceBBar: { alignItems: 'center', gap: 6, paddingTop: 8, paddingBottom: 8, paddingHorizontal: 10, borderTopWidth: 1 },
  voiceBInput: { minHeight: 44, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 15, lineHeight: 19.5 },
});
