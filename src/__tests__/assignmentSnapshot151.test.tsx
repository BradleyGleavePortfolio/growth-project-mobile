/**
 * K3FIX-SNAPSHOT (agent 151): once the server froze an assignment (MWB-1),
 * the list, the detail, the catalog-name lookup and Start use that frozen
 * prescription, not the coach's later edits to the live plan. Fixtures follow
 * the server's assignment read: top-level `exercises`, `snapshot_source` and
 * `snapshot`, with frozen rows that have no `id` / `workout_plan_id`.
 */
import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { assignmentPlanName, assignmentPrescription } from '../utils/workout/assignmentPrescription';
import { buildActiveWorkoutExercises } from '../utils/workout/buildActiveWorkout';
import type { ClientWorkoutAssignmentWithPlan } from '../api/workoutBuilderApi';

const NAMES: Record<string, string> = {
  bench: 'barbell bench press', squat: 'back squat', row: 'seated row', lunge: 'walking lunge',
};
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
}));
let mockUser = { id: 'client-a', role: 'client' };
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
const mockLoadSession = jest.fn();
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: (...a: unknown[]) => mockLoadSession(...a),
}));
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(), success: jest.fn() },
}));
let mockDetail: unknown;
let mockList: unknown[] = [];
jest.mock('../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignment: () => ({ data: mockDetail, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false }),
  useMyWorkoutAssignments: () => ({ data: mockList, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false }),
}));

import WorkoutAssignmentDetailScreen from '../screens/client/WorkoutAssignmentDetailScreen';
import ClientWorkoutViewerScreen from '../screens/client/ClientWorkoutViewerScreen';

// The coach's plan today: renamed, retyped, bench moved and re-set, squat
// replaced by lunges, a row added first.
const liveRow = (id: string, order: number, sets: number, reps: number) => ({
  id: `pe-${id}`, workout_plan_id: 'plan-1', exercise_external_id: id, order, sets,
  reps_or_duration_seconds: reps, weight_lbs: 70, rest_seconds: 45, superset_group_id: null, notes: 'Live note',
});
const LIVE = {
  id: 'plan-1', coach_id: 'coach-1', name: 'Upper A v2', type: 'cardio' as const, duration_estimate_minutes: 60,
  created_at: '', updated_at: '', archived_at: null,
  exercises: [liveRow('row', 1, 5, 12), liveRow('bench', 2, 6, 4), liveRow('lunge', 3, 3, 10)],
};
// What the client was assigned, as saved in the snapshot (no row ids).
const FROZEN = [
  { exercise_external_id: 'squat', order: 2, sets: 4, reps_or_duration_seconds: 5, weight_lbs: 135, rest_seconds: 120, superset_group_id: null, notes: null },
  { exercise_external_id: 'bench', order: 1, sets: 3, reps_or_duration_seconds: 8, weight_lbs: 95, rest_seconds: 90, superset_group_id: null, notes: 'Pause at the chest' },
];
type Row = Record<string, unknown>;
function frozen(extra: Row = {}): ClientWorkoutAssignmentWithPlan {
  return {
    id: 'asg-1', workout_plan_id: 'plan-1', client_id: 'client-a', assigned_by_coach_id: 'coach-1',
    scheduled_for: '2026-10-12T00:00:00.000Z', completed_at: null, post_rpe: null, post_notes: null,
    workout_plan: LIVE,
    snapshot: { id: 'snap-1', assignment_id: 'asg-1', plan_name: 'Upper A', plan_type: 'strength', exercises_json: FROZEN,
      source_plan_id: 'plan-1', source_version: '2026-10-12T00:00:00.000Z', created_at: '2026-10-12T00:00:00.000Z' },
    exercises: FROZEN, snapshot_source: true, roman_adjusted_sets: [],
    ...extra,
  } as unknown as ClientWorkoutAssignmentWithPlan;
}
/** A server before MWB-1: no `exercises`, `snapshot_source`, `snapshot` or Roman field. */
function legacy(extra: Row = {}): ClientWorkoutAssignmentWithPlan {
  const { exercises: _e, snapshot_source: _s, snapshot: _n, roman_adjusted_sets: _r, ...rest } = frozen();
  return { ...rest, ...extra } as unknown as ClientWorkoutAssignmentWithPlan;
}

let qc: QueryClient;
const wrap = (node: React.ReactElement) => <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
async function startPayload(view: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(await view.findByText('Start workout'));
  expect(mockTabNavigate).toHaveBeenCalledTimes(1);
  const { params } = mockTabNavigate.mock.calls[0][1];
  return { params, started: JSON.parse(params.exercises) as Array<Record<string, unknown>> };
}

beforeEach(() => {
  jest.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockUser = { id: 'client-a', role: 'client' };
  mockLoadSession.mockResolvedValue(null);
  mockGetById.mockImplementation((id: string) => Promise.resolve({ data: { id, name: NAMES[id] } }));
  mockList = [];
});

