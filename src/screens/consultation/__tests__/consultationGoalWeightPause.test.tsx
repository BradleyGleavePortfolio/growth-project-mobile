/**
 * B4 goal weight: a value changed on the wheel is kept when the client taps
 * Finish later before Continue, then resumes (ONB-SWEEP-SOL-135 B1). Before
 * the fix the wheel changed only the screen's own state, so the pause saved
 * and resumed the older answer.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ConsultationFlow from '../ConsultationFlow';
import { fullAnswers, NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { makeApi, resetStores, seedLocal } from '../../../lib/consultation/__fixtures__/flowHarness';
import { readLocalState } from '../../../lib/consultation/storage';
import type { Answers } from '../../../lib/consultation/types';

jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { put: jest.fn(), get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

beforeEach(async () => {
  await resetStores();
});

function renderFlow(api: ReturnType<typeof makeApi>) {
  return render(
    <ConsultationFlow
      userId="u1"
      firstName="Maya"
      api={api}
      onFinished={jest.fn()}
      now={() => NOW}
      autoAdvanceMs={0}
      prepMinMs={0}
    />,
  );
}

async function changePauseResume(seed: Answers, before: string, after: string) {
  const api = makeApi();
  await seedLocal(seed, 'B4');
  const r = await renderFlow(api);
  await waitFor(() => r.getByTestId('wheel-goal'));
  expect(r.getByTestId('wheel-goal').props.accessibilityValue).toEqual({ text: before });
  await fireEvent(r.getByTestId('wheel-goal'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  // Changing the wheel does not move on by itself.
  expect(r.getByTestId('wheel-goal').props.accessibilityValue).toEqual({ text: after });
  await fireEvent.press(r.getByTestId('consult-finish-later'));
  await waitFor(() => r.getByTestId('consult-paused'));
  await fireEvent.press(r.getByTestId('consult-resume'));
  await waitFor(() => r.getByTestId('wheel-goal'));
  expect(r.getByTestId('wheel-goal').props.accessibilityValue).toEqual({ text: after });
  return api;
}

describe('B4 goal weight survives Finish later', () => {
  it('lb: 150 lb changed to 151 lb, paused and resumed, stays 151 lb (draft and server save)', async () => {
    const api = await changePauseResume(fullAnswers({ B4: 150 }), '150 lb', '151 lb');
    expect((await readLocalState('u1'))?.answers.B4).toBe(151);
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    const saved = api.save.mock.calls.map((c: unknown[]) => (c[0] as { answers: Answers }).answers.B4);
    expect(saved.filter((b4: unknown) => b4 !== undefined).pop()).toBe(151);
  });

  it('kg: 68 kg changed to 69 kg, paused and resumed, stays 69 kg', async () => {
    const metric = fullAnswers({ B3: { height_cm: 167.6, weight_lbs: 172, unit: 'metric' }, B4: 150 });
    await changePauseResume(metric, '68 kg', '69 kg');
    // 69 kg is stored in pounds, as every B4 answer is.
    expect((await readLocalState('u1'))?.answers.B4).toBe(Math.round(69 / 0.453592));
  });
});
