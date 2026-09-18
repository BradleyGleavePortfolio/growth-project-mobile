import './sideEffectGuards.cjs';
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { cleanup, fireEvent, render, renderHook } from '@testing-library/react-native';
import { ImportOfferCard } from '../ImportOfferCard';
import { ImportJourneyAction, useImportHeadingFocus } from '../importJourneyUI';
import { darkTokens, lightTokens } from '../../../../theme/tokens';
const guards = require('./sideEffectGuards.cjs');
const Native = require('react-native') as typeof import('react-native');

beforeEach(() => guards.installGuards());
afterEach(async () => {
  await cleanup();
  try { guards.assertNoSideEffects(); } finally { jest.restoreAllMocks(); }
});

it.each([
  [true, undefined, 'Have you coached on another platform before?'],
  [true, 'neutral', 'Have you coached on another platform before?'],
  [true, 'sir', 'Have you coached on another platform before, sir?'],
  [false, 'sir', 'Have you coached on another platform before?'],
] as const)('uses explicit voice preference: Roman=%s address=%s', async (romanEnabled, addressForm, question) => {
  const view = await render(<ImportOfferCard variant="question" romanEnabled={romanEnabled} addressForm={addressForm} onYes={jest.fn()} onStartingFresh={jest.fn()} onLater={jest.fn()} />);
  expect(view.getByRole('header')).toHaveTextContent(question);
  expect(view.queryAllByRole('image', { name: 'Roman' })).toHaveLength(romanEnabled ? 1 : 0);
});

it('dispatches Yes, starting fresh, and Later separately, without changing controlled state', async () => {
  const onYes = jest.fn(), onStartingFresh = jest.fn(), onLater = jest.fn();
  const view = await render(<ImportOfferCard variant="question" romanEnabled onYes={onYes} onStartingFresh={onStartingFresh} onLater={onLater} />);
  await fireEvent.press(view.getByRole('button', { name: 'Yes' }));
  expect([onYes.mock.calls.length, onStartingFresh.mock.calls.length, onLater.mock.calls.length]).toEqual([1, 0, 0]);
  expect(view.getByRole('header')).toHaveTextContent('Have you coached on another platform before?');
  await fireEvent.press(view.getByRole('button', { name: 'I am starting fresh' }));
  expect([onYes.mock.calls.length, onStartingFresh.mock.calls.length, onLater.mock.calls.length]).toEqual([1, 1, 0]);
  await fireEvent.press(view.getByRole('button', { name: 'Later' }));
  expect([onYes.mock.calls.length, onStartingFresh.mock.calls.length, onLater.mock.calls.length]).toEqual([1, 1, 1]);
});

it('dispatches every value and resume action exactly once, without a saved/result claim', async () => {
  const onImportRecords = jest.fn(), onBack = jest.fn(), onLater = jest.fn(), onResume = jest.fn();
  const view = await render(<ImportOfferCard variant="value" romanEnabled={false} onImportRecords={onImportRecords} onBack={onBack} onLater={onLater} />);
  expect(view.getByRole('header')).toHaveTextContent('Would you like to bring your clients and coaching history into TGP?');
  for (const name of ['Import my records', 'Back', 'Later']) await fireEvent.press(view.getByRole('button', { name }));
  expect([onImportRecords.mock.calls.length, onBack.mock.calls.length, onLater.mock.calls.length]).toEqual([1, 1, 1]);
  await view.rerender(<ImportOfferCard variant="resume" romanEnabled={false} onResume={onResume} />);
  expect(view.getAllByRole('button')).toHaveLength(1);
  await fireEvent.press(view.getByRole('button', { name: 'Continue import setup' }));
  expect(onResume.mock.calls).toEqual([[]]);
  expect(view.queryByText(/saved|copied|complete|running|ready/i)).toBeNull();
});

it.each(['light', 'dark'])('keeps %s controls readable, focus-visible, static and at least 48 logical pixels', async mode => {
  guards.theme.mode = mode;
  const c = mode === 'dark' ? darkTokens : lightTokens;
  const view = await render(<ImportJourneyAction primary label="Import my records" onPress={jest.fn()} />);
  const button = view.getByRole('button');
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({ minHeight: 48, minWidth: 48, borderColor: c.textMuted });
  expect(StyleSheet.flatten(view.getByText('Import my records').props.style)).toMatchObject({ color: c.textOnAccent });
  await fireEvent(button, 'focus');
  expect(view.container.queryAll(node => node.type === 'View').some(node => { const style = StyleSheet.flatten(node.props.style); return style?.borderWidth === 2 && style.borderColor === c.textPrimary; })).toBe(true);
  await fireEvent(button, 'blur');
  expect(view.container.queryAll(node => node.type === 'View').some(node => { const style = StyleSheet.flatten(node.props.style); return style?.borderWidth === 2 && style.borderColor === c.textPrimary; })).toBe(false);
  await view.rerender(<ImportJourneyAction primary disabled label="Continue" onPress={jest.fn()} />);
  expect(view.getByRole('button')).toBeDisabled();
  expect(StyleSheet.flatten(view.getByRole('button').props.style).backgroundColor).toBe(c.disabledBg);
  expect(StyleSheet.flatten(view.getByText('Continue').props.style).color).toBe(c.textOnDisabled);
});

it('keeps one Roman announcement if the existing neutral portrait falls back to its monogram', async () => {
  const view = await render(<ImportOfferCard variant="resume" romanEnabled onResume={jest.fn()} />);
  const image = view.container.queryAll(node => node.props.onError && node.props.source)[0];
  expect(StyleSheet.flatten(image.props.style)).toMatchObject({ width: 48, height: 48 });
  await fireEvent(image, 'error');
  expect(view.queryAllByRole('image', { name: 'Roman' })).toHaveLength(1);
});

// Request policy only: mocked handles do not establish real screen-reader delivery.
it('requests native heading focus for explicit entry and transitions, not ordinary rerenders', async () => {
  const handle = jest.spyOn(Native, 'findNodeHandle').mockReturnValue(17);
  const focus = jest.spyOn(Native.AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => {});
  const hook = await renderHook<ReturnType<typeof useImportHeadingFocus>, { step: string; explicit: boolean }>(({ step, explicit }) => {
    const ref = useImportHeadingFocus(step, explicit);
    ref.current = {} as Text;
    return ref;
  }, { initialProps: { step: 'question', explicit: false } });
  expect(handle).not.toHaveBeenCalled();
  await hook.rerender({ step: 'question', explicit: true });
  expect(handle).not.toHaveBeenCalled();
  await hook.rerender({ step: 'value', explicit: false });
  expect(focus.mock.calls).toEqual([[17]]);
  await hook.rerender({ step: 'value', explicit: false });
  expect(focus).toHaveBeenCalledTimes(1);
  await hook.unmount();
  await renderHook(() => {
    const ref = useImportHeadingFocus('source', true);
    ref.current = {} as Text;
    return ref;
  });
  expect(focus.mock.calls).toEqual([[17], [17]]);
});

it('does not call the native-only focus API on web', async () => {
  jest.replaceProperty(Native.Platform, 'OS', 'web');
  const handle = jest.spyOn(Native, 'findNodeHandle').mockImplementation(() => { throw new Error('native-only API'); });
  await renderHook(() => {
    const ref = useImportHeadingFocus('source', true);
    ref.current = {} as Text;
    return ref;
  });
  expect(handle).not.toHaveBeenCalled();
});
