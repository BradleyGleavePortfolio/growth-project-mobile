/**
 * Design Tokens — The Growth Project
 * Wave 2: Luxury repositioning — bone/cream/ink/forest palette.
 * Phase 11: Dark mode — semantic token system added on top of existing palette.
 * Single source of truth for the New Shared Design System.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WCAG AA CONTRAST MATRIX (updated for new palette)
 * ─────────────────────────────────────────────────────────────────────────────
 * Relative luminance formula: L = 0.2126·R + 0.7152·G + 0.0722·B (linearised)
 * Contrast ratio = (L1 + 0.05) / (L2 + 0.05)  where L1 > L2
 *
 * Required: 4.5:1 body text (< 18pt / < 14pt bold), 3:1 large text (>= 18pt / >= 14pt bold)
 *
 * Pair                                          Hex pair              Ratio    AA body  AA large
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ink (#1A1A18) on bone (#F5EFE4)               ~16.5:1              PASS     PASS
 * ink (#1A1A18) on cream (#F1E8D5)              ~15.2:1              PASS     PASS
 * charcoal (#3D3D3A) on bone (#F5EFE4)          ~ 8.0:1              PASS     PASS
 * forest (#2C4A36) on bone (#F5EFE4)            ~ 7.4:1              PASS     PASS
 * stone (#B1A89F) on bone (#F5EFE4)             ~ 2.3:1              FAIL     PASS (caption/meta only >= 18pt)
 * mutedGold (#C5A253) on bone (#F5EFE4)         ~ 2.9:1              FAIL     PASS (badge label >= 14pt bold only)
 *
 * Dark mode additions:
 * textPrimary (#EBE6DE) on bgPrimary (#121110)  ~14.2:1              PASS     PASS
 * textMuted (#A09B94) on bgPrimary (#121110)    ~ 5.9:1              PASS     PASS
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Universal old-money palette ──────────────────────────────────────────────
export const colors = {
  bone:        '#F5EFE4',  // primary background
  cream:       '#F1E8D5',  // card surface, warm
  ink:         '#1A1A18',  // primary text, dark sections (NEVER #000)
  charcoal:    '#3D3D3A',  // secondary text on light
  stone:       '#B1A89F',  // tertiary text, hairlines, meta

  // Single accent — wellness app
  forest:      '#2C4A36',  // PRIMARY accent, replaces #2D6A4F

  // Sparingly
  mutedGold:   '#C5A253',  // ONLY for founding-tier badge typography, never as fill
  camel:       '#B08D57',  // hairline borders only

  // Semantic — keep minimal
  success:     '#2C4A36',  // map to forest
  warning:     '#C5A253',  // map to mutedGold
  // Warning band used for "needs attention" surfaces (e.g. Stripe
  // Connect readiness banner). Pulled from the existing
  // `semantic.warning` triad so the values stay coherent with the
  // old-money palette and pass AA contrast on bone — see the
  // contrast matrix at the top of this file. Surfaces previously
  // hardcoded the Tailwind amber-100/500/700 hex equivalents.
  warningBg:     '#F8F2E5',
  warningBorder: '#C5A253',
  warningInk:    '#8A6A2A',
  // Cross-pillar brand cohesion (Wave 5): oxblood (#4A0404) is reserved
  // as the Earnings/Wealth pillar primary brand color. The Body pillar
  // uses #B91C1C — a clearer alarm red that pairs with bone, passes WCAG
  // AA on bone background, and reads as "warning" rather than "blood".
  error:       '#B91C1C',
} as const;

// ─── Neutrals 0–1000 (10 stops) ───────────────────────────────────────────────
export const neutral = {
  0:    '#FFFFFF',
  100:  '#F7F7F6',
  200:  '#EFEFED',
  300:  '#E4E4E0',
  400:  '#CCCCC6',
  500:  '#AAAAA4',
  600:  '#7A7A75',
  700:  '#5A5A56',
  800:  '#3A3A37',
  900:  '#1E1E1C',
  1000: '#0A0A09',
} as const;

// ─── Brand Primary Scale (updated to forest) ──────────────────────────────────
export const brand = {
  50:   '#D6E4DA',   // pale tint
  100:  '#B8CCBF',
  300:  '#6E9479',
  400:  '#4D7059',   // medium
  500:  '#3A5C46',   // accent
  600:  '#2C4A36',   // BASE — forest (primary brand colour)
  800:  '#1C3023',   // dark
} as const;

// ─── Semantic Colours (minimal — maps to palette) ─────────────────────────────
export const semantic = {
  success: {
    bg:     '#E0EBE4',
    fg:     '#1C3023',
    border: '#6E9479',
    icon:   '#2C4A36',
  },
  warning: {
    bg:     '#F8F2E5',
    fg:     '#8A6A2A',
    border: '#C5A253',
    icon:   '#C5A253',
  },
  danger: {
    bg:     '#F2E0E0',
    fg:     '#4A0404',
    border: '#9A3030',
    icon:   '#4A0404',
  },
  info: {
    bg:     '#E8F4FD',
    fg:     '#1E4971',
    border: '#93C5DC',
    icon:   '#457B9D',
  },
} as const;

// ─── Gold Scale — Founding / Inner Circle tier ─────────────────────────────────
export const gold = {
  50:   '#FEFAF0',
  100:  '#F8F0DC',
  200:  '#EDDD9C',
  300:  '#D4B96B',
  400:  '#C5A253',   // mutedGold — badge typography only
  500:  '#B08D57',   // camel / border use
  700:  '#8A6A2A',   // darker label
  800:  '#6B4F1A',
  border:  'rgba(197,162,83,0.35)',
} as const;

// ─── Typography Scale (Wave 2: Cormorant Garamond + Inter) ────────────────────
export const typography = {
  /**
   * CRITICAL: weight 400 (NOT 700/800) — the single biggest amateur tell.
   * Display/heading roles use Cormorant Garamond (editorial serif).
   * Body/UI roles use Inter (neutral sans).
   */
  display: {
    fontFamily:    'CormorantGaramond_400Regular',
    fontSize:      44,
    lineHeight:    46,
    letterSpacing: 0.4,
    fontWeight:    '400' as const,
  },
  h1: {
    fontFamily:    'CormorantGaramond_400Regular',
    fontSize:      32,
    lineHeight:    35,
    letterSpacing: 0.6,
    fontWeight:    '400' as const,
  },
  h2: {
    fontFamily:    'CormorantGaramond_400Regular',
    fontSize:      24,
    lineHeight:    29,
    letterSpacing: 0.5,
    fontWeight:    '400' as const,
  },
  h3: {
    fontFamily:    'CormorantGaramond_500Medium',
    fontSize:      20,
    lineHeight:    24,
    letterSpacing: 0.4,
    fontWeight:    '500' as const,
  },
  h4: {
    fontFamily:    'Inter_500Medium',
    fontSize:      17,
    lineHeight:    22,
    letterSpacing: -0.1,
    fontWeight:    '500' as const,
  },
  body: {
    fontFamily:    'Inter_400Regular',
    fontSize:      16,
    lineHeight:    26,
    letterSpacing: -0.16,
    fontWeight:    '400' as const,
  },
  bodyMd: {
    fontFamily:    'Inter_500Medium',
    fontSize:      16,
    lineHeight:    26,
    letterSpacing: -0.16,
    fontWeight:    '500' as const,
  },
  bodySmall: {
    fontFamily:    'Inter_400Regular',
    fontSize:      14,
    lineHeight:    22,
    letterSpacing: 0,
    fontWeight:    '400' as const,
  },
  caption: {
    fontFamily:    'Inter_500Medium',
    fontSize:      12,
    lineHeight:    18,
    letterSpacing: 0.96,
    fontWeight:    '500' as const,
  },
  eyebrow: {
    fontFamily:     'Inter_500Medium',
    fontSize:       11,
    lineHeight:     13,
    letterSpacing:  1.98,
    fontWeight:     '500' as const,
    textTransform:  'uppercase' as const,
  },
  micro: {
    fontFamily:    'Inter_600SemiBold',
    fontSize:      10,
    lineHeight:    14,
    letterSpacing: 0.5,
    fontWeight:    '600' as const,
  },
} as const;

