/**
 * ONB-SWEEP U1 (agent 135): the client consultation's first load gives up
 * after the startup step limit (8 s, not axios's 30 s) and resumes from the
 * draft on this phone. A late server answer changes nothing.
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';
import ConsultationFlow, { ConsultationApi } from '../ConsultationFlow';
import { NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { makeApi, resetStores, seedLocal } from '../../../lib/consultation/__fixtures__/flowHarness';
import { STARTUP_STEP_TIMEOUT_MS } from '../../../lib/startupTimebox';

jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../services/sentry', () => ({
  ...jest.requireActual('../../../services/sentry'),
  captureError: jest.fn(),
}));
jest.mock('../../../tutorial/tutorialStore', () => ({ startClientTutorial: jest.fn(() => true) }));

function renderFlow(api: ConsultationApi) {
  return render(
    <ConsultationFlow
      userId="u1"
      firstName="Maya"
      coachName={null}
      api={api}
      onFinished={jest.fn()}
      now={() => NOW}
      autoAdvanceMs={0}
      prepMinMs={0}
    />,
  );
}

const advance = (ms: number) => act(async () => { await jest.advanceTimersByTimeAsync(ms); });

beforeEach(async () => {
  await resetStores();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

it('a GET /me/onboarding that never answers falls back to the phone draft at 8 s', async () => {
  expect(STARTUP_STEP_TIMEOUT_MS).toBe(8000);
  await seedLocal({}, 'P0');
  let answer: (v: null) => void = () => undefined;
  const api = makeApi({ getState: jest.fn(() => new Promise<null>((res) => (answer = res))) });
  const r = await renderFlow(api);
  await advance(STARTUP_STEP_TIMEOUT_MS - 100);
  expect(api.getState).toHaveBeenCalledTimes(1);
  expect(r.queryByTestId('consult-screen-P0')).toBeNull();
  await advance(200);
  expect(r.getByTestId('consult-screen-P0')).toBeTruthy();
  // The late answer is ignored: still the same screen, no second load.
  await act(async () => { answer(null); });
  await advance(10);
  expect(r.getByTestId('consult-screen-P0')).toBeTruthy();
  expect(api.getState).toHaveBeenCalledTimes(1);
});

it('a GET that answers in time is used as before (no wait for the limit)', async () => {
  await seedLocal({}, 'P0');
  const api = makeApi();
  const r = await renderFlow(api);
  await advance(10);
  expect(r.getByTestId('consult-screen-P0')).toBeTruthy();
});
