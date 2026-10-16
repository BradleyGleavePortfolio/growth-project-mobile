/**
 * K1-OVERVIEW — the client file's This week (planning/MOCKUP3/K1, Style C), from reads the server sends today.
 * summary.recent_assignments is the 20 latest by scheduled_for, so a delivered program's future rows can push
 * this week out: `workoutWeek` returns null (the ring is left out) unless the read provably holds the whole
 * week (fewer than 20 rows, or the oldest is before Monday).
 */
import type { DayState, SegmentState } from '../../../ui/charts/StyleCMarks';
import { bucketDateLocal } from '../../../utils/date';

export const SUMMARY_ASSIGNMENT_CAP = 20;
export const TIMELINE_PAGE = 100;
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface AssignmentRow { scheduled_for: string; completed_at?: string | null }
export interface MealRow { id: string; date?: string | null; logged_at?: string | null; quantity_multiplier?: number | null; food_item?: { calories?: number | null } | null }
export interface CheckInRow { date: string; reviewed_by_coach?: boolean }

/** Monday first. `missed`: the latest day (Monday = 0) with a missed session. `week`: Monday, YYYY-MM-DD. */
export interface WorkoutWeek {
  segments: SegmentState[]; days: DayState[]; dates: number[]; done: number; total: number; missed: number | null; week: string;
}

/** Monday 00:00 of the local week that holds `now`. */
export function weekStart(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function dayIndex(at: Date, start: Date): number {
  const day = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  return Math.round((day.getTime() - start.getTime()) / 86_400_000);
}

function addDays(start: Date, n: number): Date {
  const d = new Date(start);
  d.setDate(d.getDate() + n);
  return d;
}

export function workoutWeek(rows: ReadonlyArray<AssignmentRow>, now: Date): WorkoutWeek | null {
  const start = weekStart(now);
  const at = rows.map((r) => new Date(r.scheduled_for));
  if (rows.length >= SUMMARY_ASSIGNMENT_CAP && !at.some((t) => t < start)) return null;
  const today = dayIndex(now, start);
  const week = rows
    .map((r, i) => ({ day: dayIndex(at[i], start), t: at[i].getTime(), done: !!r.completed_at }))
    .filter((r) => r.day >= 0 && r.day < 7)
    .sort((a, b) => a.t - b.t);
  const state = (r: { day: number; done: boolean }): SegmentState => (r.done ? 'done' : r.day < today ? 'missed' : 'planned');
  const segments = week.map(state);
  const days = Array.from({ length: 7 }, (_, d): DayState => {
    const mine = week.filter((r) => r.day === d).map(state);
    if (mine.length > 0 && mine.every((s) => s === 'done')) return 'done';
    if (mine.includes('missed')) return 'missed';
    if (d === today) return 'today';
    return mine.length > 0 ? 'planned' : 'rest';
  });
  const missedDays = week.filter((r) => state(r) === 'missed').map((r) => r.day);
  return {
    segments, days,
    dates: days.map((_, d) => addDays(start, d).getDate()),
    done: segments.filter((s) => s === 'done').length,
    total: segments.length,
    missed: missedDays.length > 0 ? Math.max(...missedDays) : null,
    week: bucketDateLocal(start),
  };
}

/** The seven local days ending today, oldest first, as YYYY-MM-DD. */
export function lastSevenDays(now: Date): string[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Array.from({ length: 7 }, (_, i) => bucketDateLocal(addDays(today, i - 6)));
}

const mealDay = (m: MealRow) => (m.date || m.logged_at || '').slice(0, 10);

/** True when a full page of meals still reaches into the seven days: read the next page. */
export function needsNextMealPage(page: ReadonlyArray<MealRow>, now: Date): boolean {
  const last = page[page.length - 1];
  return page.length >= TIMELINE_PAGE && !!last && mealDay(last) >= lastSevenDays(now)[0];
}

export function foodWeek(meals: ReadonlyArray<MealRow>, now: Date): { logged: number; average: number | null } {
  const days = new Set(lastSevenDays(now));
  const kcal = new Map<string, number>();
  for (const m of meals) {
    const d = mealDay(m);
    if (!days.has(d)) continue;
    kcal.set(d, (kcal.get(d) ?? 0) + (m.food_item?.calories || 0) * (m.quantity_multiplier || 1));
  }
  const total = [...kcal.values()].reduce((a, b) => a + b, 0);
  return { logged: kcal.size, average: kcal.size > 0 ? Math.round(total / kcal.size) : null };
}

export function checkInWeek(rows: ReadonlyArray<CheckInRow>, now: Date): { count: number; toReview: number } {
  const from = bucketDateLocal(weekStart(now));
  const mine = rows.filter((c) => c.date.slice(0, 10) >= from);
  return { count: mine.length, toReview: mine.filter((c) => !c.reviewed_by_coach).length };
}

// ── Words (K1 section 11; every one is listed under "Wording needed") ──

const kcalText = (n: number) => n.toLocaleString('en-US');

/** K1-S-38 */
export const doneLine = (w: WorkoutWeek) => `${w.done} of ${w.total} done`;
/** Masthead headline: K1-S-39 when a session was missed, else K1-S-38. */
export const weekHeadline = (w: WorkoutWeek) => (w.missed != null ? `Missed ${DAY_NAMES[w.missed]}` : doneLine(w));
/** K1-S-40, only while sessions are still ahead. */
export function toGoLine(w: WorkoutWeek): string | null {
  const left = w.segments.filter((s) => s === 'planned').length;
  return left > 0 ? `${left} to go` : null;
}
/** Workouts card: K1-S-38 · K1-S-39. */
export const workoutsLine = (w: WorkoutWeek) => [doneLine(w), w.missed != null ? `Missed ${DAY_NAMES[w.missed]}` : null].filter(Boolean).join(' · ');
/** Food card: K1-S-41 · K1-S-42 (the target part only when a target is set). */
export function foodLine(f: { logged: number; average: number | null }, target: number | null): string {
  const parts = [`Logged ${f.logged} of 7 days`];
  if (f.average != null) parts.push(`Average ${kcalText(f.average)} kcal${target ? ` · target ${kcalText(target)}` : ''}`);
  return parts.join(' · ');
}
/** Check-ins card: K1-S-44. */
export const checkInLine = (c: { count: number; toReview: number }) => `${c.count} this week · ${c.toReview} to review`;
/** K1-S-138, the day strip for a screen reader. */
export function dayLabel(w: WorkoutWeek, d: number): string {
  const s = w.days[d];
  return `${DAY_NAMES[d]} ${w.dates[d]}${s === 'rest' ? '' : ` ${s}`}`;
}
