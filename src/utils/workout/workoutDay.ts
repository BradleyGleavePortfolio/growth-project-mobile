/**
 * WK-1-M R4: the one phone rule for the day a workout or an assignment counts on.
 *
 * - A workout counts on the client's local day it began; finishing after
 *   midnight keeps the start day. The phone saves that day as the workout's
 *   `date` (workoutStartDay) and every reader takes the day from `date`
 *   (workoutDay), never from when the server received it.
 * - An assignment counts on the day it was assigned for (`scheduled_for`).
 * - Both are server calendar dates (@db.Date: "YYYY-MM-DD", or that day at
 *   UTC midnight). A calendar date is a day, not an instant, so it is never
 *   moved into local time: west of UTC "Monday 00:00Z" stays Monday.
 * - A real instant (created_at, completed_at) is the local day it falls on,
 *   through the shared day helper bucketDateLocal.
 *
 * The list of every save and day read on this rule is in
 * src/__tests__/workoutDayRule.test.ts.
 */
import { bucketDateLocal } from '../date';

const DAY_PART = /^(\d{4})-(\d{2})-(\d{2})/;

/** The local day an instant falls on ('' when unreadable). */
export function instantDay(at: string | number | Date | null | undefined): string {
  if (at === null || at === undefined || at === '') return '';
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? '' : bucketDateLocal(d);
}

/** The day a server calendar date names, as written ('' when unreadable). */
export function calendarDay(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  const m = DAY_PART.exec(value);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : instantDay(value);
}

/** The `date` a workout is saved with: the client's local day it began. */
export function workoutStartDay(startedAtMs: number): string {
  return instantDay(startedAtMs);
}

/** The day a workout counts on: its recorded `date`; a row without one, the day it was stored. */
export function workoutDay(row: { date?: string | null; created_at?: string | null } | null | undefined): string {
  if (!row) return '';
  return calendarDay(row.date) || instantDay(row.created_at);
}

/** The day an assignment counts on: the day it was assigned for. */
export function assignmentDay(row: { scheduled_for?: string | null } | null | undefined): string {
  return calendarDay(row?.scheduled_for);
}

/** Local midnight of a day, for date labels and day arithmetic (null when unreadable). */
export function dayStart(day: string): Date | null {
  const m = DAY_PART.exec(day);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
