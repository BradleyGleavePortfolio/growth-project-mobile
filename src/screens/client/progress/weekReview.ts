/** C8 slice 3: the last completed Monday–Sunday, from existing self-only reads. */
import api, { checkInsApi, logApi, weightApi, workoutApi } from '../../../services/api';
import { workoutBuilderApi } from '../../../api/workoutBuilderApi';
import type { WeightLog } from '../../../types';
import { parseWeightLogRow, weightHistoryRows } from './weightHistory';
import * as P from './progressV2';

export interface ReviewWeek { start: string; end: string }
export interface FoodDay { date: string; protein_g: number }
export interface ReviewCheckIn { date: string; sleep_hours: number | null }
export interface HabitCount { planned: number; done: number }
export interface WeekReviewData {
  workouts: number;
  training: ReturnType<typeof P.trainingWeek>;
  food: number;
  protein: number | null;
  weights: WeightLog[];
  habits: HabitCount;
  checkIns: number;
  sleepMinutes: number | null;
  empty: boolean;
}
const DAY = 86_400_000;
const dayAt = (x: number) => new Date(x).toISOString().slice(0, 10);
const inWeek = (date: string, week: ReviewWeek) => date.slice(0, 10) >= week.start && date.slice(0, 10) <= week.end;

export function reviewWeek(today: string): ReviewWeek {
  const x = P.dayX(today);
  const monday = x - ((new Date(x).getUTCDay() + 6) % 7) * DAY;
  return { start: dayAt(monday - 7 * DAY), end: dayAt(monday - DAY) };
}

export const weekDate = (day: string) => new Date(P.dayX(day)).toLocaleDateString('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/** No client id is sent: these routes derive ownership from the signed-in session. */
export async function loadWeekReview(userId: string, week: ReviewWeek): Promise<WeekReviewData> {
  const [workouts, assignments, food, weight, habits, checkIns] = await Promise.all([
    workoutApi.getAll(P.SESSIONS),
    workoutBuilderApi.listMyAssignments(),
    logApi.getWeekly(week.start),
    weightApi.getHistory(3650),
    api.get<{ habits: HabitCount[] }>('/habits/summary', { params: { from: week.start, to: week.end } }),
    checkInsApi.list({ from: week.start, to: week.end, limit: 7 }),
  ]);
  const sessions: P.Session[] = workouts.data;
  const foodDays = (food.data as FoodDay[]).filter((d) => inWeek(d.date, week));
  const checks = (checkIns.data as ReviewCheckIn[]).filter((c) => inWeek(c.date, week));
  const weights = weightHistoryRows(weight.data).map((r) => parseWeightLogRow(r, userId))
    .filter((r): r is WeightLog => r !== null && r.date <= week.end);
  const counts = habits.data.habits.reduce((sum, h) => ({ done: sum.done + h.done, planned: sum.planned + h.planned }),
    { done: 0, planned: 0 });
  const sleep = mean(checks.flatMap((c) => typeof c.sleep_hours === 'number' ? [c.sleep_hours] : []));
  const done = sessions.filter((s) => inWeek(s.date, week)).length;
  const training = P.trainingWeek(assignments, week.end);
  return {
    workouts: done, training, food: new Set(foodDays.map((d) => d.date.slice(0, 10))).size,
    protein: mean(foodDays.map((d) => d.protein_g)), weights, habits: counts, checkIns: checks.length,
    sleepMinutes: sleep === null ? null : Math.round(sleep * 60),
    empty: done === 0 && !training?.done && !foodDays.length && !weights.some((w) => inWeek(w.date, week))
      && counts.done === 0 && !checks.length,
  };
}

export function reviewTrend(weights: WeightLog[], week: ReviewWeek, unit: P.WeightUnit): string {
  if (!weights.some((w) => inWeek(w.date, week))) return 'No weigh-ins this week.';
  return P.trendSentence(weights, '7D', unit, week.end) ?? 'The first weigh-in sets the starting point.';
}

export const sleepLine = (minutes: number | null) => minutes === null ? 'No sleep logged' : `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
export const workoutLine = (data: WeekReviewData) => data.training
  ? `${data.training.done} of ${data.training.total}` : `${data.workouts} logged`;
