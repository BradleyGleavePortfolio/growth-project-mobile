/**
 * ThemeProvider — Premium Visual System (UX Psych Report #5)
 *
 * Reads founding-member status from useFoundingNumber() (PR #41) and
 * vends either freeTheme or founderTheme via useTheme().
 *
 * founderTheme = freeTheme + gold accent overrides:
 *   • border tints → gold.border
 *   • hero gradient stop → gold.300 accent
 *   • badge highlight colours → gold scale
 *   • shadow on tier-aware cards → shadows['glow-gold']
 */

import React, { createContext, useContext, ReactNode } from 'react';
import tokens, { Tokens } from './tokens';
import { useFoundingNumber } from '../hooks/useIdentity';

// ─── Tier Type ─────────────────────────────────────────────────────────────────
export type Tier = 'free' | 'founder';

// ─── Theme shape ───────────────────────────────────────────────────────────────
export interface Theme {
  tokens: Tokens;
  tier: Tier;
  /**
   * Tier-specific overrides applied on top of base tokens.
   * Components read these via useTheme().tierColors instead of branching on tier.
   */
  tierColors: {
    /** Card/badge border colour */
    accentBorder: string;
    /** Subtle background tint for tier-aware elements */
    accentBg: string;
    /** Primary text accent (badge label, highlights) */
    accentFg: string;
    /** Hero gradient second stop */
    heroGradientStop: string;
    /** Badge shadow style */
    badgeShadow: Tokens['shadows']['sm'] | Tokens['shadows']['glow-gold'];
    /** Border glow for shimmer-capable elements */
    shimmerHighlight: string;
  };
}

// ─── Free theme ────────────────────────────────────────────────────────────────
const freeTheme: Theme = {
  tokens,
  tier: 'free',
  tierColors: {
    accentBorder:      tokens.brand[600],            // primary green border
    accentBg:          'rgba(45,106,79,0.08)',        // primary pale tint
    accentFg:          tokens.brand[600],
    heroGradientStop:  tokens.brand[400],             // medium green
    badgeShadow:       tokens.shadows.sm,
    shimmerHighlight:  'rgba(82,183,136,0.30)',
  },
};

// ─── Founder theme ─────────────────────────────────────────────────────────────
const founderTheme: Theme = {
  tokens,
  tier: 'founder',
  tierColors: {
    accentBorder:      tokens.gold.border,
    accentBg:          tokens.gold[100],
    accentFg:          tokens.gold[700],              // 5.9:1 on gold bg ✅
    heroGradientStop:  tokens.gold[300],              // gold accent stop in hero gradient
    badgeShadow:       tokens.shadows['glow-gold'],
    shimmerHighlight:  tokens.gold.shimmer,
  },
};

// ─── Context ───────────────────────────────────────────────────────────────────
const ThemeContext = createContext<Theme>(freeTheme);

// ─── Provider ──────────────────────────────────────────────────────────────────
interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  // useFoundingNumber comes from PR #41 — degrades gracefully to null on error
  const { data: foundingData } = useFoundingNumber();

  // A user is a founding member if the API returns a founding_number field.
  // Mirrors the logic already used in IdentityBadge / HomeScreen.
  const isFoundingMember =
    foundingData != null &&
    typeof (foundingData as any).founding_number === 'number';

  const theme = isFoundingMember ? founderTheme : freeTheme;

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────────
/** Access the active theme (tokens + tier + tierColors) from any component. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export default ThemeProvider;
