// src/theme/__tests__/contrastTokens.test.ts
//
// v3-1 #235 R4 P2-1 — REGRESSION GATE for the dark-mode accent-text contrast
// fix (D-046). The dark `accent` fill #B43C3C only reaches ~3.28:1 on bgPrimary
// #121110 and ~3.02:1 on bgSurface #1C1A18 — below WCAG AA's 4.5:1 floor for
// body-sized text. The fix introduces a SEPARATE `accentText` role (dark
// #E07373) for accent-tinted FOREGROUND text/icons, while `accent` stays the
// fill (CTA backgrounds, progress fills, borders).
//
// This gate locks `accentText` so its value can never drift back below AA on
// either dark background, and confirms `accent` (the fill) is unchanged so the
// filled-CTA contrast (textOnAccent on accent) is preserved.

import { lightTokens, darkTokens } from '../tokens';

// ─── WCAG 2.1 relative-luminance contrast ──────────────────────────────────
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

describe('v3-1 #235 R4 P2-1 — accentText AA contrast gate', () => {
  it('dark accentText clears AA on BOTH dark bgPrimary and bgSurface', () => {
    const onPrimary = contrastRatio(darkTokens.accentText, darkTokens.bgPrimary);
    const onSurface = contrastRatio(darkTokens.accentText, darkTokens.bgSurface);
    expect(onPrimary).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(onSurface).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('light accentText clears AA on BOTH light bgPrimary and bgSurface', () => {
    const onPrimary = contrastRatio(lightTokens.accentText, lightTokens.bgPrimary);
    const onSurface = contrastRatio(lightTokens.accentText, lightTokens.bgSurface);
    expect(onPrimary).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(onSurface).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('documents the audited regression: the dark accent FILL fails AA as text', () => {
    // This is the bug `accentText` exists to avoid — assert the fill is still
    // below AA so a future "just use accent for text" regression is obvious.
    expect(
      contrastRatio(darkTokens.accent, darkTokens.bgPrimary),
    ).toBeLessThan(AA_NORMAL);
    expect(
      contrastRatio(darkTokens.accent, darkTokens.bgSurface),
    ).toBeLessThan(AA_NORMAL);
  });

  it('accent FILL is unchanged so the filled CTA (textOnAccent on accent) stays AA', () => {
    // Splitting the role must NOT touch the fill; the CTA label contrast
    // (textOnAccent on accent) must still clear AA in both modes.
    expect(darkTokens.accent).toBe('#B43C3C');
    expect(lightTokens.accent).toBe('#4A0404');
    expect(
      contrastRatio(darkTokens.textOnAccent, darkTokens.accent),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(
      contrastRatio(lightTokens.textOnAccent, lightTokens.accent),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('logs measured accentText ratios for the manual contrast gate', () => {
    const dp = contrastRatio(darkTokens.accentText, darkTokens.bgPrimary);
    const ds = contrastRatio(darkTokens.accentText, darkTokens.bgSurface);
    const lp = contrastRatio(lightTokens.accentText, lightTokens.bgPrimary);
    const ls = contrastRatio(lightTokens.accentText, lightTokens.bgSurface);
    // eslint-disable-next-line no-console
    console.log(
      `[contrastTokens] dark accentText ${darkTokens.accentText}: ` +
        `vs bgPrimary ${darkTokens.bgPrimary} = ${dp.toFixed(2)}:1 | ` +
        `vs bgSurface ${darkTokens.bgSurface} = ${ds.toFixed(2)}:1 ; ` +
        `light accentText ${lightTokens.accentText}: ` +
        `vs bgPrimary ${lightTokens.bgPrimary} = ${lp.toFixed(2)}:1 | ` +
        `vs bgSurface ${lightTokens.bgSurface} = ${ls.toFixed(2)}:1`,
    );
    expect(dp).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(ds).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});
