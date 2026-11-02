/**
 * @jest-environment ./src/__tests__/helpers/lsWorkoutPacific187.cjs
 *
 * FR-917R2 (LO-917R2 C8): with two pending workouts, the plan card's next
 * day is the earliest assigned day (assignmentDay), the order TrainToday opens.
 * A package workout bought Monday 18:30 Pacific is stored as Tuesday 01:30
 * UTC; a coach's Tuesday pick is stored as Tuesday 00:00 UTC. Sorted by the
 * stored text, the Tuesday pick came first.
 */
import { firstPendingAssignment, weekdayOf } from '../components/tutorial/PlanExplanationCard';
import type { ClientWorkoutAssignmentWithPlan } from '../api/workoutBuilderApi';

const row = (id: string, scheduled_for: string, completed_at: string | null = null) =>
  ({ id, scheduled_for, completed_at }) as unknown as ClientWorkoutAssignmentWithPlan;

it('two pending workouts: the Monday package workout is next, not the Tuesday pick', () => {
  const tuesdayPick = row('tue', '2026-10-27T00:00:00.000Z');
  const mondayPackage = row('mon', '2026-10-27T01:30:00.000Z');
  for (const rows of [[tuesdayPick, mondayPackage], [mondayPackage, tuesdayPick]]) {
    const first = firstPendingAssignment(rows);
    expect(first?.id).toBe('mon');
    expect(weekdayOf(first?.scheduled_for)).toBe('Monday');
  }
});

it('a done workout is skipped even when its day is earlier', () => {
  const done = row('done', '2026-10-26T00:00:00.000Z', '2026-10-26T15:00:00.000Z');
  const tuesdayPick = row('tue', '2026-10-27T00:00:00.000Z');
  expect(firstPendingAssignment([done, tuesdayPick])?.id).toBe('tue');
  expect(firstPendingAssignment(undefined)).toBeUndefined();
});
