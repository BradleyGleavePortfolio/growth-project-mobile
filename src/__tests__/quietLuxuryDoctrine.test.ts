/**
 * Enforces the rules from docs/QUIET_LUXURY_DOCTRINE.md by scanning the
 * shipped surface of the app. If any of these assertions fail, do NOT add
 * the offending file to an allowlist — fix the file. The doctrine is the
 * point.
 *
 * Scope: src/screens, src/components. Tests, types, and the legacy onboarding
 * step files are excluded (the long-flow onboarding is no longer reachable;
 * sweeping it is out of scope for Wave 5b).
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

const SCAN_DIRS = [
  path.join(ROOT, 'screens'),
  path.join(ROOT, 'components'),
];

// Files explicitly allowed to slip through individual rules. Keep this list
// short and motivated; do not pad it.
const ALLOWLIST_HEAVY_WEIGHT: Set<string> = new Set();

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      // Skip the legacy long-form onboarding files — out of scope for Wave 5b.
      if (/onboarding\/OnboardingStep\d+\.tsx$/.test(full)) continue;
      if (/onboarding\/OnboardingResults\.tsx$/.test(full)) continue;
      out.push(full);
    }
  }
  return out;
}

const FILES = SCAN_DIRS.flatMap(walk);

// Strip line and block comments before scanning so an explanatory note in a
// header comment doesn't trip the assertion.
function stripComments(src: string): string {
  // Block comments
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Line comments
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return out;
}

describe('Quiet-luxury doctrine (docs/QUIET_LUXURY_DOCTRINE.md)', () => {
  it('does not use fontWeight 700 or 800 in shipped screens or components', () => {
    const offenders: string[] = [];
    const re = /fontWeight\s*:\s*['"](?:700|800)['"]/;
    for (const file of FILES) {
      if (ALLOWLIST_HEAVY_WEIGHT.has(file)) continue;
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (re.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('does not contain "Coming Soon" / "In Development" / "Planned" placeholder copy', () => {
    const offenders: string[] = [];
    const re = /["'`](?:Coming Soon|Coming soon|In Development|in development)["'`]/;
    for (const file of FILES) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (re.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('does not contain TODO / FIXME / XXX comments', () => {
    const offenders: string[] = [];
    const re = /\b(?:TODO|FIXME|XXX)\b/;
    for (const file of FILES) {
      const src = fs.readFileSync(file, 'utf8');
      if (re.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('does not contain trophy / confetti / first-win celebration chrome', () => {
    const offenders: string[] = [];
    // Allow incidental references inside the doctrine module name itself.
    const re = /(FirstWinCelebration|TrophyArtifact|TrophyShareScreen|confetti)/i;
    for (const file of FILES) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (re.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('does not use Ionicons name="flame" anywhere in shipped surface', () => {
    const offenders: string[] = [];
    const re = /Ionicons[\s\S]*?name\s*=\s*["'`]flame(?:-[a-z]+)?["'`]/;
    const reInline = /name\s*=\s*["'`]flame(?:-[a-z]+)?["'`]/;
    for (const file of FILES) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (re.test(src) || reInline.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('does not use Ionicons name="trophy" anywhere in shipped surface', () => {
    const offenders: string[] = [];
    const re = /name\s*=\s*["'`]trophy(?:-[a-z]+)?["'`]/;
    for (const file of FILES) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (re.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('does not reference the legacy BadgeCabinet identifier', () => {
    const offenders: string[] = [];
    const re = /BadgeCabinet/;
    for (const file of FILES) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (re.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it("does not include 'streak' as a discriminated-union member in db/notificationsDb.ts", () => {
    const file = path.join(ROOT, 'db', 'notificationsDb.ts');
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    // The forbidden form is the literal string 'streak' inside a union: e.g. | 'streak'
    const re = /['"]streak['"]/;
    expect(re.test(src)).toBe(false);
  });

  it('does not reference Leaderboard in shipped screens', () => {
    const offenders: string[] = [];
    const re = /Leaderboard/;
    for (const file of FILES) {
      // The doctrine test file itself is allowed to reference the term.
      if (file === __filename) continue;
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (re.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('does not embed pictograph emoji in source', () => {
    const offenders: string[] = [];
    // Pictograph ranges only — bare typographic marks like ✓ (U+2713) and
    // arrows are allowed because they read as glyphs, not as emoji.
    // Misc Symbols & Pictographs / Emoticons / Transport / Supplemental.
    const re = /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{1F1E6}-\u{1F1FF}]/u;
    for (const file of FILES) {
      const src = fs.readFileSync(file, 'utf8');
      if (re.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });
});
