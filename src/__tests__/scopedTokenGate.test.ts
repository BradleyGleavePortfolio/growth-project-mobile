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

const ROOT = path.resolve(__dirname, '..', '..');

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
