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

// Faint greys that fail AA as text on light grounds: stone and its legacy copies (#B1A89F) and the recovery slate.
const FAINT = /\b(colors|tokens)\.stone\b|#B1A89F|#7E879E|\b(Colors|colors)\.(streak|tabInactive|medalSilver)\b|\baccentMuted\b/i;
// Each allowance is one reviewed line (file | text on that line) and must still match, so none goes stale.
// Disabled marks keep stone (a dark grey would read as enabled); the recovery resolver's `color` is the ring fill.
const ALLOWED = [
  'components/roman/adjust/RomanAdjustmentCard.tsx|disabledText: { color: colors.stone }',
  'components/AllergySafetyPrompt.tsx|laterTextDisabled: { color: colors.stone }',
  'screens/coach/client-detail/WearableInsightPanel.tsx|{ color: canEdit ? accentInk : colors.stone }',
  'screens/client/wearables/recoveryTheme.ts|color: (p) => p.accentMuted',
];
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

  it('no text colour, plain or conditional, uses a faint grey outside the allowed lines', () => {
    const hits: string[] = [];
    for (const file of files(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/\bcolor:/g)) {
          const rest = line.slice((m.index ?? 0) + 6);
          const cut = rest.search(/,\s*\w+\s*:/); // stop at the next style key
          const value = cut < 0 ? rest : rest.slice(0, cut);
          if (FAINT.test(value)) hits.push(`${rel}:${i + 1}|${line.trim()}`);
        }
      });
    }
    const allowed = (hit: string, entry: string) => {
      const [file, text] = entry.split('|');
      return hit.startsWith(`${file}:`) && hit.includes(text);
    };
    expect(hits.filter((hit) => !ALLOWED.some((entry) => allowed(hit, entry)))).toEqual([]);
    expect(ALLOWED.filter((entry) => !hits.some((hit) => allowed(hit, entry)))).toEqual([]);
  });

  // LO-875R C4: the LTV dashboard takes graphite from the theme, not its own hex copy.
  it('the LTV dashboard uses colors.graphite, with no #2C2C2C literal', () => {
    const src = fs.readFileSync(path.join(SRC, 'components/command-center/CoachLtvDashboard.tsx'), 'utf8');
    expect(src).not.toMatch(/['"`]#2C2C2C['"`]/i);
    expect(src).toMatch(/const GREY_TEXT = colors\.graphite;/);
  });
});
