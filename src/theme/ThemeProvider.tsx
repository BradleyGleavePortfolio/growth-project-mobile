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
    /** Badge shadow style */
    badgeShadow: Tokens['shadows']['sm'];
  };
}

// ─── Free theme ────────────────────────────────────────────────────────────────
const freeTheme: Theme = {
  tokens,
  tier: 'free',
  tierColors: {
    accentBorder: tokens.colors.forest,           // forest hairline
    accentBg:     'rgba(44,74,54,0.06)',           // forest at 6% opacity
    accentFg:     tokens.colors.forest,
    badgeShadow:  tokens.shadows.sm,
  },
};

// ─── Founder theme ─────────────────────────────────────────────────────────────
// Founding member badge: a 1px hairline in mutedGold on bone,
// tracked all-caps label "FOUNDING · 03 OF 88." No glow. No fill.
const founderTheme: Theme = {
  tokens,
  tier: 'founder',
  tierColors: {
    accentBorder: tokens.gold.border,             // camel hairline (rgba)
    accentBg:     tokens.gold[100],               // subtle gold tint
    accentFg:     tokens.gold[700],               // darker gold label
    badgeShadow:  tokens.shadows.sm,
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
