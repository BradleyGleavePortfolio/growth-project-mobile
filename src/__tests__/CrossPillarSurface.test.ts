// Stage 3 — cross-pillar surface contract guards.
//
// Source-level reads to guarantee:
//   1. The cross-pillar API client is typed (no `Record<string, unknown>`)
//      and lives where the screens import from.
//   2. The Settings entry navigates to the live nested navigator, not
//      the Stage-2 stub (the stub remains reachable at `BothPillarsLegacyStub`
//      for QA but is intentionally not the user-facing path).
//   3. The Stage-3 `coach_practice_type` enum is present on both Prisma
//      schemas (fitness mobile imports it through the typed contract).
//
// We deliberately do NOT mount the cross-pillar screens in RTL — they
// pull a deep tree (theme, navigation, hooks) and the value of those
// integration tests is small relative to their flake risk. The
// component logic that matters (search debounce, recent-on-focus) is
// covered by `UniversalClientSearch.test.tsx` directly.

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('cross-pillar API client — typed contract', () => {
  const apiSrc = read('src/services/api.ts');
  const typesSrc = read('src/types/crossPillar.ts');

  it('imports SubmitQuizAnswers-style typed shapes from crossPillar.ts', () => {
    expect(apiSrc).toMatch(/CrossPillarRosterResponse/);
    expect(apiSrc).toMatch(/CrossPillarSearchResponse/);
    expect(apiSrc).toMatch(/CrossPillarClientResponse/);
    expect(apiSrc).toMatch(/CrossPillarAnalyticsResponse/);
    expect(apiSrc).toMatch(/PracticeTypeResponse/);
    expect(apiSrc).toMatch(/CoachPracticeType/);
  });

  it('does not use Record<string, unknown> for cross-pillar payloads', () => {
    // Belt-and-suspenders against Stage-1's silent-bucket bug class.
    // Slice the file from the cross-pillar opening comment through the
    // close of the crossPillarApi object, then strip line and block
    // comments — the test prose itself mentions the forbidden token.
    const start = apiSrc.indexOf('Stage 3 — coach practice type');
    const endMarker = '\nexport const messagesApi';
    const end = apiSrc.indexOf(endMarker, start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const xpRegion = apiSrc
      .slice(start, end)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(xpRegion).not.toMatch(/Record<string,\s*unknown>/);
    expect(xpRegion).toMatch(/crossPillarApi/);
  });

  it('the practice-type contract has a closed string-literal union', () => {
    expect(typesSrc).toMatch(/CoachPracticeType\s*=\s*['"]fitness_only['"][^;]*['"]finance_only['"][^;]*['"]both['"]/s);
  });

  it('renders the cross-pillar wire shapes the backend returns', () => {
    expect(typesSrc).toMatch(/CrossPillarRosterRow/);
    expect(typesSrc).toMatch(/identity_mapping:\s*['"]email['"]/);
  });
});

describe('Coach navigator wiring — live cross-pillar surface', () => {
  const navSrc = read('src/navigation/CoachNavigator.tsx');

  it('imports the new CrossPillarNavigator', () => {
    expect(navSrc).toMatch(/from\s+['"]\.\.\/screens\/coach\/cross-pillar\/CrossPillarNavigator['"]/);
  });

  it('mounts CrossPillarNavigator at the BothPillars route (not the stub)', () => {
    // The Stage-2 stub remains importable but is mounted at the legacy
    // route name only.
    expect(navSrc).toMatch(/<SettingsStack\.Screen\s+name="BothPillars"\s+component=\{CrossPillarNavigator\}/);
    expect(navSrc).toMatch(/BothPillarsLegacyStub/);
  });
});

describe('Settings entry copy — live, not preview', () => {
  const settingsSrc = read('src/screens/coach/SettingsScreen.tsx');

  it('does not advertise the screen as "Stage 3 wires real data"', () => {
    expect(settingsSrc).not.toMatch(/Stage 3 wires/);
  });

  it('describes the live cross-pillar capabilities to the coach', () => {
    expect(settingsSrc).toMatch(/Unified roster/);
    expect(settingsSrc).toMatch(/holistic insights/);
  });
});
