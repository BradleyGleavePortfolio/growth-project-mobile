// The Growth Project — Central Theme
// Single source of truth for colors/typography/spacing.
// NEVER hardcode hex values in component files — always import from here.
// Round 3: expanded to semantic tokens so screens can express intent.

import CanonicalColors from '../constants/colors';

// Flat palette (legacy — keep for back-compat with files already using it).
export const Colors = {
  primary: CanonicalColors.primary,           // #2D6A4F deep green
  primaryLight: CanonicalColors.primaryLight, // #52B788
  primaryPale: CanonicalColors.primaryPale,   // #D8F3DC
  primaryDark: CanonicalColors.primaryDark,   // #1B4332
  accent: CanonicalColors.accent,             // #40916C
  gold: CanonicalColors.warning,              // #E9C46A
  orange: CanonicalColors.error,              // #E63946
  dark: CanonicalColors.textPrimary,          // #1B2B1E
  background: CanonicalColors.background,     // #FAF8F3
  surface: CanonicalColors.surface,           // #FFFFFF
  surfaceElevated: CanonicalColors.surfaceElevated, // #F5F0E8
  textMuted: CanonicalColors.textMuted,       // #8FA89A
  textPrimary: CanonicalColors.textPrimary,
  textSecondary: CanonicalColors.textSecondary,
  textOnPrimary: CanonicalColors.textOnPrimary,
  success: CanonicalColors.success,
  warning: CanonicalColors.warning,
  error: CanonicalColors.error,
  info: CanonicalColors.info,
  white: CanonicalColors.textOnPrimary,       // #FFFFFF
  border: CanonicalColors.border,             // #E2EDE6
  divider: CanonicalColors.divider,
  cardShadow: CanonicalColors.cardShadow,
  goldLight: 'rgba(233, 196, 106, 0.12)',
  protein: CanonicalColors.protein,
  carbs: CanonicalColors.carbs,
  fat: CanonicalColors.fat,
  water: CanonicalColors.water,
  fiber: CanonicalColors.fiber,
};

// Semantic tokens grouped by purpose. Prefer these in new code.
// Round 3: introduced so screens can say `colors.text.secondary` instead of `#4A6358`.
export const colors = {
  background: {
    primary: CanonicalColors.background,       // screen bg
    secondary: CanonicalColors.surfaceElevated,
    surface: CanonicalColors.surface,          // cards
    overlay: 'rgba(0, 0, 0, 0.5)',
  },
  text: {
    primary: CanonicalColors.textPrimary,
    secondary: CanonicalColors.textSecondary,
    muted: CanonicalColors.textMuted,
    onPrimary: CanonicalColors.textOnPrimary,  // text on brand bg
    link: CanonicalColors.info,
  },
  brand: {
    primary: CanonicalColors.primary,
    primaryDark: CanonicalColors.primaryDark,
    primaryLight: CanonicalColors.primaryLight,
    primaryPale: CanonicalColors.primaryPale,
    accent: CanonicalColors.accent,
  },
  feedback: {
    success: CanonicalColors.success,
    successBg: '#E8F5E9',        // tinted success background
    warning: CanonicalColors.warning,
    warningBg: '#FFF8E7',        // tinted warning background
    error: CanonicalColors.error,
    errorBg: '#FEF2F2',          // tinted error background
    errorText: '#EF4444',
    info: CanonicalColors.info,
    infoBg: '#E8F4FD',
  },
  border: {
    default: CanonicalColors.border,
    divider: CanonicalColors.divider,
    strong: CanonicalColors.textMuted,
  },
  // Domain-specific accents reused across the app.
  data: {
    protein: CanonicalColors.protein,
    carbs: CanonicalColors.carbs,
    fat: CanonicalColors.fat,
    water: CanonicalColors.water,
    fiber: CanonicalColors.fiber,
    streak: '#E76F51',            // orange — streaks, fire, active timers
    habit: '#A78BFA',             // purple — habit highlights
  },
  shadow: CanonicalColors.cardShadow,
  transparent: 'transparent',
};

export const Typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, color: Colors.dark },
  h2: { fontSize: 22, fontWeight: '700' as const, color: Colors.dark },
  h3: { fontSize: 18, fontWeight: '600' as const, color: Colors.dark },
  body: { fontSize: 15, fontWeight: '400' as const, color: Colors.textMuted },
  bodyDark: { fontSize: 15, fontWeight: '400' as const, color: Colors.dark },
  label: { fontSize: 12, fontWeight: '600' as const, color: Colors.primary, letterSpacing: 0.5 },
  caption: { fontSize: 13, fontWeight: '400' as const, color: Colors.textMuted },
  button: { fontSize: 16, fontWeight: '600' as const },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};

export const Shadow = {
  card: {
    shadowColor: Colors.dark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  button: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
};
