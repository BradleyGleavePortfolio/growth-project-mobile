// Source-level guards for the ReportScreen P0-1 TDZ fix and the related
// timezone-correct daily lookup. Mounting the screen under Jest is fragile
// because of expo-font + react-navigation deps; the deterministic guard is
// to assert the file no longer has the "reference Colors before its import"
// shape that almost white-screened the Reports tab.

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SRC_PATH = path.join(ROOT, 'src', 'screens', 'client', 'ReportScreen.tsx');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

const lines = SRC.split('\n');
function lineIndex(pattern: RegExp): number {
  return lines.findIndex((l) => pattern.test(l));
}

describe('ReportScreen — audit P0-1 TDZ fix', () => {
  it('has no Colors reference left to hit before its import', () => {
    // C8 found 1 removed the only Colors use (a red weight gain), so the TDZ
    // shape the audit flagged cannot come back without a new import.
    const importIdx = lineIndex(/^import\s*\{\s*Colors\s*\}/);
    const firstUseIdx = lineIndex(/\bColors\.[A-Za-z]/);
    expect(firstUseIdx === -1 || (importIdx > -1 && importIdx < firstUseIdx)).toBe(true);
  });

  it('uses the locale-aware getTodayString helper for the daily macros fetch', () => {
    // The previous code called `new Date().toISOString().split('T')[0]` —
    // a UTC bucket — which is wrong for users east of UTC. The fix funnels
    // through the shared `getTodayString` helper (which is now local-tz).
    expect(SRC).toMatch(/from\s+'\.\.\/\.\.\/utils\/date'/);
    expect(SRC).toMatch(/getTodayString\(\)/);
    expect(SRC).not.toMatch(/new\s+Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]/);
  });
});
