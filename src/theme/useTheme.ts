/**
 * useTheme — Phase 11 semantic colour hook
 *
 * Convenience re-export so consumers can import from a dedicated path:
 *
 *   import { useTheme } from '../theme/useTheme';
 *
 * Returns the full Theme object. The most commonly needed field is
 * `semanticColors`, which automatically switches between lightTokens and
 * darkTokens based on the resolved colour scheme:
 *
 *   const { semanticColors: colors } = useTheme();
 *   // colors.bgPrimary, colors.textPrimary, colors.accent …
 *
 * The legacy `colors` field (ThemeColors) remains available for backward
 * compatibility with screens not yet migrated to semantic tokens.
 */
export { useTheme } from './ThemeProvider';
export type { Theme, ThemeColors, AppearanceOverride, Tier } from './ThemeProvider';
