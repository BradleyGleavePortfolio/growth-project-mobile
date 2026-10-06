/**
 * B-ROMANADJ-125: a coach approves Roman's set change in the Action Queue;
 * the client's workout screen shows and starts the approved sets, with a
 * small "Updated by your coach" note. An older server (no field) keeps
 * today's behaviour.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { overlayRomanAdjustedSets } from '../utils/workout/romanAdjustedSets';

const mockGetById = jest.fn();
jest.mock('../api/exerciseLibraryApi', () => ({
  exerciseLibraryApi: { getById: (...a: unknown[]) => mockGetById(...a) },
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      getParent: () => ({ getParent: () => ({ navigate: mockNavigate }) }),
    }),
    useRoute: () => ({ params: { assignmentId: 'asg-1' } }),
  };
});

let mockAssignment: { data: unknown; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};
jest.mock('../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignment: () => ({ ...mockAssignment, refetch: jest.fn(), isRefetching: false }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const WorkoutAssignmentDetailScreen = require('../screens/client/WorkoutAssignmentDetailScreen').default;

function wrap(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

const EXERCISES = [
  { id: 'pe1', exercise_external_id: 'bench', order: 1, sets: 4, reps_or_duration_seconds: 8, weight_lbs: 95, rest_seconds: 90, notes: null },
  { id: 'pe2', exercise_external_id: 'row', order: 2, sets: 3, reps_or_duration_seconds: 10, weight_lbs: null, rest_seconds: 60, notes: null },
];

function assignment(extra: Record<string, unknown>) {
  return {
    id: 'asg-1',
    completed_at: null,
    post_rpe: null,
    workout_plan: { id: 'plan-1', name: 'Upper A', type: 'strength', duration_estimate_minutes: 45, exercises: EXERCISES },
    ...extra,
  };
}

async function openAndStart() {
  const screen = await render(wrap(<WorkoutAssignmentDetailScreen />));
  expect(await screen.findByText('Start workout')).toBeTruthy();
  await fireEvent.press(screen.getByText('Start workout'));
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  const started = JSON.parse(mockNavigate.mock.calls[0][1].params.exercises) as Array<{ sets: number }>;
  return { screen, startedSets: started.map((e) => e.sets) };
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockGetById.mockReset();
  mockGetById.mockImplementation((id: string) => Promise.resolve({ data: { id, name: id === 'row' ? 'Barbell Row' : 'Bench Press' } }));
});

describe('approved Roman set changes on the client workout (B-ROMANADJ-125)', () => {
  it('shows and starts the approved set count, with the coach note on that exercise only', async () => {
    mockAssignment = { data: assignment({ roman_adjusted_sets: [{ order: 1, sets: 2 }] }), isLoading: false, isError: false };
    const { screen, startedSets } = await openAndStart();
    expect(screen.getByText(/^2 sets × 8 reps/)).toBeTruthy();
    expect(screen.queryByText(/^4 sets/)).toBeNull();
    expect(screen.getByTestId('assignment-adjusted-1')).toBeTruthy();
    expect(screen.queryByTestId('assignment-adjusted-2')).toBeNull();
    expect(screen.getAllByText('Updated by your coach')).toHaveLength(1);
    expect(startedSets).toEqual([2, 3]);
  });

  it('older server (field missing): the live plan exactly as before', async () => {
    mockAssignment = { data: assignment({}), isLoading: false, isError: false };
    const { screen, startedSets } = await openAndStart();
    expect(screen.getByText(/^4 sets × 8 reps/)).toBeTruthy();
    expect(screen.queryByText('Updated by your coach')).toBeNull();
    expect(startedSets).toEqual([4, 3]);
  });

  it('empty list: nothing changes', async () => {
    mockAssignment = { data: assignment({ roman_adjusted_sets: [] }), isLoading: false, isError: false };
    const { screen, startedSets } = await openAndStart();
    expect(screen.queryByText('Updated by your coach')).toBeNull();
    expect(startedSets).toEqual([4, 3]);
  });

  it('an order the plan no longer has is ignored', async () => {
    mockAssignment = { data: assignment({ roman_adjusted_sets: [{ order: 9, sets: 1 }] }), isLoading: false, isError: false };
    const { screen, startedSets } = await openAndStart();
    expect(screen.queryByText('Updated by your coach')).toBeNull();
    expect(startedSets).toEqual([4, 3]);
  });
});

describe('overlayRomanAdjustedSets', () => {
  const rows = [
    { order: 1, sets: 4 },
    { order: 2, sets: 3 },
  ];

  it('overlays by order and reports which orders changed', () => {
    const out = overlayRomanAdjustedSets(rows, [{ order: 2, sets: 1 }]);
    expect(out.exercises).toEqual([{ order: 1, sets: 4 }, { order: 2, sets: 1 }]);
    expect([...out.adjustedOrders]).toEqual([2]);
    // The input is not mutated.
    expect(rows[1].sets).toBe(3);
  });

  it('ignores malformed input and keeps the rows as they are', () => {
    for (const raw of [undefined, null, 'x', {}, [null, { order: 'one', sets: 2 }, { order: 1, sets: 0 }, { order: 1.5, sets: 2 }]]) {
      const out = overlayRomanAdjustedSets(rows, raw);
      expect(out.exercises).toEqual(rows);
      expect(out.adjustedOrders.size).toBe(0);
    }
  });
});
