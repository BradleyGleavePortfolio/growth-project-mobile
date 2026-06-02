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

import { brand, colors, gold, withAlpha } from '../../../theme/tokens';
import type { IoniconName } from '../../../types/common';
import type {
  WearableMetricBucket,
  WearableMetricType,
} from '../../../api/wearablesSamplesApi';

/** Animation timing for the shell bucket cross-fade (brief §1.4: 200ms). */
export const SHELL_CROSSFADE_MS = 200;

/** A bucket's visual tone. `warm` = Health & Fitness, `cool` = Sleep & Recovery. */
export type BucketTone = 'warm' | 'cool';

/** Resolved colour scheme the tone tokens are tuned for. */
export type ToneScheme = 'light' | 'dark';

export interface ToneTokens {
  /**
   * Primary accent for hairline borders, rings, inactive chips, icons, and
   * chart lines — its documented role (warm `camel` is borders-only per
   * tokens.ts). NOT for filled CTAs or on-light text: warm `camel` is only
   * 2.70:1 on bone and 2.54:1 on cream, both below WCAG AA.
   *
   * Scheme-reactive: on the dark card surface (`bgSurface #1C1A18`) the cool
   * `forest #2C4A36` icon is only 1.77:1 (below the 3:1 UI-component
   * threshold), so dark COOL lifts to `brand[300] #6E9479` (5.10:1). Warm
   * `camel #B08D57` already clears 3:1 on dark (5.61:1) and is preserved.
   */
  readonly accent: string;
  /**
   * CTA-fill colour: the background behind the primary CTA's `textOnAccent`
   * label. This pairing passes AA in BOTH schemes (warm 7.13:1 / cool 9.19:1
   * with the near-white label) so it is held static across schemes. NOT for
   * on-surface text/border — use {@link onSurfaceInk} for those.
   */
  readonly accentInk: string;
  /**
   * On-surface ink: the foreground used for text/border affordances drawn
   * directly on the card surface (Retry text+border, Read more/Show less).
   * Scheme-reactive against `bgSurface` so it clears AA in both modes:
   *  - light: warm `gold[800] #6B4F1A` (7.49:1 on bone) / cool `forest`
   *    (9.65:1) — preserves the prior light appearance.
   *  - dark: warm `gold[300] #D4B96B` (9.05:1 on #1C1A18) / cool
   *    `brand[300] #6E9479` (5.10:1) — the prior static inks failed dark
   *    (warm 2.28:1 / cool 1.77:1).
   */
  readonly onSurfaceInk: string;
  /** Soft tinted surface behind hero / selected states. */
  readonly tint: string;
  /** Glow color for the Revolut chart's lifted datum. */
  readonly glow: string;
  /** Track / inactive ring color. */
  readonly track: string;
}

/** Light-mode base for the warm (Health & Fitness) tone. */
const WARM_LIGHT: ToneTokens = {
  accent: colors.camel, // clay/amber warm accent (#B08D57) — borders/icons/lines only
  // CTA fill behind bone text (7.13:1 with textOnAccent).
  accentInk: gold[800], // #6B4F1A
  // On-surface ink: 7.49:1 on bone — preserves prior light text appearance.
  onSurfaceInk: gold[800], // #6B4F1A
  tint: withAlpha(colors.camel, 0.1),
  glow: withAlpha(colors.mutedGold, 0.6),
  track: withAlpha(colors.camel, 0.16),
};

/** Light-mode base for the cool (Sleep & Recovery) tone. */
const COOL_LIGHT: ToneTokens = {
  accent: colors.forest, // forest/slate cool accent (#2C4A36)
  accentInk: colors.forest, // CTA fill behind bone text (9.19:1 with textOnAccent)
  onSurfaceInk: colors.forest, // 9.65:1 on bone — preserves prior light text appearance
  tint: withAlpha(colors.forest, 0.1),
  glow: withAlpha(colors.forest, 0.5),
  track: withAlpha(colors.forest, 0.16),
};

/**
 * Dark-scheme overrides, merged over the light base. Only the slots whose AA
 * verdict changes on the dark card surface (`bgSurface #1C1A18`) are listed;
 * `accentInk` (CTA fill) and the alpha-derived tint/glow/track stay put.
 *
 *  - `onSurfaceInk`: the prior static inks fail dark (warm 2.28:1, cool
 *    1.77:1); lifted to `gold[300]` (9.05:1) / `brand[300]` (5.10:1).
 *  - `accent`: cool `forest` icon is 1.77:1 on dark (below 3:1), lifted to
 *    `brand[300]` (5.10:1). Warm `camel` is 5.61:1 on dark and is kept. The
 *    chip-tint composite (accent @ 0.1 over the dark surface) still passes
 *    because a lighter accent over a dark bg only raises its contrast.
 */
const WARM_DARK: Partial<ToneTokens> = {
  onSurfaceInk: gold[300], // #D4B96B — 9.05:1 on #1C1A18
};

const COOL_DARK: Partial<ToneTokens> = {
  accent: brand[300], // #6E9479 — 5.10:1 on #1C1A18 (forest was 1.77:1)
  onSurfaceInk: brand[300], // #6E9479 — 5.10:1 on #1C1A18
};

/**
 * Resolve the tone tokens for a tone id and the resolved colour scheme. Callers
 * get a single object with the right values for the current scheme: the dark
 * overrides above are merged over the light base so on-surface affordances
 * clear WCAG AA against the dark card surface.
 */
export function toneTokens(
  tone: BucketTone,
  colorScheme: ToneScheme = 'light',
): ToneTokens {
  if (tone === 'warm') {
    return colorScheme === 'dark' ? { ...WARM_LIGHT, ...WARM_DARK } : WARM_LIGHT;
  }
  return colorScheme === 'dark' ? { ...COOL_LIGHT, ...COOL_DARK } : COOL_LIGHT;
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
