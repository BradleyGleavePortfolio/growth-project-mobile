/**
 * @jest-environment ./src/__tests__/helpers/lsWorkoutPacific187.cjs
 *
 * FR-917R2 (LO-917R2 C8): with two pending workouts, the plan card's next
 * day is the earliest assigned day (assignmentDay), the order TrainToday opens.
 * A package workout bought Monday 18:30 Pacific is stored as Tuesday 01:30
 * UTC; a coach's Tuesday pick is stored as Tuesday 00:00 UTC. Sorted by the
 * stored text, the Tuesday pick came first.
 */
import { weekdayOf } from '../components/tutorial/PlanExplanationCard';
import { nextAssignment } from '../utils/workout/nextAssignment';
import type { ClientWorkoutAssignmentWithPlan } from '../api/workoutBuilderApi';

const row = (id: string, scheduled_for: string, completed_at: string | null = null) =>
  ({ id, scheduled_for, completed_at }) as unknown as ClientWorkoutAssignmentWithPlan;

it('two pending workouts: the Monday package workout is next, not the Tuesday pick', () => {
  const tuesdayPick = row('tue', '2026-10-27T00:00:00.000Z');
  const mondayPackage = row('mon', '2026-10-27T01:30:00.000Z');
  for (const rows of [[tuesdayPick, mondayPackage], [mondayPackage, tuesdayPick]]) {
    // FR-917R3: the plan card now uses the shared rule; both days are ahead of today.
    const first = nextAssignment(rows, '2026-10-25');
    expect(first?.id).toBe('mon');
    expect(weekdayOf(first?.scheduled_for)).toBe('Monday');
  }
});

it('a done workout is skipped even when its day is earlier', () => {
  const done = row('done', '2026-10-26T00:00:00.000Z', '2026-10-26T15:00:00.000Z');
  const tuesdayPick = row('tue', '2026-10-27T00:00:00.000Z');
  expect(nextAssignment([done, tuesdayPick], '2026-10-25')?.id).toBe('tue');
  expect(nextAssignment(undefined, '2026-10-25')).toBeNull();
});

// FR-917R3 (LS-917R3 B5): one rule for Train's Today and the plan card's Next.
const open = (id: string, scheduled_for: string, skipped = false) =>
  ({ id, scheduled_for, completed_at: null, skipped_at: skipped ? `${scheduled_for}T12:00:00Z` : null }) as unknown as ClientWorkoutAssignmentWithPlan;

it.each([
  ['a skipped day is never next', [open('skip', '2026-10-30', true), open('fri', '2026-11-02')], 'fri'],
  ['a future day comes before an overdue one', [open('missed', '2026-10-26'), open('fri', '2026-11-02')], 'fri'],
  ["today's workout comes first", [open('today', '2026-10-30'), open('fri', '2026-11-02')], 'today'],
  ['with only overdue days, the latest one', [open('older', '2026-10-26'), open('latest', '2026-10-28')], 'latest'],
  ['with only skipped days, nothing', [open('skip', '2026-10-30', true)], undefined],
] as const)('%s', (_name, rows, id) => {
  expect(nextAssignment(rows, '2026-10-30')?.id).toBe(id);
});
