import { StyleSheet } from 'react-native';
import Colors from './colors';
import { typography as tokenTypography, radius as tokenRadius } from '../theme/tokens';

// Wave 5b: this legacy file now defers to src/theme/tokens.ts.
//
// Typography roles map onto the tokenised quiet-luxury scale (Cormorant
// Garamond display, Inter UI, no 700/800 display weights). Older callers
// that still import { Typography } from this module get the new values for
// free. New code should import from `theme/tokens` directly.
//
// Spacing keeps the legacy 4 / 8 / 16 / 24 / 32 / 48 grid because dozens of
// screens still spell paddings as `Spacing.md`. Token-grid migrations happen
// per-screen.

export const Typography = {
  hero: {
    fontFamily:    tokenTypography.display.fontFamily,
    fontSize:      tokenTypography.display.fontSize,
    lineHeight:    tokenTypography.display.lineHeight,
    fontWeight:    tokenTypography.display.fontWeight,
    letterSpacing: tokenTypography.display.letterSpacing,
    color:         Colors.textPrimary,
  },
  h1: {
    fontFamily:    tokenTypography.h1.fontFamily,
    fontSize:      tokenTypography.h1.fontSize,
    lineHeight:    tokenTypography.h1.lineHeight,
    fontWeight:    tokenTypography.h1.fontWeight,
    letterSpacing: tokenTypography.h1.letterSpacing,
    color:         Colors.textPrimary,
  },
  h2: {
    fontFamily:    tokenTypography.h2.fontFamily,
    fontSize:      tokenTypography.h2.fontSize,
    lineHeight:    tokenTypography.h2.lineHeight,
    fontWeight:    tokenTypography.h2.fontWeight,
    letterSpacing: tokenTypography.h2.letterSpacing,
    color:         Colors.textPrimary,
  },
  h3: {
    fontFamily:    tokenTypography.h3.fontFamily,
    fontSize:      tokenTypography.h3.fontSize,
    lineHeight:    tokenTypography.h3.lineHeight,
    fontWeight:    tokenTypography.h3.fontWeight,
    letterSpacing: tokenTypography.h3.letterSpacing,
    color:         Colors.textPrimary,
  },
  h4: {
    fontFamily:    tokenTypography.h4.fontFamily,
    fontSize:      tokenTypography.h4.fontSize,
    lineHeight:    tokenTypography.h4.lineHeight,
    fontWeight:    tokenTypography.h4.fontWeight,
    letterSpacing: tokenTypography.h4.letterSpacing,
    color:         Colors.textPrimary,
  },
  body: {
    fontFamily:    tokenTypography.body.fontFamily,
    fontSize:      tokenTypography.body.fontSize,
    lineHeight:    tokenTypography.body.lineHeight,
    fontWeight:    tokenTypography.body.fontWeight,
    letterSpacing: tokenTypography.body.letterSpacing,
    color:         Colors.textPrimary,
  },
  bodySmall: {
    fontFamily:    tokenTypography.bodySmall.fontFamily,
    fontSize:      tokenTypography.bodySmall.fontSize,
    lineHeight:    tokenTypography.bodySmall.lineHeight,
    fontWeight:    tokenTypography.bodySmall.fontWeight,
    letterSpacing: tokenTypography.bodySmall.letterSpacing,
    color:         Colors.textSecondary,
  },
  caption: {
    fontFamily:    tokenTypography.caption.fontFamily,
    fontSize:      tokenTypography.caption.fontSize,
    lineHeight:    tokenTypography.caption.lineHeight,
    fontWeight:    tokenTypography.caption.fontWeight,
    letterSpacing: tokenTypography.caption.letterSpacing,
    color:         Colors.textMuted,
  },
  label: {
    fontFamily:     tokenTypography.eyebrow.fontFamily,
    fontSize:       tokenTypography.eyebrow.fontSize,
    lineHeight:     tokenTypography.eyebrow.lineHeight,
    fontWeight:     tokenTypography.eyebrow.fontWeight,
    letterSpacing:  tokenTypography.eyebrow.letterSpacing,
    textTransform:  'uppercase' as const,
    color:          Colors.textSecondary,
  },
  button: {
    fontFamily:     tokenTypography.eyebrow.fontFamily,
    fontSize:       13,
    lineHeight:     18,
    fontWeight:     '500' as const,
    letterSpacing:  1.6,
    textTransform:  'uppercase' as const,
  },
  number: {
    fontFamily:    tokenTypography.h1.fontFamily,
    fontSize:      tokenTypography.h1.fontSize,
    lineHeight:    tokenTypography.h1.lineHeight,
    fontWeight:    tokenTypography.h1.fontWeight,
    letterSpacing: tokenTypography.h1.letterSpacing,
    color:         Colors.textPrimary,
  },
};

export const Spacing = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
};

// Radius — flattened to the tokenised luxury scale. xl/full kept for back
// compat (sheet headers, pills). They no longer return rounded "sheet"
// corners; pill stays generous because chip-only.
export const Radius = {
  sm: tokenRadius.sm, // 0
  md: tokenRadius.md, // 2
  lg: tokenRadius.lg, // 4
  xl: tokenRadius.xl, // 4
  full: tokenRadius.pill, // 999 — chips only
};

export const Shadow = {
  small: {
    shadowColor: Colors.cardShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 2,
    elevation: 1,
  },
  medium: {
    shadowColor: Colors.cardShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 2,
  },
};

export const GlobalStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    ...Shadow.small,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  primaryButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.sm,
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
  },
  primaryButtonText: { ...Typography.button, color: Colors.textOnPrimary },
  secondaryButton: {
    backgroundColor: Colors.primaryPale,
    borderRadius: Radius.sm,
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
  },
  secondaryButtonText: { ...Typography.button, color: Colors.primary },
  sectionTitle: { ...Typography.h3, marginBottom: Spacing.sm },
  input: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: 15,
    color: Colors.textPrimary,
  },
});

export default { Colors, Typography, Spacing, Radius, Shadow, GlobalStyles };
