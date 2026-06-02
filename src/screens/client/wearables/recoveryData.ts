/**
 * recoveryData — pure selectors that turn a `WearableSamplesResponse` (S&R
 * bucket) into the view-models the cards render. Kept pure + framework-free so
 * they're unit-testable without React.
 *
 * Bradley LAW: sleep-stage labels here are PLAIN LANGUAGE ONLY — `awake`,
 * `light sleep`, `deep sleep`, `REM`. There are NO clinical stage codes
 * anywhere in this module by construction.
 */

import type {
  WearableSamplesResponse,
  WearableSampleSeries,
  WearableMetricType,
} from '../../../api/wearablesSamplesApi';

export interface TrendPoint {
  at: string;
  value: number;
}

/** Find the series for a metric, or undefined if the bucket lacks it. */
export function seriesFor(
  data: WearableSamplesResponse | undefined,
  metric: WearableMetricType,
): WearableSampleSeries | undefined {
  return data?.series.find((s) => s.metric === metric);
}

/** Most-recent sample value for a metric, or null when there are none. */
export function latestValue(
  data: WearableSamplesResponse | undefined,
  metric: WearableMetricType,
): number | null {
  const series = seriesFor(data, metric);
  if (!series || series.samples.length === 0) return null;
  // samples are time-ordered ascending by contract; take the last.
  const last = series.samples[series.samples.length - 1];
  return last ? last.value : null;
}

/** A trend (ascending by time) for charting. Empty array when no data. */
export function trendFor(
  data: WearableSamplesResponse | undefined,
  metric: WearableMetricType,
): TrendPoint[] {
  const series = seriesFor(data, metric);
  if (!series) return [];
  // Prefer day buckets when present (granularity='day'); else raw samples.
  if (series.buckets && series.buckets.length > 0) {
    return series.buckets.map((b) => ({ at: b.bucket_start, value: b.agg }));
  }
  return series.samples.map((s) => ({ at: s.start_at, value: s.value }));
}

/**
 * Recovery score (0-100). Prefers RECOVERY_SCORE; falls back to READINESS_SCORE
 * per the brief. Returns null when neither has data.
 */
export function recoveryScore(data: WearableSamplesResponse | undefined): number | null {
  const recovery = latestValue(data, 'RECOVERY_SCORE');
  if (recovery !== null) return clampScore(recovery);
  const readiness = latestValue(data, 'READINESS_SCORE');
  return readiness === null ? null : clampScore(readiness);
}

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

// ─── Sleep stages (PLAIN LANGUAGE ONLY) ──────────────────────────────────────

/** A stage in the stacked sleep bar. `key` drives colour; `label` is shown. */
export interface SleepStageSlice {
  key: 'awake' | 'light' | 'deep' | 'rem';
  label: 'Awake' | 'Light sleep' | 'Deep sleep' | 'REM';
  minutes: number;
  /** Fraction of the night [0,1] for the stacked bar width. */
  fraction: number;
}

export interface SleepStagesView {
  slices: SleepStageSlice[];
  totalMinutes: number;
}

/**
 * Build the stacked sleep-stage view. Order REM → Deep → Light → Awake for the
 * bar. Stages with zero minutes are dropped from the bar but the total reflects
 * everything. Returns null when there is no sleep-stage data at all.
 */
export function sleepStages(data: WearableSamplesResponse | undefined): SleepStagesView | null {
  const rem = latestValue(data, 'SLEEP_REM_MIN');
  const deep = latestValue(data, 'SLEEP_DEEP_MIN');
  const light = latestValue(data, 'SLEEP_LIGHT_MIN');
  const awake = latestValue(data, 'SLEEP_AWAKE_MIN');
  if (rem === null && deep === null && light === null && awake === null) return null;

  const raw: Array<{ key: SleepStageSlice['key']; label: SleepStageSlice['label']; minutes: number }> = [
    { key: 'rem', label: 'REM', minutes: Math.max(0, rem ?? 0) },
    { key: 'deep', label: 'Deep sleep', minutes: Math.max(0, deep ?? 0) },
    { key: 'light', label: 'Light sleep', minutes: Math.max(0, light ?? 0) },
    { key: 'awake', label: 'Awake', minutes: Math.max(0, awake ?? 0) },
  ];
  const totalMinutes = raw.reduce((sum, s) => sum + s.minutes, 0);
  const slices: SleepStageSlice[] = raw
    .filter((s) => s.minutes > 0)
    .map((s) => ({
      ...s,
      fraction: totalMinutes > 0 ? s.minutes / totalMinutes : 0,
    }));
  return { slices, totalMinutes };
}

