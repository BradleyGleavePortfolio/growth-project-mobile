/**
 * ThemeProvider — Luxury Visual System (Wave 2) + Phase 11 Dark Mode
 *
 * Phase 11 additions:
 *   - Resolves `useColorScheme()` (system preference) into the active
 *     semantic token map (`lightTokens` or `darkTokens`).
 *   - User override ('system' | 'light' | 'dark') stored in AsyncStorage
 *     under the key `gp_appearance` and persisted across sessions.
 *   - Exposes `colorScheme`, `appearanceOverride`, and `setAppearanceOverride`
 *     so the Settings screen can render and mutate the Appearance radio.
 *
 * Existing behaviour preserved:
 *   - Reads founding-member status from useFoundingNumber() and vends either
 *     freeTheme or founderTheme via the ThemeColors / tierColors fields.
 *   - founderTheme = freeTheme + muted-gold accent overrides.
 *
 * Wave 2 changes preserved:
 *   - heroGradientStop removed (LinearGradient deleted in Wave 1)
 *   - shimmerHighlight removed (shimmer deleted in Wave 1)
 *   - All references updated to new color tokens
 */

import React, { createContext, useContext, ReactNode, useState, useEffect, useMemo } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import tokens, { Tokens, SemanticTokens, lightTokens, darkTokens } from './tokens';
import CanonicalColors from '../constants/colors';
import { useFoundingNumber } from '../hooks/useIdentity';

// ─── Appearance override type ─────────────────────────────────────────────────
/** 'system' defers to the device colour scheme; 'light' and 'dark' hard-lock it. */
export type AppearanceOverride = 'system' | 'light' | 'dark';

const APPEARANCE_KEY = 'gp_appearance';

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
  /** Phase 11: resolved semantic tokens for the active colour scheme */
  semanticColors: SemanticTokens;
  /** Phase 11: the resolved colour scheme ('light' or 'dark') */
  colorScheme: 'light' | 'dark';
  /** Phase 11: the user's persisted override (default: 'system') */
  appearanceOverride: AppearanceOverride;
  /** Phase 11: updates and persists the user's appearance preference */
  setAppearanceOverride: (override: AppearanceOverride) => void;
}

// ─── Internal theme builders ──────────────────────────────────────────────────
function buildTheme(
  tier: Tier,
  semanticColors: SemanticTokens,
  colorScheme: 'light' | 'dark',
  appearanceOverride: AppearanceOverride,
  setAppearanceOverride: (o: AppearanceOverride) => void,
): Theme {
  const tierColors =
    tier === 'founder'
      ? {
          accentBorder: tokens.gold.border,
          accentBg:     tokens.gold[100],
          accentFg:     tokens.gold[700],
          badgeShadow:  tokens.shadows.sm,
        }
      : {
          accentBorder: tokens.colors.forest,
          accentBg:     'rgba(44,74,54,0.06)',
          accentFg:     tokens.colors.forest,
          badgeShadow:  tokens.shadows.sm,
        };

  return {
    tokens,
    tier,
    colors: baseColors,
    tierColors,
    semanticColors,
    colorScheme,
    appearanceOverride,
    setAppearanceOverride,
  };
}

// ─── Default context (light, free) ────────────────────────────────────────────
const noop = () => {};
const defaultTheme = buildTheme('free', lightTokens, 'light', 'system', noop);

const ThemeContext = createContext<Theme>(defaultTheme);

// ─── ThemeProvider ─────────────────────────────────────────────────────────────
interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { data: foundingData } = useFoundingNumber();
  const systemScheme = useSystemColorScheme() ?? 'light';

  const [appearanceOverride, setOverrideState] = useState<AppearanceOverride>('system');
  const [overrideLoaded, setOverrideLoaded] = useState(false);

  // Load persisted override on mount
  useEffect(() => {
    AsyncStorage.getItem(APPEARANCE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setOverrideState(stored);
        }
      })
      .catch(() => {
        // Silently fall back to 'system'
      })
      .finally(() => setOverrideLoaded(true));
  }, []);

  const setAppearanceOverride = useMemo(
    () => async (override: AppearanceOverride) => {
      setOverrideState(override);
      try {
        await AsyncStorage.setItem(APPEARANCE_KEY, override);
      } catch {
        // Non-fatal — preference will revert on next app launch
      }
    },
    [],
  );

  const colorScheme: 'light' | 'dark' = useMemo(() => {
    if (appearanceOverride === 'light') return 'light';
    if (appearanceOverride === 'dark') return 'dark';
    return systemScheme;
  }, [appearanceOverride, systemScheme]);

  const semanticColors: SemanticTokens = colorScheme === 'dark' ? darkTokens : lightTokens;

  const isFoundingMember =
    foundingData != null &&
    typeof (foundingData as { founding_number?: unknown }).founding_number === 'number';

  const tier: Tier = isFoundingMember ? 'founder' : 'free';

  const theme = useMemo(
    () => buildTheme(tier, semanticColors, colorScheme, appearanceOverride, setAppearanceOverride),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tier, colorScheme, appearanceOverride],
  );

  // Render children immediately — the override defaults to 'system' so the
  // first render is correct on initial mount. Once AsyncStorage resolves the
  // stored preference a re-render adjusts the scheme if needed.
  // We keep overrideLoaded in scope to silence the lint warning but intentionally
  // do not gate rendering on it to avoid a flash.
  void overrideLoaded;

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
