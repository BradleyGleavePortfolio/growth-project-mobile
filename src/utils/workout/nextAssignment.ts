import { assignmentDay } from './workoutDay';

/** The fields the choice reads; GET /assignments/me sends all three. */
export interface OpenAssignmentLike {
  scheduled_for?: string | null;
  completed_at?: string | null;
  skipped_at?: string | null;
}

/**
 * The coach workout to open next, one rule for Train's Today and the plan
 * card's Next (LS-917R3 B5): today's open workout; else the next open one;
 * else the latest still open (a missed day). Done and skipped days are not
 * open. Days are the assigned day (assignmentDay), compared with `today`
 * (YYYY-MM-DD, the client's local today).
 */
export function nextAssignment<T extends OpenAssignmentLike>(rows: ReadonlyArray<T> | null | undefined, today: string): T | null {
  const open = (Array.isArray(rows) ? rows : [])
    .filter((a) => !a.completed_at && !a.skipped_at)
    .sort((a, b) => assignmentDay(a).localeCompare(assignmentDay(b)));
  return open.find((a) => assignmentDay(a) >= today) ?? open[open.length - 1] ?? null;
}
