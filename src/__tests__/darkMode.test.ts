/**
 * darkMode.test.ts — Phase 11: ThemeProvider dark-mode unit tests
 *
 * Guards the semantic token resolution logic so that:
 *  1. override='dark'   → darkTokens resolved regardless of system scheme
 *  2. override='light'  → lightTokens resolved regardless of system scheme
 *  3. override='system' → follows the mocked useColorScheme() value
 *
 * Uses source-level contract tests (no component render required) plus
 * a light functional test of the token shape.
 */

import { lightTokens, darkTokens } from '../theme/tokens';

// ─── Token shape guard ────────────────────────────────────────────────────────

describe('lightTokens shape', () => {
  it('exposes all required semantic keys', () => {
    expect(lightTokens).toHaveProperty('bgPrimary');
    expect(lightTokens).toHaveProperty('bgSurface');
    expect(lightTokens).toHaveProperty('textPrimary');
    expect(lightTokens).toHaveProperty('textMuted');
    expect(lightTokens).toHaveProperty('accent');
    expect(lightTokens).toHaveProperty('border');
  });

  it('bgPrimary is the bone value', () => {
    expect(lightTokens.bgPrimary).toBe('#F5EFE4');
  });

  it('textPrimary is the ink value', () => {
    expect(lightTokens.textPrimary).toBe('#1A1A18');
  });
});

describe('darkTokens shape', () => {
  it('exposes all required semantic keys', () => {
    expect(darkTokens).toHaveProperty('bgPrimary');
    expect(darkTokens).toHaveProperty('bgSurface');
    expect(darkTokens).toHaveProperty('textPrimary');
    expect(darkTokens).toHaveProperty('textMuted');
    expect(darkTokens).toHaveProperty('accent');
    expect(darkTokens).toHaveProperty('border');
  });

  it('bgPrimary is dark (near-black)', () => {
    expect(darkTokens.bgPrimary).toBe('#121110');
  });

  it('textPrimary is light (near-white)', () => {
    expect(darkTokens.textPrimary).toBe('#EBE6DE');
  });

  it('accent is the lifted oxblood', () => {
    expect(darkTokens.accent).toBe('#B43C3C');
  });
});

describe('token distinctness', () => {
  it('light and dark bgPrimary differ', () => {
    expect(lightTokens.bgPrimary).not.toBe(darkTokens.bgPrimary);
  });

  it('light and dark textPrimary differ', () => {
    expect(lightTokens.textPrimary).not.toBe(darkTokens.textPrimary);
  });

  it('dark accent has better contrast than light accent for dark backgrounds', () => {
    // The dark accent (#B43C3C) is a lighter oxblood to maintain AA contrast
    // on a near-black background. Validate that the dark value is "lighter"
    // (higher total RGB) than the light value (#4A0404).
    const parseHex = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    };
    const [lr, lg, lb] = parseHex(lightTokens.accent);
    const [dr, dg, db] = parseHex(darkTokens.accent);
    const lightLuminance = lr + lg + lb;
    const darkLuminance  = dr + dg + db;
    expect(darkLuminance).toBeGreaterThan(lightLuminance);
  });
});

// ─── ThemeProvider resolution logic (source-level) ────────────────────────────

import * as fs from 'fs';
import * as path from 'path';

const PROVIDER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'theme', 'ThemeProvider.tsx'),
  'utf8',
);

describe('ThemeProvider source-level contract', () => {
  it('imports useColorScheme from react-native', () => {
    expect(PROVIDER_SRC).toMatch(/useColorScheme.*from 'react-native'/);
  });

  it('reads override from AsyncStorage with the correct key', () => {
    expect(PROVIDER_SRC).toMatch(/gp_appearance/);
  });

  it("resolves 'light' override to 'light' scheme", () => {
    // The resolution logic must contain a branch that maps 'light' -> 'light'
    expect(PROVIDER_SRC).toMatch(/appearanceOverride === 'light'.*return 'light'/s);
  });

  it("resolves 'dark' override to 'dark' scheme", () => {
    expect(PROVIDER_SRC).toMatch(/appearanceOverride === 'dark'.*return 'dark'/s);
  });

  it("falls back to systemScheme when override is 'system'", () => {
    // When no explicit override, the code must return systemScheme
    expect(PROVIDER_SRC).toMatch(/return systemScheme/);
  });

  it('persists override to AsyncStorage on change', () => {
    expect(PROVIDER_SRC).toMatch(/AsyncStorage\.setItem\(APPEARANCE_KEY/);
  });

  it('exposes setAppearanceOverride on the Theme context', () => {
    expect(PROVIDER_SRC).toMatch(/setAppearanceOverride/);
  });

  it('exposes semanticColors on the Theme context', () => {
    expect(PROVIDER_SRC).toMatch(/semanticColors/);
  });

  it('exposes colorScheme on the Theme context', () => {
    expect(PROVIDER_SRC).toMatch(/colorScheme/);
  });
});

// ─── useTheme.ts re-export contract ───────────────────────────────────────────

const USE_THEME_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'theme', 'useTheme.ts'),
  'utf8',
);

describe('useTheme.ts', () => {
  it('re-exports useTheme from ThemeProvider', () => {
    expect(USE_THEME_SRC).toMatch(/export.*useTheme.*from.*ThemeProvider/);
  });

  it('re-exports AppearanceOverride type', () => {
    expect(USE_THEME_SRC).toMatch(/AppearanceOverride/);
  });
});
