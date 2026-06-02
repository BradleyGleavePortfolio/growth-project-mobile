/**
 * wearablesTheme — bucket-scoped presentation tokens + metric metadata for the
 * Health & Fitness / Sleep & Recovery surface.
 *
 * Single source of truth (#40) for:
 *  - the warm (H&F) / cool (S&R) tone pair that drives the shell cross-fade
 *    and the `tone` prop on cards + the Revolut glow chart (§1.4 / §4.2), and
 *  - per-metric display metadata (label, short label, value formatting,
 *    Ionicon) so a card and the Metric Detail screen never disagree on how a
 *    metric reads.
 *
 * Tones are derived from the existing old-money palette in `theme/tokens.ts`
 * (clay/amber warm; forest/slate cool) so they stay coherent with the rest of
 * the app and never introduce a raw off-palette hex.
 */

import { colors, gold, withAlpha } from '../../../theme/tokens';
import type { IoniconName } from '../../../types/common';
import type {
  WearableMetricBucket,
  WearableMetricType,
} from '../../../api/wearablesSamplesApi';

/** Animation timing for the shell bucket cross-fade (brief §1.4: 200ms). */
export const SHELL_CROSSFADE_MS = 200;

/** A bucket's visual tone. `warm` = Health & Fitness, `cool` = Sleep & Recovery. */
export type BucketTone = 'warm' | 'cool';

export interface ToneTokens {
  /**
   * Primary accent for hairline borders, rings, inactive chips, icons, and
   * chart lines — its documented role (warm `camel` is borders-only per
   * tokens.ts). NOT for filled CTAs or on-light text: warm `camel` is only
   * 2.70:1 on bone and 2.54:1 on cream, both below WCAG AA.
   */
  readonly accent: string;
  /**
   * AA-safe foreground (≥4.5:1 vs bone, and on cream) — used as the fill for
   * primary CTAs that carry bone text AND as on-light text/link colour. Warm
   * resolves to gold[700] (#8A6A2A ≈ 5.10:1 bone); cool to forest (8.57:1).
   */
  readonly accentInk: string;
  /** Soft tinted surface behind hero / selected states. */
  readonly tint: string;
  /** Glow color for the Revolut chart's lifted datum. */
  readonly glow: string;
  /** Track / inactive ring color. */
  readonly track: string;
}

const WARM: ToneTokens = {
  accent: colors.camel, // clay/amber warm accent (#B08D57) — borders/icons/lines only
  accentInk: gold[700], // #8A6A2A — bone-on-fill ≈ 5.10:1 (AA PASS)
  tint: withAlpha(colors.camel, 0.1),
  glow: withAlpha(colors.mutedGold, 0.6),
  track: withAlpha(colors.camel, 0.16),
};

const COOL: ToneTokens = {
  accent: colors.forest, // forest/slate cool accent (#2C4A36)
  accentInk: colors.forest, // already AA-safe vs bone (8.57:1) and cream (8.06:1)
  tint: withAlpha(colors.forest, 0.1),
  glow: withAlpha(colors.forest, 0.5),
  track: withAlpha(colors.forest, 0.16),
};

/** Resolve the tone tokens for a tone id. */
export function toneTokens(tone: BucketTone): ToneTokens {
  return tone === 'warm' ? WARM : COOL;
}

/** The tone a bucket renders in. */
export function toneForBucket(bucket: WearableMetricBucket): BucketTone {
  return bucket === 'HEALTH_FITNESS' ? 'warm' : 'cool';
}

/** The bucket an in-shell `?bucket=` route param maps to. */
export function bucketForParam(
  param: 'fitness' | 'recovery' | undefined,
): WearableMetricBucket {
  return param === 'recovery' ? 'SLEEP_RECOVERY' : 'HEALTH_FITNESS';
}

/** The `?bucket=` route param a bucket maps back to. */
export function paramForBucket(
  bucket: WearableMetricBucket,
): 'fitness' | 'recovery' {
  return bucket === 'SLEEP_RECOVERY' ? 'recovery' : 'fitness';
}

// ─── Per-metric presentation ──────────────────────────────────────────────────

/** How a metric's numeric value should be aggregated across a day for display. */
export type MetricSummaryKind = 'sum' | 'avg' | 'latest';

export interface MetricMeta {
  readonly metric: WearableMetricType;
  /** Full human label (Metric Detail header). */
  readonly label: string;
  /** Short label (card titles, chips). */
  readonly shortLabel: string;
  /** Ionicon glyph. */
  readonly icon: IoniconName;
  /** How a day's worth of samples reduces to one headline number. */
  readonly summary: MetricSummaryKind;
  /**
   * Format a raw numeric value for display. Receives the value and the
   * server-provided unit; returns the already-suffixed display string. Kept
   * pure + total (never throws) so a chart label can call it on every frame.
   */
  readonly format: (value: number, unit: string) => string;
}

