/**
 * coachAIBudget — surface logic + formatter tests.
 *
 * Covers the threshold table from STREAM_1_AI_CREDITS_SPEC.md §4. Each row
 * in the table is one test: pct_used boundaries map deterministically to a
 * single surface state. If the operator ever moves the 80%/95%/100% knobs
 * one of these tests will fail loudly.
 */

import {
  surfaceFor,
  formatCents,
  clampPctForDisplay,
  type CoachAIBudgetResponse,
} from '../coachAIBudget';

function makeBudget(pct: number): CoachAIBudgetResponse {
  return {
    period_start: '2026-05-01T00:00:00Z',
    period_end: '2026-06-01T00:00:00Z',
    base_displayed_cents: 12500,
    pack_displayed_cents: 0,
    total_displayed_cents: 12500,
    used_displayed_cents: Math.round((pct / 100) * 12500),
    remaining_displayed_cents: Math.round(((100 - pct) / 100) * 12500),
    pct_used: pct,
    base_actual_cents: 4000,
    value_multiplier: '3.125',
    actual_used_cents: Math.round((pct / 100) * 4000),
    pack_options_cents: [1000, 2500, 9900],
    custom_pack_bounds_cents: { min: 1000, max: 50000 },
  };
}

describe('surfaceFor — spec §4 threshold table', () => {
  it('returns "hidden" when the budget is null or undefined', () => {
    expect(surfaceFor(null)).toBe('hidden');
    expect(surfaceFor(undefined)).toBe('hidden');
  });

  it.each([
    [0, 'hidden'],
    [25, 'hidden'],
    [59.9, 'hidden'],
    [60, 'chip'],
    [79.9, 'chip'],
    [80, 'tutorial'],
    [94.9, 'tutorial'],
    [95, 'banner'],
    [99.9, 'banner'],
    [100, 'paused'],
    [105, 'paused'], // backend race-overshoot
  ])('pct_used=%s → %s surface', (pct, expected) => {
    expect(surfaceFor(makeBudget(pct))).toBe(expected);
  });
});

describe('formatCents — Intl-based currency formatter', () => {
  it('renders whole-dollar amounts without trailing zeros', () => {
    expect(formatCents(12500)).toBe('$125');
    expect(formatCents(1000)).toBe('$10');
    expect(formatCents(0)).toBe('$0');
  });

  it('renders sub-dollar precision when needed', () => {
    expect(formatCents(125)).toBe('$1.25');
    expect(formatCents(9999)).toBe('$99.99');
  });
});

describe('clampPctForDisplay', () => {
  it('clamps negatives to 0 and overshoot to 100', () => {
    expect(clampPctForDisplay(-5)).toBe(0);
    expect(clampPctForDisplay(105.7)).toBe(100);
    expect(clampPctForDisplay(NaN)).toBe(0);
  });

  it('passes through valid values', () => {
    expect(clampPctForDisplay(0)).toBe(0);
    expect(clampPctForDisplay(62.5)).toBe(62.5);
    expect(clampPctForDisplay(100)).toBe(100);
  });
});
