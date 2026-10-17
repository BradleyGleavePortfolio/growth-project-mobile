/**
 * homeTiles — the numbers inside the Home tiles (UI-1 rings and tiles). Pure, so
 * every rule is unit tested: real data only, "—" while a read is pending, failed
 * or empty (today's Home placeholder), and Steps says "Connect" without Health.
 */
import { formatCount } from './homeRings';
import { ENERGY_LABELS, MOOD_LABELS } from '../../../screens/client/habits/constants';
import type { WeightLog } from '../../../types';

/** value: serif number; small: muted text after it; sub: muted foot lines; progress: bar (null = no bar). */
export interface TileView { value: string; small: string; sub: string; progress: number | null }

const DASH: TileView = { value: '—', small: '', sub: '', progress: null };
const ML_PER_OZ = 29.5735;
const KG_PER_LB = 0.45359237;
const one = (n: number): string => String(Math.round(n * 10) / 10);
const frac = (n: number, of: number): number => (of > 0 ? Math.max(0, Math.min(1, n / of)) : 0);

export function proteinTile(i: {
  ready: boolean; protein?: number; carbs?: number; fat?: number; target?: number; simple: boolean;
}): TileView {
  const target = i.target && i.target > 0 ? Math.round(i.target) : 0;
  const small = target ? `of ${formatCount(target)}` : '';
  if (!i.ready) return { ...DASH, small };
  const protein = Math.max(0, Math.round(i.protein ?? 0));
  // The lighter start (simple macro mode) shows calories and protein only.
  const sub = i.simple ? '' : `Carbs ${Math.round(i.carbs ?? 0)} g\nFat ${Math.round(i.fat ?? 0)} g`;
  return { value: `${protein} g`, small, sub, progress: target ? frac(protein, target) : null };
}

/** Water against the Food log's goal (Settings, starter goal by default), in the client's units. */
export function waterTile(i: { ready: boolean; oz: number; goalOz: number; metric: boolean }): TileView {
  const goal = i.metric ? `of ${formatCount(i.goalOz * ML_PER_OZ)} ml` : `of ${formatCount(i.goalOz)} oz`;
  if (!i.ready) return { ...DASH, small: goal };
  // Day reads round to ounces, so a converted ml total is approximate (as on the Food log).
  const value = i.metric ? `≈ ${formatCount(i.oz * ML_PER_OZ)}` : one(i.oz);
  return { value, small: goal, sub: '', progress: null };
}

export function weightTile(rows: WeightLog[] | null, metric: boolean): TileView & { points: number[] } {
  const logs = (rows ?? []).filter((r) => Number.isFinite(r.weight) && r.weight > 0)
    .sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)));
  if (logs.length === 0) return { ...DASH, points: [] };
  const unit = metric ? 'kg' : 'lb';
  const points = logs.map((l) => (metric ? l.weight * KG_PER_LB : l.weight));
  const latest = points[points.length - 1] as number;
  const change = latest - (points[0] as number);
  // The mockup's line says "Down"; a gain or no change shows the number and trend only.
  const sub = logs.length > 1 && Math.round(change * 10) < 0 ? `Down ${one(-change)} ${unit} in 30 days` : '';
  return { value: one(latest), small: unit, sub, progress: null, points: points.length > 1 ? points : [] };
}

/** "A", "A and B", "A, B and C". */
const list = (names: string[]): string =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** A GET /habits row: the client's own and coach-set habits (HB1); rows without a plan count every day. */
export interface HabitRow {
  id: string;
  name: string;
  schedule_kind?: string | null;
  /** 0 = Sunday ... 6 = Saturday. */
  schedule_days?: number[] | null;
  times_per_week?: number | null;
  starts_on?: string | null;
  logs?: ReadonlyArray<{ date: string; completed?: boolean | null }> | null;
}

const utcDay = (day: string): Date => new Date(`${day}T00:00:00Z`);

/**
 * #HABITS-CONCEPT (the ring): today's ring holds the habits planned for today only. A habit
 * counts from its start day, on its chosen days, or (times a week) until this week's count is
 * met before today; Monday starts the week.
 */
export function plannedToday(h: HabitRow, today: string): boolean {
  if (h.starts_on && h.starts_on.slice(0, 10) > today) return false;
  if (h.schedule_kind === 'days') return (h.schedule_days ?? []).includes(utcDay(today).getUTCDay());
  if (h.schedule_kind === 'times_per_week' && h.times_per_week) {
    const monday = utcDay(today);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const start = monday.toISOString().slice(0, 10);
    const done = new Set((h.logs ?? []).filter((l) => l.completed).map((l) => l.date.slice(0, 10))
      .filter((day) => day >= start && day < today));
    return done.size < h.times_per_week;
  }
  return true;
}

export function habitsTile(
  rows: ReadonlyArray<HabitRow> | null | undefined,
  logs: ReadonlyArray<{ habit_id: string; completed: boolean }> | null | undefined,
  today: string,
): TileView {
  if (!rows || !logs) return DASH;
  const doneIds = new Set(logs.filter((l) => l.completed).map((l) => l.habit_id));
  // A habit ticked today stays in today's ring even on a day it was not planned.
  const habits = rows.filter((h) => doneIds.has(h.id) || plannedToday(h, today));
  if (habits.length === 0) return DASH;
  const done = habits.filter((h) => doneIds.has(h.id)).map((h) => h.name.trim());
  const open = habits.filter((h) => !doneIds.has(h.id)).map((h) => h.name.trim());
  const sub = [done.length ? `${list(done)} done.` : '', open.length ? `${list(open)} open.` : ''].filter(Boolean).join(' ');
  return { value: String(done.length), small: `of ${habits.length}`, sub, progress: null };
}

export function checkInTile(checkIn: unknown): TileView {
  const c = (checkIn ?? null) as { mood?: number | null; energy?: number | null; sleep_hours?: number | string | null } | null;
  const mood = c && typeof c.mood === 'number' ? MOOD_LABELS[c.mood] : undefined;
  if (!mood) return DASH;
  const energy = typeof c?.energy === 'number' ? ENERGY_LABELS[c.energy] : undefined;
  const slept = Number(c?.sleep_hours);
  const parts = [energy ? `energy ${energy.toLowerCase()}` : '', slept > 0 ? `slept ${one(slept)} h` : ''].filter(Boolean).join(', ');
  return { value: mood, small: '', sub: parts ? parts.charAt(0).toUpperCase() + parts.slice(1) : '', progress: null };
}

/** Today's steps from Health against the Starter goal (5,000, owner 10-07); "Connect" with no Health source. */
export function stepsTile(i: { today: number | null; connected: boolean; goal: number; source: string | null }): TileView {
  if (i.today === null) return i.connected ? DASH : { value: 'Connect', small: '', sub: '', progress: null };
  const sub = `Of ${formatCount(i.goal)}${i.source ? `, ${i.source}` : ''}`;
  return { value: formatCount(i.today), small: '', sub, progress: frac(i.today, i.goal) };
}
