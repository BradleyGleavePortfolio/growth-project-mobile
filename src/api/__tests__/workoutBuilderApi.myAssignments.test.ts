/**
 * AUDIT-07-125: GET /assignments/me answers `{ items, nextCursor }` (one page
 * of at most 50, oldest first). The client list must read every page and hand
 * the screens a plain list, so coach-assigned workouts show up.
 */
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

import api from '../../services/api';
import { workoutBuilderApi } from '../workoutBuilderApi';
import { assignmentPrescription } from '../../utils/workout/assignmentPrescription';

const mockApi = jest.mocked(api);

function row(id: string) {
  return {
    id,
    workout_plan_id: `plan-${id}`,
    client_id: 'client-1',
    assigned_by_coach_id: 'coach-1',
    scheduled_for: '2026-10-08T00:00:00.000Z',
    completed_at: null,
    post_rpe: null,
    post_notes: null,
    workout_plan: { id: `plan-${id}`, name: `Day ${id}`, exercises: [] },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('returns the items of the paginated reply as a list', async () => {
  mockApi.get.mockResolvedValueOnce({ data: { items: [row('a'), row('b')], nextCursor: null } });
  const list = await workoutBuilderApi.listMyAssignments();
  expect(Array.isArray(list)).toBe(true);
  expect(list.map((a) => a.id)).toEqual(['a', 'b']);
  expect(mockApi.get).toHaveBeenCalledTimes(1);
  expect(mockApi.get).toHaveBeenCalledWith('/assignments/me', { params: undefined });
});

it('reads every page so workouts after the first 50 are not lost', async () => {
  mockApi.get
    .mockResolvedValueOnce({ data: { items: [row('a')], nextCursor: 'c1' } })
    .mockResolvedValueOnce({ data: { items: [row('b')], nextCursor: 'c2' } })
    .mockResolvedValueOnce({ data: { items: [row('c')], nextCursor: null } });
  const list = await workoutBuilderApi.listMyAssignments();
  expect(list.map((a) => a.id)).toEqual(['a', 'b', 'c']);
  expect(mockApi.get).toHaveBeenNthCalledWith(2, '/assignments/me', { params: { cursor: 'c1' } });
  expect(mockApi.get).toHaveBeenNthCalledWith(3, '/assignments/me', { params: { cursor: 'c2' } });
});

it('still accepts a bare list', async () => {
  mockApi.get.mockResolvedValueOnce({ data: [row('a')] });
  const list = await workoutBuilderApi.listMyAssignments();
  expect(list.map((a) => a.id)).toEqual(['a']);
});

it('fails the load on an unreadable page instead of showing an empty list', async () => {
  mockApi.get.mockResolvedValueOnce({ data: { unexpected: true } });
  await expect(workoutBuilderApi.listMyAssignments()).rejects.toThrow(
    'Your workouts could not be read. Pull to try again.',
  );
});

// K3FIX-SNAPSHOT: frozen prescriptions on later pages reach the screens as sent.
it('keeps the frozen rows and name of every page, an empty frozen list included', async () => {
  const live = { id: 'pe-1', workout_plan_id: 'plan-x', exercise_external_id: 'live', order: 1, sets: 9,
    reps_or_duration_seconds: 9, weight_lbs: null, rest_seconds: null, superset_group_id: null, notes: null };
  const frozen = (id: string, rows: unknown[]) => ({
    ...row(id), workout_plan: { ...row(id).workout_plan, exercises: [live] },
    exercises: rows, snapshot_source: true, snapshot: { plan_name: `Frozen ${id}`, plan_type: 'strength' },
  });
  const { id: _id, workout_plan_id: _p, ...frozenRow } = { ...live, exercise_external_id: 'bench', sets: 3 };
  mockApi.get
    .mockResolvedValueOnce({ data: { items: [frozen('a', [frozenRow])], nextCursor: 'c1' } })
    .mockResolvedValueOnce({ data: { items: [frozen('b', [])], nextCursor: null } });
  const list = await workoutBuilderApi.listMyAssignments();
  expect(list.map(assignmentPrescription)).toMatchObject([
    { name: 'Frozen a', exercises: [{ exercise_external_id: 'bench', sets: 3 }] },
    { name: 'Frozen b', exercises: [] },
  ]);
  expect(mockApi.get).toHaveBeenCalledTimes(2);
});
