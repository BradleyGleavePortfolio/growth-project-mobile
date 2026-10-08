/**
 * WORKOUT-RESUME-131: reopening a saved live workout.
 *
 *   - A workout reopened more than 12 hours after its last change counted its
 *     clock up to "now": a one-hour workout reopened the next day was saved
 *     as 30 hours (more than the server accepts). It now counts up to that
 *     last change and carries on from the reopen, and the gap stays out when
 *     the workout is reopened again.
 *   - The phone closed the app in the background before anything was
 *     entered: the next, different workout opened the old empty one under
 *     its old name. The empty one is now cleared and the chosen workout opens.
 *   - A saved workout with anything entered still reopens, whichever workout
 *     is opened (TRAIN-GATE-128, m#521 Sol B).
 */
import React from 'react';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadActiveWorkoutSession,
  saveActiveWorkoutSession,
} from '../storage/activeWorkoutSession';
import { isUntouchedSession, resumedPausedMs, routineSessionExercises } from '../utils/workout/workoutLogging';

jest.mock('../config/featureFlags', () => ({ featureFlags: { coachBrief: true, romanChat: false } }));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'c1', role: 'client' }) }));
let mockRouteParams: Record<string, unknown> = {};
const mockSetParams = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: jest.fn(), goBack: jest.fn(), setParams: mockSetParams, dispatch: jest.fn(),
    addListener: () => () => undefined,
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));
let mockMutateOptions: { onError?: (e: unknown) => void } | null = null;
const mockMutate = jest.fn((_vars: unknown, options: typeof mockMutateOptions) => { mockMutateOptions = options; });
jest.mock('../hooks/useApi', () => ({ useCreateWorkout: () => ({ mutate: mockMutate }) }));
jest.mock('../services/api', () => ({ workoutApi: { getAll: jest.fn(async () => ({ data: [] })) } }));
jest.mock('../db/workoutDb', () => ({ getAllExercises: jest.fn(async () => []) }));
jest.mock('../api/workoutBuilderApi', () => ({ workoutBuilderApi: { completeMyAssignment: jest.fn(async () => undefined) } }));
const mockQueueWorkout = jest.fn(async (..._a: unknown[]) => ({ id: 'q1', alreadySynced: false, serverId: null }));
jest.mock('../offline', () => ({
  queueWorkout: (...a: unknown[]) => mockQueueWorkout(...a),
  settleQueuedWorkout: jest.fn(async () => undefined),
  releaseQueuedWorkout: jest.fn(async () => undefined),
  triggerSync: jest.fn(async () => undefined),
}));

import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';

const HOUR = 60 * 60 * 1000;
const PUSH = {
  routineName: 'Push Day',
  exercises: JSON.stringify([{ exerciseId: 'ex-1', exerciseName: 'Bench Press', sets: 2, reps: 8, restSec: 90, weightLbs: 135 }]),
};
const LEGS = {
  routineName: 'Leg Day',
  exercises: JSON.stringify([{ exerciseId: 'ex-2', exerciseName: 'Back Squat', sets: 3, reps: 5, restSec: 120 }]),
};
const set = (completed: boolean) => ({ reps: 8, weight: 135, completed });

let listeners: Array<(state: AppStateStatus) => void> = [];
let spies: jest.SpyInstance[] = [];

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockMutateOptions = null;
  listeners = [];
  spies = [
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener);
      return { remove: () => { listeners = listeners.filter((l) => l !== listener); } };
    }),
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
      (buttons ?? []).find((b) => b.text === 'Finish')?.onPress?.();
    }),
  ];
});
afterEach(() => spies.forEach((s) => s.mockRestore()));

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
/** The app goes to the background: the screen writes its latest state at once. */
const background = () => act(async () => { [...listeners].forEach((l) => l('background')); await flush(); });

async function open(params: Record<string, unknown>, exerciseName: string) {
  mockRouteParams = params;
  const view = await render(<ActiveWorkoutScreen />);
  await waitFor(() => expect(view.getByText(exerciseName)).toBeTruthy());
  await act(flush);
  return view;
}

