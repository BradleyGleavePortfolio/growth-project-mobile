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

export function habitsTile(
  habits: ReadonlyArray<{ id: string; name: string }> | null | undefined,
  logs: ReadonlyArray<{ habit_id: string; completed: boolean }> | null | undefined,
): TileView {
  if (!habits || !logs || habits.length === 0) return DASH;
  const doneIds = new Set(logs.filter((l) => l.completed).map((l) => l.habit_id));
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
