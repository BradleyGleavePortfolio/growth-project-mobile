/**
 * ONBQ-TILES: consultation questions T1, B1 to B4, N1 and N2 in Quiet Tiles
 * (owner pick MOCK-ONBQ option A, path op 1) behind featureFlags.consultTilesV2.
 * Off: main's hairline rows and quiet tabs. On: cream tiles and pills, forest
 * with a check when chosen, wheel cards, a selection haptic per tap. Every tap
 * reaches the same handler with the same arguments, and the body sent to
 * PUT /me/onboarding/consultation is identical with the flag on or off.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import { featureFlags } from '../../../config/featureFlags';
import { colors, lightTokens, radius } from '../../../theme/tokens';
import { HapticService } from '../../../ui/haptics/haptics.service';
import QuestionScreen, { TILE_SCREENS } from '../QuestionScreen';
import ConsultationFlow from '../ConsultationFlow';
import { fullAnswers, NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { makeApi, resetStores, seedLocal } from '../../../lib/consultation/__fixtures__/flowHarness';
import { screenById } from '../../../lib/consultation/definitions';
import type { Answers, ScreenDef } from '../../../lib/consultation/types';

jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ regionCode: 'US' }] }));
jest.mock('../../../tutorial/tutorialStore', () => ({ startClientTutorial: () => true }));
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags } };
});

const flags = featureFlags as { consultTilesV2: boolean };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const flat = (el: any) => StyleSheet.flatten(el.props.style) ?? {};
const inc = { nativeEvent: { actionName: 'increment' } };
let tick: jest.SpyInstance;

beforeEach(async () => {
  flags.consultTilesV2 = false;
  tick = jest.spyOn(HapticService, 'selection').mockResolvedValue(undefined);
  await resetStores();
});
afterEach(() => tick.mockRestore());

async function renderQ(id: string, answers: Answers = {}) {
  const h = { onAnswer: jest.fn(), onNext: jest.fn(), onBack: jest.fn(), onFinishLater: jest.fn() };
  const r = await render(
    <QuestionScreen screen={screenById(id) as ScreenDef} answers={answers} progress={null} ctx={{ firstName: 'Maya', coachName: 'Bradley' }} now={NOW} {...h} />,
  );
  return { r, ...h };
}

it('ships off, read from its own env key, on exactly the seven matching questions', () => {
  expect(jest.requireActual('../../../config/featureFlags').featureFlags.consultTilesV2).toBe(false);
  expect([...TILE_SCREENS]).toEqual(['T1', 'B1', 'B2', 'B3', 'B4', 'N1', 'N2']);
});

it('off: main hairline rows, quiet tabs, no cards, no haptic', async () => {
  const { r, onAnswer } = await renderQ('T1');
  expect(flat(r.getByTestId('consult-option-beginner'))).toMatchObject({ borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: lightTokens.bgPrimary });
  await fireEvent.press(r.getByTestId('consult-option-beginner'));
  expect(onAnswer).toHaveBeenCalledWith('T1', 'beginner', { advance: true });
  const b3 = await renderQ('B3');
  expect(b3.r.getByTestId('unit-imperial-rule')).toBeTruthy();
  expect(b3.r.queryByTestId('consult-card-height')).toBeNull();
  expect(tick).not.toHaveBeenCalled();
});

describe('on', () => {
  beforeEach(() => { flags.consultTilesV2 = true; });

  it.each([
    ['T1', 'intermediate'],
    ['B1', 'prefer_not_to_say'],
    ['N1', 'vegetarian'],
  ])('%s: cream tiles, the chosen one forest with a check; each tap answers and moves on as before', async (id, chosen) => {
    const { r, onAnswer, onBack, onFinishLater } = await renderQ(id, { [id]: chosen });
    const options = (screenById(id) as ScreenDef).options ?? [];
    for (const o of options) {
      const tile = r.getByTestId(`consult-option-${o.value}`);
      expect(flat(tile)).toMatchObject({ minHeight: 64, borderRadius: radius.card, backgroundColor: o.value === chosen ? lightTokens.accent : colors.cream });
      expect(tile.props.accessibilityState).toMatchObject({ selected: o.value === chosen });
      await fireEvent.press(tile);
    }
    expect(onAnswer.mock.calls).toEqual(options.map((o) => [id, o.value, { advance: true }]));
    expect(tick).toHaveBeenCalledTimes(options.length);
    expect(flat(r.getByText(options.find((o) => o.value === chosen)!.label)).color).toBe(lightTokens.textOnAccent);
    await fireEvent.press(r.getByTestId('consult-back'));
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onFinishLater).toHaveBeenCalledTimes(1);
  });

  it('T1: the second line keeps 4.5:1 on the chosen tile (light green on forest)', async () => {
    const { r } = await renderQ('T1', { T1: 'beginner' });
    expect(flat(r.getByText("I haven't followed a program")).color).toBe(lightTokens.textOnMastheadMuted);
    expect(flat(r.getByText("I've trained on and off")).color).toBe(lightTokens.textMuted);
  });

  it('N2: cream pills, same multi-select, exclusive Nothing, detail field and Continue', async () => {
    const { r, onAnswer, onNext } = await renderQ('N2', { N2: ['dairy', 'other'] });
    expect(flat(r.getByTestId('consult-chip-dairy'))).toMatchObject({ backgroundColor: lightTokens.accent, borderRadius: radius.chip, borderWidth: 0 });
    expect(flat(r.getByTestId('consult-chip-nuts'))).toMatchObject({ backgroundColor: colors.cream, minHeight: 44 });
    await fireEvent.press(r.getByTestId('consult-chip-nuts'));
    await fireEvent.press(r.getByTestId('consult-chip-nothing'));
    expect(onAnswer.mock.calls).toEqual([['N2', ['dairy', 'other', 'nuts']], ['N2', ['nothing']]]);
    await fireEvent.changeText(r.getByTestId('consult-detail-text-N2'), 'Mushrooms');
    expect(onAnswer).toHaveBeenLastCalledWith('N2_other', 'Mushrooms');
    await fireEvent.press(r.getByTestId('consult-continue'));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('B3: Imperial and Metric pills, wheel cards, the same answer and Continue', async () => {
    const { r, onAnswer, onNext } = await renderQ('B3');
    expect(flat(r.getByTestId('unit-imperial')).backgroundColor).toBe(lightTokens.accent);
    expect(flat(r.getByTestId('unit-metric')).backgroundColor).toBe(colors.cream);
    expect(r.queryByTestId('unit-imperial-rule')).toBeNull();
    for (const c of ['consult-card-height', 'consult-card-weight']) expect(flat(r.getByTestId(c))).toMatchObject({ backgroundColor: colors.cream, borderRadius: radius.card });
    await fireEvent.press(r.getByTestId('unit-metric'));
    expect(onAnswer).toHaveBeenLastCalledWith('B3', { height_cm: 167.6, weight_lbs: 172, unit: 'metric' });
    expect(r.getByTestId('unit-metric').props.accessibilityState).toEqual({ selected: true });
    await fireEvent(r.getByTestId('wheel-weight'), 'accessibilityAction', inc);
    expect(onAnswer).toHaveBeenLastCalledWith('B3', { height_cm: 167.6, weight_lbs: 174, unit: 'metric' });
    await fireEvent.press(r.getByTestId('consult-continue'));
    expect(onNext).toHaveBeenCalledWith({ B3: { height_cm: 167.6, weight_lbs: 174, unit: 'metric' } });
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('B2: one card for the three wheels, a full date, and the as-built under-16 stop', async () => {
    const { r, onNext } = await renderQ('B2');
    expect(flat(r.getByTestId('consult-card-dob'))).toMatchObject({ backgroundColor: colors.cream, borderRadius: radius.card });
    expect(r.getByTestId('consult-continue').props.accessibilityState).toMatchObject({ disabled: true });
    for (const w of ['wheel-dob-month', 'wheel-dob-day', 'wheel-dob-year']) await fireEvent(r.getByTestId(w), 'accessibilityAction', inc);
    await fireEvent.press(r.getByTestId('consult-continue'));
    expect(onNext).toHaveBeenCalledWith({ B2: '1997-10-29' });
    const young = await renderQ('B2', { B2: '2015-01-01' });
    await fireEvent.press(young.r.getByTestId('consult-continue'));
    expect(young.onNext).not.toHaveBeenCalled();
    expect(young.r.getByText('The Growth Project is for ages 16 and up.')).toBeTruthy();
    await fireEvent.press(young.r.getByTestId('consult-under-age-change'));
    expect(young.r.getByTestId('consult-card-dob')).toBeTruthy();
  });

  it('B4: a goal wheel card; Continue sends the number, "No number, just the goal" sends none', async () => {
    const { r, onAnswer, onNext } = await renderQ('B4', { B3: { height_cm: 167.6, weight_lbs: 172, unit: 'imperial' }, B4: 150 });
    expect(flat(r.getByTestId('consult-card-goal'))).toMatchObject({ backgroundColor: colors.cream, borderRadius: radius.card });
    await fireEvent.press(r.getByTestId('consult-continue'));
    expect(onNext).toHaveBeenLastCalledWith({ B4: 150 });
    expect(r.getByText('No number, just the goal')).toBeTruthy();
    await fireEvent.press(r.getByTestId('consult-skip'));
    expect(onAnswer).toHaveBeenLastCalledWith('B4', null);
    expect(onNext).toHaveBeenLastCalledWith({ B4: null });
  });
});

/** Walk the real flow, press Finish later, and return the last body sent to PUT /me/onboarding/consultation. */
async function savedBody(on: boolean, start: string, clear: string[], steps: (r: RenderResult) => Promise<void>) {
  flags.consultTilesV2 = on;
  await resetStores();
  const seed = fullAnswers();
  for (const k of clear) delete seed[k];
  await seedLocal(seed, start);
  const api = makeApi();
  const r = await render(
    <ConsultationFlow userId="u1" firstName="Maya" coachName="Bradley" api={api} onFinished={jest.fn()} now={() => NOW} autoAdvanceMs={0} prepMinMs={0} />,
  );
  await waitFor(() => r.getByTestId(`consult-screen-${start}`));
  await steps(r);
  const before = api.save.mock.calls.length;
  await fireEvent.press(r.getByTestId('consult-finish-later'));
  await waitFor(() => expect(api.save.mock.calls.length).toBeGreaterThan(before));
  const body = api.save.mock.calls[api.save.mock.calls.length - 1][0];
  await r.unmount();
  return body;
}