/** Every elapsed-time readout on the screen (live clock and finish summary), in seconds. */
function shownSeconds(view: Awaited<ReturnType<typeof render>>): number[] {
  return view.getAllByText(/^\d+:\d{2}(:\d{2})?$/).map((node) =>
    String(node.props.children).split(':').map(Number).reduce((total, part) => total * 60 + part, 0),
  );
}
function expectClockNear(view: Awaited<ReturnType<typeof render>>, seconds: number) {
  const shown = shownSeconds(view);
  expect(shown.length).toBeGreaterThan(0);
  for (const s of shown) {
    expect(s).toBeGreaterThanOrEqual(seconds);
    expect(s).toBeLessThan(seconds + 120);
  }
}

/** One hour of training (one set ticked) that started 30 hours ago, last changed 29 hours ago. */
async function saveYesterdaysWorkout(now: number) {
  await saveActiveWorkoutSession('c1', {
    startedAtMs: now - 30 * HOUR,
    routineName: 'Push Day',
    exercisesJson: PUSH.exercises,
    idempotencyKey: 'k-1',
    sessionExercises: [{ exerciseId: 'ex-1', exerciseName: 'Bench Press', restSec: 90, sets: [set(true), set(false)] }],
  }, now - 29 * HOUR);
}

describe('a workout reopened more than 12 hours after its last change', () => {
  it('counts the clock only up to that change, and Finish sends that duration', async () => {
    const now = Date.now();
    await saveYesterdaysWorkout(now);
    const view = await open({ ...PUSH, resume: true }, 'Bench Press');
    expectClockNear(view, 3600);

    await act(async () => { await fireEvent.press(view.getByTestId('finish-workout')); await flush(); });
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    const queued = mockQueueWorkout.mock.calls[0][0] as { clientKey: string; durationMinutes: number; payload: { duration_minutes: number } };
    expect(queued.payload.duration_minutes).toBe(60);
    expect(queued.durationMinutes).toBe(60);
    expect(mockMutate.mock.calls[0][0]).toMatchObject({ duration_minutes: 60 });
    // Same workout: its start (and so its offline copy's key) is unchanged.
    expect(queued.clientKey).toBe(`c1:${now - 30 * HOUR}`);

    // A refused save keeps the workout on the phone with the gap still left out.
    await act(async () => {
      mockMutateOptions!.onError!(Object.assign(new Error('Bad Request'), { response: { status: 400, data: {} } }));
      await flush();
    });
    await waitFor(async () => expect((await loadActiveWorkoutSession('c1'))?.session.pausedMs).toBeGreaterThanOrEqual(29 * HOUR));
  });

  it('keeps the gap out when the workout is reopened again later', async () => {
    const now = Date.now();
    await saveYesterdaysWorkout(now);
    const first = await open({ ...PUSH, resume: true }, 'Bench Press');
    await background();
    await first.unmount();
    const saved = await loadActiveWorkoutSession('c1');
    expect(saved?.isStale).toBe(false);
    expect(saved?.session.startedAtMs).toBe(now - 30 * HOUR);

    const again = await open({ ...PUSH, resume: true }, 'Bench Press');
    expectClockNear(again, 3600);
  });

  it('a workout reopened within 12 hours still counts from its start', async () => {
    const now = Date.now();
    await saveActiveWorkoutSession('c1', {
      startedAtMs: now - 40 * 60_000,
      routineName: 'Push Day',
      exercisesJson: PUSH.exercises,
      idempotencyKey: 'k-2',
      sessionExercises: [{ exerciseId: 'ex-1', exerciseName: 'Bench Press', restSec: 90, sets: [set(true), set(false)] }],
    }, now - 5 * 60_000);
    expectClockNear(await open({ ...PUSH, resume: true }, 'Bench Press'), 40 * 60);
  });
});

