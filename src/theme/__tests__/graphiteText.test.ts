// Owner #168-13: small grey text on light grounds is graphite #2C2C2C.
// Locks the token's contrast and keeps the faint stone grey out of text styles.
import fs from 'fs';
import path from 'path';
import { colors, lightTokens } from '../tokens';

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Disabled marks keep stone (a dark grey would read as enabled). CoachLtvDashboard
// is swept by its own lane (LTV-GOLD).
const ALLOWED = new Set([
  'components/roman/adjust/RomanAdjustmentCard.tsx',
  'components/command-center/CoachLtvDashboard.tsx',
]);
const SRC = path.join(__dirname, '..', '..');
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : files(full);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : [];
  });

describe('#168-13 graphite small text', () => {
  it('is #2C2C2C and clears AA on every light ground', () => {
    expect(colors.graphite).toBe('#2C2C2C');
    for (const bg of [colors.bone, colors.cream, lightTokens.bgSurface, lightTokens.surface.sage]) {
      expect(ratio(colors.graphite, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('no text style uses stone outside the allowed disabled marks', () => {
    const hits = files(SRC)
      .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => /\bcolor:\s*(colors|tokens)\.stone\b/.test(fs.readFileSync(path.join(SRC, rel), 'utf8')));
    expect(hits).toEqual([]);
  });
});
