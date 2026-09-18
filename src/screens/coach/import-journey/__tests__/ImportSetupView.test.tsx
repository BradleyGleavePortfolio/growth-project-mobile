import './sideEffectGuards.cjs';
import React from 'react';
import { Dimensions, I18nManager, ScrollView, StyleSheet, View } from 'react-native';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { ImportSetupView, ImportSetupViewProps } from '../ImportSetupView';
import { ImportOfferCard } from '../ImportOfferCard';
import * as copy from '../importJourneyCopy';
import { IMPORT_PLATFORMS } from '../../../../constants/importPlatforms';
const guards = require('./sideEffectGuards.cjs');
const dimensions = Dimensions.get('window');
const inputProps = () => ({
  romanEnabled: false, selectedSourceId: null, customSourceUrl: '', validation: 'idle' as const,
  onBack: jest.fn(), onLater: jest.fn(), onSourceChange: jest.fn(),
  onCustomSourceChange: jest.fn(), onCustomSourceBlur: jest.fn(), onContinue: jest.fn(),
});
beforeEach(() => guards.installGuards());
afterEach(async () => {
  await cleanup();
  Dimensions.set({ window: dimensions });
  try { guards.assertNoSideEffects(); } finally { jest.restoreAllMocks(); }
});

it('renders the real catalog without a default, support badge, or enabled Continue', async () => {
  const props = inputProps();
  const view = await render(<ImportSetupView {...props} step="source" />);
  expect(view.getAllByRole('radio').map(row => row.props.accessibilityLabel)).toEqual(IMPORT_PLATFORMS.map(p => p.label));
  expect(view.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  expect(props.onContinue).not.toHaveBeenCalled();
  expect(view.getByText('Choose a shortcut, or enter another site. Available records are checked on your computer.')).toBeTruthy();
  expect(view.getByText('A listed site is a shortcut, not a guarantee that every record can be imported.')).toBeTruthy();
  expect(view.queryByText(/supported|fully compatible/i)).toBeNull();
});

it.each(IMPORT_PLATFORMS)('selects $label only by callback and renders the controlled selection', async platform => {
  const props = inputProps();
  const view = await render(<ImportSetupView {...props} step="source" />);
  const row = view.getByRole('radio', { name: platform.label });
  await fireEvent.press(row);
  expect(props.onSourceChange.mock.calls).toEqual([[platform.id]]);
  expect(props.onContinue).not.toHaveBeenCalled();
  expect(row.props.accessibilityState).toEqual({ checked: false, selected: false });
  await view.rerender(<ImportSetupView {...props} step="source" selectedSourceId={platform.id} />);
  expect(view.getByRole('radio', { name: platform.label }).props.accessibilityState).toEqual({ checked: true, selected: true });
  expect(StyleSheet.flatten(view.getByRole('radio', { name: platform.label }).props.style)).toMatchObject({ minHeight: 56, minWidth: 48 });
  await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  expect(props.onContinue.mock.calls).toEqual([[]]);
});

it.each(['not a url', 'http://example.com', 'https://user:password@example.com', 'https://localhost', 'https://127.0.0.1', 'https://10.0.0.1', 'https://[::1]'])('keeps an invalid custom address intact: %s', async address => {
  const props = inputProps();
  const view = await render(<ImportSetupView {...props} step="customSource" selectedSourceId="custom" customSourceUrl={address} validation="invalid" />);
  expect(view.getByLabelText('Site address').props.value).toBe(address);
  expect(view.getByRole('alert')).toHaveTextContent('Enter a valid public HTTPS address.');
  expect(view.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  expect(props.onContinue).not.toHaveBeenCalled();
});

it('dispatches custom change, blur, continue, Back and Later with no external action', async () => {
  const props = inputProps();
  const view = await render(<ImportSetupView {...props} step="customSource" selectedSourceId="custom" />);
  const input = view.getByLabelText('Site address');
  expect(input.props).toMatchObject({ keyboardType: 'url', autoCapitalize: 'none', autoCorrect: false, multiline: true, scrollEnabled: false });
  expect(view.queryByRole('alert')).toBeNull();
  await fireEvent(input, 'focus');
  await fireEvent.changeText(input, 'https://coaching.example.com/login');
  await fireEvent(input, 'blur');
  expect(props.onCustomSourceChange.mock.calls).toEqual([['https://coaching.example.com/login']]);
  expect(props.onCustomSourceBlur.mock.calls).toEqual([[]]);
  await view.rerender(<ImportSetupView {...props} step="customSource" selectedSourceId="custom" customSourceUrl="https://coaching.example.com/login" />);
  expect(view.getByRole('button', { name: 'Continue' })).toBeEnabled();
  for (const name of ['Continue', 'Back', 'Later']) await fireEvent.press(view.getByRole('button', { name }));
  expect([props.onContinue.mock.calls.length, props.onBack.mock.calls.length, props.onLater.mock.calls.length]).toEqual([1, 1, 1]);
});

it.each(IMPORT_PLATFORMS)('handoff for $label is instructional only', async platform => {
  const onBack = jest.fn(), onLater = jest.fn();
  const view = await render(<ImportSetupView step="computerHandoff" selectedSourceId={platform.id} romanEnabled onBack={onBack} onLater={onLater} />);
  expect(view.getByRole('header')).toHaveTextContent('Continue on a computer');
  expect(view.getByText(`Selected site: \u2068${platform.label}\u2069`)).toBeTruthy();
  expect(view.getByText('You will need Chrome on a computer. Keep this setup open while you connect the TGP extension.')).toBeTruthy();
  expect(view.getAllByRole('button').map(b => b.props.accessibilityLabel)).toEqual(['Back', 'I will use a computer later']);
  expect(view.queryByText(/copied|saved|paired|running|waiting|ready to use|https:\/\//i)).toBeNull();
  for (const name of ['Back', 'I will use a computer later']) await fireEvent.press(view.getByRole('button', { name }));
  expect([onBack.mock.calls.length, onLater.mock.calls.length]).toEqual([1, 1]);
});

// These are test-renderer trees, NOT Yoga layout, screenshots or device proof.
const environments = [320, 375, 430].flatMap(width => ['light', 'dark'].flatMap(mode => [1, 2].flatMap(fontScale => [false, true].map(rtl => ({ width, mode, fontScale, rtl })))));
it.each(environments)('declares scalable scroll content at $width / $mode / $fontScale / RTL=$rtl (tree only)', async ({ width, mode, fontScale, rtl }) => {
  guards.theme.mode = mode;
  jest.replaceProperty(I18nManager, 'isRTL', rtl);
  Dimensions.set({ window: { width, height: 568, scale: 1, fontScale } });
  const props = inputProps();
  const states: ImportSetupViewProps[] = [
    { ...props, step: 'source' },
    { ...props, step: 'customSource', selectedSourceId: 'custom', customSourceUrl: 'https://example.com/a-long-path', validation: 'idle' },
    { ...props, step: 'computerHandoff', selectedSourceId: 'truecoach' },
  ];
  for (const state of states) {
    const view = await render(<View style={{ width, flex: 1 }}><ImportSetupView {...state} /></View>);
    expect(view.container.queryAll(node => node.props.keyboardShouldPersistTaps === 'handled')).toHaveLength(1);
    for (const text of view.container.queryAll(node => /Text$/.test(node.type))) {
      expect(text.props.allowFontScaling).not.toBe(false);
      expect(text.props.maxFontSizeMultiplier).toBeUndefined();
      expect(text.props.numberOfLines).toBeUndefined();
    }
    for (const input of view.container.queryAll(node => node.props.keyboardType === 'url')) expect(input.props.multiline).toBe(true);
    await view.unmount();
  }
  for (const variant of ['question', 'value', 'resume'] as const) {
    const actions = { onYes: jest.fn(), onStartingFresh: jest.fn(), onLater: jest.fn(), onBack: jest.fn(), onImportRecords: jest.fn(), onResume: jest.fn() };
    const view = await render(<ScrollView style={{ width }}><ImportOfferCard variant={variant} romanEnabled {...actions} /></ScrollView>);
    for (const text of view.container.queryAll(node => /Text$/.test(node.type))) expect(text.props.numberOfLines).toBeUndefined();
    await view.unmount();
  }
});

// Pseudo-localization checks tree growth permissions, not rendered clipping.
it('keeps expanded +40% copy and every action in the tree without truncation props', async () => {
  const original = copy.importJourneyCopy;
  const expand = (text: string) => `[${text}${'·'.repeat(Math.ceil(text.length * 0.4))}]`;
  jest.spyOn(copy, 'importJourneyCopy').mockImplementation(((key: copy.ImportJourneyCopyKey, vars?: { sourceName: string }) =>
    expand(key === 'handoff.source' ? original(key, vars!) : original(key))) as typeof original);
  const props = inputProps();
  const view = await render(<ImportSetupView {...props} step="customSource" selectedSourceId="custom" customSourceUrl="https://example.com" />);
  expect(view.getByRole('header')).toHaveTextContent(expand('Where are your records?'));
  await fireEvent.press(view.getByRole('button', { name: expand('Continue') }));
  expect(props.onContinue.mock.calls).toEqual([[]]);
  for (const text of view.container.queryAll(node => /Text$/.test(node.type))) {
    expect(text.props.numberOfLines).toBeUndefined();
    expect(text.props.maxFontSizeMultiplier).toBeUndefined();
  }
});