describe('frozen prescription after the coach edits the plan', () => {
  it('pending detail: rows, header, name lookup and Start are the frozen ones', async () => {
    const consoleError = jest.spyOn(console, 'error');
    mockDetail = frozen();
    const view = await render(wrap(<WorkoutAssignmentDetailScreen />));
    expect(await view.findByText('Back Squat')).toBeTruthy();
    expect(view.getByText('Upper A')).toBeTruthy();
    expect(view.getByText('Strength')).toBeTruthy();
    expect(view.getByText(/^About 60 min · 2 exercises$/)).toBeTruthy();
    expect(within(view.getByTestId('assignment-row-1')).getByText('Barbell Bench Press')).toBeTruthy();
    expect(within(view.getByTestId('assignment-row-2')).getByText(/^4 sets × 5 reps · 135 lb · 120s rest$/)).toBeTruthy();
    expect(view.getByText(/^3 sets × 8 reps · 95 lb · 90s rest$/)).toBeTruthy();
    for (const live of ['Upper A v2', 'Cardio', 'Seated Row', 'Walking Lunge', 'Live note']) expect(view.queryByText(live)).toBeNull();
    expect(view.queryByText('Updated by your coach')).toBeNull();
    expect(mockGetById.mock.calls.map((c) => c[0]).sort()).toEqual(['bench', 'squat']);
    // Rows without database ids still render with stable keys (their order).
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/unique "key"/);
    consoleError.mockRestore();

    const { params, started } = await startPayload(view);
    expect(params).toMatchObject({ assignmentId: 'asg-1', routineId: 'plan-1', routineName: 'Upper A' });
    expect(started.map((e) => [e.exerciseId, e.exerciseName, e.sets, e.reps, e.weightLbs])).toEqual([
      ['bench', 'Barbell Bench Press', 3, 8, 95], ['squat', 'Back Squat', 4, 5, 135],
    ]);
    expect(started[0].coachNote).toBe('Pause at the chest');
    // Frozen rows have no plan-row id: none is sent, none is made up.
    expect(started.some((e) => 'workoutPlanExerciseId' in e)).toBe(false);
  });

  it('completed: detail and list stay frozen', async () => {
    mockDetail = frozen({ completed_at: '2026-10-13T10:00:00.000Z', post_rpe: 7 });
    mockList = [mockDetail];
    const detail = await render(wrap(<WorkoutAssignmentDetailScreen />));
    expect(await detail.findByText('Completed · RPE 7')).toBeTruthy();
    expect(await detail.findByText('Barbell Bench Press')).toBeTruthy();
    expect(detail.queryByTestId('assignment-start')).toBeNull();
    expect(detail.queryByText('Seated Row')).toBeNull();
    await detail.unmount();
    const list = await render(wrap(<ClientWorkoutViewerScreen />));
    expect(await list.findByText('Back Squat')).toBeTruthy();
    expect(list.getByRole('button', { name: 'Open workout Upper A' })).toBeTruthy();
    expect(list.getByText(/^Strength • about 60 min • 2 exercises$/)).toBeTruthy();
    expect(list.getByText('3 sets × 8 reps / sec · 95 lb prescribed')).toBeTruthy();
    expect(list.getByText('4 sets × 5 reps / sec · 135 lb prescribed')).toBeTruthy();
    expect(list.queryByText(/Upper A v2|Seated Row|Walking Lunge/)).toBeNull();
  });
});

// List and detail read one selector, so they agree on every reply shape.
const SHAPES: Array<[string, ClientWorkoutAssignmentWithPlan, string, number[]]> = [
  ['frozen', frozen(), 'Upper A', [3, 4]],
  ['frozen empty list (live rows ignored)', frozen({ exercises: [] }), 'Upper A', []],
  ['current server, no snapshot', legacy({ exercises: LIVE.exercises, snapshot_source: false, snapshot: null }), 'Upper A v2', [5, 6, 3]],
  ['older server, no canonical field', legacy(), 'Upper A v2', [5, 6, 3]],
];
describe.each(SHAPES)('%s', (_label, data, name, sets) => {
  it('list, detail and Start agree', async () => {
    mockDetail = data;
    mockList = [data];
    const count = `${sets.length} exercise${sets.length === 1 ? '' : 's'}`;
    const detail = await render(wrap(<WorkoutAssignmentDetailScreen />));
    expect(detail.getByText(name)).toBeTruthy();
    expect(detail.getByText(new RegExp(`^About 60 min · ${count}$`))).toBeTruthy();
    const { started } = await startPayload(detail);
    expect(started.map((e) => e.sets)).toEqual(sets);
    // Live rows keep their real plan-row id; frozen rows have none.
    const live = name === 'Upper A v2';
    expect(started.map((e) => e.workoutPlanExerciseId)).toEqual(live ? ['pe-row', 'pe-bench', 'pe-lunge'] : sets.map(() => undefined));
    await detail.unmount();
    const list = await render(wrap(<ClientWorkoutViewerScreen />));
    expect(list.getByRole('button', { name: `Open workout ${name}` })).toBeTruthy();
    expect(list.getByText(new RegExp(`about 60 min • ${count}$`))).toBeTruthy();
    const rows = list.queryAllByText(/ sets × /);
    expect(rows).toHaveLength(sets.length);
    rows.forEach((row, i) => expect(row).toHaveTextContent(new RegExp(`^${sets[i]} sets × `)));
  });
});

