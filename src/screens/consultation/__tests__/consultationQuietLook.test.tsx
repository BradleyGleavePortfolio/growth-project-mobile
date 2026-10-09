import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { lightTokens, darkTokens, radius } from '../../../theme/tokens';
import { fullAnswers, NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { RESULT } from '../../../lib/consultation/__fixtures__/flowHarness';
import { Checkbox, Chip, Frame, LabeledInput, OptionRow, PrimaryButton, UnitTabs, Wheel, STEP_MS } from '../components';
import { CompleteProblemScreen, MacroRevealScreen, PausedScreen, PlanRevealScreen, SummaryScreen } from '../RevealScreens';

let mockTokens = lightTokens;
jest.mock('../../../theme/useTheme', () => ({ useTheme: () => ({ semanticColors: mockTokens }) }));
// The shared src/ui primitives read the theme from ThemeProvider directly.
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({ semanticColors: mockTokens }) }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
const mockOpen = jest.fn();
jest.mock('../../../components/support/SupportEmailFallback', () => ({
  useSupportEmail: () => ({ open: mockOpen }),
  SupportEmailFallback: () => null,
}));
const ctx = { firstName: 'Maya', coachName: 'Bradley' };
beforeEach(() => { mockTokens = lightTokens; mockOpen.mockClear(); });

it.each([lightTokens, darkTokens])('uses active semantic tokens and unfilled hairline choices', async (tokens) => {
  mockTokens = tokens;
  const r = await render(<Frame testID="frame"><OptionRow option={{ value: 'a', label: 'A' }} selected onPress={jest.fn()} testID="row" /><Chip option={{ value: 'b', label: 'B' }} selected onPress={jest.fn()} testID="chip" /><PrimaryButton label="Continue" onPress={jest.fn()} testID="cta" /></Frame>);
  expect(StyleSheet.flatten(r.getByTestId('frame').props.style).backgroundColor).toBe(tokens.bgPrimary);
  const row = StyleSheet.flatten(r.getByTestId('row').props.style);
  const chip = StyleSheet.flatten(r.getByTestId('chip').props.style);
  expect(row).toMatchObject({ borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: tokens.bgPrimary });
  expect(chip).toMatchObject({ borderWidth: StyleSheet.hairlineWidth, backgroundColor: tokens.bgPrimary, borderRadius: radius.chip });
  expect(StyleSheet.flatten(r.getByTestId('cta').props.style).backgroundColor).toBe(tokens.accent);
  expect(STEP_MS).toBe(280);
});