const screen = (r: RenderResult, id: string) => waitFor(() => r.getByTestId(`consult-screen-${id}`));

const WALKS: Array<[string, string, string[], (r: RenderResult) => Promise<void>, Answers]> = [
  ['body chapter', 'B1', ['B1', 'B2', 'B3', 'B4'], async (r) => {
    await fireEvent.press(r.getByTestId('consult-option-male'));
    await screen(r, 'B2');
    for (const w of ['wheel-dob-month', 'wheel-dob-day', 'wheel-dob-year']) await fireEvent(r.getByTestId(w), 'accessibilityAction', inc);
    await fireEvent.press(r.getByTestId('consult-continue'));
    await screen(r, 'B3');
    await fireEvent.press(r.getByTestId('unit-metric'));
    await fireEvent(r.getByTestId('wheel-weight'), 'accessibilityAction', inc);
    await fireEvent.press(r.getByTestId('consult-continue'));
    await screen(r, 'B4');
    await fireEvent.press(r.getByTestId('consult-skip'));
    await screen(r, 'L1');
  }, { B1: 'male', B2: '1997-10-29', B3: { height_cm: 167.6, weight_lbs: 174, unit: 'metric' }, B4: null }],
  ['training experience', 'T1', ['T1'], async (r) => {
    await fireEvent.press(r.getByTestId('consult-option-intermediate'));
    await screen(r, 'T2');
  }, { T1: 'intermediate' }],
  ['food', 'N1', ['N1', 'N2'], async (r) => {
    await fireEvent.press(r.getByTestId('consult-option-vegetarian'));
    await screen(r, 'N2');
    for (const c of ['dairy', 'nuts', 'other']) await fireEvent.press(r.getByTestId(`consult-chip-${c}`));
    await fireEvent.changeText(r.getByTestId('consult-detail-text-N2'), 'Mushrooms');
    await fireEvent.press(r.getByTestId('consult-continue'));
    await screen(r, 'N3');
  }, { N1: 'vegetarian', N2: ['dairy', 'nuts', 'other'], N2_other: 'Mushrooms' }],
];

it.each(WALKS)('%s: the saved body is identical with the flag on or off', async (_name, start, clear, steps, expected) => {
  const off = await savedBody(false, start, clear, steps);
  expect(tick).not.toHaveBeenCalled();
  const on = await savedBody(true, start, clear, steps);
  expect(tick).toHaveBeenCalled();
  expect(on).toEqual(off);
  expect(on.version).toBe('consult-v1');
  expect(on.answers).toMatchObject(expected);
});
