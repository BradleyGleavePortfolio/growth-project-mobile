import { WEIGHT_DAY as D, weightDomain, weightPeriod, weightSegments, weightTrend } from '../weightTrend';
const sample = (d: number, y: number, pending = false) => ({ x: d * D, y, pending });

it('seeds the first reading and moves exactly a tenth on weigh-in days only', () => {
  const days = weightTrend([sample(1, 170), sample(3, 180), sample(4, 160)], 4 * D);
  expect(days.map((p) => p.y)).toEqual([170, 170, 171, 169.9]);
  expect(days[0]).toMatchObject({ count: 1, weight: 170, low: 169.4, high: 170.6 });
});
it('uses the mean absolute residual of the last 14 readings, with the two floors', () => {
  const flat = weightTrend(Array.from({ length: 20 }, (_, i) => sample(i + 1, 170)), 20 * D);
  expect(flat.slice(0, 3).every((p) => p.high - p.y > 0.59)).toBe(true);
  expect(flat[3].high - flat[3].y).toBeCloseTo(0.4);
  const days = weightTrend(Array.from({ length: 16 }, (_, i) => sample(i + 1, 170 + i)), 16 * D);
  const mean = days.slice(-14).reduce((s, p) => s + Math.abs(p.weight! - p.y), 0) / 14;
  expect(days[15].high - days[15].y).toBeCloseTo(mean);
});
it.each([1, 2, 3, 7])('marks %i missing days only at the three-day threshold', (missing) => {
  const days = weightTrend([sample(1, 170), sample(missing + 2, 168)], (missing + 2) * D);
  expect(days.slice(1).every((p) => p.gap === (missing >= 3))).toBe(true);
});
it('carries a missed week through today without moving or resetting the trend', () => {
  const days = weightTrend([sample(1, 170), sample(2, 169)], 9 * D);
  expect(days.slice(2).every((p) => p.y === 169.9 && p.gap && p.weight == null)).toBe(true);
  const runs = weightSegments(days);
  expect(runs.map((r) => r.gap)).toEqual([false, true]);
  expect(runs[1].points).toHaveLength(8);
});
it('sorts without mutation and uses the last same-day reading and pending state', () => {
  const samples = [sample(2, 180), sample(1, 170), { x: 2 * D + 1, y: 172, pending: true }];
  expect(weightTrend(samples, 2 * D)[1]).toMatchObject({ y: 170.2, weight: 172, pending: true });
  expect(samples[0].y).toBe(180);
});
it('returns no invented readings for empty input', () => expect(weightTrend([])).toEqual([]));
it('filters after full-history smoothing, not a fresh seed at each period', () => {
  const days = weightTrend([sample(1, 180), sample(25, 170)], 31 * D);
  expect(weightPeriod(days, '7D')).toHaveLength(7);
  expect(weightPeriod(days, '30D')).toHaveLength(30);
  expect(weightPeriod(days, '7D')[0].y).toBe(179);
  expect(weightPeriod(days, 'All')).toBe(days);
  expect(weightDomain(days, 2, true, 165)).toEqual([162, 184]);
});
