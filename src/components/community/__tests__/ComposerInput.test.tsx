/**
 * ComposerInput — synchronous double-submit guard regression tests (v3-1 R8).
 *
 * The parent `sending` prop only disables the send button on the NEXT render,
 * so a rapid double-tap could invoke this render's `submit` closure twice and
 * send the same draft twice (each with a fresh Idempotency-Key, so the backend
 * cannot dedupe). A synchronous `submittingRef` set before `onSubmit` rejects
 * the second tap. These tests pin:
 *
 *   1. A rapid double-tap produces exactly ONE onSubmit call.
 *   2. The guard clears after the promise SETTLES (success and failure), so a
 *      later, deliberate second send works.
 *   3. The existing draft-restore semantics still hold (a failed send restores
 *      the draft only when the field is still empty).
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';

// ── Theme: real light tokens, no ThemeProvider ───────────────────────────────
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});

// ── HapticPressable → a plain Pressable that forwards onPress/disabled/testID,
// so a press is observable without loading haptics / reduce-motion deps. ──────
jest.mock('../../HapticPressable', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    default: ({
      children,
      onPress,
      disabled,
      testID,
    }: {
      children: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      testID?: string;
    }) => (
      <Pressable onPress={onPress} disabled={disabled} testID={testID}>
        {children}
      </Pressable>
    ),
  };
});

// ── Ionicons → inert text node (no font assets) ──────────────────────────────
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Ionicons: ({ testID }: { testID?: string }) => <Text testID={testID} /> };
});

import ComposerInput from '../ComposerInput';

describe('ComposerInput — synchronous double-submit guard (P2-C2)', () => {
  it('a rapid double-tap fires onSubmit exactly once', async () => {
    // A never-settling promise keeps the guard set for the duration of the test,
    // mirroring an in-flight network send where the parent `sending` prop has
    // not yet re-rendered the button to disabled.
    const onSubmit = jest.fn(() => new Promise<void>(() => {}));
    await render(
      <ComposerInput
        placeholder="Message"
        maxLength={4000}
        onSubmit={onSubmit}
        testID="composer"
      />,
    );

    await fireEvent.changeText(screen.getByTestId('composer-field'), 'hello');
    // Fire two presses on ONE render's button node WITHIN a single act() —
    // replicating a double-tap that lands on the same render frame, before React
    // re-renders with a cleared field / a disabled button. Without the
    // synchronous submittingRef guard this calls onSubmit twice (both with the
    // same captured 'hello' draft, each a distinct Idempotency-Key the backend
    // cannot dedupe). The single wrapping act() batches both presses so no
    // intervening re-render disables the button between them.
    const send = screen.getByTestId('composer-send');
    await act(() => {
      await fireEvent.press(send);
      await fireEvent.press(send);
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('hello');
  });

  it('clears the guard after the promise SETTLES so a later send works', async () => {
    let resolveSend: (() => void) | undefined;
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    await render(
      <ComposerInput
        placeholder="Message"
        maxLength={4000}
        onSubmit={onSubmit}
        testID="composer"
      />,
    );

    const field = screen.getByTestId('composer-field');
    const send = screen.getByTestId('composer-send');

    // First send (in flight) + a blocked double-tap → one call.
    await fireEvent.changeText(field, 'first');
    await fireEvent.press(send);
    await fireEvent.press(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Settle the first send; the field cleared optimistically.
    await waitFor(() => expect(field.props.value).toBe(''));
    await act(async () => {
      resolveSend?.();
    });

    // A deliberate later send now works (guard cleared on settle).
    await fireEvent.changeText(field, 'second');
    await fireEvent.press(send);
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenNthCalledWith(2, 'second');
  });

  it('clears the guard after a REJECTED send and restores the draft when the field is still empty', async () => {
    let rejectSend: ((err: Error) => void) | undefined;
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject;
        }),
    );
    await render(
      <ComposerInput
        placeholder="Message"
        maxLength={4000}
        onSubmit={onSubmit}
        testID="composer"
      />,
    );

    const field = screen.getByTestId('composer-field');
    const send = screen.getByTestId('composer-send');

    await fireEvent.changeText(field, 'draft');
    await fireEvent.press(send);
    await fireEvent.press(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(field.props.value).toBe(''));
    await act(async () => {
      rejectSend?.(new Error('send failed'));
    });

    // Draft-restore semantics intact: field was still empty, so the draft comes
    // back; the guard cleared on the failure path so a retry send works.
    await waitFor(() => expect(field.props.value).toBe('draft'));
    await fireEvent.press(send);
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenNthCalledWith(2, 'draft');
  });
});
