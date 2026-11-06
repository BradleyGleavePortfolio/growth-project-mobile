/**
 * FOOD-DAY-STYLEC-M (C2 Style C slice C1, planning/MOCKUP3/C2/index.md sections 5 and 9): the Food tab's day as a
 * 24-hour timeline. Pure: every item comes from the plan (DailyMealPlanSlot.time_of_day, "HH:MM", sent since C2-C0),
 * the day's log (createdAt) and the workout from Train. Nothing here saves or totals anything.
 *
 * Order: a done meal sits at its log time, a meal still to eat at the coach's time, an extra at its log time, the
 * workout at its scheduled time. A meal with no time keeps plan order and shows no time; one still to eat goes
 * after the now line. A workout with no time follows the pre-workout meal (or closes the day).
 */
import type { FoodLog } from '../../types';
import type { DaySlot, FoodDay } from './foodDay';

export type TimelineItem =
  | { kind: 'slot'; slot: DaySlot; min: number | null }
  | { kind: 'extra'; log: FoodLog; min: number | null }
  | { kind: 'workout'; name: string; min: number | null }
  | { kind: 'now'; min: number };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The server's "HH:MM" (24-hour) as minutes after midnight; anything else is no time. */
export function minutesOf(hhmm: string | null | undefined): number | null {
  const m = typeof hhmm === 'string' ? HHMM.exec(hhmm) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Minutes after midnight as the drawn clock: "7:40 am", "12:35 pm". */
export function clockOf(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const mm = String(min % 60).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? 'am' : 'pm'}`;
}

/** A log row's local clock time, or null when the row has no readable createdAt. */
export function logMinutes(log: FoodLog): number | null {
  if (!log.createdAt) return null;
  const d = new Date(log.createdAt);
  return Number.isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes();
}

const firstLogMin = (slot: DaySlot): number | null => {
  const mins = slot.logs.map(logMinutes).filter((m): m is number => m != null);
  return mins.length ? Math.min(...mins) : null;
};

export function buildTimeline({ day, nowMin, workout }: {
  day: FoodDay;
  /** Minutes after midnight when the day is today; null on any other day (no now line). */
  nowMin: number | null;
  workout?: { name: string; time: string | null | undefined } | null;
}): TimelineItem[] {
  // Each item gets a sort key; ties keep the order pushed here (plan order, then extras, then the workout).
  const rows: { item: TimelineItem; key: number }[] = [];
  let prev = -1;
  let preworkoutKey: number | null = null;
  for (const slot of day.slots) {
    const done = slot.logs.length > 0;
    const shown = done ? firstLogMin(slot) ?? minutesOf(slot.time) : minutesOf(slot.time);
    // A meal with no time inherits its place in plan order; one still to eat waits after the now line.
    const key = shown ?? (done ? prev : Math.max(prev, nowMin ?? -1) + 0.5);
    rows.push({ item: { kind: 'slot', slot, min: shown }, key });
    prev = key;
    if (slot.label === 'Pre-workout') preworkoutKey = key;
  }
  for (const log of day.extras) {
    const min = logMinutes(log);
    rows.push({ item: { kind: 'extra', log, min }, key: min ?? Number.MAX_SAFE_INTEGER });
  }
  if (workout) {
    const min = minutesOf(workout.time);
    const key = min ?? (preworkoutKey != null ? preworkoutKey + 0.25 : Number.MAX_SAFE_INTEGER);
    rows.push({ item: { kind: 'workout', name: workout.name, min }, key });
  }
  // The now line goes after everything at or before this minute.
  if (nowMin != null) rows.push({ item: { kind: 'now', min: nowMin }, key: nowMin + 0.1 });
  return rows
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((r) => r.item);
}

export interface DayLeft {
  over: boolean;
  /** Left to eat when not over; how far above the target when over. */
  kcal: number;
  /** Protein still to go (never below 0). */
  protein: number;
  target: number;
  targetProtein: number;
  eatenProtein: number;
}

/** The masthead's line: what is left of the target, or how far above it. No target, no line. */
export function dayLeft(
  targets: { calories: number; protein: number } | null | undefined,
  eaten: { calories: number; protein: number },
): DayLeft | null {
  if (!targets || !(targets.calories > 0)) return null;
  const target = Math.round(targets.calories);
  const targetProtein = Math.round(targets.protein || 0);
  const kcal = Math.round(eaten.calories);
  const eatenProtein = Math.round(eaten.protein);
  const over = kcal > target;
  return { over, kcal: over ? kcal - target : target - kcal, protein: Math.max(0, targetProtein - eatenProtein), target, targetProtein, eatenProtein };
}
