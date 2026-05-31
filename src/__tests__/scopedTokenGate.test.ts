// src/__tests__/scopedTokenGate.test.ts
//
// PR-18 M1 — STATIC GREP GATE for the semantic-token migration (item 1).
//
// Every scoped package / commerce / deliverables screen MUST consume colors
// through `useTheme()` semantic tokens. After this PR they may contain:
//   • NO raw hex color literals (#RGB / #RRGGBB / #RRGGBBAA), and
//   • NO `ThemeColors` type/import (the legacy per-screen color contract).
//
// Comments are stripped before the scan so that doctrine notes (which may name
// a forbidden pattern to document the rule) never trip the gate — only the
// rendered code is asserted. The gate scans the SCOPED SCREEN FILES only; the
// token source files (tokens.ts / colors.ts) legitimately define hex values
// and are intentionally excluded.

import * as fs from 'fs';
import * as path from 'path';

import { lightTokens, darkTokens } from '../theme/tokens';

const ROOT = path.resolve(__dirname, '..', '..');

// ─── WCAG 2.1 relative-luminance contrast ──────────────────────────────────
// Locks the P2 fix: muted text on cream and on-accent text must clear AA
// (>= 4.5:1) for normal body-sized text so the token values cannot drift back
// to the audited failing pairs (muted #78736E @4.10:1, dark on-accent
// #1A1714 @3.10:1).
function channelLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function relLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channelLinear(r) + 0.7152 * channelLinear(g) + 0.0722 * channelLinear(b);
}
function contrastRatio(fg: string, bg: string): number {
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
const AA_NORMAL = 4.5;

const SCOPED_FILES = [
  'src/components/PackageSelectionSheet.tsx',
  'src/screens/client/ClientPackagesScreen.tsx',
  'src/screens/client/PackageCheckoutScreen.tsx',
  'src/screens/client/CheckoutReturnScreen.tsx',
  'src/screens/client/BrandedCheckoutWebViewScreen.tsx',
  'src/screens/client/DeliverablesScreen.tsx',
  'src/screens/client/PurchaseUnpackScreen.tsx',
  'src/screens/client/deliverables/dropRow.tsx',
  'src/screens/client/packageDetail/PackageDetailSurface.tsx',
  'src/screens/coach/payments/CoachPackageEditScreen.tsx',
  'src/screens/coach/payments/CoachPackageContentsScreen.tsx',
  'src/screens/coach/payments/CoachPackagesListScreen.tsx',
  'src/screens/coach/payments/CoachPackageSubscribersScreen.tsx',
];

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// 3–8 hex digits guarded by a word boundary so we match #fff, #2C4A36,
// #FBF7F0FF but not arbitrary identifiers.
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

describe('PR-18 M1 — scoped semantic-token gate', () => {
  it.each(SCOPED_FILES)('exists and is readable: %s', (rel) => {
    expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
  });

  it.each(SCOPED_FILES)('contains NO raw hex color literals: %s', (rel) => {
    const code = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    const matches = code.match(HEX_RE) ?? [];
    expect(matches).toEqual([]);
  });

  it.each(SCOPED_FILES)('does NOT reference the legacy ThemeColors type: %s', (rel) => {
    const code = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    expect(code).not.toMatch(/\bThemeColors\b/);
  });

  it.each(SCOPED_FILES)('consumes colors via useTheme(): %s', (rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    expect(src).toMatch(/useTheme/);
  });
});

describe('PR-18 M1 — semantic-token AA contrast gate (P2)', () => {
  it('light textMuted clears AA on cream bgPrimary and bgSurface', () => {
    const onCream = contrastRatio(lightTokens.textMuted, lightTokens.bgPrimary);
    const onSurface = contrastRatio(lightTokens.textMuted, lightTokens.bgSurface);
    expect(onCream).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(onSurface).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('light textOnAccent clears AA on the light accent', () => {
    expect(
      contrastRatio(lightTokens.textOnAccent, lightTokens.accent),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('dark textOnAccent clears AA on the lifted dark accent', () => {
    expect(
      contrastRatio(darkTokens.textOnAccent, darkTokens.accent),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('dark textMuted clears AA on dark bgPrimary and bgSurface', () => {
    expect(
      contrastRatio(darkTokens.textMuted, darkTokens.bgPrimary),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(
      contrastRatio(darkTokens.textMuted, darkTokens.bgSurface),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('light textOnDisabled clears AA on the disabled fill', () => {
    expect(
      contrastRatio(lightTokens.textOnDisabled, lightTokens.disabledBg),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('dark textOnDisabled clears AA on the disabled fill', () => {
    expect(
      contrastRatio(darkTokens.textOnDisabled, darkTokens.disabledBg),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('textPrimary clears AA on its mode background', () => {
    expect(
      contrastRatio(lightTokens.textPrimary, lightTokens.bgPrimary),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(
      contrastRatio(darkTokens.textPrimary, darkTokens.bgPrimary),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});
