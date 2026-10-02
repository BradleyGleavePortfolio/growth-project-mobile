import { colors, darkTokens, lightTokens, radius, type SemanticTokens } from '../../theme/tokens';

/**
 * Stripe PaymentSheet theme built from the TGP design tokens (OR-110-2).
 *
 * Shape matches `PaymentSheet.AppearanceParams` of @stripe/stripe-react-native
 * 0.64 (colors are #RRGGBB hex, which every semantic color token is).
 * Fonts are left to the OS on purpose: Stripe looks custom fonts up by native
 * file / PostScript name and fails `initPaymentSheet` when one is missing,
 * and the app's serif and Inter are loaded at runtime by expo-font.
 */
export interface SheetColors {
  primary: string;
  background: string;
  componentBackground: string;
  componentBorder: string;
  componentDivider: string;
  primaryText: string;
  secondaryText: string;
  componentText: string;
  placeholderText: string;
  icon: string;
  error: string;
}

export interface SheetAppearance {
  colors: { light: SheetColors; dark: SheetColors };
  shapes: { borderRadius: number; borderWidth: number };
  primaryButton: {
    colors: {
      light: { background: string; text: string; border: string };
      dark: { background: string; text: string; border: string };
    };
    shapes: { borderRadius: number; borderWidth: number };
  };
}

function sheetColors(t: SemanticTokens, error: string): SheetColors {
  return {
    primary: t.accent,
    background: t.bgPrimary,
    componentBackground: t.bgSurface,
    componentBorder: t.border,
    componentDivider: t.border,
    primaryText: t.textPrimary,
    secondaryText: t.textMuted,
    componentText: t.textPrimary,
    placeholderText: t.textMuted,
    icon: t.textMuted,
    error,
  };
}

export function buildPaymentSheetAppearance(): SheetAppearance {
  return {
    // Dark mode lifts the error red the same way accentText lifts the accent.
    colors: { light: sheetColors(lightTokens, colors.error), dark: sheetColors(darkTokens, darkTokens.accentText) },
    shapes: { borderRadius: radius.md, borderWidth: 1 },
    primaryButton: {
      colors: {
        light: { background: lightTokens.accent, text: lightTokens.textOnAccent, border: lightTokens.accent },
        dark: { background: darkTokens.accent, text: darkTokens.textOnAccent, border: darkTokens.accent },
      },
      shapes: { borderRadius: radius.sm, borderWidth: 0 },
    },
  };
}

/** Pin the sheet to the app's own light/dark choice (the app has an override). */
export function sheetStyleFor(colorScheme: 'light' | 'dark'): 'alwaysLight' | 'alwaysDark' {
  return colorScheme === 'dark' ? 'alwaysDark' : 'alwaysLight';
}
