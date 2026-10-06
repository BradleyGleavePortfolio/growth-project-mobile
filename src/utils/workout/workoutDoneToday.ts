import { bucketDateLocal } from '../date';

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
 * workout to go." after the client finished. `date` is a calendar date
 * (YYYY-MM-DD at UTC midnight): compare its day part; a row created today
 * on this device also counts. A row explicitly marked incomplete never does.
 */
export function isWorkoutDoneToday(rows: WorkoutRowLike[] | undefined, todayStr: string): boolean {
  return (rows || []).some((r) => {
    if (!r || r.completed === false) return false;
    const day = typeof r.date === 'string' ? r.date.slice(0, 10) : '';
    if (day === todayStr) return true;
    const created = r.created_at ? new Date(r.created_at) : null;
    return !!created && !Number.isNaN(created.getTime()) && bucketDateLocal(created) === todayStr;
  });
}
