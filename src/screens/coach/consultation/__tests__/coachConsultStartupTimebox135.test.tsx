/**
 * ONB-SWEEP U2 (agent 135): the coach consultation's first load gives up
 * after the startup step limit (8 s, not axios's 30 s) and resumes from the
 * phone draft (or a fresh K0) instead of a 30 s spinner.
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CoachConsultationFlow from '../CoachConsultationFlow';
import { draftKey } from '../../../../lib/coachConsultation/draft';
import type { CoachConsultApi } from '../../../../lib/coachConsultation/api';
import { STARTUP_STEP_TIMEOUT_MS } from '../../../../lib/startupTimebox';

jest.mock('../../../../services/api', () => ({ __esModule: true, default: {} }));

const hangingApi = (): jest.Mocked<CoachConsultApi> =>
  ({
    load: jest.fn(() => new Promise(() => undefined)),
    saveDraft: jest.fn().mockResolvedValue('unavailable'),
    complete: jest.fn().mockResolvedValue(undefined),
  }) as jest.Mocked<CoachConsultApi>;

const advance = (ms: number) => act(async () => { await jest.advanceTimersByTimeAsync(ms); });

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

it('a GET /coach/consultation that never answers resumes the phone draft at 8 s', async () => {
  await AsyncStorage.setItem(
    draftKey('c1'),
    JSON.stringify({ v: 1, step: 'K1', updatedAt: '2026-10-08T20:00:00.000Z', answers: { display_name: 'Jordan Reyes' } }),
  );
  const api = hangingApi();
  const r = await render(<CoachConsultationFlow userId="c1" user={{ name: 'Jordan Reyes' }} api={api} onComplete={jest.fn()} />);
  await advance(STARTUP_STEP_TIMEOUT_MS - 100);
  expect(r.getByTestId('coach-consult-loading')).toBeTruthy();
  await advance(200);
  expect(r.queryByTestId('coach-consult-loading')).toBeNull();
  expect(r.getByTestId('coach-consult-K1-name').props.value).toBe('Jordan Reyes');
  expect(api.load).toHaveBeenCalledTimes(1);
});

it('with no draft either, a fresh start opens K0 at 8 s, prefilled from the cached user', async () => {
  const r = await render(<CoachConsultationFlow userId="c1" user={{ name: 'Jordan Reyes' }} api={hangingApi()} onComplete={jest.fn()} />);
  await advance(STARTUP_STEP_TIMEOUT_MS + 100);
  expect(r.queryByTestId('coach-consult-loading')).toBeNull();
  expect(r.getByTestId('coach-consult-K0-title').props.children).toBe('Welcome,\nJordan.');
});
