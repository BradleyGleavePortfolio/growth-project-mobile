/**
 * seriesSummary — real assertions on the pure reducers (#17: no snapshot
 * theatre; we assert the actual numbers and the null-on-empty contract).
 */

import {
  seriesPoints,
  summariseValue,
  deltaPct,
  ringProgress,
} from '../seriesSummary';
import type { SampleSeries } from '../../../../api/wearablesSamplesApi';

function series(partial: Partial<SampleSeries>): SampleSeries {
  return {
    metric: 'STEPS',
    unit: 'count',
    provider_used: 'APPLE_HEALTHKIT',
    sample_count: 0,
    samples: [],
    ...partial,
  } as SampleSeries;
}

describe('seriesPoints', () => {
  it('returns [] for undefined or empty series', () => {
    expect(seriesPoints(undefined)).toEqual([]);
    expect(seriesPoints(series({}))).toEqual([]);
  });

  it('prefers aggregated buckets over raw samples when present', () => {
    const s = series({
      samples: [
        { start_at: '2026-01-01T00:00:00.000Z', end_at: '2026-01-01T01:00:00.000Z', value: 1, provider: 'APPLE_HEALTHKIT' },
      ],
      buckets: [
        { bucket_start: '2026-01-01T00:00:00.000Z', bucket_end: '2026-01-02T00:00:00.000Z', agg: 5000, count: 24 },
        { bucket_start: '2026-01-02T00:00:00.000Z', bucket_end: '2026-01-03T00:00:00.000Z', agg: 7000, count: 24 },
      ],
    });
    const pts = seriesPoints(s);
    expect(pts).toHaveLength(2);
    expect(pts.map((p) => p.y)).toEqual([5000, 7000]);
  });

  it('falls back to raw samples when no buckets', () => {
    const s = series({
      samples: [
        { start_at: '2026-01-01T00:00:00.000Z', end_at: '2026-01-01T01:00:00.000Z', value: 10, provider: 'OURA' },
        { start_at: '2026-01-02T00:00:00.000Z', end_at: '2026-01-02T01:00:00.000Z', value: 20, provider: 'OURA' },
      ],
    });
    expect(seriesPoints(s).map((p) => p.y)).toEqual([10, 20]);
  });
});

describe('summariseValue', () => {
  const pts = [
    { x: 1, y: 2 },
    { x: 2, y: 4 },
    { x: 3, y: 6 },
  ];
  it('sums', () => expect(summariseValue(pts, 'sum')).toBe(12));
  it('averages', () => expect(summariseValue(pts, 'avg')).toBe(4));
  it('takes latest', () => expect(summariseValue(pts, 'latest')).toBe(6));
  it('returns null on empty (never a fake zero)', () => {
    expect(summariseValue([], 'sum')).toBeNull();
    expect(summariseValue([], 'avg')).toBeNull();
    expect(summariseValue([], 'latest')).toBeNull();
  });
});

describe('deltaPct', () => {
  it('returns null for <2 points or zero baseline', () => {
    expect(deltaPct([])).toBeNull();
    expect(deltaPct([{ x: 1, y: 5 }])).toBeNull();
    expect(deltaPct([{ x: 1, y: 0 }, { x: 2, y: 9 }])).toBeNull();
  });
  it('computes signed percent change first→last', () => {
    expect(deltaPct([{ x: 1, y: 100 }, { x: 2, y: 150 }])).toBeCloseTo(50);
    expect(deltaPct([{ x: 1, y: 100 }, { x: 2, y: 75 }])).toBeCloseTo(-25);
  });
});

describe('ringProgress', () => {
  it('clamps to 0..1 and guards null / non-positive goal', () => {
    expect(ringProgress(null, 100)).toBe(0);
    expect(ringProgress(50, 0)).toBe(0);
    expect(ringProgress(50, 100)).toBe(0.5);
    expect(ringProgress(250, 100)).toBe(1);
    expect(ringProgress(-10, 100)).toBe(0);
  });
});
