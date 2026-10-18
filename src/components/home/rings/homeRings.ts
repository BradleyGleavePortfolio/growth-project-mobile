/**
 * homeRings — the numbers inside the three Home dials (UI-1 rings and tiles).
 * Each dial is its own number, never a combined score. Pure, so every rule is
 * unit tested: no invented data, "—" while a read is pending or failed, and the
 * Sleep dial never says "coming soon" (an empty ring and "Connect" instead, only
 * once the client's connections list none connected and the check-in has no hours).
 */
import { bucketDateLocal } from '../../../utils/date';
import type { WorkoutRowLike } from '../../../utils/workout/workoutDoneToday';
import { DEFAULT_SLEEP_NEED_MIN, recoveryScore, sleepDeficit } from '../../../screens/client/wearables/recoveryData';
import type { WearableSamplesResponse } from '../../../api/wearablesSamplesApi';

/** value: serif number in the ring; unit: the line under it; sub: muted line under the label ('' = none). */
export interface DialView { value: string; unit: string; sub: string; progress: number }

export const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/** 1850 -> "1,850" without relying on the device's Intl data. */
export function formatCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 440 -> "7 h 20 m", 420 -> "7 h", 45 -> "45 m" (the mockup's sleep form). */
export function formatHm(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

export function foodDial(input: { ready: boolean; eaten: number | undefined; target: number | undefined }): DialView {
  const target = input.target && input.target > 0 ? input.target : 0;
  if (!input.ready) return { value: '—', unit: target ? 'kcal left' : 'kcal', sub: '', progress: 0 };
  const eaten = Math.max(0, input.eaten ?? 0);
  if (!target) return { value: formatCount(eaten), unit: 'kcal', sub: '', progress: 0 };
  return {
    value: formatCount(Math.max(0, target - eaten)),
    unit: 'kcal left',
    sub: `${formatCount(eaten)} of ${formatCount(target)}`,
    progress: clamp01(eaten / target),
  };
}

/** Monday 00:00 local of the week holding `now`, as YYYY-MM-DD, and the next Monday. */
export function weekBounds(now: Date): { start: string; end: string } {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const next = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
  return { start: bucketDateLocal(monday), end: bucketDateLocal(next) };
}

const dayOf = (iso: string | undefined | null): string => {
  if (typeof iso !== 'string' || !iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : bucketDateLocal(d);
};
const inWeek = (day: string, w: { start: string; end: string }): boolean => !!day && day >= w.start && day < w.end;

export function trainDial(input: {
  now: Date;
  assignments: ReadonlyArray<{ scheduled_for?: string | null; completed_at?: string | null }> | null;
  history: ReadonlyArray<WorkoutRowLike> | null;
  daysPerWeek: number | undefined;
  loading: boolean;
}): DialView {
  const unknown: DialView = { value: '—', unit: 'workouts', sub: 'This week', progress: 0 };
  // A failed read is not a zero: a failed assignment read is no proof of no coach plan.
  if (input.loading || input.assignments === null) return unknown;
  const week = weekBounds(input.now);
  const planned = input.assignments.filter((a) => inWeek(dayOf(a.scheduled_for), week));
  if (planned.length > 0) {
    const done = planned.filter((a) => !!a.completed_at).length;
    return { value: `${done} of ${planned.length}`, unit: 'workouts', sub: 'This week', progress: clamp01(done / planned.length) };
  }
  if (input.history === null) return unknown;
  // No coach assignments this week: the client's own workouts against days per week.
  const days = new Set(
    input.history
      .filter((r) => r && r.completed !== false)
      // `date` is a calendar day (UTC midnight): its day part, as isWorkoutDoneToday reads it.
      .map((r) => (typeof r.date === 'string' && r.date.length >= 10 ? r.date.slice(0, 10) : dayOf(r.created_at ?? null)))
      .filter((d) => inWeek(d, week)),
  );
  const goal = input.daysPerWeek && input.daysPerWeek > 0 ? Math.round(input.daysPerWeek) : 0;
  if (!goal) return { value: String(days.size), unit: 'workouts', sub: 'This week', progress: 0 };
  return { value: `${days.size} of ${goal}`, unit: 'workouts', sub: 'This week', progress: clamp01(days.size / goal) };
}

/** 'unknown': a read is still pending or failed, so the dial shows "—", never "Connect". */
export type SleepSource = 'health' | 'checkin' | 'none' | 'unknown';
export type ReadState = 'pending' | 'failed' | 'ok';

/** #RINGS-CONNECT: no source only once the client's connections answered with none connected, never from one bucket's data. */
export const noHealthSource = (connections: { isSuccess: boolean; data?: ReadonlyArray<{ status: string }> }): boolean =>
  connections.isSuccess && !connections.data?.some((c) => c.status === 'connected');

/** Whole-UTC-day records keep their calendar date; other samples use the local end (wake) day. */
export function lastNightSleep(
  data: WearableSamplesResponse | undefined,
  now: Date,
  timeZone: string,
): { recovery: number | null; asleepMin: number | null } {
  const today = bucketDateLocal(now, timeZone);
  const night = data && {
    ...data,
    series: data.series.map((series) => ({
      ...series,
      samples: series.samples.filter((sample) => {
        const day = sample.start_at.slice(0, 10);
        if (sample.start_at === `${day}T00:00:00.000Z` && sample.end_at === `${day}T23:59:59.999Z`) {
          return day === today;
        }
        const at = new Date(sample.end_at);
        return !Number.isNaN(at.getTime()) && bucketDateLocal(at, timeZone) === today;
      }),
    })),
  };
  return { recovery: recoveryScore(night), asleepMin: sleepDeficit(night)?.asleepMinutes ?? null };
}

export function sleepDial(input: {
  recovery: number | null;
  asleepMin: number | null;
  checkInHours: number | null | undefined;
  reads: { health: ReadState; checkIn: ReadState };
  /** noHealthSource: the one state that may say "Connect" (and opens Connections). */
  noSource: boolean;
}): DialView & { source: SleepSource } {
  if (input.recovery !== null) {
    return {
      value: `${Math.round(input.recovery)}%`,
      unit: 'recovered',
      sub: input.asleepMin !== null ? `${formatHm(input.asleepMin)} asleep` : '',
      progress: clamp01(input.recovery / 100),
      source: 'health',
    };
  }
  if (input.asleepMin !== null) {
    return { value: `${Math.round(input.asleepMin / 6) / 10}`, unit: 'h asleep', sub: '', progress: clamp01(input.asleepMin / DEFAULT_SLEEP_NEED_MIN), source: 'health' };
  }
  const unknown = { value: '—', unit: '', sub: '', progress: 0, source: 'unknown' as const };
  if (input.reads.health === 'pending') return unknown;
  // Health answered with no sleep, or failed: the check-in's verified hours still count.
  const hours = typeof input.checkInHours === 'number' && input.checkInHours > 0 ? input.checkInHours : null;
  if (hours !== null) {
    return { value: `${Math.round(hours * 10) / 10}`, unit: 'h asleep', sub: '', progress: clamp01((hours * 60) / DEFAULT_SLEEP_NEED_MIN), source: 'checkin' };
  }
  // A connected client with nothing for last night keeps the dash, never "Connect".
  if (input.reads.health !== 'ok' || input.reads.checkIn !== 'ok' || !input.noSource) return unknown;
  return { value: 'Connect', unit: '', sub: '', progress: 0, source: 'none' };
}