describe('coach-approved Roman sets on every path', () => {
  it('frozen: the server already wrote the sets into the snapshot; the note marks that row only', async () => {
    const adjusted = FROZEN.map((r) => (r.order === 2 ? { ...r, sets: 2 } : r));
    mockDetail = frozen({ exercises: adjusted, roman_adjusted_sets: [{ order: 2, sets: 2 }] });
    const view = await render(wrap(<WorkoutAssignmentDetailScreen />));
    expect(await view.findByTestId('assignment-adjusted-2')).toBeTruthy();
    expect(view.queryByTestId('assignment-adjusted-1')).toBeNull();
    expect(view.getByText(/^2 sets × 5 reps/)).toBeTruthy();
    expect((await startPayload(view)).started.map((e) => e.sets)).toEqual([3, 2]);
  });

  it('older server with the Roman field: laid over the live rows by order', async () => {
    mockDetail = legacy({ roman_adjusted_sets: [{ order: 2, sets: 2 }] });
    const view = await render(wrap(<WorkoutAssignmentDetailScreen />));
    expect(await view.findByTestId('assignment-adjusted-2')).toBeTruthy();
    expect(view.getAllByText('Updated by your coach')).toHaveLength(1);
    expect((await startPayload(view)).started.map((e) => e.sets)).toEqual([5, 2, 3]);
  });

  it('no Roman field: no note, sets unchanged', () => {
    for (const a of [frozen({ roman_adjusted_sets: undefined }), legacy()]) {
      expect(assignmentPrescription(a).adjustedOrders.size).toBe(0);
    }
  });
});

describe('metadata and payload rules', () => {
  it('frozen name and type when saved, the live plan otherwise; duration stays the live estimate', () => {
    const p = assignmentPrescription(frozen());
    expect([p.name, p.type, p.durationMinutes]).toEqual(['Upper A', 'strength', 60]);
    expect(assignmentPrescription(legacy())).toMatchObject({ name: 'Upper A v2', type: 'cardio' });
    expect(assignmentPlanName({ snapshot: null, workout_plan: { name: 'Live' } })).toBe('Live');
  });

  it('the snapshot saves no duration: the live estimate as before, and none is made up', async () => {
    mockDetail = frozen({ workout_plan: { ...LIVE, duration_estimate_minutes: null } });
    const view = await render(wrap(<WorkoutAssignmentDetailScreen />));
    expect(view.getByText(/^2 exercises$/)).toBeTruthy();
    expect(view.queryByText(/About/)).toBeNull();
  });

  it('a snapshot-sourced reply never falls back to the live rows', () => {
    const { exercises: _e, ...noRows } = frozen();
    expect(assignmentPrescription(noRows as ClientWorkoutAssignmentWithPlan).exercises).toEqual([]);
  });

  it('frozen rows build a session with catalog ids and no plan-row ids', () => {
    const seeds = buildActiveWorkoutExercises({ exercises: [...FROZEN, { ...FROZEN[0], exercise_external_id: '', order: 3 }] });
    expect(seeds.map((s) => s.exerciseId)).toEqual(['bench', 'squat', 'assignment-exercise:3']);
    expect(seeds.every((s) => !('workoutPlanExerciseId' in s))).toBe(true);
  });
});

describe('account fence', () => {
  it("account A's late saved session never becomes B's Resume, and B sees B's workout", async () => {
    let releaseA: (v: unknown) => void = () => undefined;
    mockLoadSession.mockImplementation((uid: string) =>
      uid === 'client-a' ? new Promise((r) => { releaseA = r; }) : Promise.resolve(null));
    mockDetail = frozen();
    const view = await render(wrap(<WorkoutAssignmentDetailScreen />));
    expect(await view.findByText('Upper A')).toBeTruthy();
    mockUser = { id: 'client-b', role: 'client' };
    mockDetail = frozen({ client_id: 'client-b', snapshot: { plan_name: 'Lower B', plan_type: 'strength' } });
    await view.rerender(wrap(<WorkoutAssignmentDetailScreen />));
    await act(async () => { releaseA({ session: { assignmentId: 'asg-1' } }); });
    expect(view.getByText('Lower B')).toBeTruthy();
    expect(view.queryByText('Upper A')).toBeNull();
    expect(await view.findByText('Start workout')).toBeTruthy();
    expect(view.queryByText('Resume workout')).toBeNull();
    expect(mockLoadSession).toHaveBeenLastCalledWith('client-b');
    expect((await startPayload(view)).params.routineName).toBe('Lower B');
  });
});
