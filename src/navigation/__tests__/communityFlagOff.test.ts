/**
 * Flag-off guarantees for the v1-5 Community tab.
 *
 * The Community tab + its deep link must NOT exist when
 * featureFlags.communityTab is OFF (the default). We assert this STATICALLY by
 * reading the navigator sources and pinning the flag gate, rather than mounting
 * React Navigation (which pulls in reanimated / gesture-handler). This mirrors
 * the existing clientNavigator.test.ts pattern.
 *
 * Also asserts the four Expo flags default to OFF and that no `sonnet` string
 * leaked into the community source tree (build-role hygiene).
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

const CLIENT_NAV = fs.readFileSync(
  path.join(ROOT, 'navigation', 'ClientNavigator.tsx'),
  'utf8',
);
const ROOT_NAV = fs.readFileSync(
  path.join(ROOT, 'navigation', 'RootNavigator.tsx'),
  'utf8',
);
const FLAGS = fs.readFileSync(
  path.join(ROOT, 'config', 'featureFlags.ts'),
  'utf8',
);

describe('Community tab — flag-gated mount (default OFF)', () => {
  it('renders the CommunityTab <Tab.Screen> only behind featureFlags.communityTab', () => {
    // The Tab.Screen for the Community tab must be wrapped in a
    // `featureFlags.communityTab && (...)` guard. We locate the guarded block
    // and confirm the CommunityTab screen lives INSIDE it.
    expect(CLIENT_NAV).toMatch(
      /\{featureFlags\.communityTab\s*&&\s*\(/,
    );
    // The CommunityTab screen registration exists.
    expect(CLIENT_NAV).toMatch(
      /name=["']CommunityTab["']\s+component=\{CommunityNavigator\}/,
    );
    // And it is NOT registered unconditionally: the CommunityTab <Tab.Screen>
    // appears AFTER the flag guard in source order.
    const guardIdx = CLIENT_NAV.search(/\{featureFlags\.communityTab\s*&&/);
    const screenIdx = CLIENT_NAV.search(
      /name=["']CommunityTab["']\s+component=\{CommunityNavigator\}/,
    );
    expect(guardIdx).toBeGreaterThan(-1);
    expect(screenIdx).toBeGreaterThan(guardIdx);
  });

  it('registers the Community deep link only behind the same flag', () => {
    // The community deep-link entry is added via a conditional spread keyed on
    // featureFlags.communityTab — when OFF the spread contributes nothing.
    expect(ROOT_NAV).toMatch(
      /\.\.\.\(featureFlags\.communityTab\s*\?/,
    );
    // The path the link maps to lives inside that conditional spread, after the
    // guard — so no `community` route exists when the flag is OFF.
    const guardIdx = ROOT_NAV.search(/\.\.\.\(featureFlags\.communityTab\s*\?/);
    const pathIdx = ROOT_NAV.search(/path:\s*['"]community['"]/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(pathIdx).toBeGreaterThan(guardIdx);
  });

  it('does not register the Community deep link unconditionally', () => {
    // There must be no `path: 'community'` entry outside the flag-gated spread.
    const occurrences = ROOT_NAV.match(/path:\s*['"]community['"]/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });
});

describe('Expo feature flags — default OFF', () => {
  it('declares the four community flags reading EXPO_PUBLIC_FF_* with a false default', () => {
    // Each flag must read its env var via readFlag(..., false) so the default
    // is OFF regardless of environment.
    for (const env of [
      'EXPO_PUBLIC_FF_COMMUNITY_TAB',
      'EXPO_PUBLIC_FF_COMMUNITY_HALL',
      'EXPO_PUBLIC_FF_COMMUNITY_COHORTS',
      'EXPO_PUBLIC_FF_COMMUNITY_DM',
    ]) {
      const re = new RegExp(`readFlag\\([^)]*${env}[^)]*,\\s*false\\s*\\)`);
      expect(FLAGS).toMatch(re);
    }
  });

  it('exposes communityTab / communityHall / communityCohorts / communityDm keys', () => {
    expect(FLAGS).toMatch(/communityTab\s*:/);
    expect(FLAGS).toMatch(/communityHall\s*:/);
    expect(FLAGS).toMatch(/communityCohorts\s*:/);
    expect(FLAGS).toMatch(/communityDm\s*:/);
  });
});

describe('build-role hygiene', () => {
  it('contains no "sonnet" reference anywhere in the community source tree', () => {
    const dirs = [
      path.join(ROOT, 'screens', 'community'),
      path.join(ROOT, 'components', 'community'),
    ];
    const files: string[] = [
      path.join(ROOT, 'api', 'communityApi.ts'),
      path.join(ROOT, 'api', 'communityRealtime.ts'),
      path.join(ROOT, 'hooks', 'useCommunity.ts'),
      path.join(ROOT, 'navigation', 'CommunityNavigator.tsx'),
    ];
    for (const dir of dirs) {
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.ts') || f.endsWith('.tsx')) files.push(path.join(dir, f));
      }
    }
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src.toLowerCase()).not.toContain('sonnet');
    }
  });
});
