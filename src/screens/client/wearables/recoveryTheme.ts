/**
 * recoveryTheme — Sleep & Recovery (S&R) bucket visual identity.
 *
 * Per UNIFIED_BUILD_PLAN §1.4 "Visual identity": S&R uses a COOL indigo→slate
 * palette with a deep/dark luminance and a slow ~480ms breathing motion, in
 * contrast to H&F's warm amber→ember. The two buckets share skeleton/type/
 * spacing and differ only in accent/motion/luminance.
 *
 * Bradley LAW (S&R): a low recovery / low HRV value is NEVER rendered red. We
 * desaturate toward slate instead, and the only escalation colour permitted is
 * a SOFT AMBER — used solely when an absolute clinical-attention threshold is
 * crossed (e.g. SpO2 sustained < 90%), never for "low score" framing.
 *
 * These tokens are local to the S&R screens (bucket accent layer) and compose
 * ON TOP of the app `ThemeColors` surface/text tokens — they intentionally do
 * not live in the global theme, which is warm/old-money by brand.
 */

import type { ThemeColors } from '../../../theme/ThemeProvider';

export interface RecoveryPalette {
  /** Primary cool accent (indigo). Used for ring fill at healthy recovery. */
  accent: string;
  /** Muted cool accent (slate) — used as the desaturated low-recovery fill. */
  accentMuted: string;
  /** Track/background for the ring + bars (cool, low-luminance). */
  track: string;
  /** Soft amber — clinical-attention ONLY. Never for generic low scores. */
  attention: string;
  /** Cool tint for card surfaces layered over the theme surface. */
  surfaceTint: string;
}

export const RECOVERY_PALETTE: RecoveryPalette = {
  accent: '#5B6CB8', // indigo
  accentMuted: '#7E879E', // slate (desaturated, NOT red)
  track: '#E5E7EF',
  attention: '#C99A52', // soft amber
  surfaceTint: '#F4F5FA',
};

/**
 * Recovery state buckets driven by the recovery/readiness score. We map a 0-100
 * score to a plain-language label + a COOL colour. The lowest band is slate
 * (desaturated), explicitly NOT red, per the CALM treatment.
 */
export type RecoveryState = 'recovered' | 'recovering' | 'run_down' | 'unknown';

export interface RecoveryStateView {
  state: RecoveryState;
  /** Plain-language headline shown beside the number (never a number alone). */
  label: string;
  /** Cool ring/fill colour for this state. */
  color: (palette: RecoveryPalette) => string;
}

/**
 * Resolve a recovery state from a 0-100 score. `null` (no data) → 'unknown'.
 * Thresholds mirror the common readiness banding (≥67 recovered, 34-66
 * recovering, <34 run-down) but the COPY stays reassurance-first.
 */
export function resolveRecoveryState(score: number | null): RecoveryStateView {
  if (score === null || Number.isNaN(score)) {
    return {
      state: 'unknown',
      label: 'Recovery',
      color: (p) => p.accentMuted,
    };
  }
  if (score >= 67) {
    return { state: 'recovered', label: 'Recovered', color: (p) => p.accent };
  }
  if (score >= 34) {
    return { state: 'recovering', label: 'Recovering', color: (p) => p.accent };
  }
  // Low recovery — desaturated slate, reassurance-first label. NEVER red.
  return { state: 'run_down', label: 'Run-down', color: (p) => p.accentMuted };
}

/** Convenience: the card surface colour, blending theme surface with cool tint. */
export function recoverySurface(colors: ThemeColors): string {
  return colors.surface;
}
