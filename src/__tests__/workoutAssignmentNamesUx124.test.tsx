/**
 * UX-WORKOUT-124 (agent 124): a coach-assigned workout shows the real
 * exercise names, its load error can be retried, the plan type is
 * capitalised, and Home knows a workout was logged today.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { formatPlanType } from '../utils/workout/formatPlanType';
import { isWorkoutDoneToday } from '../utils/workout/workoutDoneToday';
import { displayExerciseName } from '../hooks/useExerciseNames';

const mockGetById = jest.fn();
jest.mock('../api/exerciseLibraryApi', () => ({
  exerciseLibraryApi: { getById: (...a: unknown[]) => mockGetById(...a) },
}));

// mockNavigate is the client tab navigator (MoreStack's only parent);
// mockStackNavigate is MoreStack itself, which cannot reach ActiveWorkout.
const mockNavigate = jest.fn();
const mockStackNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockStackNavigate,
      getParent: () => ({ navigate: mockNavigate }),
    }),
    useRoute: () => ({ params: { assignmentId: 'asg-1' } }),
  };
});

const mockRefetch = jest.fn();
let mockAssignment: { data: unknown; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};
jest.mock('../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignment: () => ({ ...mockAssignment, refetch: mockRefetch, isRefetching: false }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const WorkoutAssignmentDetailScreen = require('../screens/client/WorkoutAssignmentDetailScreen').default;

function wrap(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

const PLAN = {
  id: 'asg-1',
  completed_at: null,
  post_rpe: null,
  workout_plan: {
    id: 'plan-1',
    name: 'Upper A',
    type: 'strength',
    duration_estimate_minutes: 45,
    exercises: [
      { id: 'pe1', exercise_external_id: 'seed:push-001', order: 1, sets: 3, reps_or_duration_seconds: 8, weight_lbs: 95, rest_seconds: 90, notes: null },
      { id: 'pe2', exercise_external_id: '0025', order: 2, sets: 3, reps_or_duration_seconds: 10, weight_lbs: null, rest_seconds: 60, notes: null },
    ],
  },
};

beforeEach(() => {
  mockStackNavigate.mockReset();
  mockGetById.mockReset();
  mockNavigate.mockReset();
  mockRefetch.mockReset();
});

describe('coach-assigned workout names (B: client saw "Push 001" / "Exercise")', () => {
  it('shows the catalog names and starts the session with them', async () => {
    mockAssignment = { data: PLAN, isLoading: false, isError: false };
    mockGetById.mockImplementation((id: string) =>
      Promise.resolve({ data: { id, name: id === '0025' ? 'barbell bent over row' : 'Barbell Bench Press' } }),
    );
    const { getByText, findByText } = await render(wrap(<WorkoutAssignmentDetailScreen />));
    expect(await findByText('1. Barbell Bench Press')).toBeTruthy();
    expect(await findByText('2. Barbell Bent Over Row')).toBeTruthy();
    expect(getByText(/^Strength/)).toBeTruthy();

    await fireEvent.press(getByText('Start workout'));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockStackNavigate).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('WorkoutTab', {
      screen: 'ActiveWorkout',
      params: expect.objectContaining({ assignmentId: 'asg-1', routineId: 'plan-1' }),
    });
    const params = mockNavigate.mock.calls[0][1].params;
    const names = JSON.parse(params.exercises).map((e: { exerciseName: string }) => e.exerciseName);
    expect(names).toEqual(['Barbell Bench Press', 'Barbell Bent Over Row']);
  });

  // FIX ROUND 2 (B-399-1): a client who taps Start while the names are
  // still loading used to get "Push 001" / "Exercise" frozen into the live
  // workout. Start now waits for the in-flight reads.
  const startButton = (q: Awaited<ReturnType<typeof render>>) =>
    q.getByLabelText(/^(Start workout|Loading exercise names)/);
  const realName = (id: string) => (id === '0025' ? 'barbell bent over row' : 'Barbell Bench Press');
  const startedNames = () =>
    JSON.parse(mockNavigate.mock.calls[0][1].params.exercises).map(
      (e: { exerciseName: string }) => e.exerciseName,
    );

  it('cold cache: a Start tap while names load does not seed placeholders; the real names go in', async () => {
    mockAssignment = { data: PLAN, isLoading: false, isError: false };
    const release: Array<() => void> = [];
    mockGetById.mockImplementation(
      (id: string) =>
        new Promise((resolve) => {
          release.push(() => resolve({ data: { id, name: realName(id) } }));
        }),
    );
    const screen = await render(wrap(<WorkoutAssignmentDetailScreen />));
    await waitFor(() => expect(mockGetById).toHaveBeenCalledTimes(2));

    await fireEvent.press(startButton(screen));
    expect(mockNavigate).not.toHaveBeenCalled();

    await act(async () => {
      release.forEach((r) => r());
    });
    expect(await screen.findByText('Start workout')).toBeTruthy();
    await fireEvent.press(startButton(screen));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(startedNames()).toEqual(['Barbell Bench Press', 'Barbell Bent Over Row']);
  });

  it('a failed lookup does not block Start; the session keeps the fallback names', async () => {
    mockAssignment = { data: PLAN, isLoading: false, isError: false };
    mockGetById.mockRejectedValue(new Error('503'));
    const screen = await render(wrap(<WorkoutAssignmentDetailScreen />));
    // One retry (about 1 s) per lookup, then Start is offered.
    await waitFor(() => expect(screen.getByText('Start workout')).toBeTruthy(), { timeout: 6000 });
    await fireEvent.press(startButton(screen));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(startedNames()).toEqual(['Push 001', 'Exercise']);
  }, 10000);

  it('falls back to the prettified id when a lookup fails', async () => {
    mockAssignment = { data: PLAN, isLoading: false, isError: false };
    mockGetById.mockRejectedValue(new Error('503'));
    const { findByText } = await render(wrap(<WorkoutAssignmentDetailScreen />));
    expect(await findByText('1. Push 001')).toBeTruthy();
  });
});

describe('assignment load error (U: "Pull to retry" on a screen that cannot be pulled)', () => {
  it('shows a Try again button that refetches', async () => {
    mockAssignment = { data: undefined, isLoading: false, isError: true };
    const { getByTestId, queryByText } = await render(wrap(<WorkoutAssignmentDetailScreen />));
    expect(queryByText(/Pull to retry/)).toBeNull();
    await fireEvent.press(getByTestId('assignment-retry'));
    await waitFor(() => expect(mockRefetch).toHaveBeenCalledTimes(1));
  });
});

describe('small helpers', () => {
  it('capitalises plan types', () => {
    expect(formatPlanType('strength')).toBe('Strength');
    expect(formatPlanType('hiit_cardio')).toBe('Hiit cardio');
    expect(formatPlanType(null)).toBe('Workout');
  });
  it('title-cases catalog names', () => {
    expect(displayExerciseName('barbell bench press')).toBe('Barbell Bench Press');
  });
  it('Home counts a workout logged today even with no `completed` field', () => {
    expect(isWorkoutDoneToday([{ date: '2026-10-06T00:00:00.000Z' }], '2026-10-06')).toBe(true);
    expect(isWorkoutDoneToday([{ date: '2026-10-05T00:00:00.000Z' }], '2026-10-06')).toBe(false);
    expect(isWorkoutDoneToday([{ date: '2026-10-06T00:00:00.000Z', completed: false }], '2026-10-06')).toBe(false);
    expect(isWorkoutDoneToday(undefined, '2026-10-06')).toBe(false);
  });
});
