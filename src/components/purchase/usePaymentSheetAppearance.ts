/**
 * TGP-themed PaymentSheet appearance (OR-110-2: Stripe surfaces look like
 * TGP), built from the semantic tokens so light and dark mode both match.
 */
import { useMemo } from "react";
import { useTheme } from "../../theme/ThemeProvider";

export function usePaymentSheetAppearance(): {
  appearance: Record<string, unknown>;
  colorScheme: "light" | "dark";
} {
  const { semanticColors, tokens, colorScheme } = useTheme();
  const appearance = useMemo(
    () => ({
      colors: {
        primary: semanticColors.accent,
        background: semanticColors.bgPrimary,
        componentBackground: semanticColors.bgSurface,
        componentBorder: semanticColors.border,
        componentDivider: semanticColors.border,
        primaryText: semanticColors.textPrimary,
        secondaryText: semanticColors.textMuted,
        componentText: semanticColors.textPrimary,
        placeholderText: semanticColors.textMuted,
        icon: semanticColors.textMuted,
        error: tokens.colors.error,
      },
      shapes: { borderRadius: 2, borderWidth: 1 },
      primaryButton: {
        colors: {
          background: semanticColors.accent,
          text: semanticColors.textOnAccent,
          border: semanticColors.accent,
        },
        shapes: { borderRadius: 0, borderWidth: 0 },
      },
    }),
    [semanticColors, tokens],
  );
  return { appearance, colorScheme: colorScheme === "dark" ? "dark" : "light" };
}
