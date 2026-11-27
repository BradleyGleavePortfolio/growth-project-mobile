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
      addListener: () => () => undefined,
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
  clearActiveWorkoutSession: jest.fn(async () => undefined),
}));

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
let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  capturedMutateOptions = null;
  alertTitles = [];
  alertBodies = [];
  mockRouteParams = { routineName: 'Push Day', exercises: '[]' };
  mockLoadActiveWorkoutSession.mockResolvedValue(storedSession());
  mockGetWorkoutHistory.mockResolvedValue({ data: [] });
  mockCatalog.mockResolvedValue([]);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((title, body, buttons) => {
    alertTitles.push(String(title));
    alertBodies.push(String(body ?? ''));
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