// ─── Sleep need / deficit (drives the Phantom reassurance banner) ────────────

/** Default nightly sleep need (minutes) when the provider gives no personal need. */
export const DEFAULT_SLEEP_NEED_MIN = 480; // 8h

export interface SleepDeficitView {
  /** Total asleep minutes last night (light + deep + REM; excludes awake). */
  asleepMinutes: number;
  needMinutes: number;
  /** Positive when under need, 0 when met or exceeded. */
  deficitMinutes: number;
}

/** Compute last-night sleep vs. need. Returns null when no sleep data. */
export function sleepDeficit(
  data: WearableSamplesResponse | undefined,
  needMinutes: number = DEFAULT_SLEEP_NEED_MIN,
): SleepDeficitView | null {
  const duration = latestValue(data, 'SLEEP_DURATION_MIN');
  let asleep: number | null = duration;
  if (asleep === null) {
    const stages = sleepStages(data);
    if (!stages) return null;
    // Exclude "Awake" from asleep total.
    asleep = stages.slices
      .filter((s) => s.key !== 'awake')
      .reduce((sum, s) => sum + s.minutes, 0);
  }
  const asleepMinutes = Math.max(0, Math.round(asleep));
  const deficitMinutes = Math.max(0, needMinutes - asleepMinutes);
  return { asleepMinutes, needMinutes, deficitMinutes };
}

/** Human "Xh Ym" formatting for a minutes count. */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem} min`;
  if (rem === 0) return `${h}h`;
  return `${h}h ${rem}m`;
}

// ─── Respiration / SpO2 ──────────────────────────────────────────────────────

/** Sustained-low SpO2 threshold (percent). Mirrors HK-4 clinician-referral rule. */
export const SPO2_ATTENTION_THRESHOLD = 90;

export interface RespirationView {
  respiratoryRate: number | null;
  spo2: number | null;
  /** True only when SpO2 is present AND below the clinical-attention threshold. */
  spo2NeedsAttention: boolean;
  respiratoryTrend: TrendPoint[];
  spo2Trend: TrendPoint[];
}

export function respiration(data: WearableSamplesResponse | undefined): RespirationView {
  const spo2 = latestValue(data, 'SPO2_PCT');
  return {
    respiratoryRate: latestValue(data, 'RESPIRATORY_RATE_BRPM'),
    spo2,
    spo2NeedsAttention: spo2 !== null && spo2 < SPO2_ATTENTION_THRESHOLD,
    respiratoryTrend: trendFor(data, 'RESPIRATORY_RATE_BRPM'),
    spo2Trend: trendFor(data, 'SPO2_PCT'),
  };
}

// ─── Sleep consistency (bedtime / wake-time window over 7d) ──────────────────

export interface ConsistencyView {
  /** Spread (minutes) between earliest and latest bedtime across the window. */
  bedtimeSpreadMin: number | null;
  /** Spread (minutes) for wake time. */
  wakeSpreadMin: number | null;
  /** Count of nights with onset data. */
  nights: number;
}

/**
 * Compute bedtime/wake-time consistency from ISO onset/wake series. Each sample
 * value is encoded as minutes-from-midnight by the backend (SLEEP_ONSET_ISO /
 * SLEEP_WAKE_ISO carry a numeric value = local minutes-of-day). We measure the
 * spread (max-min) — a tighter spread means a more settled schedule.
 */
export function sleepConsistency(data: WearableSamplesResponse | undefined): ConsistencyView {
  const onset = seriesFor(data, 'SLEEP_ONSET_ISO');
  const wake = seriesFor(data, 'SLEEP_WAKE_ISO');
  return {
    bedtimeSpreadMin: spread(onset?.samples.map((s) => s.value)),
    wakeSpreadMin: spread(wake?.samples.map((s) => s.value)),
    nights: onset?.samples.length ?? 0,
  };
}

function spread(values: number[] | undefined): number | null {
  if (!values || values.length === 0) return null;
  let min = values[0]!;
  let max = values[0]!;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Math.round(max - min);
}
