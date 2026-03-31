// The Growth Project — Central Theme
// Re-exports canonical green/cream palette from constants/colors.
// NEVER hardcode hex values in component files — always import from here.

import CanonicalColors from '../constants/colors';

export const Colors = {
  primary: CanonicalColors.primary,           // #2D6A4F deep green
  gold: CanonicalColors.warning,              // #E9C46A (was teal-era gold)
  orange: CanonicalColors.error,              // #E63946 (was #E88D67)
  dark: CanonicalColors.textPrimary,          // #1B2B1E near-black green-tinted
  background: CanonicalColors.background,     // #FAF8F3 warm cream
  surface: CanonicalColors.surface,           // #FFFFFF
  textMuted: CanonicalColors.textMuted,       // #8FA89A light muted
  success: CanonicalColors.success,           // #2D6A4F
  warning: CanonicalColors.warning,           // #E9C46A
  error: CanonicalColors.error,               // #E63946
  white: CanonicalColors.textOnPrimary,       // #FFFFFF
  // Additional tokens
  border: CanonicalColors.border,             // #E2EDE6
  cardShadow: CanonicalColors.cardShadow,     // rgba(45, 106, 79, 0.08)
  primaryLight: CanonicalColors.primaryPale,   // #D8F3DC
  goldLight: 'rgba(233, 196, 106, 0.12)',     // translucent warning
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
