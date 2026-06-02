/**
 * seriesSummary — pure helpers that reduce a `SampleSeries` (or its aggregated
 * `buckets`) into the headline numbers + sparkline points the cards render.
 *
 * Kept pure + total (never throw) and exported so the cards stay declarative
 * and the reductions are unit-tested in isolation (#17 — real assertions on
 * real reducers, not snapshot theatre).
 */

import type { SampleSeries } from '../../../api/wearablesSamplesApi';
import type { MetricSummaryKind } from './wearablesTheme';

export interface SparkPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The chronologically-ordered numeric series for a metric, preferring the
 * server-aggregated `buckets` (one point per hour/day) when present, else the
 * raw samples. Returns `[]` when there is no data.
 */
export function seriesPoints(series: SampleSeries | undefined): SparkPoint[] {
  if (!series) return [];
  if (series.buckets && series.buckets.length > 0) {
    return series.buckets.map((b, i) => ({
      x: Date.parse(b.bucket_start) || i,
      y: b.agg,
    }));
  }
  return series.samples.map((s, i) => ({
    x: Date.parse(s.start_at) || i,
    y: s.value,
  }));
}

/**
 * Reduce a metric's points to its single headline value per its summary kind:
 *   - sum    → total over the window (steps, active kcal, exercise minutes)
 *   - avg    → mean (heart rates)
 *   - latest → most-recent value (weight, body fat, VO2 max)
 * Returns `null` when there is no data — the caller renders a value-first
 * prompt rather than a fake zero.
 */
export function summariseValue(
  points: readonly SparkPoint[],
  kind: MetricSummaryKind,
): number | null {
  if (points.length === 0) return null;
  switch (kind) {
    case 'sum':
      return points.reduce((acc, p) => acc + p.y, 0);
    case 'avg':
      return points.reduce((acc, p) => acc + p.y, 0) / points.length;
    case 'latest':
      // points are chronological; the last point is the most recent.
      return points[points.length - 1].y;
    default:
      return null;
  }
}

/**
 * The change between the first and last point (for "↑ 3% vs start" style
 * deltas). Returns `null` when fewer than two points or a zero baseline.
 */
export function deltaPct(points: readonly SparkPoint[]): number | null {
  if (points.length < 2) return null;
  const first = points[0].y;
  const last = points[points.length - 1].y;
  if (first === 0) return null;
  return ((last - first) / Math.abs(first)) * 100;
}

/** Clamp a value/goal ratio to 0..1 for a progress ring (goal<=0 → 0). */
export function ringProgress(value: number | null, goal: number): number {
  if (value === null || goal <= 0) return 0;
  return Math.max(0, Math.min(1, value / goal));
}