describe('the phone closed the app before anything was entered', () => {
  it('opening a different workout clears the empty one and opens the chosen workout', async () => {
    const first = await open(PUSH, 'Bench Press');
    await background();
    await first.unmount();
    expect((await loadActiveWorkoutSession('c1'))?.session.routineName).toBe('Push Day');

    const next = await open(LEGS, 'Back Squat');
    expect(next.queryByText('Bench Press')).toBeNull();
    expect(mockSetParams).not.toHaveBeenCalled();
    await background();
    const saved = await loadActiveWorkoutSession('c1');
    expect(saved?.session.routineName).toBe('Leg Day');
    expect(saved?.session.sessionExercises.map((e) => e.exerciseName)).toEqual(['Back Squat']);
  });

  it('opening the same workout again goes back into the saved one', async () => {
    const first = await open(PUSH, 'Bench Press');
    await background();
    await first.unmount();
    const before = await loadActiveWorkoutSession('c1');

    await open(PUSH, 'Bench Press');
    await background();
    const after = await loadActiveWorkoutSession('c1');
    expect(after?.session.startedAtMs).toBe(before?.session.startedAtMs);
    expect(after?.session.idempotencyKey).toBe(before?.session.idempotencyKey);
  });

  it('a saved workout with notes but no ticked set still reopens when another workout is opened', async () => {
    const first = await open(PUSH, 'Bench Press');
    await act(async () => { fireEvent.changeText(first.getByLabelText('Workout notes'), 'Left shoulder tight'); await flush(); });
    await background();
    await first.unmount();

    const next = await open(LEGS, 'Bench Press');
    expect(next.getByLabelText('Workout notes').props.value).toBe('Left shoulder tight');
    expect(next.queryByText('Back Squat')).toBeNull();
    expect(mockSetParams).toHaveBeenCalledWith(expect.objectContaining({ routineName: 'Push Day' }));
  });
});

describe('helpers', () => {
  it('a session is untouched only exactly as it opened', () => {
    const opened = { exercisesJson: PUSH.exercises, sessionExercises: routineSessionExercises(PUSH.exercises) };
    expect(isUntouchedSession(opened)).toBe(true);
    expect(isUntouchedSession({ ...opened, workoutNotes: '  ' })).toBe(true);
    expect(isUntouchedSession({ ...opened, workoutNotes: 'Felt good' })).toBe(false);
    const [bench] = opened.sessionExercises;
    expect(isUntouchedSession({ ...opened, sessionExercises: [{ ...bench, sets: [set(true), set(false)] }] })).toBe(false);
    expect(isUntouchedSession({ ...opened, sessionExercises: [{ ...bench, sets: [{ ...bench.sets[0], reps: 12 }, bench.sets[1]] }] })).toBe(false);
    expect(isUntouchedSession({ ...opened, sessionExercises: [bench, bench] })).toBe(false);
    expect(isUntouchedSession({ ...opened, sessionExercises: [{ ...bench, notes: 'Grip' }] })).toBe(false);
  });

  it('time left out of the clock: the gap since the last change, only past 12 hours', () => {
    const now = 100 * HOUR;
    expect(resumedPausedMs({ updatedAtMs: now - HOUR }, false, now)).toBe(0);
    expect(resumedPausedMs({ updatedAtMs: now - 20 * HOUR }, true, now)).toBe(20 * HOUR);
    expect(resumedPausedMs({ updatedAtMs: now - 20 * HOUR, pausedMs: 3 * HOUR }, true, now)).toBe(23 * HOUR);
    expect(resumedPausedMs({ updatedAtMs: now - HOUR, pausedMs: 3 * HOUR }, false, now)).toBe(3 * HOUR);
    expect(resumedPausedMs({ updatedAtMs: now, pausedMs: Number.NaN }, false, now)).toBe(0);
    expect(resumedPausedMs({ updatedAtMs: now, pausedMs: -5 }, false, now)).toBe(0);
  });
});