function round(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—';
  const f = 10 ** digits;
  return String(Math.round(value * f) / f);
}

const integerFmt = (v: number): string =>
  Number.isFinite(v) ? Math.round(v).toLocaleString() : '—';

/**
 * Metric metadata for the metrics this PR surfaces. Health & Fitness metrics
 * are fully specified (this PR owns the H&F screen); Sleep & Recovery metrics
 * are included so the SHARED MetricDetailScreen can render an S&R metric when
 * HK-3b mounts it — HK-3b imports this map and MUST NOT redefine a metric here
 * (single source of truth). A metric absent from this map falls back to a
 * generic presentation (see {@link metricMeta}).
 */
export const METRIC_META: Partial<Record<WearableMetricType, MetricMeta>> = {
  // ── Health & Fitness ──
  STEPS: {
    metric: 'STEPS',
    label: 'Steps',
    shortLabel: 'Steps',
    icon: 'footsteps-outline',
    summary: 'sum',
    format: (v) => integerFmt(v),
  },
  ACTIVE_ENERGY_KCAL: {
    metric: 'ACTIVE_ENERGY_KCAL',
    label: 'Active Energy',
    shortLabel: 'Active kcal',
    icon: 'flame-outline',
    summary: 'sum',
    format: (v) => `${integerFmt(v)} kcal`,
  },
  RESTING_HEART_RATE_BPM: {
    metric: 'RESTING_HEART_RATE_BPM',
    label: 'Resting Heart Rate',
    shortLabel: 'RHR',
    icon: 'heart-outline',
    summary: 'avg',
    format: (v) => `${round(v)} bpm`,
  },
  HEART_RATE_BPM: {
    metric: 'HEART_RATE_BPM',
    label: 'Heart Rate',
    shortLabel: 'HR',
    icon: 'pulse-outline',
    summary: 'avg',
    format: (v) => `${round(v)} bpm`,
  },
  VO2_MAX: {
    metric: 'VO2_MAX',
    label: 'VO₂ Max',
    shortLabel: 'VO₂ Max',
    icon: 'fitness-outline',
    summary: 'latest',
    format: (v) => round(v, 1),
  },
  WORKOUT_DURATION_MIN: {
    metric: 'WORKOUT_DURATION_MIN',
    label: 'Workout Duration',
    shortLabel: 'Exercise',
    icon: 'barbell-outline',
    summary: 'sum',
    format: (v) => `${round(v)} min`,
  },
  WORKOUT_DISTANCE_M: {
    metric: 'WORKOUT_DISTANCE_M',
    label: 'Workout Distance',
    shortLabel: 'Distance',
    icon: 'map-outline',
    summary: 'sum',
    format: (v) =>
      v >= 1000 ? `${round(v / 1000, 2)} km` : `${round(v)} m`,
  },
  TRAINING_LOAD: {
    metric: 'TRAINING_LOAD',
    label: 'Training Load',
    shortLabel: 'Load',
    icon: 'trending-up-outline',
    summary: 'latest',
    format: (v) => round(v),
  },
  BODY_WEIGHT_KG: {
    metric: 'BODY_WEIGHT_KG',
    label: 'Body Weight',
    shortLabel: 'Weight',
    icon: 'body-outline',
    summary: 'latest',
    format: (v) => `${round(v, 1)} kg`,
  },
  BODY_FAT_PCT: {
    metric: 'BODY_FAT_PCT',
    label: 'Body Fat',
    shortLabel: 'Body Fat',
    icon: 'analytics-outline',
    summary: 'latest',
    format: (v) => `${round(v, 1)}%`,
  },
  BLOOD_PRESSURE_SYS: {
    metric: 'BLOOD_PRESSURE_SYS',
    label: 'Blood Pressure (Systolic)',
    shortLabel: 'BP Sys',
    icon: 'speedometer-outline',
    summary: 'latest',
    format: (v) => `${round(v)} mmHg`,
  },
  BLOOD_PRESSURE_DIA: {
    metric: 'BLOOD_PRESSURE_DIA',
    label: 'Blood Pressure (Diastolic)',
    shortLabel: 'BP Dia',
    icon: 'speedometer-outline',
    summary: 'latest',
    format: (v) => `${round(v)} mmHg`,
  },
};

/**
 * Resolve presentation metadata for any metric. Falls back to a safe generic
 * presentation (humanised enum + the server-provided unit) for metrics not in
 * {@link METRIC_META} — so a newly-seeded backend metric renders sanely rather
 * than crashing the Metric Detail screen.
 */
export function metricMeta(metric: WearableMetricType): MetricMeta {
  const known = METRIC_META[metric];
  if (known) return known;
  const label = metric
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return {
    metric,
    label,
    shortLabel: label,
    icon: 'stats-chart-outline',
    summary: 'latest',
    format: (v, unit) => (unit ? `${round(v, 1)} ${unit}` : round(v, 1)),
  };
}
