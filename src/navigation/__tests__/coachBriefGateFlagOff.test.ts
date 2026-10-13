/**
 * BRIEFA flag-off proof. EXPO_PUBLIC_FF_COACH_BRIEF_GATE defaults off and no
 * build profile turns it on. With coachBrief or coachBriefGate off, the brief's
 * list route is not registered and nothing in the app can open it, so today's
 * app is unchanged. Static, like romanFlagOff.test.ts: no navigator mount.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const FLAGS = read('src/config/featureFlags.ts');
const COACH_NAV = read('src/navigation/CoachNavigator.tsx');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe('coachBriefGate flag', () => {
  it('reads EXPO_PUBLIC_FF_COACH_BRIEF_GATE with a false default', () => {
    expect(FLAGS).toMatch(/coachBriefGate:\s*readFlag\('EXPO_PUBLIC_FF_COACH_BRIEF_GATE',\s*false\)/);
  });

  it('is not turned on by any build profile', () => {
    const eas = JSON.parse(read('eas.json')) as { build: Record<string, { env?: Record<string, string> }> };
    for (const profile of Object.values(eas.build)) {
      expect(profile.env?.EXPO_PUBLIC_FF_COACH_BRIEF_GATE).toBeUndefined();
    }
  });
});

describe('CoachBrief route', () => {
  it('shows Concept A only with coachBriefGate on; otherwise today\'s CoachBriefScreen', () => {
    expect(COACH_NAV).toMatch(
      /\{featureFlags\.coachBrief && \(\s*<SettingsStack\.Screen\s+name="CoachBrief"\s+component=\{featureFlags\.coachBriefGate \? CoachBriefLightScreen : CoachBriefScreen\}/,
    );
    expect(COACH_NAV.match(/component=\{[^}]*CoachBriefLightScreen/g)).toHaveLength(1);
  });

  it('hides the tab bar only for Concept A', () => {
    expect(COACH_NAV).toMatch(
      /\.\.\.\(featureFlags\.coachBriefGate && getFocusedRouteNameFromRoute\(route\) === 'CoachBrief'\s*\?\s*\{ tabBarStyle: \{ display: 'none' as const \} \}\s*:\s*\{\}\)/,
    );
    expect(COACH_NAV.match(/tabBarStyle/g)).toHaveLength(2);
  });
});

describe('CoachBriefList route', () => {
  it('is registered once, only behind coachBrief and coachBriefGate', () => {
    const screens = COACH_NAV.match(/name="CoachBriefList"/g) ?? [];
    expect(screens).toHaveLength(1);
    const guard = COACH_NAV.search(/\{featureFlags\.coachBrief && featureFlags\.coachBriefGate && \(\s*<SettingsStack\.Screen name="CoachBriefList"/);
    expect(guard).toBeGreaterThan(-1);
  });

  it('is opened only from the brief screens', () => {
    const openers = walk(path.join(ROOT, 'src'))
      .filter((f) => /'CoachBriefList'|"CoachBriefList"/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(openers).toContain('src/navigation/CoachNavigator.tsx');
    for (const f of openers) expect(f).toMatch(/navigation\/CoachNavigator\.tsx$|screens\/coach\/brief\//);
  });
});
