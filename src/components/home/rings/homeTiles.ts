/**
 * homeTiles — the numbers inside the Home tiles (UI-1 rings and tiles). Pure, so
 * every rule is unit tested: real data only, "—" while a read is pending, failed
 * or empty (today's Home placeholder), and Steps says "Connect" without Health.
 */
import { formatCount, formatHm } from './homeRings';
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

type FastRow = { start_time?: string; startTime?: string; end_time?: string | null; endTime?: string | null };

/** A fast running now shows its time so far; otherwise the last fast's length ("Last fast."). */
export function fastingTile(rows: unknown, now: number): TileView & { active: boolean } {
  if (!Array.isArray(rows)) return { ...DASH, active: false };
  const fasts = (rows as FastRow[]).map((r) => {
    const end = r.end_time || r.endTime;
    return { start: Date.parse(r.start_time || r.startTime || ''), end: end ? Date.parse(end) : null };
  }).filter((f) => Number.isFinite(f.start));
  const active = fasts.filter((f) => f.end === null).sort((a, b) => b.start - a.start)[0];
  if (active) return { value: formatHm((now - active.start) / 60000), small: '', sub: '', progress: null, active: true };
  const last = fasts.filter((f) => f.end !== null && Number.isFinite(f.end))
    .sort((a, b) => (b.end as number) - (a.end as number))[0];
  if (!last) return { ...DASH, active: false };
  return { value: formatHm(((last.end as number) - last.start) / 60000), small: '', sub: 'Last fast.', progress: null, active: false };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The earliest scheduled session still ahead: "Tue" "9:00 am" and its title. */
export function nextSessionTile(
  sessions: ReadonlyArray<{ id: string; status: string; start_at: string; title: string }> | null | undefined,
  now: number,
): TileView & { sessionId: string | null } {
  const next = (sessions ?? []).filter((s) => s.status === 'scheduled' && Date.parse(s.start_at) > now)
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))[0];
  if (!next) return { ...DASH, sessionId: null };
  const at = new Date(next.start_at);
  const h = at.getHours() % 12 || 12;
  const time = `${h}:${String(at.getMinutes()).padStart(2, '0')} ${at.getHours() < 12 ? 'am' : 'pm'}`;
  return { value: WEEKDAYS[at.getDay()] as string, small: time, sub: next.title.trim(), progress: null, sessionId: next.id };
}

/** A YYYY-MM-DD calendar date moved by whole days. */
export function shiftDay(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(y, m - 1, d + days);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

/** Days in a row with food logged, ending today (or yesterday while today is still empty). */
export function loggingTile(loggedDays: ReadonlyArray<string> | null | undefined, today: string): TileView {
  if (!loggedDays) return DASH;
  const days = new Set(loggedDays);
  let day = days.has(today) ? today : shiftDay(today, -1);
  let run = 0;
  while (days.has(day)) { run += 1; day = shiftDay(day, -1); }
  return { value: String(run), small: run === 1 ? 'day in a row' : 'days in a row', sub: run > 0 ? 'Food logged each day' : '', progress: null };
}
