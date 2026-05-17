// The Growth Project — Central Theme (Wave 2: Luxury Repositioning)
// tokens.ts is the canonical source of truth.
// This file re-exports everything from tokens.ts and maintains legacy
// named exports so existing imports keep working without changes.
// NEVER hardcode hex values in component files — always import from here.

import CanonicalColors from '../constants/colors';

// Re-export all canonical tokens (new code should import from here or tokens.ts)
export {
  colors as colorTokens,
  neutral,
  brand,
  semantic,
  gold,
  typography as typographyTokens,
  spacing as spacingTokens,
  radius as radiusTokens,
  shadows as shadowTokens,
  motion,
} from './tokens';
export { default as tokens } from './tokens';
export type { Tokens } from './tokens';

// ─── Legacy flat Colors export ────────────────────────────────────────────────
// Maps old keys to the new palette. Components don't need to change imports.
export const Colors = {
  primary:         CanonicalColors.primary,           // #2C4A36 forest
  primaryLight:    CanonicalColors.primaryLight,
  primaryPale:     CanonicalColors.primaryPale,
  primaryDark:     CanonicalColors.primaryDark,
  accent:          CanonicalColors.accent,
  gold:            CanonicalColors.warning,           // #C5A253 mutedGold
  orange:          CanonicalColors.error,             // #4A0404 oxblood
  dark:            CanonicalColors.textPrimary,       // #1A1A18 ink
  background:      CanonicalColors.background,        // #F5EFE4 bone
  surface:         CanonicalColors.surface,           // #F1E8D5 cream
  surfaceElevated: CanonicalColors.surfaceElevated,
  textMuted:       CanonicalColors.textMuted,         // #B1A89F stone
  textPrimary:     CanonicalColors.textPrimary,
  textSecondary:   CanonicalColors.textSecondary,
  textOnPrimary:   CanonicalColors.textOnPrimary,
  success:         CanonicalColors.success,
  warning:         CanonicalColors.warning,
  error:           CanonicalColors.error,
  info:            CanonicalColors.info,
  white:           CanonicalColors.textOnPrimary,     // bone (was #FFFFFF)
  border:          CanonicalColors.border,
  divider:         CanonicalColors.divider,
  cardShadow:      CanonicalColors.cardShadow,
  goldLight:       'rgba(197,162,83,0.12)',
  protein:         CanonicalColors.protein,
  carbs:           CanonicalColors.carbs,
  fat:             CanonicalColors.fat,
  water:           CanonicalColors.water,
  fiber:           CanonicalColors.fiber,
};

// ─── Legacy grouped colors export ─────────────────────────────────────────────
export const colors = {
  background: {
    primary:   CanonicalColors.background,       // bone — screen bg
    secondary: CanonicalColors.surfaceElevated,
    surface:   CanonicalColors.surface,          // cream — cards
    overlay:   'rgba(26, 26, 24, 0.5)',
  },
  text: {
    primary:    CanonicalColors.textPrimary,
    secondary:  CanonicalColors.textSecondary,
    muted:      CanonicalColors.textMuted,
    onPrimary:  CanonicalColors.textOnPrimary,
    link:       CanonicalColors.info,
  },
  brand: {
    primary:      CanonicalColors.primary,
    primaryDark:  CanonicalColors.primaryDark,
    primaryLight: CanonicalColors.primaryLight,
    primaryPale:  CanonicalColors.primaryPale,
    accent:       CanonicalColors.accent,
  },
  feedback: {
    success:    CanonicalColors.success,
    successBg:  CanonicalColors.feedbackSuccessBg,
    warning:    CanonicalColors.warning,
    warningBg:  CanonicalColors.noticeWarningBg,
    error:      CanonicalColors.error,
    errorBg:    CanonicalColors.noticeCriticalBg,
    errorText:  CanonicalColors.noticeCriticalAccent,
    info:       CanonicalColors.info,
    infoBg:     '#E8F4FD',  // light info blue — no token yet
  },
  border: {
    default: CanonicalColors.border,
    divider: CanonicalColors.divider,
    strong:  CanonicalColors.textMuted,
  },
  data: {
    protein: CanonicalColors.protein,
    carbs:   CanonicalColors.carbs,
    fat:     CanonicalColors.fat,
    water:   CanonicalColors.water,
    fiber:   CanonicalColors.fiber,
    consistency: CanonicalColors.textMuted,  // stone — neutral consecutive-day accent
    habit:       CanonicalColors.templateMobility,  // muted lavender
  },
  shadow:      CanonicalColors.cardShadow,
  transparent: 'transparent',
};

// ─── Legacy Typography export ──────────────────────────────────────────────────
// Re-maps old keys to new luxury typography values.
// CRITICAL: weight 400 for headings — not 700/800.
export const Typography = {
  // Map legacy keys → new token values
  hero:     { fontFamily: 'CormorantGaramond_400Regular', fontSize: 44, lineHeight: 46, fontWeight: '400' as const, letterSpacing: 0.4 },
  h1:       { fontFamily: 'CormorantGaramond_400Regular', fontSize: 32, lineHeight: 35, fontWeight: '400' as const, letterSpacing: 0.6, color: CanonicalColors.textPrimary },
  h2:       { fontFamily: 'CormorantGaramond_400Regular', fontSize: 24, lineHeight: 29, fontWeight: '400' as const, letterSpacing: 0.5, color: CanonicalColors.textPrimary },
  h3:       { fontFamily: 'CormorantGaramond_500Medium',  fontSize: 20, lineHeight: 24, fontWeight: '500' as const, letterSpacing: 0.4, color: CanonicalColors.textPrimary },
  body:     { fontFamily: 'Inter_400Regular',             fontSize: 16, lineHeight: 26, fontWeight: '400' as const, letterSpacing: -0.16, color: CanonicalColors.textMuted },
  bodyDark: { fontFamily: 'Inter_400Regular',             fontSize: 16, lineHeight: 26, fontWeight: '400' as const, letterSpacing: -0.16, color: CanonicalColors.textPrimary },
  label:    { fontFamily: 'Inter_500Medium',              fontSize: 11, lineHeight: 13, fontWeight: '500' as const, letterSpacing: 1.98, textTransform: 'uppercase' as const, color: CanonicalColors.primary },
  caption:  { fontFamily: 'Inter_500Medium',              fontSize: 12, lineHeight: 18, fontWeight: '500' as const, letterSpacing: 0.96, color: CanonicalColors.textMuted },
  button:   { fontFamily: 'Inter_600SemiBold',            fontSize: 14, lineHeight: 18, fontWeight: '600' as const, letterSpacing: 1.2, textTransform: 'uppercase' as const },
};

// ─── Legacy Spacing export ────────────────────────────────────────────────────
export const Spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
};

// ─── Legacy Radius export (Wave 2: luxury scale) ──────────────────────────────
export const Radius = {
  sm:   0,    // buttons, primary CTAs (was 8)
  md:   2,    // inputs (was 12)
  lg:   4,    // cards (was 16)
  xl:   4,    // remapped to lg (was 24)
  full: 999,  // small chips only
};

// ─── Legacy Shadow export (Wave 2: luxury opacity caps) ───────────────────────
export const Shadow = {
  card: {
    shadowColor:   CanonicalColors.textPrimary,
    shadowOffset:  { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius:  6,
    elevation:     2,
  },
  button: {
    shadowColor:   CanonicalColors.primary,
    shadowOffset:  { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius:  2,
    elevation:     1,
  },
};
