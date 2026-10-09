/**
 * Progress copy helpers (REDO-PROGRESS-133). Sentences, not labels; numbers
 * only from real entries. Weights are pounds (the server stores weight_lbs).
 */
export type Period = '7D' | '30D' | '90D' | 'All';
export const PERIODS: Period[] = ['7D', '30D', '90D', 'All'];

/** 183 -> "183", 182.44 -> "182.4" (one decimal only when it carries one). */
export function formatWeight(lbs: number): string {
  const r = Math.round(lbs * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

const PERIOD_WORDS: Record<Exclude<Period, 'All'>, string> = {
  '7D': 'over the last 7 days',
  '30D': 'over the last 30 days',
  '90D': 'over the last 90 days',
};

/**
 * The line under the chart: what the period's own entries say, nothing more.
 * Needs two entries in the period; "All" reads from the first weigh-in.
 */
export function periodSummary(
  first: number,
  last: number,
  period: Period,
  since: string | null,
): { headline: string; detail: string } {
  const delta = Math.round((last - first) * 10) / 10;
  const detail =
    period === 'All'
      ? since ? since.replace(/^Since/, 'since') : 'since the first weigh-in'
      : PERIOD_WORDS[period];
  if (delta === 0) return { headline: 'Steady', detail };
  return { headline: `${delta < 0 ? 'Down' : 'Up'} ${formatWeight(Math.abs(delta))} lb`, detail };
}
