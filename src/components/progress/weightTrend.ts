/** C8 v2: pounds in, full-history trend out. Filter periods AFTER smoothing. */
export const WEIGHT_DAY = 86_400_000;
export type WeightPeriod = '7D' | '30D' | 'All';
export interface WeightSample { x: number; y: number; pending?: boolean }
export interface WeightTrendDay {
  x: number; y: number; low: number; high: number;
  weight?: number; pending?: boolean; gap: boolean; count: number;
}
const day = (x: number) => Math.floor(x / WEIGHT_DAY) * WEIGHT_DAY;

export function weightTrend(samples: WeightSample[], through = Date.now()): WeightTrendDay[] {
  // One reading per day: the latest entry wins, matching the weigh-in list.
  const readings = new Map<number, WeightSample>();
  [...samples].sort((a, b) => a.x - b.x).forEach((p) => readings.set(day(p.x), p));
  const entries = [...readings.entries()];
  if (!entries.length) return [];
  const result: WeightTrendDay[] = [];
  const residuals: number[] = [];
  let trend = entries[0][1].y;
  entries.forEach(([x, p], i) => {
    if (i) trend += 0.1 * (p.y - trend);
    residuals.push(Math.abs(p.y - trend));
    if (residuals.length > 14) residuals.shift();
    const radius = Math.max(i < 3 ? 0.6 : 0.4, residuals.reduce((a, b) => a + b, 0) / residuals.length);
    const next = entries[i + 1]?.[0] ?? Math.max(x, day(through)) + WEIGHT_DAY;
    const missing = (next - x) / WEIGHT_DAY - 1;
    result.push({ x, y: trend, low: trend - radius, high: trend + radius,
      weight: p.y, pending: p.pending, count: i + 1,
      gap: i > 0 && x - entries[i - 1][0] >= 4 * WEIGHT_DAY });
    for (let t = x + WEIGHT_DAY; t < next; t += WEIGHT_DAY) {
      result.push({ x: t, y: trend, low: trend - radius, high: trend + radius,
        count: i + 1, gap: missing >= 3 });
    }
  });
  return result;
}

export function weightPeriod(days: WeightTrendDay[], period: WeightPeriod): WeightTrendDay[] {
  if (period === 'All' || !days.length) return days;
  const start = days[days.length - 1].x - ((period === '7D' ? 7 : 30) - 1) * WEIGHT_DAY;
  return days.filter((p) => p.x >= start);
}

/** Whole-pound ticks, never zero-based or magnified around a flat series. */
export function weightDomain(days: WeightTrendDay[], step: number, band: boolean, goal?: number): [number, number] {
  const values = days.flatMap((p) => [p.y, p.weight ?? p.y, ...(band ? [p.low, p.high] : [])]);
  if (goal != null) values.push(goal);
  if (!values.length) return [step, step * 3];
  return [Math.floor(Math.min(...values) / step) * step - step,
    Math.ceil(Math.max(...values) / step) * step + step];
}
