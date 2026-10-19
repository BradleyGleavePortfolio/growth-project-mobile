/** C8 slice 3: the last completed Monday–Sunday, from existing self-only reads. */
import api, { checkInsApi, logApi, weightApi, workoutApi } from '../../../services/api';
import { workoutBuilderApi } from '../../../api/workoutBuilderApi';
import { wearablesSamplesApi } from '../../../api/wearablesSamplesApi';
import { formatHm, lastNightSleep } from '../../../components/home/rings/homeRings';
import { weightTrend } from '../../../components/progress/weightTrend';
import type { WeightLog } from '../../../types';
import { parseWeightLogRow, weightHistoryRows } from './weightHistory';
import * as P from './progressV2';

export interface ReviewWeek { start: string; end: string }
export interface FoodDay { date: string; protein_g: number }
export interface ReviewCheckIn { date: string; sleep_hours: number | string | null }
export interface HabitCount { planned: number; done: number }
export interface WeekReviewData {
  workouts: number;
  training: ReturnType<typeof P.trainingWeek>;
  food: number;
  protein: number | null;
  weights: WeightLog[];
  habits: HabitCount;
  checkIns: number;
  /** null: no night this week. undefined: the watch read failed and no check-in has sleep, so the row is left out. */
  sleepMinutes: number | null | undefined;
  empty: boolean;
}
const DAY = 86_400_000;
const dayAt = (x: number) => new Date(x).toISOString().slice(0, 10);
const inWeek = (date: string, week: ReviewWeek) => date.slice(0, 10) >= week.start && date.slice(0, 10) <= week.end;
/** A calendar day on this phone's clock, `add` days later, at `hour`. */
const localAt = (day: string, add = 0, hour = 0) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d + add, hour);
};

export function reviewWeek(today: string): ReviewWeek {
  const x = P.dayX(today);
  const monday = x - ((new Date(x).getUTCDay() + 6) % 7) * DAY;
  return { start: dayAt(monday - 7 * DAY), end: dayAt(monday - DAY) };
}

/** C8-S-030: "October 5 to 11"; both months only when the week crosses one. */
export const weekDates = ({ start, end }: ReviewWeek) =>
  `${P.monthDay(start)} to ${start.slice(0, 7) === end.slice(0, 7) ? Number(end.slice(8, 10)) : P.monthDay(end)}`;
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/** No client id is sent: these routes derive ownership from the signed-in session. */
export async function loadWeekReview(userId: string, week: ReviewWeek): Promise<WeekReviewData> {
  const [workouts, assignments, food, weight, habits, checkIns, health] = await Promise.all([
    workoutApi.getAll(P.SESSIONS),
    workoutBuilderApi.listMyAssignments(),
    logApi.getWeekly(week.start),
    weightApi.getHistory(3650),
    api.get<{ habits: HabitCount[] }>('/habits/summary', { params: { from: week.start, to: week.end } }),
    checkInsApi.list({ from: week.start, to: week.end, limit: 7 }),
    // Home's Sleep read (RingsHomeScreen), over this week's nights. #WEEK-SLEEP-FAIL op 2: only this read may
    // fail and still leave the week; check-in hours then count alone, as on Home's Sleep dial (sleepDial).
    wearablesSamplesApi.getSamples({ bucket: 'SLEEP_RECOVERY', from: localAt(week.start).toISOString(),
      to: localAt(week.end, 1).toISOString(), granularity: 'day', preferredOnly: true }).catch(() => undefined),
  ]);
  const sessions: P.Session[] = workouts.data;
  const foodDays = (food.data as FoodDay[]).filter((d) => inWeek(d.date, week));
  const checks = (checkIns.data as ReviewCheckIn[]).filter((c) => inWeek(c.date, week));
  const weights = weightHistoryRows(weight.data).map((r) => parseWeightLogRow(r, userId))
    .filter((r): r is WeightLog => r !== null && r.date <= week.end);
  const counts = habits.data.habits.reduce((sum, h) => ({ done: sum.done + h.done, planned: sum.planned + h.planned }),
    { done: 0, planned: 0 });
  // Each night as Home's Sleep dial reads it: the watch first, the daily check-in's hours second.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const nights = Array.from({ length: 7 }, (_, i) => dayAt(P.dayX(week.start) + i * DAY)).flatMap((day) => {
    const watch = lastNightSleep(health, localAt(day, 0, 12), timeZone).asleepMin;
    const hours = Number(checks.find((c) => c.date.slice(0, 10) === day)?.sleep_hours) || 0;
    return watch !== null ? [watch] : hours > 0 ? [hours * 60] : [];
  });
  const sleep = mean(nights);
  const done = sessions.filter((s) => inWeek(s.date, week)).length;
  const training = P.trainingWeek(assignments, week.end);
  return {
    workouts: done, training, food: new Set(foodDays.map((d) => d.date.slice(0, 10))).size,
    protein: mean(foodDays.map((d) => d.protein_g)), weights, habits: counts, checkIns: checks.length,
    sleepMinutes: sleep !== null ? Math.round(sleep) : health ? null : undefined,
    empty: done === 0 && !training?.done && !foodDays.length && !weights.some((w) => inWeek(w.date, week))
      && counts.done === 0 && !checks.length && !nights.length,
  };
}

/** The trend on Sunday against the trend just before Monday (or the first weigh-in, when the history starts this week). */
export function reviewTrend(weights: WeightLog[], week: ReviewWeek, unit: P.WeightUnit): string {
  if (!weights.some((w) => inWeek(w.date, week))) return 'No weigh-ins this week.';
  const days = weightTrend(P.samplesOf(weights), P.dayX(week.end)).filter((p) => p.x <= P.dayX(week.end));
  const last = days[days.length - 1];
  if (!last || last.count < 2) return 'The first weigh-in sets the starting point.';
  const base = days.filter((p) => p.x < P.dayX(week.start)).pop() ?? days[0];
  const n = P.one(Math.abs(P.toUnit(last.y - base.y, unit)));
  return n === '0.0' ? 'Steady' : `${last.y < base.y ? 'Down' : 'Up'} ${n} ${unit}`;
}

export const sleepLine = (minutes: number | null) => minutes === null ? 'No sleep logged' : formatHm(minutes);
export const workoutLine = (data: WeekReviewData) => data.training
  ? `${data.training.done} of ${data.training.total}` : `${data.workouts} logged`;
