/**
 * ThemeProvider — Luxury Visual System (Wave 2)
 *
 * Reads founding-member status from useFoundingNumber() and
 * vends either freeTheme or founderTheme via useTheme().
 *
 * founderTheme = freeTheme + muted-gold accent overrides:
 *   • border tints → gold.border (camel hairline)
 *   • badge highlight → mutedGold typography
 *   • shadow → shadows.sm (no glow)
 *
 * Wave 2 changes:
 *   - heroGradientStop removed (LinearGradient deleted in Wave 1)
 *   - shimmerHighlight removed (shimmer deleted in Wave 1)
 *   - All references updated to new color tokens
 */

import React, { createContext, useContext, ReactNode } from 'react';
import tokens, { Tokens } from './tokens';
import CanonicalColors from '../constants/colors';
import { useFoundingNumber } from '../hooks/useIdentity';

// ─── Tier Type ─────────────────────────────────────────────────────────────────
export type Tier = 'free' | 'founder';

// ─── Flat colour map vended by useTheme().colors ─────────────────────────────
export interface ThemeColors {
  primary: string; primaryLight: string; primaryPale: string; primaryDark: string; accent: string;
  background: string; surface: string; surfaceElevated: string;
  textPrimary: string; textSecondary: string; textMuted: string; textOnPrimary: string;
  border: string; divider: string;
  success: string; warning: string; error: string; info: string;
  streak: string;
  protein: string; carbs: string; fat: string; water: string; fiber: string;
  tabActive: string; tabInactive: string; tabBackground: string; tabBorder: string;
  cardShadow: string;
  offlineBanner: string; primaryTint: string;
  noticeWarningBg: string; noticeWarningIconBg: string; noticeWarningText: string;
  noticeCriticalBg: string; noticeCriticalAccent: string; noticeCriticalText: string;
  macroCarbsChipBg: string; macroCarbsChipText: string; macroFatChipBg: string; macroFatChipText: string;
  templateFatLoss: string; templateLeanBulk: string; templateRecomp: string; templateMaintenance: string; templateMobility: string;
  medalGold: string; medalSilver: string; medalBronze: string;
  muscleLegs: string; muscleTriceps: string; muscleCore: string; muscleFullBody: string; muscleCardio: string;
  dark: string; white: string; gold: string; orange: string;
}

const baseColors: ThemeColors = {
  ...CanonicalColors,
  dark:   CanonicalColors.textPrimary,
  white:  CanonicalColors.textOnPrimary,
  gold:   CanonicalColors.warning,
  orange: CanonicalColors.error,
};

// ─── Theme shape ───────────────────────────────────────────────────────────────
export interface Theme {
  tokens: Tokens;
  tier: Tier;
  colors: ThemeColors;
  tierColors: {
    accentBorder: string;
    accentBg: string;
    accentFg: string;
    badgeShadow: Tokens['shadows']['sm'];
  };
}

const freeTheme: Theme = {
  tokens,
  tier: 'free',
  colors: baseColors,
  tierColors: {
    accentBorder: tokens.colors.forest,
    accentBg:     'rgba(44,74,54,0.06)',
    accentFg:     tokens.colors.forest,
    badgeShadow:  tokens.shadows.sm,
  },
};

const founderTheme: Theme = {
  tokens,
  tier: 'founder',
  colors: baseColors,
  tierColors: {
    accentBorder: tokens.gold.border,
    accentBg:     tokens.gold[100],
    accentFg:     tokens.gold[700],
    badgeShadow:  tokens.shadows.sm,
  },
};

const ThemeContext = createContext<Theme>(freeTheme);

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { data: foundingData } = useFoundingNumber();

  const isFoundingMember =
    foundingData != null &&
    typeof (foundingData as { founding_number?: unknown }).founding_number === 'number';

  const theme = isFoundingMember ? founderTheme : freeTheme;

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export default ThemeProvider;
