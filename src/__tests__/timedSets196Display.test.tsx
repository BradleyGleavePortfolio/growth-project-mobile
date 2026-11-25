/**
 * TIMED-SETS-M (agent 196): a plan row the coach counts in seconds reads in
 * seconds on every screen that shows the count; a reps row reads as on main.
 * The server sends `unit` on each plan row (TIMED-SETS-BE, b#1211); a row
 * without one reads reps.
 */
import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ClientWorkoutAssignmentWithPlan } from '../api/workoutBuilderApi';
import { formatRow } from '../components/coach/ai-builder/aiBuilderCopy';
import { countWord, unitField, unitOf } from '../utils/workout/exerciseUnit';

const NAMES: Record<string, string> = { plank: 'front plank', squat: 'back squat' };
const mockGetById = jest.fn();
jest.mock('../api/exerciseLibraryApi', () => ({
  exerciseLibraryApi: { getById: (...a: unknown[]) => mockGetById(...a) },
}));
const mockTabNavigate = jest.fn();
const mockNavigation = {
  navigate: jest.fn(), getParent: () => ({ navigate: mockTabNavigate }), addListener: jest.fn(() => () => undefined),
};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: { assignmentId: 'asg-1' } }),
  useFocusEffect: () => undefined,
}));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-a', role: 'client' }) }));
jest.mock('../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: async () => null }));
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(), success: jest.fn() },
}));
let mockDetail: unknown;
let mockList: unknown[] = [];
jest.mock('../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignment: () => ({ data: mockDetail, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false }),
  useMyWorkoutAssignments: () => ({ data: mockList, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false }),
}));
jest.mock('../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ coach_id: 'coach-1', name: 'Sam Rivera' }] }) }));
jest.mock('../hooks/useExerciseNames', () => ({
  ...jest.requireActual('../hooks/useExerciseNames'),
  useExerciseNames: () => ({ names: { plank: 'Front Plank', squat: 'Back Squat' }, loading: false }),
}));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true] }));

import WorkoutAssignmentDetailScreen from '../screens/client/WorkoutAssignmentDetailScreen';
import ClientWorkoutViewerScreen from '../screens/client/ClientWorkoutViewerScreen';
import { TrainDay, type TrainWorkout } from '../screens/client/train/TrainToday';
import { getTodayString } from '../utils/date';

const ROWS = [
  { exercise_external_id: 'plank', order: 1, sets: 3, reps_or_duration_seconds: 60, unit: 'seconds', weight_lbs: null, rest_seconds: 30, superset_group_id: null, notes: null },
  { exercise_external_id: 'squat', order: 2, sets: 4, reps_or_duration_seconds: 5, unit: 'reps', weight_lbs: 135, rest_seconds: 120, superset_group_id: null, notes: null },
];
function assignment(rows: unknown[] = ROWS, extra: Record<string, unknown> = {}): ClientWorkoutAssignmentWithPlan {
  return {
    id: 'asg-1', workout_plan_id: 'plan-1', client_id: 'client-a', assigned_by_coach_id: 'coach-1',
    scheduled_for: `${getTodayString()}T12:00:00`, completed_at: null, post_rpe: null, post_notes: null,
    workout_plan: { id: 'plan-1', coach_id: 'coach-1', name: 'Core day', type: 'strength', duration_estimate_minutes: 30,
      created_at: '', updated_at: '', archived_at: null, exercises: [] },
    snapshot: { plan_name: 'Core day', plan_type: 'strength' },
    exercises: rows, snapshot_source: true, roman_adjusted_sets: [],
    ...extra,
  } as unknown as ClientWorkoutAssignmentWithPlan;
}

let qc: QueryClient;
const wrap = (node: React.ReactElement) => <QueryClientProvider client={qc}>{node}</QueryClientProvider>;

beforeEach(() => {
  jest.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetById.mockImplementation((id: string) => Promise.resolve({ data: { id, name: NAMES[id] } }));
  mockList = [];
});

