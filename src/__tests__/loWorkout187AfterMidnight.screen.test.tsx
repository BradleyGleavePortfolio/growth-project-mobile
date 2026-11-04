/**
 * LO-WORKOUT (agent 187, audit of main 585616c8): a workout started late in
 * the evening and finished after midnight is saved on the day it was trained
 * (the day it started), not the day the Finish button was pressed.
 *
 * Harness copied from workoutSync124.screen.test.tsx.
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
import WorkoutSyncCards from '../components/workout/WorkoutSyncCards';

// Friday 29 Oct 2026, 23:30 local: the client starts. Saturday 00:15 local: Finish.
const STARTED_AT = new Date(2026, 9, 29, 23, 30, 0).getTime();
const FINISHED_AT = new Date(2026, 9, 30, 0, 15, 0).getTime();

function storedSession() {
  return {
    isStale: false,
    session: {
      version: 1,
      startedAtMs: STARTED_AT,
      updatedAtMs: FINISHED_AT - 60_000,
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
    },
  };
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  // Only the clock is faked; timers stay real so the screen settles normally.
  jest.useFakeTimers({
    now: FINISHED_AT,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'hrtime', 'performance'],
  });
  mockRouteParams = { routineName: 'Push Day', exercises: '[]' };
  mockLoadActiveWorkoutSession.mockResolvedValue(storedSession());
  mockGetWorkoutHistory.mockResolvedValue({ data: [] });
  mockCatalog.mockResolvedValue([]);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
    const press = (buttons ?? []).find((b) => b.text === 'Resume' || b.text === 'Finish');
    press?.onPress?.();
  });
});

afterEach(() => {
  alertSpy.mockRestore();
  jest.useRealTimers();
});

describe('LO-WORKOUT B2: a workout finished after midnight', () => {
  it('is saved on the day it was started (Friday), not the day Finish was pressed (Saturday)', async () => {
    const view = await render(<ActiveWorkoutScreen />);
    await waitFor(() => expect(view.getByText('Bench Press')).toBeTruthy());

    await act(async () => {
      await fireEvent.press(view.getByText('Finish workout'));
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    expect(mockQueueWorkout).toHaveBeenCalledTimes(1);
    const queued = mockQueueWorkout.mock.calls[0][0] as { payload: { date: string } };
    expect(queued.payload.date).toBe('2026-10-29');
    expect((mockMutate.mock.calls[0][0] as { date: string }).date).toBe('2026-10-29');
  });
});