it('preserves all building-block handlers, roles and disabled consent behaviour', async () => {
  const action = jest.fn();
  const change = jest.fn();
  const r = await render(<Frame onBack={action} onFinishLater={action}>
    <OptionRow option={{ value: 'a', label: 'A', sub: 'Detail' }} selected onPress={action} testID="row" />
    <Chip option={{ value: 'b', label: 'B' }} selected single onPress={action} testID="chip" />
    <Checkbox label="Consent unchanged" checked onToggle={action} testID="consent" />
    <Checkbox label="Waiting" checked={false} disabled onToggle={action} testID="waiting" />
    <LabeledInput label="Notes" value="" onChange={change} maxLength={200} testID="notes" />
    <UnitTabs unit="imperial" onChange={change} />
    <Wheel label="Number" values={[1, 2, 3]} value={2} onChange={change} testID="wheel" />
    <PrimaryButton label="Continue" onPress={action} testID="cta" />
    <PrimaryButton label="Wait" disabled onPress={action} testID="disabled" />
  </Frame>);
  for (const id of ['consult-back', 'consult-finish-later', 'row', 'chip', 'consent', 'cta']) await fireEvent.press(r.getByTestId(id));
  expect(action).toHaveBeenCalledTimes(6);
  await fireEvent.press(r.getByTestId('waiting')); await fireEvent.press(r.getByTestId('disabled'));
  expect(action).toHaveBeenCalledTimes(6);
  expect(r.getByTestId('consent').props.accessibilityState).toMatchObject({ checked: true });
  expect(r.getByTestId('waiting').props.accessibilityState).toMatchObject({ checked: false, disabled: true, busy: true });
  await fireEvent.changeText(r.getByTestId('notes'), 'Note');
  await fireEvent.press(r.getByTestId('unit-metric'));
  await fireEvent.press(r.getByTestId('unit-imperial'));
  await fireEvent(r.getByTestId('wheel'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  await fireEvent(r.getByTestId('wheel'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
  expect(change.mock.calls).toEqual([['Note'], ['metric'], ['imperial'], [3], [1]]);
  expect(r.getByTestId('consult-scroll').props['ph-no-capture']).toBe(true);
});

it('keeps every summary edit, back, prepare and preparing guard', async () => {
  const edit = jest.fn(); const action = jest.fn();
  const props = { answers: fullAnswers(), ctx, now: NOW, onEdit: edit, onBack: action, onPrepare: action };
  const r = await render(<SummaryScreen {...props} />);
  for (const chapter of [1, 2, 3, 4, 6]) await fireEvent.press(r.getByTestId(`summary-edit-${chapter}`));
  expect(edit.mock.calls).toEqual([[1], [2], [3], [4], [6]]);
  await fireEvent.press(r.getByTestId('consult-back')); await fireEvent.press(r.getByTestId('consult-prepare'));
  expect(action).toHaveBeenCalledTimes(2);
  await r.rerender(<SummaryScreen {...props} preparing />);
  expect(r.queryByTestId('consult-back')).toBeNull();
  await fireEvent.press(r.getByTestId('consult-prepare'));
  expect(action).toHaveBeenCalledTimes(2);
  expect(r.getByTestId('consult-preparing')).toBeTruthy();
});

it.each(['full', 'simple'] as const)('keeps %s macro targets, explanation toggle and next', async (mode) => {
  const action = jest.fn();
  const r = await render(<MacroRevealScreen result={{ ...RESULT, macro_display_mode: mode }} answers={fullAnswers()} ctx={ctx} onNext={action} />);
  expect(r.getByTestId('macro-calories').props.children).toBe('1,789');
  expect(r.getByTestId('macro-protein')).toBeTruthy();
  expect(!!r.queryByTestId('macro-carbs')).toBe(mode === 'full');
  expect(!!r.queryByTestId('macro-fat')).toBe(mode === 'full');
  expect(StyleSheet.flatten(r.getByText('Protein').props.style).fontFamily).toBe('Inter_400Regular');
  await fireEvent.press(r.getByTestId('macro-why'));
  expect(r.getByTestId('macro-why').props.accessibilityState.expanded).toBe(true);
  expect(r.getByText(/Method: Mifflin/)).toBeTruthy();
  await fireEvent.press(r.getByTestId('macro-why'));
  expect(r.queryByText(/Method: Mifflin/)).toBeNull();
  await fireEvent.press(r.getByTestId('consult-macro-next')); expect(action).toHaveBeenCalledTimes(1);
});

it('keeps plan back, explanation, screening guidance and finish', async () => {
  const action = jest.fn();
  const r = await render(<PlanRevealScreen result={RESULT} answers={fullAnswers({ P1: 'yes' })} ctx={ctx} now={NOW} onBack={action} onFinish={action} />);
  expect(r.getByTestId('plan-physician-line')).toBeTruthy();
  expect(r.getByTestId('plan-week-strip').props.accessibilityLabel).toMatch(/^Suggested training days:/);
  expect(r.getByText('Suggested training days')).toBeTruthy();
  await fireEvent.press(r.getByTestId('plan-why'));
  expect(r.getByTestId('plan-why').props.accessibilityState.expanded).toBe(true);
  await fireEvent.press(r.getByTestId('plan-why'));
  expect(r.getByTestId('plan-why').props.accessibilityState.expanded).toBe(false);
  await fireEvent.press(r.getByTestId('consult-back')); await fireEvent.press(r.getByTestId('consult-finish'));
  expect(action).toHaveBeenCalledTimes(2);
});

it('keeps paused/problem primary, support, reference and confirmed sign out', async () => {
  const action = jest.fn(); const signOut = jest.fn();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const r = await render(<PausedScreen ctx={ctx} onResume={action} onSignOut={signOut} />);
  await fireEvent.press(r.getByTestId('consult-resume')); await fireEvent.press(r.getByTestId('consult-support')); await fireEvent.press(r.getByTestId('consult-sign-out'));
  expect(mockOpen).toHaveBeenCalledTimes(1); expect(signOut).not.toHaveBeenCalled();
  alert.mock.calls[0][2]?.find((button) => button.text === 'Sign out')?.onPress?.();
  expect(signOut).toHaveBeenCalledTimes(1);
  await r.rerender(<CompleteProblemScreen problem="unknown" onAction={action} onBack={action} onSignOut={signOut} reference="ref12345" />);
  expect(r.getByTestId('consult-problem-reference').props.children).toContain('ref12345');
  await fireEvent.press(r.getByTestId('consult-problem-action')); await fireEvent.press(r.getByTestId('consult-back'));
  await fireEvent.press(r.getByTestId('consult-support')); await fireEvent.press(r.getByTestId('consult-sign-out'));
  expect(action).toHaveBeenCalledTimes(3); expect(mockOpen).toHaveBeenCalledTimes(2);
  alert.mockRestore();
});

it.each(['not_attached', 'consultation_incomplete', 'consent_missing', 'consent_version_mismatch', 'clinic_not_configured', 'completion_in_progress', 'invalid_answers', 'network', 'unknown'] as const)('keeps the %s recovery action and back', async (problem) => {
  const action = jest.fn();
  const r = await render(<CompleteProblemScreen problem={problem} onAction={action} onBack={action} />);
  await fireEvent.press(r.getByTestId('consult-problem-action'));
  await fireEvent.press(r.getByTestId('consult-back'));
  expect(action).toHaveBeenCalledTimes(2);
  expect(r.getByTestId('consult-support')).toBeTruthy();
  expect(r.queryByTestId('consult-sign-out')).toBeNull();
  expect(r.queryByText(/still being set up|still setting things up|ready to prepare shortly/)).toBeNull();
});
