/**
 * WORKOUT-REFUSAL-M (203-P1 Style 2): a Finish the server refuses with a reason code (backend b#1256) says
 * "Workout not saved", the server's words and its next step; with no code (the server live today) the alert is
 * main's, word for word (A5 rule 5). The harness is workoutSync124.screen.test.tsx's.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';
import type { LoggedWorkout } from '../screens/client/active-workout/sessionQuality';
import type { Exercise } from '../screens/client/active-workout/types';

jest.mock('../config/featureFlags', () => ({
  featureFlags: { coachBrief: true, romanChat: false },
}));

jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'c1', email: 'm@x.io', role: 'client', firstName: 'Marcus' }),
}));

let mockRouteParams: Record<string, unknown> = {};
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockDispatch = jest.fn();
const mockListeners: Record<string, (e: unknown) => void> = {};
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const ReactLib = jest.requireActual('react');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      setParams: jest.fn(),
      getParent: () => ({ navigate: mockNavigate }),
      dispatch: mockDispatch,
      addListener: (name: string, cb: (e: unknown) => void) => { mockListeners[name] = cb; return () => undefined; },
    }),
    useRoute: () => ({ params: mockRouteParams }),
    useFocusEffect: (cb: () => undefined | (() => void)) => {
      ReactLib.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
    },
  };
});

let capturedMutateOptions: { onSuccess?: (data: unknown) => void; onError?: (e: unknown) => void } | null = null;
const mockMutate = jest.fn((_vars: unknown, options: typeof capturedMutateOptions) => {
  capturedMutateOptions = options;
});
jest.mock('../hooks/useApi', () => ({
  useCreateWorkout: () => ({ mutate: mockMutate }),
}));

const mockLoadActiveWorkoutSession = jest.fn();
const mockSaveActiveWorkoutSession = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: (...a: unknown[]) => mockLoadActiveWorkoutSession(...a),
  saveActiveWorkoutSession: (...a: unknown[]) => mockSaveActiveWorkoutSession(...a),
  clearActiveWorkoutSession: (...a: unknown[]) => mockClearActiveWorkoutSession(...a),
}));
const mockClearActiveWorkoutSession = jest.fn(async (..._a: unknown[]) => undefined);

const mockGetWorkoutHistory = jest.fn(async () => ({ data: [] as LoggedWorkout[] }));
jest.mock('../services/api', () => ({
  workoutApi: { getRoutines: jest.fn(), getAll: () => mockGetWorkoutHistory(), getVolume: jest.fn() },
}));

const mockCatalog = jest.fn(async (): Promise<Exercise[]> => []);
jest.mock('../db/workoutDb', () => ({
  getAllExercises: () => mockCatalog(),
}));

const mockCompleteMyAssignment = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../api/workoutBuilderApi', () => ({
  workoutBuilderApi: { completeMyAssignment: (...a: unknown[]) => mockCompleteMyAssignment(...a) },
}));

const mockQueueWorkout = jest.fn(async (..._a: unknown[]) => ({ id: 'q1', alreadySynced: false, serverId: null }));
const mockSettle = jest.fn(async (..._a: unknown[]) => undefined);
const mockRelease = jest.fn(async (..._a: unknown[]) => undefined);
const mockCountQueued = jest.fn(async (..._a: unknown[]) => 0);
const mockPushQueued = jest.fn(async () => undefined);
const mockTriggerSync = jest.fn(async () => undefined);
jest.mock('../offline', () => ({
  queueWorkout: (...a: unknown[]) => mockQueueWorkout(...a),
  settleQueuedWorkout: (...a: unknown[]) => mockSettle(...a),
  releaseQueuedWorkout: (...a: unknown[]) => mockRelease(...a),
  countQueuedWorkouts: (...a: unknown[]) => mockCountQueued(...a),
  pushQueuedWorkouts: () => mockPushQueued(),
  triggerSync: () => mockTriggerSync(),
  workoutSyncEvents: { on: jest.fn(), off: jest.fn() },
}));

// ALM-D8: the logger's own reach into the local store (getDatabase); every statement it sends is recorded, so Leave can
// be shown to leave the parked row where the Train tab's card lists it.
const mockStoreStatements: string[] = [];
jest.mock('../offline/database', () => ({
  getDatabase: async () => {
    const note = (sql: string) => { mockStoreStatements.push(sql); };
    return {
      runAsync: async (sql: string) => note(sql),
      execAsync: async (sql: string) => note(sql),
      getFirstAsync: async (sql: string) => { note(sql); return null; },
      getAllAsync: async (sql: string) => { note(sql); return []; },
    };
  },
}));

const mockTrack = jest.fn();
jest.mock('../lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';

const STARTED_AT = Date.now() - 40 * 60 * 1000;
const SERVER_MUSCLE_GROUPS = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core', 'cardio', 'full_body'];

function storedSession(extra: Record<string, unknown> = {}) {
  return {
    isStale: false,
    session: {
      version: 1,
      startedAtMs: STARTED_AT,
      updatedAtMs: STARTED_AT,
      routineName: 'Push Day',
      exercisesJson: '[]',
      idempotencyKey: '0b6f2a3e-4b1c-4d2e-9f00-1a2b3c4d5e6f',
      sessionExercises: [
        {
          exerciseId: 'ex-1',
          exerciseName: 'Bench Press',
          sets: [
            { weight: 135, reps: 8, completed: true },
            { weight: 145, reps: 6, completed: true },
          ],
        },
      ],
      ...extra,
    },
  };
}

let alertTitles: string[] = [];
let alertBodies: string[] = [];
let alertButtons: Array<Array<{ text?: string; onPress?: () => void }>> = [];
let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  capturedMutateOptions = null;
  alertTitles = [];
  alertBodies = [];
  alertButtons = [];
  mockRouteParams = { routineName: 'Push Day', exercises: '[]' };
  mockLoadActiveWorkoutSession.mockResolvedValue(storedSession());
  mockGetWorkoutHistory.mockResolvedValue({ data: [] });
  mockCatalog.mockResolvedValue([]);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((title, body, buttons) => {
    alertTitles.push(String(title));
    alertBodies.push(String(body ?? ''));
    alertButtons.push((buttons ?? []) as Array<{ text?: string; onPress?: () => void }>);
    const press = (buttons ?? []).find((b) => b.text === 'Resume' || b.text === 'Finish');
    press?.onPress?.();
  });
});

afterEach(() => {
  alertSpy.mockRestore();
});

async function finishOnce(view: Awaited<ReturnType<typeof render>>) {
  await act(async () => {
    await fireEvent.press(view.getByText('Finish workout'));
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}


const W2 = 'If an app update is waiting, install it, then send it again.';
const answer = (data: Record<string, unknown>) => Object.assign(new Error('HTTP 400'), { response: { status: 400, data } });

describe('a Finish the server refuses', () => {
  it.each([
    [
      // OPERATOR RULING 7208809287 item 3: a client never reads the validation line.
      'WORKOUT_INVALID: the plain line and the next step, never the validation line',
      answer({ statusCode: 400, code: 'WORKOUT_INVALID', message: ['property surprise should not exist'], error: 'Bad Request', next_step: W2 }),
      'Workout not saved',
      `Part of this workout couldn't be saved.\n\n${W2}`,
    ],
    [
      'another code with a next step: the server\'s words and its next step, as built',
      answer({ statusCode: 400, code: 'WORKOUT_OTHER', message: 'Workout date is too far ahead', error: 'Bad Request', next_step: W2 }),
      'Workout not saved',
      `The server said:\n\u201CWorkout date is too far ahead\u201D\n\n${W2}`,
    ],
    [
      'with no code (the old server): main\'s alert, word for word',
      answer({ statusCode: 400, message: ['property surprise should not exist'], error: 'Bad Request' }),
      'Workout not saved yet',
      'Bad Request. The sets stay on this screen. Check the connection, then tap Finish again.',
    ],
  ])('%s', async (_name, err, title, body) => {
    const view = await render(<ActiveWorkoutScreen />);
    await waitFor(() => expect(view.getByText('Bench Press')).toBeTruthy());
    await finishOnce(view);
    await act(async () => {
      capturedMutateOptions!.onError!(err);
      await Promise.resolve();
    });
    // The engine parks the body either way (it keeps the reason only when there is one).
    expect(mockRelease).toHaveBeenCalledWith(`c1:${STARTED_AT}`, err);
    expect(mockGoBack).not.toHaveBeenCalled();
    const i = alertTitles.lastIndexOf(title);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(alertBodies[i]).toBe(body);
    if (title === 'Workout not saved' && err.response.data.code === 'WORKOUT_INVALID') {
      expect(alertBodies.join('\n')).not.toMatch(/property|should not exist/);
    }
    expect(alertTitles).not.toContain(title === 'Workout not saved' ? 'Workout not saved yet' : 'Workout not saved');
    // The sets stay on the logger and the session is saved again for Finish again.
    expect(mockSaveActiveWorkoutSession).toHaveBeenCalled();
  });
});

// ALM-D8 (OPERATOR RULING 7209272454, owner #ALM-E15 "DECISIONS #ALM-D8 - op 1"): after a Finish refused with a coded
// reason and parked on this phone, every way out of the logger that asks "Log this workout?" also offers Leave, which
// closes the logger and ends the live session; nothing is sent, no second copy is queued, and the parked workout stays
// (the engine parked it with its reason through releaseQueuedWorkout: workoutRefusalM.engine.test.ts lists such a row
// until it is sent again or removed). Before any refusal, and after one with no code, the question is main's.
describe('ALM-D8: leaving the logger after a refused Finish', () => {
  const CODED = answer({ statusCode: 400, code: 'WORKOUT_INVALID', message: ['property surprise should not exist'], error: 'Bad Request', next_step: W2 });
  const UNCODED = answer({ statusCode: 400, message: ['property surprise should not exist'], error: 'Bad Request' });
  const mockTabLeave = jest.fn();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { workoutLeaveGuard } = require('../navigation/workoutLeaveGuard') as typeof import('../navigation/workoutLeaveGuard');
  type View = Awaited<ReturnType<typeof render>>;
  const WAYS: Array<[string, (view: View) => void, () => void]> = [
    ['the close control (Leave workout)', (view) => fireEvent.press(view.getByLabelText('Leave workout')),
      () => expect(mockGoBack).toHaveBeenCalledTimes(1)],
    ['the back gesture (Android back)', () => mockListeners.beforeRemove({ preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } }),
      () => expect(mockDispatch).toHaveBeenCalledWith({ type: 'GO_BACK' })],
    ['a press on another tab', () => workoutLeaveGuard()!(mockTabLeave),
      () => { expect(mockGoBack).toHaveBeenCalledTimes(1); expect(mockTabLeave).toHaveBeenCalledTimes(1); }],
  ];
  const STATES: Array<[string, unknown, boolean]> = [
    ['after a coded refusal', CODED, true],
    ['before any refusal', null, false],
    ['after a refusal with no code (the old server)', UNCODED, false],
  ];
  const rows = STATES.flatMap(([state, err, leave]) => WAYS.map(([way, go, left]) => [state, way, err, leave, go, left] as const));
  const sends = () => [mockMutate, mockQueueWorkout, mockRelease, mockSettle, mockPushQueued, mockTriggerSync, mockCompleteMyAssignment]
    .map((m) => m.mock.calls.length);

  it.each(rows)('%s, %s', async (_state, _way, err, leave, go, left) => {
    mockTabLeave.mockClear();
    const view = await render(<ActiveWorkoutScreen />);
    await waitFor(() => expect(view.getByText('Bench Press')).toBeTruthy());
    if (err) {
      await finishOnce(view);
      await act(async () => { capturedMutateOptions!.onError!(err); await Promise.resolve(); });
      expect(mockRelease).toHaveBeenCalledWith(`c1:${STARTED_AT}`, err); // parked (the engine keeps a coded reason)
    }
    mockGoBack.mockClear();
    mockDispatch.mockClear();
    await act(async () => { go(view); });
    const i = alertTitles.lastIndexOf('Log this workout?');
    expect(i).toBeGreaterThanOrEqual(0);
    const texts = alertButtons[i].map((b) => b.text);
    if (!leave) {
      expect(texts).toEqual(['Keep training', 'Finish and log']);
      expect(mockGoBack).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(mockTabLeave).not.toHaveBeenCalled();
      return;
    }
    expect(texts).toEqual(['Keep training', 'Finish and log', 'Leave']);
    expect(mockGoBack).not.toHaveBeenCalled(); // asked first, nothing left yet
    const before = sends();
    mockClearActiveWorkoutSession.mockClear();
    mockStoreStatements.length = 0;
    await act(async () => { alertButtons[i][2].onPress!(); for (let k = 0; k < 6; k++) await Promise.resolve(); });
    left(); // the logger closed (and the tab opened)
    expect(mockClearActiveWorkoutSession).toHaveBeenCalledWith('c1'); // the live session ended
    expect(sends()).toEqual(before); // nothing sent, nothing queued again, the parked row not touched
    expect(mockQueueWorkout).toHaveBeenCalledTimes(1); // no second copy
    // The parked row is still listed: Leave sends no statement to the local store, so the dead_letter row and its
    // reason stay as releaseQueuedWorkout left them (listRefusedWorkouts lists such a row: workoutRefusalM.engine).
    expect(mockStoreStatements).toEqual([]);
  });
});
