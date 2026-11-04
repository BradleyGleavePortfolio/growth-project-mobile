import { workoutDay } from './workoutDay';

export interface WorkoutRowLike {
  date?: string;
  created_at?: string;
  completed?: boolean;
}

/**
 * True when one of the client's recent workouts was logged today.
 *
 * WorkoutSession has no `completed` column, so the Home line's old
 * `completed === true` test never matched and Home kept saying "One
 * workout to go." after the client finished. A workout counts on its
 * recorded day (workoutDay): an older workout synced today is not today's;
 * only a row without a recorded date falls back to the day it was stored.
 * A row explicitly marked incomplete never counts.
 */
export function isWorkoutDoneToday(rows: WorkoutRowLike[] | undefined, todayStr: string): boolean {
  return (rows || []).some((r) => !!r && r.completed !== false && workoutDay(r) === todayStr);
}
