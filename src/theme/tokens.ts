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
 * ink (#1A1A18) on bone (#F7FAF7)               ~16.6:1              PASS     PASS
 * ink (#1A1A18) on cream (#F1E8D5)              ~15.2:1              PASS     PASS
 * charcoal (#3D3D3A) on bone (#F7FAF7)          ~10.4:1              PASS     PASS
 * forest (#2C4A36) on bone (#F7FAF7)            ~ 9.3:1              PASS     PASS
 * stone (#B1A89F) on bone (#F7FAF7)             ~ 2.2:1              FAIL     FAIL (decorative/disabled only)
 * mutedGold (#C5A253) on bone (#F7FAF7)         ~ 2.3:1              FAIL     FAIL (fills/borders only)
 *
 * Dark mode additions:
 * textPrimary (#EBE6DE) on bgPrimary (#121110)  ~14.2:1              PASS     PASS
 * textMuted (#A09B94) on bgPrimary (#121110)    ~ 5.9:1              PASS     PASS
 *
 * Style C v2 surface.* and data.* pairs (light and dark): theme/README.md,
 * locked by __tests__/contrastStyleC.test.ts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Universal old-money palette ──────────────────────────────────────────────
export const colors = {
  bone:        '#F7FAF7',  // primary background (owner #166-2)
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

  // Roman (AI persona) brand-character avatar tokens. The Roman mascot uses a
  // deep-gold accent that is intentionally distinct from `mutedGold`
  // (#C5A253, founding-tier badge typography) — it is the avatar ring + the
  // monogram-tile fill, never general UI chrome. `romanInk` is the dark glyph
  // color on that gold tile (shares ink's value but is named for the Roman lane
  // so the avatar's palette stays self-documenting and tokenized). Previously
  // hardcoded as raw hex inside RomanAvatar.tsx (#C9A961 / #1A1A18).
  romanAccent: '#C9A961',
  romanInk:    '#1A1A18',
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
   * Serif roles keep lineHeight >= SERIF_MIN_LINE_RATIO x fontSize. Cormorant's
   * own line box is 1.211 em (hhea 924 + 287 per 1000), so anything tighter
   * clips descenders on Android (B15). Guarded by serifLineHeight.test.ts.
   */
  display: {
    fontFamily:    'CormorantGaramond_400Regular',
    fontSize:      44,
    lineHeight:    55,
    letterSpacing: 0.4,
    fontWeight:    '400' as const,
  },
  h1: {
    fontFamily:    'CormorantGaramond_400Regular',
    fontSize:      32,
    lineHeight:    40,
    letterSpacing: 0.6,
    fontWeight:    '400' as const,
  },
  h2: {
    fontFamily:    'CormorantGaramond_400Regular',
    fontSize:      24,
    lineHeight:    30,
    letterSpacing: 0.5,
    fontWeight:    '400' as const,
  },
  h3: {
    fontFamily:    'CormorantGaramond_500Medium',
    fontSize:      20,
    lineHeight:    25,
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
  /**
   * Bottom tab labels (B26). Six tabs share 60 pt on a 360 pt Android phone.
   * "Community" in Inter Medium is 5.484 em: 60.3 pt at 11 pt with no
   * tracking (it wrapped), 58.5 pt with -0.2 tracking. ClientNavigator also
   * drops the tab item's 5 pt side padding and keeps the label on one line.
   */
  tabLabel: {
    fontFamily:    'Inter_400Regular',
    fontSize:      11,
    lineHeight:    14,
    letterSpacing: -0.2,
    fontWeight:    '400' as const,
  },
  tabLabelActive: {
    fontFamily:    'Inter_500Medium',
    fontSize:      11,
    lineHeight:    14,
    letterSpacing: -0.2,
    fontWeight:    '500' as const,
  },
} as const;

/**
 * Minimum serif lineHeight / fontSize. 1.25 sits above Cormorant's natural
 * 1.211 em line box and above the 1.2 floor in the lane 133 quality bar.
 */
export const SERIF_MIN_LINE_RATIO = 1.25;

/** Typography roles set in Cormorant Garamond (checked by the lineHeight test). */
export const serifRoles = ['display', 'h1', 'h2', 'h3'] as const;
export type SerifRole = (typeof serifRoles)[number];

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

// ─── Border Radius ────────────────────────────────────────────────────────────
// OWNER 17:07 2026-10-08 (binding): "I want nice rounded corners, luxurious,
// not rectangles". Decision 133-4 answered: rounded. New code uses the
// SEMANTIC keys (button, input, card, sheet, chip, control); never a literal.
// The prototype frames show square corners; the owner's ruling wins over them.
// Legacy keys sm / md / lg / xl / 2xl (and every theme/index `Radius` key) now
// resolve to the rounded scale so every existing user rounds at once.
export const radius = {
  // Semantic (use these)
  button:  12,   // PrimaryButton, filled or outlined actions
  input:   12,   // text fields, unit tabs, segmented controls
  card:    16,   // cards, grouped panels, image tiles
  sheet:   24,   // bottom-sheet and modal TOP corners
  chip:    999,  // chips and pills
  control: 6,    // small boxes under 28 pt (checkbox, tag)
  // Legacy names (deprecated for new code), mapped onto the rounded scale
  sm:   12,   // was 0: buttons -> button (card-payment sheet button included)
  md:   12,   // was 2: inputs -> input
  lg:   16,   // was 4: cards -> card
  xl:   16,   // was 4 -> card
  '2xl': 24,  // was 4 -> sheet
  pill: 999,  // same as chip
} as const;

// ─── Layout (DS-PRIMITIVES-133) ─────────────────────────────────────────────
// Measured from the prototype (390 x 844): 24 pt gutters, 54 pt button, link
// 8 pt under it. statusBarGap = breathing room under the real inset (B13, B28).
export const layout = {
  gutter:          24,  // horizontal page margin
  statusBarGap:    12,  // added under insets.top
  footerTopGap:    12,  // space above the pinned footer
  footerBottomMin: 16,  // floor for insets.bottom (devices with no gesture bar)
  footerBottomGap: 8,   // added under the footer, above the gesture bar
  footerItemGap:   8,   // primary button to quiet link
  buttonHeight:    54,  // primary button (prototype 00, 07)
  touchMin:        44,  // minimum touch target (links, icons)
  rowMinHeight:    56,  // QuietRow
  sectionPadY:     18,  // QuietSection padding above and below (Home rhythm)
  sectionGap:      24,  // QuietSection bottom margin
} as const;

// ─── Wheel (shared band for consultation wheels, B19) ────────────────────────
// Prototype 07-09: 44 pt rows, five visible, two hairlines framing the selected
// value. The band is outline only and sits BEHIND the values.
const wheelSerif = { fontFamily: 'CormorantGaramond_400Regular', fontWeight: '400' as const };
export const wheel = {
  rowHeight:    44,
  visibleRows:  5,
  bandHairline: 1,
  selected: { ...wheelSerif, fontSize: 28, lineHeight: 36 },
  near:     { ...wheelSerif, fontSize: 21, lineHeight: 28, opacity: 0.55 },
  far:      { ...wheelSerif, fontSize: 18, lineHeight: 24, opacity: 0.3 },
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
  /** Primary brand accent — forest in light; retained dark fill is AA-safe */
  accent: string;
  /**
   * Accent color for ACCENT-TINTED TEXT/ICONS rendered ON a screen/surface
   * background (outline-chip labels, link/retry/opt-in labels, completion
   * hints) — i.e. the foreground use of the brand accent, NOT a filled CTA.
   * Kept SEPARATE from `accent` (the fill) because the dark `accent` oxblood
   * #B43C3C only reaches ~3.28:1 on bgPrimary #121110 and ~3.02:1 on bgSurface
   * #1C1A18 (AA FAIL for body-sized text). This lifted rose clears AA on BOTH
   * dark backgrounds (WCAG 2.1, verified in theme/__tests__/contrastTokens.test):
   *   dark:  #E07373 on #121110 ~ 6.17:1  PASS  |  on #1C1A18 ~ 5.68:1  PASS
   * Light mode uses the existing forest #2C4A36, which clears AA as text on
   * bone #F7FAF7 (~9.33:1) and surface #FFFDF8 (~9.65:1).
   * Use `accent` for FILLS (CTA backgrounds, progress fills, borders) and
   * `accentText` for accent-colored FOREGROUND text/icons on a bg/surface.
   */
  accentText: string;
  /**
   * Text/icon color to place ON the `accent` fill (e.g. label inside a
   * primary CTA). Warm near-white so it never reads as a hard #FFF on the
   * old-money palette. Contrast on accent (computed, WCAG 2.1 relative
   * luminance — verified in contrast_check.py / scopedTokenGate test):
   *   light: #FBF7F0 on #2C4A36 (forest)         ~  9.19:1  PASS (AA body + large)
   *   dark:  #FBF7F0 on #B43C3C (oxblood lifted) ~  5.38:1  PASS (AA body + large)
   * NOTE: a dark ink on the lifted dark accent only reaches ~3.10:1 (even
   * pure black tops out at ~3.65:1), so the dark on-accent MUST be the warm
   * near-white too — both modes use light text on their primary CTA fill.
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
  /**
   * Scrim/overlay behind modals and bottom sheets. A theme-anchored token so
   * the dim is consistent across light/dark instead of a hard-coded raw rgba.
   * Calm, not opaque — the sheet sits on a dimmed-but-visible context.
   */
  overlay: string;
  /**
   * Style C v2 surfaces (MOCK-C1V2, index-v2 section 4). They hold short
   * text only; long text stays on bone. Text on masthead and forestBand uses
   * textOnAccent and textOnMastheadMuted. forestBandLine is the chip border on
   * the rest band (section 5: 60% textOnAccent over forest, solid). Pairs:
   * theme/__tests__/contrastStyleC.
   */
  surface: { masthead: string; forestBand: string; forestBandLine: string; sage: string; sageLine: string };
  /** Secondary text on surface.masthead and surface.forestBand. */
  textOnMastheadMuted: string;
  /**
   * Style C v2 chart marks. leaf and fern sit on a dark ground or are chip
   * fills, never text or a lone mark on bone. peak (gold) marks a personal
   * best only, always with a star and words; peakInk outlines it on light
   * ground. `*OnDark` is the same role on the masthead. Solid colours only.
   */
  data: {
    leaf: string; fern: string; moss: string; forest: string; deep: string;
    peak: string; peakInk: string; planned: string; plannedOnDark: string;
    missed: string; missedOnDark: string; trackLight: string;
    trend: string; range: string; weighIn: string; goal: string;
    frameOnDark: string; pending: string;
  };
}

// C8 v2 role aliases reuse the C1 v2 leaf, never a new colour.
const chartLeaf = '#A3C46A';

/** Light-mode semantic tokens (default — matches existing bone/ink palette). */
export const lightTokens: SemanticTokens = {
  bgPrimary:   '#F7FAF7',  // bone (owner #166-2)
  bgSurface:   '#FFFDF8',
  textPrimary: '#1A1A18',  // ink (~15.23:1 on cream)
  // Warm taupe muted. Darkened from #78736E (only 4.10:1 on cream, AA FAIL
  // for body-sized 12-13px meta text) to #6B675F so it clears AA on BOTH
  // light backgrounds: ~5.35:1 on bone #F7FAF7, ~5.54:1 on surface #FFFDF8.
  textMuted:   '#6B675F',
  accent:      colors.forest,
  // One forest accent for both CTA fills and foreground text/icons. Clears
  // AA on page (~8.57:1) and surface (~9.65:1); see contrastTokens test.
  accentText:  colors.forest,
  textOnAccent:'#FBF7F0',  // warm near-white on forest (~9.19:1)
  // Disabled CTA: warm taupe fill + dark warm ink. ~5.90:1 (AA PASS) so a
  // disabled/current-plan button label stays legible without parent opacity.
  disabledBg:     '#E0D9CE',
  textOnDisabled: '#524E47',
  border:      '#DCD5CC',
  // Ink (#1A1A18) at 0.40 — a calm dim that keeps the underlying screen legible.
  overlay:     'rgba(26, 26, 24, 0.40)',
  surface: { masthead: brand[800], forestBand: brand[600], forestBandLine: '#A8B2A6', sage: semantic.success.bg, sageLine: '#C9D8CD' },
  textOnMastheadMuted: brand[100],
  data: {
    leaf: chartLeaf, fern: '#7FA653', moss: '#4E7A3F', forest: brand[600], deep: brand[800],
    peak: gold[300], peakInk: gold[800], planned: '#857F75', plannedOnDark: brand[300],
    missed: '#6B675F', missedOnDark: colors.stone, trackLight: '#E6DFD3', // missed = textMuted
    trend: chartLeaf, range: brand[500], weighIn: brand[100], goal: gold[300],
    frameOnDark: brand[300], pending: chartLeaf,
  },
};

/**
 * Forest Pop (C6CHAT-S-V2 section 6): the community colours by role. Every
 * value is an existing token above, so nothing new enters the palette. Light
 * ground only (the app launches light, ThemeProvider). Deep holds the masthead,
 * space headers and drawer; forest is the one filled action and the segment
 * track; leaf means new, unread or active, on deep or as a fill with a moss
 * edge; gold means the coach, on deep only (goldInk on light); sage tints;
 * sageLine is the hairline; surface is the page. Leaf and gold are never text
 * on a light ground. Pairs: theme/__tests__/forestPop.test.ts.
 */
export const forestPop = {
  deep: brand[800],
  forest: colors.forest,
  leaf: chartLeaf,
  moss: lightTokens.data.moss,
  gold: gold[300],
  goldInk: gold[800],
  sage: semantic.success.bg,
  sageLine: lightTokens.surface.sageLine,
  surface: lightTokens.bgSurface,
  ink: colors.ink,
  n700: neutral[700],
  brand400: brand[400],
  onDeep: lightTokens.textOnAccent,
  onDeepMuted: brand[100],
  error: colors.error,
} as const;
export type ForestPopRole = keyof typeof forestPop;

/** Path Copilot status tints (style A board, owner #162-1): leaf = sent / approved, gold = waiting, still = kept / expired. */
export const pathTint = { leaf: '#EEF4E0', gold: gold[100], still: neutral[200] } as const;

/**
 * Voice notes Style B shades the B mockups draw that are not tokens above
 * (owner 10-21 10:09, #VOICE-SHADES op 1, exact mockup shades).
 */
export const voiceShades = {
  hairline: '#E2E6E1', // card and row hairlines, level dots, progress tracks
  leafWash: '#EEF4E2', // icon circles on the consent and permission sheets
  barOnDeep: '#6A7E71', // unplayed bars on the coach's deep card (3.23:1 on deep)
  track: '#C9D0CA', // sheet handle, field borders, off controls
  washEdge: '#D3E2B8', // edge of the leaf wash (icon circles, safety line box)
  scrim: 'rgba(26, 26, 24, 0.45)', // the record sheet's scrim (mockup .scrim)
} as const;

/** Dark-mode semantic tokens. */
export const darkTokens: SemanticTokens = {
  bgPrimary:   '#121110',
  bgSurface:   '#1C1A18',
  textPrimary: '#EBE6DE',
  textMuted:   '#A09B94',
  accent:      '#B43C3C',  // oxblood lifted for dark contrast (FILLS only)
  // Accent-tinted FOREGROUND text/icons on dark backgrounds. The fill oxblood
  // #B43C3C fails AA as body text (~3.28:1 on bgPrimary, ~3.02:1 on bgSurface);
  // this lifted rose clears AA on BOTH: ~6.17:1 on #121110, ~5.68:1 on #1C1A18.
  accentText:  '#E07373',
  // (disabled tokens declared after textOnAccent below)
  // Warm near-white on the lifted accent (~5.38:1, AA PASS). The previous
  // dark ink #1A1714 was only ~3.10:1 on #B43C3C (AA FAIL for body text).
  textOnAccent:'#FBF7F0',
  // Disabled CTA in dark mode: muted ink on a slightly raised neutral fill.
  // ~4.99:1 (AA PASS) for the disabled label without parent opacity.
  disabledBg:     '#2A2723',
  textOnDisabled: '#9A958C',
  border:      '#2D2A26',
  // Deeper near-black scrim for dark mode so the dim still reads against the
  // already-dark surfaces without washing out (#000 at 0.55).
  overlay:     'rgba(0, 0, 0, 0.55)',
  // Style C v2: the masthead, forest band, leaf greens, gold and on-dark marks
  // were drawn for a dark ground and stay. Light-ground roles move to values
  // that pass on #121110 and #1C1A18 (missed = textMuted again).
  surface: { ...lightTokens.surface, sage: '#17211A', sageLine: '#2A3A2F' },
  textOnMastheadMuted: brand[100],
  data: { ...lightTokens.data, forest: '#527A5E', peakInk: gold[300], missed: '#A09B94', trackLight: '#24221F' },
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
  layout,
  wheel,
  lightTokens,
  darkTokens,
  forestPop,
} as const;

export type Tokens = typeof tokens;
export default tokens;