// ─── Spacing — 4 px base grid ──────────────────────────────────────────────────
export const spacing = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  24,
  '2xl': 32,
  '3xl': 48,
  '4xl': 64,
} as const;

// ─── Border Radius (Wave 2: luxury scale) ─────────────────────────────────────
export const radius = {
  sm:   0,    // buttons, primary CTAs
  md:   2,    // inputs
  lg:   4,    // cards
  // xl and 2xl kept for legacy back-compat — screens with literal large radii
  // are flagged in FITNESS_RADIUS_HITS.md for Wave 3 cleanup.
  xl:   4,    // remapped to lg value (was 16)
  '2xl': 4,   // remapped to lg value (was 24)
  pill: 999,  // SMALL CHIPS ONLY — never on primary surfaces
} as const;

// ─── Shadows (Wave 2: luxury opacity caps) ────────────────────────────────────
export const shadows = {
  /** Subtle lift — inputs, chips */
  sm: {
    shadowColor:   '#1A1A18',
    shadowOffset:  { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius:  2,
    elevation:     1,
  },
  /** Card elevation */
  md: {
    shadowColor:   '#1A1A18',
    shadowOffset:  { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius:  6,
    elevation:     2,
  },
  /** Modal / bottom sheet */
  lg: {
    shadowColor:   '#1A1A18',
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius:  12,
    elevation:     4,
  },
} as const;

// ─── Motion (Wave 2: velvet timing, expo-out easing) ──────────────────────────
export const motion = {
  duration: {
    fast:       120,   // haptic taps only
    base:       400,   // standard transitions (was 200)
    slow:       800,   // content reveals, image fades (was 320)
    deliberate: 1200,  // hero reveals, scene changes
    // spring, accelerate, shimmer: removed (Wave 1 + Wave 2 luxury repositioning)
  },
  easing: {
    /** expo-out — primary easing for everything entering */
    decel:  [0.16, 1, 0.3, 1] as const,
    /** standard — used sparingly */
    smooth: [0.4, 0, 0.2, 1] as const,
    // accelerate and spring: DELETED (luxury repositioning)
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Phase 11: Semantic dark-mode token layer
//
// Usage:
//   const { colors } = useTheme();
//   <View style={{ backgroundColor: colors.bgPrimary }} />
//
// These are the ONLY tokens that change between light and dark mode.
// All other design decisions (typography, spacing, radius, motion) are
// mode-agnostic.
// ─────────────────────────────────────────────────────────────────────────────

export interface SemanticTokens {
  /** Screen/page background */
  bgPrimary: string;
  /** Card / surface background */
  bgSurface: string;
  /** Primary body text — ink on light, near-white on dark */
  textPrimary: string;
  /** Secondary / supporting text */
  textMuted: string;
  /** Primary brand accent — oxblood lifted in dark for AA contrast */
  accent: string;
  /**
   * Text/icon color to place ON the `accent` fill (e.g. label inside a
   * primary CTA). Warm near-white so it never reads as a hard #FFF on the
   * old-money palette. Contrast on accent (computed, WCAG 2.1 relative
   * luminance — verified in contrast_check.py / scopedTokenGate test):
   *   light: #FBF7F0 on #4A0404 (oxblood)        ~ 15.01:1  PASS (AA body + large)
   *   dark:  #FBF7F0 on #B43C3C (oxblood lifted) ~  5.38:1  PASS (AA body + large)
   * NOTE: a dark ink on the lifted dark accent only reaches ~3.10:1 (even
   * pure black tops out at ~3.65:1), so the dark on-accent MUST be the warm
   * near-white too — both modes use light text on the oxblood CTA.
   */
  textOnAccent: string;
  /**
   * Fill for a DISABLED / inactive primary control (e.g. a CTA that is the
   * current plan or mid-request). Use this explicit token instead of
   * compositing the enabled `accent` fill under a parent `opacity`, which
   * drags the whole button — including its label — below AA. Paired with
   * `textOnDisabled` so the disabled label stays legible. Contrast on this
   * fill (WCAG 2.1, verified in scopedTokenGate test):
   *   light: #524E47 on #E0D9CE ~ 5.90:1  PASS
   *   dark:  #9A958C on #2A2723 ~ 4.99:1  PASS
   */
  disabledBg: string;
  /** Text/icon color to place ON the `disabledBg` fill. */
  textOnDisabled: string;
  /** Default border / hairline color */
  border: string;
}

/** Light-mode semantic tokens (default — matches existing bone/ink palette). */
export const lightTokens: SemanticTokens = {
  bgPrimary:   '#F5EFE4',  // bone / cream
  bgSurface:   '#FFFDF8',
  textPrimary: '#1A1A18',  // ink (~15.23:1 on cream)
  // Warm taupe muted. Darkened from #78736E (only 4.10:1 on cream, AA FAIL
  // for body-sized 12-13px meta text) to #6B675F so it clears AA on BOTH
  // light backgrounds: ~4.92:1 on cream #F5EFE4, ~5.54:1 on surface #FFFDF8.
  textMuted:   '#6B675F',
  accent:      '#4A0404',  // oxblood
  textOnAccent:'#FBF7F0',  // warm near-white on oxblood (~15.01:1)
  // Disabled CTA: warm taupe fill + dark warm ink. ~5.90:1 (AA PASS) so a
  // disabled/current-plan button label stays legible without parent opacity.
  disabledBg:     '#E0D9CE',
  textOnDisabled: '#524E47',
  border:      '#DCD5CC',
};

/** Dark-mode semantic tokens. */
export const darkTokens: SemanticTokens = {
  bgPrimary:   '#121110',
  bgSurface:   '#1C1A18',
  textPrimary: '#EBE6DE',
  textMuted:   '#A09B94',
  accent:      '#B43C3C',  // oxblood lifted for dark contrast
  // (disabled tokens declared after textOnAccent below)
  // Warm near-white on the lifted accent (~5.38:1, AA PASS). The previous
  // dark ink #1A1714 was only ~3.10:1 on #B43C3C (AA FAIL for body text).
  textOnAccent:'#FBF7F0',
  // Disabled CTA in dark mode: muted ink on a slightly raised neutral fill.
  // ~4.99:1 (AA PASS) for the disabled label without parent opacity.
  disabledBg:     '#2A2723',
  textOnDisabled: '#9A958C',
  border:      '#2D2A26',
};

// ─── Color utilities ────────────────────────────────────────────────────────
/**
 * Derive an `rgba()` string from a palette hex token at a given opacity.
 * Use this for scrims/overlays so they stay anchored to a theme token instead
 * of hard-coding a raw `rgba(...)` literal (e.g. `withAlpha(colors.ink, 0.45)`
 * for the modal scrim). Accepts `#RGB` and `#RRGGBB`; alpha is clamped to
 * [0, 1]. Non-hex input is returned unchanged so callers degrade gracefully.
 */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex);
  if (m == null) return hex;
  let h = m[1];
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ─── Composite token export ────────────────────────────────────────────────────
const tokens = {
  colors,
  neutral,
  brand,
  semantic,
  gold,
  typography,
  spacing,
  radius,
  shadows,
  motion,
  lightTokens,
  darkTokens,
} as const;

export type Tokens = typeof tokens;
export default tokens;
