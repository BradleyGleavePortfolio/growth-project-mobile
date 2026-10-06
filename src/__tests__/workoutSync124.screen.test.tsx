/**
 * WORKOUT-SYNC-124 (agent 124): the Finish path and the Workouts tab cards.
 *
 *   - Finish with no signal: the whole workout is queued on the phone, the
 *     client is told it is saved and will be sent, and the screen closes
 *     (it used to say "not saved yet" and keep the client stuck retrying).
 *   - Finish again after a server refusal updates the same queued workout.
 *   - A coach-assigned workout queues its completion with the workout.
 *   - The Workouts tab shows a workout left in progress (app closed or killed)
 *     and reopens it with its sets, name and coach assignment.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';

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

jest.mock('../services/api', () => ({
  workoutApi: { getRoutines: jest.fn(), getAll: jest.fn(async () => ({ data: [] })), getVolume: jest.fn() },
}));

jest.mock('../db/workoutDb', () => ({
  getAllExercises: jest.fn(async () => []),
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
jest.mock('../offline', () => ({
  queueWorkout: (...a: unknown[]) => mockQueueWorkout(...a),
  settleQueuedWorkout: (...a: unknown[]) => mockSettle(...a),
  releaseQueuedWorkout: (...a: unknown[]) => mockRelease(...a),
  countQueuedWorkouts: (...a: unknown[]) => mockCountQueued(...a),
  pushQueuedWorkouts: () => mockPushQueued(),
  triggerSync: jest.fn(async () => undefined),
  workoutSyncEvents: { on: jest.fn(), off: jest.fn() },
}));

import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';
import WorkoutSyncCards from '../components/workout/WorkoutSyncCards';

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
let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  capturedMutateOptions = null;
  alertTitles = [];
  mockRouteParams = { routineName: 'Push Day', exercises: '[]' };
  mockLoadActiveWorkoutSession.mockResolvedValue(storedSession());
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((title, _body, buttons) => {
    alertTitles.push(String(title));
    const press = (buttons ?? []).find((b) => b.text === 'Resume' || b.text === 'Finish');
    press?.onPress?.();
  });
});

afterEach(() => {
  alertSpy.mockRestore();
});

async function finishOnce(view: Awaited<ReturnType<typeof render>>) {
  await act(async () => {
    await fireEvent.press(view.getByText('Finish'));
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

describe('Finish with no signal', () => {
  it('queues the whole workout, says it is saved and will be sent, and closes the screen', async () => {
    const view = await render(<ActiveWorkoutScreen />);
    await waitFor(() => expect(view.getByText('Bench Press')).toBeTruthy());

    await finishOnce(view);

    expect(mockQueueWorkout).toHaveBeenCalledTimes(1);
    const queued = mockQueueWorkout.mock.calls[0][0] as {
      clientKey: string;
      payload: { workout_name: string; workout_type: string; exercises: Array<Record<string, unknown>> };
    };
    expect(queued.clientKey).toBe(`c1:${STARTED_AT}`);
    expect(queued.payload).toMatchObject({
      workout_name: 'Push Day',
      workout_type: 'strength',
      exercises: [{ exercise_name: 'Bench Press', weight_per_set: [135, 145], reps_per_set: [8, 6], sets_completed: 2 }],
    });
    expect(SERVER_MUSCLE_GROUPS).toContain(queued.payload.exercises[0].muscle_group);
    expect(queued.payload).not.toHaveProperty('local_id');
    // The screen's POST carries the same body.
    expect(mockMutate.mock.calls[0][0]).toEqual(queued.payload);

    // No signal: the request never got an answer.
    await act(async () => {
      capturedMutateOptions!.onError!(new Error('Network Error'));
      await Promise.resolve();
    });

    expect(mockRelease).toHaveBeenCalledWith(`c1:${STARTED_AT}`);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(alertTitles).toContain('Saved on this phone');
    expect(alertTitles).not.toContain('Workout not saved yet');
  });

  it('marks the queued copy sent when the screen save succeeds', async () => {
    const view = await render(<ActiveWorkoutScreen />);
    await waitFor(() => expect(view.getByText('Bench Press')).toBeTruthy());
    await finishOnce(view);
    await act(async () => {
      capturedMutateOptions!.onSuccess!({ id: 'srv-9' });
      await Promise.resolve();
    });
    expect(mockSettle).toHaveBeenCalledWith(`c1:${STARTED_AT}`, 'srv-9');
  });

  it('a server refusal parks the copy; Finish again re-queues the same workout', async () => {
    const view = await render(<ActiveWorkoutScreen />);
    await waitFor(() => expect(view.getByText('Bench Press')).toBeTruthy());
    await finishOnce(view);
    await act(async () => {
      capturedMutateOptions!.onError!(Object.assign(new Error('Bad Request'), { response: { status: 400, data: {} } }));
      await Promise.resolve();
    });
    expect(mockRelease).toHaveBeenCalledWith(`c1:${STARTED_AT}`, { rejected: true });
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(alertTitles).toContain('Workout not saved yet');

    await finishOnce(view);
    expect(mockQueueWorkout).toHaveBeenCalledTimes(2);
    const keys = mockQueueWorkout.mock.calls.map((c) => (c[0] as { clientKey: string }).clientKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('a coach-assigned workout queues its completion with the workout', async () => {
    mockRouteParams = { routineName: 'Push Day', exercises: '[]', assignmentId: 'asg-1' };
    mockLoadActiveWorkoutSession.mockResolvedValue(storedSession({ assignmentId: 'asg-1' }));
    const view = await render(<ActiveWorkoutScreen />);
    await waitFor(() => expect(view.getByText('Bench Press')).toBeTruthy());
    await finishOnce(view);

    const queued = mockQueueWorkout.mock.calls[0][0] as {
      assignment: { assignmentId: string; input: { idempotency_key: string; completion_payload: unknown; started_at: string } };
    };
    expect(queued.assignment.assignmentId).toBe('asg-1');
    expect(queued.assignment.input.idempotency_key).toBe('0b6f2a3e-4b1c-4d2e-9f00-1a2b3c4d5e6f');
    expect(queued.assignment.input.started_at).toBe(new Date(STARTED_AT).toISOString());
    expect(queued.assignment.input.completion_payload).toMatchObject({
      exercises: [{ exerciseName: 'Bench Press', sets: [{ actual_weight_lbs: 135, actual_reps: 8, status: 'completed' }, { actual_weight_lbs: 145, actual_reps: 6 }] }],
    });
  });
});

describe('app closed mid-workout', () => {
  it('the Workouts tab offers the workout in progress and reopens it with its name and assignment', async () => {
    mockLoadActiveWorkoutSession.mockResolvedValue(storedSession({ assignmentId: 'asg-1' }));
    const { findByTestId, getByText } = await render(<WorkoutSyncCards userId="c1" />);
    const card = await findByTestId('workout-resume-card');
    expect(getByText('Workout in progress')).toBeTruthy();
    expect(getByText(/2 sets logged/)).toBeTruthy();

    await act(async () => {
      await fireEvent.press(card);
    });
    expect(mockNavigate).toHaveBeenCalledWith('ActiveWorkout', {
      routineName: 'Push Day',
      exercises: '[]',
      assignmentId: 'asg-1',
      resume: true,
    });
    // Queued workouts are sent on every visit to the tab.
    expect(mockPushQueued).toHaveBeenCalled();
  });

  it('reopening from the card restores the sets without asking again', async () => {
    mockRouteParams = { routineName: 'Push Day', exercises: '[]', resume: true };
    const { getByText } = await render(<ActiveWorkoutScreen />);
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());
    expect(alertTitles).not.toContain('Resume workout?');
  });

  it('says how many finished workouts are waiting to be sent', async () => {
    mockLoadActiveWorkoutSession.mockResolvedValue(null);
    mockCountQueued.mockResolvedValue(1);
    const { findByTestId, queryByTestId } = await render(<WorkoutSyncCards userId="c1" />);
    const notice = await findByTestId('workout-queued-notice');
    expect(notice).toBeTruthy();
    expect(queryByTestId('workout-resume-card')).toBeNull();
  });
});
