/**
 * TIMED-SETS-M (agent 196): what a plan row's count means. The server sends
 * `unit` ("reps" or "seconds") on every plan row read (TIMED-SETS-BE, b#1211);
 * a row without one, or with anything else, reads reps, as before.
 */
export const EXERCISE_UNITS = ['reps', 'seconds'] as const;
export type ExerciseUnit = (typeof EXERCISE_UNITS)[number];

/** The row's unit; anything but "seconds" reads reps. */
export function unitOf(row: { unit?: unknown } | null | undefined): ExerciseUnit {
  return row?.unit === 'seconds' ? 'seconds' : 'reps';
}

/** True for a timed row (counted in seconds). */
export const isTimedRow = (row: { unit?: unknown } | null | undefined): boolean => unitOf(row) === 'seconds';

/**
 * `{ unit }` when the server (or the coach) named one, else `{}`, so a row read
 * without a unit is sent back without one and the server keeps what it has.
 */
export function unitField(unit: unknown): { unit?: ExerciseUnit } {
  return unit === 'reps' || unit === 'seconds' ? { unit } : {};
}

/** The short word after a count: "reps" or "sec" (W1). */
export const countWord = (row: { unit?: unknown } | null | undefined): string =>
  isTimedRow(row) ? 'sec' : 'reps';

/**
 * LS-928 B4: pounds lifted by one set, weight times reps. A set counted in
 * seconds lifts no reps, so it adds 0 (its saved numbers are unchanged). Every
 * lb-volume total (finish summary, member chart, coach session and weekly
 * totals) adds sets through this.
 */
export function setVolume(weight: unknown, count: unknown, unit: unknown): number {
  if (unit === 'seconds') return 0;
  return (Number(weight) || 0) * (Number(count) || 0);
}
