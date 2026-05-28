/**
 * coachAIBudget — DTO + threshold logic for the AI budget meter.
 *
 * Consumer of `GET /coach/ai/budget` from the backend (Stream 1).
 * Locked numbers (per operator override 2026-05-28):
 *   - Base displayed allowance: $125 ($12500 cents)
 *   - Multiplier: 3.125× (backend concern — mobile only consumes the DTO)
 *   - Pack tiers: $10 / $25 / $99 / Custom (min $10, max $500)
 *
 * Surface thresholds (spec §4):
 *   0–59%   → hidden meter
 *   60–79%  → subtle chip on Coach Home
 *   80–94%  → BLOCKING forced 4-card tutorial walkthrough (operator override)
 *   95–99%  → persistent banner + 1× push (AI_BUDGET_95_WARNING)
 *   100%+   → hard-pause modal (blocks AI features)
 *
 * The DTO mirrors the backend types in
 * `canonical_docs/STREAM_1_AI_CREDITS_SPEC.md` §5. `value_multiplier` arrives
 * as a string (Decimal safety on the wire) — mobile does not parse it because
 * displayed cents are precomputed by the backend.
 */

/** Wire shape of `GET /coach/ai/budget`. */
export interface CoachAIBudgetResponse {
  period_start: string; // ISO8601
  period_end: string; // ISO8601

  // Displayed numbers (cents shown to the coach)
  base_displayed_cents: number; // 12500 ($125)
  pack_displayed_cents: number;
  total_displayed_cents: number;

  used_displayed_cents: number;
  remaining_displayed_cents: number;

  /** 0-100. May exceed 100 transiently if the backend's race-guard logs an overshoot. */
  pct_used: number;

  // Internal numbers (exposed for debugging; UI does not display these)
  base_actual_cents: number;
  /** Decimal as string ("3.125") — never parse, used only for diagnostics. */
  value_multiplier: string;
  actual_used_cents: number;

  // Pack options the UI should render
  pack_options_cents: number[]; // e.g. [1000, 2500, 9900]
  custom_pack_bounds_cents: { min: number; max: number };
}

/** Discrete surface state derived from `pct_used`. Each state maps 1:1 to UI. */
export type BudgetSurface =
  | 'hidden' // < 60%
  | 'chip' // 60-79%
  | 'tutorial' // 80-94% (BLOCKING forced walkthrough)
  | 'banner' // 95-99%
  | 'paused'; // ≥ 100%

/**
 * Map a budget response to its surface state. Centralized so both the meter
 * and the Coach Home mount logic agree on the same thresholds.
 *
 * Boundaries are inclusive at the lower bound (per spec §4 table). Treat
 * `pct_used >= 100` as paused — the backend may surface 100.1 transiently
 * on the race-overshoot path, and the UI MUST refuse to fall back through
 * the banner state in that case.
 *
 * Null-safe: if no budget is loaded yet (or the fetch failed) we return
 * 'hidden' so the meter does not flash a wrong state on cold start.
 */
export function surfaceFor(budget: CoachAIBudgetResponse | null | undefined): BudgetSurface {
  if (!budget) return 'hidden';
  const pct = budget.pct_used;
  if (pct >= 100) return 'paused';
  if (pct >= 95) return 'banner';
  if (pct >= 80) return 'tutorial';
  if (pct >= 60) return 'chip';
  return 'hidden';
}

/**
 * Format cents → `$X` (no decimals if whole dollar, two decimals otherwise).
 * Uses `Intl.NumberFormat` to avoid the 50-Failures #41 "Vanilla Style"
 * trap of hand-rolling currency formatters. The currency / locale are
 * pinned to en-US / USD because TGP is US-only at launch.
 */
const USD_WHOLE = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const USD_CENTS = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCents(cents: number): string {
  const dollars = cents / 100;
  if (Number.isInteger(dollars)) return USD_WHOLE.format(dollars);
  return USD_CENTS.format(dollars);
}

/** Cap pct_used at 100 for display purposes — overshoot is a backend signal,
 *  not something the user should see on the meter ring. */
export function clampPctForDisplay(pct: number): number {
  if (Number.isNaN(pct) || pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}
