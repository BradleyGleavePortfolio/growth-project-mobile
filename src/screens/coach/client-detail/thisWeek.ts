/**
 * K1-OVERVIEW — the client file's This week (planning/MOCKUP3/K1, Style C). The week is the server's
 * (GET /coach/clients/:id/week): every assignment from Monday to Sunday in the client's own time zone, so a
 * delivered program's later weeks never push this one out. Food and check-ins count from the same days.
 */
import type { DayState, SegmentState } from '../../../ui/charts/StyleCMarks';

export const TIMELINE_PAGE = 100;
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The week read: `week_start`, `today` and each row's `day` are YYYY-MM-DD in the client's zone. */
export interface ClientWeek { week_start: string; today: string; shared: boolean; assignments: { day: string; completed_at?: string | null; skipped_at?: string | null }[] }
export interface MealRow { id: string; date?: string | null; logged_at?: string | null; quantity_multiplier?: number | null; food_item?: { calories?: number | null } | null }
export interface CheckInRow { date: string; reviewed_by_coach?: boolean }

/** Monday first. `missed`: the latest day (Monday = 0) with a missed session. `week`: Monday, YYYY-MM-DD. */
export interface WorkoutWeek {
  segments: SegmentState[]; days: DayState[]; dates: number[]; done: number; total: number; missed: number | null; week: string;
}

const DAY_MS = 86_400_000;
const daysFrom = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
const plusDays = (day: string, n: number) => new Date(Date.parse(day) + n * DAY_MS).toISOString().slice(0, 10);

/** The ring and the day strip; null when the client keeps Workouts private. A skipped session counts as missed. */
export function workoutWeek(w: ClientWeek): WorkoutWeek | null {
  if (!w.shared) return null;
  const today = daysFrom(w.week_start, w.today);
  const week = w.assignments.map((a) => ({ day: daysFrom(w.week_start, a.day), done: !!a.completed_at, skipped: !!a.skipped_at }));
  const state = (r: (typeof week)[number]): SegmentState => (r.done ? 'done' : r.skipped || r.day < today ? 'missed' : 'planned');
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
    dates: days.map((_, d) => Number(plusDays(w.week_start, d).slice(8))),
    done: segments.filter((s) => s === 'done').length,
    total: segments.length,
    missed: missedDays.length > 0 ? Math.max(...missedDays) : null,
    week: w.week_start,
  };
}

/** The seven days ending `today`, oldest first, as YYYY-MM-DD. */
export const lastSevenDays = (today: string) => Array.from({ length: 7 }, (_, i) => plusDays(today, i - 6));

const mealDay = (m: MealRow) => (m.date || m.logged_at || '').slice(0, 10);

/** True when a full page of meals still reaches into the seven days ending `today`: read the next page. */
export function needsNextMealPage(page: ReadonlyArray<MealRow>, today: string): boolean {
  const last = page[page.length - 1];
  return page.length >= TIMELINE_PAGE && !!last && mealDay(last) >= lastSevenDays(today)[0];
}

export function foodWeek(meals: ReadonlyArray<MealRow>, today: string): { logged: number; average: number | null } {
  const days = new Set(lastSevenDays(today));
  const kcal = new Map<string, number>();
  for (const m of meals) {
    const d = mealDay(m);
    if (!days.has(d)) continue;
    kcal.set(d, (kcal.get(d) ?? 0) + (m.food_item?.calories || 0) * (m.quantity_multiplier || 1));
  }
  const total = [...kcal.values()].reduce((a, b) => a + b, 0);
  return { logged: kcal.size, average: kcal.size > 0 ? Math.round(total / kcal.size) : null };
}

export function checkInWeek(rows: ReadonlyArray<CheckInRow>, weekStart: string): { count: number; toReview: number } {
  const mine = rows.filter((c) => c.date.slice(0, 10) >= weekStart);
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
/** Workouts card: K1-S-38 · K1-S-39, or (FIX739-W1) a plain line when this week has no session. */
export const workoutsLine = (w: WorkoutWeek | null) => (!w?.total ? 'Nothing planned this week'
  : [doneLine(w), w.missed != null ? `Missed ${DAY_NAMES[w.missed]}` : null].filter(Boolean).join(' · '));
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