describe('the unit a plan row reads in', () => {
  it('reads seconds only for "seconds"; absent or anything else reads reps', () => {
    expect(unitOf({ unit: 'seconds' })).toBe('seconds');
    expect(unitOf({ unit: 'reps' })).toBe('reps');
    expect(unitOf({})).toBe('reps');
    expect(unitOf({ unit: 'minutes' })).toBe('reps');
    expect(countWord({ unit: 'seconds' })).toBe('sec');
    expect(countWord({})).toBe('reps');
    expect(unitField('seconds')).toEqual({ unit: 'seconds' });
    expect(unitField(undefined)).toEqual({});
    expect(unitField('minutes')).toEqual({});
  });
});

describe('a 60-second plank reads in seconds; a squat reads as on main', () => {
  it('assignment detail: "3 sets × 60 sec" and "4 sets × 5 reps"', async () => {
    mockDetail = assignment();
    const view = await render(wrap(<WorkoutAssignmentDetailScreen />));
    expect(await view.findByText('Front Plank')).toBeTruthy();
    expect(within(view.getByTestId('assignment-row-1')).getByText(/^3 sets × 60 sec · 30s rest$/)).toBeTruthy();
    expect(within(view.getByTestId('assignment-row-2')).getByText(/^4 sets × 5 reps · 135 lb · 120s rest$/)).toBeTruthy();
  });

  it('assignment detail: a row the server sent without a unit reads reps, as on main', async () => {
    const { unit: _u, ...older } = ROWS[0];
    mockDetail = assignment([older, ROWS[1]]);
    const view = await render(wrap(<WorkoutAssignmentDetailScreen />));
    expect(await view.findByText('Front Plank')).toBeTruthy();
    expect(within(view.getByTestId('assignment-row-1')).getByText(/^3 sets × 60 reps · 30s rest$/)).toBeTruthy();
  });

  it('Start carries the unit and the plan row order into the live workout', async () => {
    mockDetail = assignment();
    const view = await render(wrap(<WorkoutAssignmentDetailScreen />));
    await fireEvent.press(await view.findByText('Start workout'));
    const { params } = mockTabNavigate.mock.calls[0][1];
    const started = JSON.parse(params.exercises) as Array<Record<string, unknown>>;
    expect(started.map((e) => [e.exerciseId, e.reps, e.unit, e.planOrder])).toEqual([
      ['plank', 60, 'seconds', 1], ['squat', 5, 'reps', 2],
    ]);
  });

  it('workout list: "3 sets × 60 sec"; the reps row keeps "reps / sec"', async () => {
    mockList = [assignment()];
    const view = await render(wrap(<ClientWorkoutViewerScreen />));
    expect(await view.findByText('Front Plank')).toBeTruthy();
    expect(view.getByText('3 sets × 60 sec')).toBeTruthy();
    expect(view.getByText('4 sets × 5 reps / sec · 135 lb prescribed')).toBeTruthy();
  });

  it('Train today: "3 × 60 sec" and "4 × 5 · 135 lb"', async () => {
    const view = await render(
      <TrainDay workout={assignment() as unknown as TrainWorkout} hasAny state="ready" coachless={false} coachId="coach-1"
        userId="client-a" onStart={jest.fn()} onRetry={jest.fn()} today={getTodayString()} />,
    );
    expect(view.getByText('3 × 60 sec')).toBeTruthy();
    expect(view.getByText('4 × 5 · 135 lb')).toBeTruthy();
  });

  it('Ask AI change rows: "3 x 60 sec" for a timed row, "4 x 5 @ 135 lb" as on main', () => {
    expect(formatRow({ sets: 3, reps_or_duration_seconds: 60, unit: 'seconds' } as never)).toBe('3 x 60 sec');
    expect(formatRow({ sets: 4, reps_or_duration_seconds: 5, weight_lbs: 135 })).toBe('4 x 5 @ 135 lb');
    expect(formatRow({ sets: 4, reps_or_duration_seconds: 5, weight_lbs: 135, unit: 'reps' } as never)).toBe('4 x 5 @ 135 lb');
  });
});
