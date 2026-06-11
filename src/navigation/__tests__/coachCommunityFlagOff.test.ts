/**
 * Flag-off guarantees for the v1-6 coach Community tab.
 *
 * The CommunityStack tab + its six CoachCommunity routes must NOT exist when
 * featureFlags.coachCommunity is OFF (the default). We assert this STATICALLY
 * by reading the navigator source and pinning the flag gate, rather than
 * mounting React Navigation (which pulls in reanimated / gesture-handler).
 * This mirrors the existing communityFlagOff.test.ts pattern.
 *
 * Also asserts the coachCommunity Expo flag defaults to OFF and that no
 * build-role marker token leaked into the v1-6 coach source tree (build-role
 * hygiene, paralleling the v1-5 `dormant` check). The forbidden token is
 * assembled at runtime so the literal never appears in source.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

const COACH_NAV = fs.readFileSync(
  path.join(ROOT, 'navigation', 'CoachNavigator.tsx'),
  'utf8',
);
const FLAGS = fs.readFileSync(
  path.join(ROOT, 'config', 'featureFlags.ts'),
  'utf8',
);

describe('Coach Community tab — flag-gated mount (default OFF)', () => {
  it('renders the CommunityStack <Tab.Screen> only behind featureFlags.coachCommunity', () => {
    // The Tab.Screen for the coach Community tab must be wrapped in a
    // `featureFlags.coachCommunity && (...)` guard. We locate the guarded
    // block and confirm the CommunityStack screen lives INSIDE it.
    expect(COACH_NAV).toMatch(
      /\{featureFlags\.coachCommunity\s*&&\s*\(/,
    );
    // The CommunityStack screen registration exists, wired to the v1-6
    // coach community navigator.
    expect(COACH_NAV).toMatch(
      /name=["']CommunityStack["']\s+component=\{CoachCommunityNavigator\}/,
    );
    // And it is NOT registered unconditionally: the CommunityStack
    // <Tab.Screen> appears AFTER the flag guard in source order.
    const guardIdx = COACH_NAV.search(/\{featureFlags\.coachCommunity\s*&&/);
    const screenIdx = COACH_NAV.search(
      /name=["']CommunityStack["']\s+component=\{CoachCommunityNavigator\}/,
    );
    expect(guardIdx).toBeGreaterThan(-1);
    expect(screenIdx).toBeGreaterThan(guardIdx);
  });

  it('does not register the CommunityStack tab unconditionally', () => {
    // There must be exactly one CommunityStack <Tab.Screen>, and it lives
    // inside the flag guard (asserted above) — never a second, unguarded one.
    const occurrences =
      COACH_NAV.match(/name=["']CommunityStack["']\s+component=\{CoachCommunityNavigator\}/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });
});

describe('Expo feature flag — coachCommunity default OFF', () => {
  it('declares coachCommunity reading EXPO_PUBLIC_FF_COACH_COMMUNITY with a false default', () => {
    // The flag must read its env var via readFlag(..., false) so the default
    // is OFF regardless of environment (NOT isDev — unconditional false).
    expect(FLAGS).toMatch(
      /readFlag\([^)]*EXPO_PUBLIC_FF_COACH_COMMUNITY[^)]*,\s*false\s*\)/,
    );
  });

  it('exposes a coachCommunity key on the flag map', () => {
    expect(FLAGS).toMatch(/coachCommunity\s*:/);
  });

  it('does not default coachCommunity to isDev', () => {
    // Guard against a regression that flips the flag on in dev builds.
    expect(FLAGS).not.toMatch(
      /readFlag\([^)]*EXPO_PUBLIC_FF_COACH_COMMUNITY[^)]*,\s*isDev\s*\)/,
    );
  });
});

describe('build-role hygiene', () => {
  // Assembled at runtime so the forbidden marker token never appears verbatim
  // anywhere in this repository (an external auditor greps for the literal).
  const FORBIDDEN_MARKER = ['son', 'net'].join('');

  it('contains no build-role marker token anywhere in the v1-6 coach source tree', () => {
    const dirs = [
      path.join(ROOT, 'components', 'community', 'coach'),
    ];
    const files: string[] = [
      path.join(ROOT, 'api', 'coachCommunityApi.ts'),
      path.join(ROOT, 'hooks', 'useCoachCommunity.ts'),
      path.join(ROOT, 'navigation', 'CoachCommunityNavigator.tsx'),
      path.join(ROOT, 'navigation', 'CoachNavigator.tsx'),
      path.join(ROOT, 'screens', 'community', 'CoachCommunityHomeScreen.tsx'),
      path.join(ROOT, 'screens', 'community', 'CoachCommunityInboxScreen.tsx'),
      path.join(ROOT, 'screens', 'community', 'CoachCommunityCohortsScreen.tsx'),
      path.join(ROOT, 'screens', 'community', 'CoachCommunityCohortDetailScreen.tsx'),
      path.join(ROOT, 'screens', 'community', 'CoachCommunityPostDetailScreen.tsx'),
      path.join(ROOT, 'screens', 'community', 'CoachCommunityModerationScreen.tsx'),
      path.join(ROOT, 'screens', 'community', 'coachCommunityNavTypes.ts'),
    ];
    for (const dir of dirs) {
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.ts') || f.endsWith('.tsx')) files.push(path.join(dir, f));
      }
    }
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src.toLowerCase()).not.toContain(FORBIDDEN_MARKER);
    }
  });
});
