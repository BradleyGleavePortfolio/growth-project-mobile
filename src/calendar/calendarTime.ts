/**
 * calendarTime — S-SCHED display helpers for the client Calendar.
 *
 * Times are always shown in the client's own (device) time zone. When the
 * coach works in a different zone, a short "coach time" label is added so
 * nobody books the wrong hour. All formatting goes through Intl with an
 * explicit timeZone, so DST is handled by the platform tables, not by
 * offset arithmetic here.
 */
import { resolveClientTimezone } from '../api/schedulingApi';

export interface Slot {
  start_at: string;
  end_at: string;
}

export interface SlotDay {
  /** YYYY-MM-DD in the client zone. */
  key: string;
  /** e.g. "Monday, October 5". */
  label: string;
  slots: Slot[];
}

function dayKey(d: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function formatDayLabel(d: Date, tz: string = resolveClientTimezone()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(d);
}

export function formatTime(d: Date, tz: string = resolveClientTimezone()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

/** Short zone name at that instant, e.g. "PDT" or "GMT+1". */
export function zoneAbbrev(d: Date, tz: string): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(d)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? tz;
}

/** True when the two zones show a different wall clock at instant `d`. */
export function zonesDiffer(d: Date, a: string, b: string): boolean {
  if (a === b) return false;
  return formatTime(d, a) !== formatTime(d, b) || dayKey(d, a) !== dayKey(d, b);
}

/** "Monday, October 5 at 9:00 AM" in the client zone. */
export function formatWhen(iso: string, tz: string = resolveClientTimezone()): string {
  const d = new Date(iso);
  return `${formatDayLabel(d, tz)} at ${formatTime(d, tz)}`;
}

/** "9:00 AM to 9:30 AM". */
export function formatRange(startIso: string, endIso: string, tz: string = resolveClientTimezone()): string {
  return `${formatTime(new Date(startIso), tz)} to ${formatTime(new Date(endIso), tz)}`;
}

/**
 * "10:00 AM PDT coach time" when the coach zone shows a different clock,
 * otherwise null.
 */
export function coachTimeLabel(
  iso: string,
  coachTz: string | null | undefined,
  clientTz: string = resolveClientTimezone(),
): string | null {
  if (!coachTz) return null;
  const d = new Date(iso);
  if (!zonesDiffer(d, coachTz, clientTz)) return null;
  return `${formatTime(d, coachTz)} ${zoneAbbrev(d, coachTz)} coach time`;
}

/** Group slots by client-local day, preserving order. */
export function groupSlotsByDay(slots: Slot[], tz: string = resolveClientTimezone()): SlotDay[] {
  const out: SlotDay[] = [];
  const byKey = new Map<string, SlotDay>();
  const sorted = [...slots].sort((a, b) => a.start_at.localeCompare(b.start_at));
  for (const s of sorted) {
    const d = new Date(s.start_at);
    const key = dayKey(d, tz);
    let day = byKey.get(key);
    if (!day) {
      day = { key, label: formatDayLabel(d, tz), slots: [] };
      byKey.set(key, day);
      out.push(day);
    }
    day.slots.push(s);
  }
  return out;
}

/** Current time rounded down to the minute (stable query key). */
export function nowToMinuteIso(now: number = Date.now()): string {
  return new Date(Math.floor(now / 60000) * 60000).toISOString();
}
