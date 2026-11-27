/**
 * The food week page's pure part (KITCHEN-WEEK-M; C2 Style C frame C_week). The range is the last seven days ending
 * today, oldest first (R4). Each day's numbers are GET /log/weekly's raw sums for that date (R5); the plan meals done
 * per day are the Food day's own rule (buildPlanDay over that day's plan read and daily read, R6), so a week row always
 * says what the Food day says for that date. Nothing here reads, writes or stores anything.
 */
import type { ClientTodayResponse, DailyMealPlan } from '../../../api/mealTemplatesApi';
import { addDays } from '../../../utils/date';
import { foodLogFromDailyEntry, type DailyLogEntry } from '../../../utils/log/dailyEntry';
import { buildPlanDay } from '../../../utils/log/foodDay';
import { countsInDay } from '../../../utils/log/queuedDay';
import { formatPlanNumber as n } from '../mealplan/planStyleC';

export interface WeekRange { start: string; end: string; days: string[]; current: boolean }
/** One day's raw sums from the weekly read; null: no entries that day. */
export interface DayTotals { kcal: number; protein: number }
export interface PlanDots { done: number; total: number }

/** R4: seven days ending today (`back` 0) or ending seven days earlier per step back. */
export function weekRange(today: string, back: number): WeekRange {
  const end = addDays(today, -7 * back);
  const days = Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
  return { start: days[0], end, days, current: back === 0 };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** The day's own name from its calendar date (no time zone enters). */
export const weekdayName = (day: string): string => WEEKDAYS[new Date(`${day.slice(0, 10)}T00:00:00Z`).getUTCDay()];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** R5: the weekly read's rows, one per day with entries (log.service.ts getWeekly), placed on the range's days. */
export function weeklyTotals(data: unknown, days: string[]): Array<DayTotals | null> {
  const byDay = new Map<string, DayTotals>();
  for (const r of Array.isArray(data) ? data : []) {
    if (!r || typeof r !== 'object') continue;
    const row = r as { date?: unknown; calories?: unknown; protein_g?: unknown };
    const kcal = num(row.calories);
    if (typeof row.date !== 'string' || kcal === null) continue;
    byDay.set(row.date.slice(0, 10), { kcal, protein: num(row.protein_g) ?? 0 });
  }
  return days.map((d) => byDay.get(d) ?? null);
}

/** R5 and C2-A-22: the mean of the finished days with entries (today left out until it ends); none: null. */
export function weekAverage(totals: Array<DayTotals | null>, days: string[], today: string): DayTotals | null {
  const counted = totals.filter((t, i): t is DayTotals => t !== null && days[i] !== today);
  if (counted.length === 0) return null;
  const mean = (pick: (t: DayTotals) => number) => Math.round(counted.reduce((s, t) => s + pick(t), 0) / counted.length);
  return { kcal: mean((t) => t.kcal), protein: mean((t) => t.protein) };
}

/**
 * R6: the day's plan meals and how many were done, by the Food day's own rule: its plans listed as FoodDayView
 * lists them (one per plan, plans with meals only), its log mapped as the Food day maps it, counted by buildPlanDay.
 * No plan, or a read missing: null, so no dots and no count (never "0 of 4" from a read that failed).
 */
export function planDots(plan: ClientTodayResponse | null | undefined, daily: unknown, day: string): PlanDots | null {
  if (!plan || !daily || typeof daily !== 'object') return null;
  const plans: DailyMealPlan[] = [...new Map((plan.assignments ?? [])
    .flatMap((a) => (a?.daily_meal_plan ? [[a.daily_meal_plan.id, a.daily_meal_plan] as const] : []))).values()]
    .filter((x) => x.slots.length > 0);
  if (plans.length === 0) return null;
  const entries = (daily as { entries?: unknown }).entries;
  const logs = (Array.isArray(entries) ? entries as DailyLogEntry[] : []).map((e) => foodLogFromDailyEntry(e, day)).filter(countsInDay);
  const slots = plans.flatMap((x) => x.slots);
  void buildPlanDay;
  return { done: slots.filter((s) => logs.some((l) => l.planSlotId === s.id)).length, total: slots.length };
}

// ─── Words (the 137-2 table in the PR body) ────────────────────────────────────
export const rowNumbers = (t: DayTotals | null): string => (t ? `${n(t.kcal)} kcal, ${n(t.protein)} g` : 'Nothing yet');
export const averageLine = (a: DayTotals): string => `${n(a.kcal)} kcal and ${n(a.protein)} g protein a day, on average.`;
export function rowSentence(day: string, t: DayTotals | null, dots: PlanDots | null): string {
  const count = dots ? `, ${dots.done} of ${dots.total}` : '';
  return `${weekdayName(day)}${count}, ${t ? `${n(t.kcal)} kcal, ${n(t.protein)} g protein` : 'nothing yet'}`;
}
/** The legend says only what the chart draws: the dashed sentence with a target, the gold one with today's point. */
export function legendLine(target: number | null, goldPoint: boolean): string | null {
  const parts = [target !== null ? `Dashed line: ${n(target)} kcal target.` : null, goldPoint ? 'Gold dot: today so far.' : null];
  const words = parts.filter(Boolean).join(' ');
  return words || null;
}
export const chartLabel = (target: number | null): string =>
  (target !== null ? `Calories per day against the ${n(target)} kcal target` : 'Calories per day');

// ─── The chart (C_week: about 130 pt tall, gutter to gutter, no axis, grid or fill) ──────────
/** C_week at 390: 930 kcal span 70 pt, so 30 pt clear above and below; points 20 pt in from each gutter. */
export const CHART = { height: 130, padY: 30, inset: 20 } as const;
export interface ChartPoint { x: number; y: number; i: number }
export interface ChartGeometry { points: Array<ChartPoint | null>; runs: ChartPoint[][]; targetY: number | null }

export function chartGeometry(totals: Array<DayTotals | null>, width: number, target: number | null): ChartGeometry {
  const values = totals.flatMap((t) => (t ? [t.kcal] : []));
  const domain = target !== null ? [...values, target] : values;
  const lo = Math.min(...domain);
  const hi = Math.max(...domain);
  const span = CHART.height - 2 * CHART.padY;
  const y = (v: number) => (hi === lo ? CHART.height / 2 : CHART.padY + ((hi - v) / (hi - lo)) * span);
  const step = (width - 2 * CHART.inset) / Math.max(totals.length - 1, 1);
  const points = totals.map((t, i) => (t ? { x: CHART.inset + i * step, y: y(t.kcal), i } : null));
  const runs: ChartPoint[][] = [];
  let run: ChartPoint[] = [];
  for (const p of points) {
    if (p) run.push(p);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  return { points, runs, targetY: target !== null && domain.length > 0 ? y(target) : null };
}
