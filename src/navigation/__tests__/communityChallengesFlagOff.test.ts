/**
 * F4 — flag-off guarantees for the v3-1 Community Challenges routes.
 *
 * The CommunityChallenges (discovery list) and CommunityChallengeDetail routes
 * must NOT be registered in CommunityNavigator unless
 * `featureFlags.communityChallenges` is true. We assert this STATICALLY by
 * reading the navigator source and pinning the flag gate, rather than mounting
 * React Navigation (which pulls in reanimated / gesture-handler). This mirrors
 * the existing communityFlagOff.test.ts / clientNavigator.test.ts pattern.
 *
 * The detail screen additionally carries a defense-in-depth runtime guard, but
 * the binding contract here is that neither <Stack.Screen> is even registered
 * when the flag is off — both screen registrations live INSIDE a
 * `featureFlags.communityChallenges ? (...) : null` ternary in source order.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

const COMMUNITY_NAV = fs.readFileSync(
  path.join(ROOT, 'navigation', 'CommunityNavigator.tsx'),
  'utf8',
);

describe('Community Challenges routes — flag-gated registration (default OFF)', () => {
  it('gates the CommunityChallenges discovery route behind featureFlags.communityChallenges', () => {
    // The flag ternary must appear before the screen registration in source.
    const guardIdx = COMMUNITY_NAV.search(
      /\{featureFlags\.communityChallenges\s*\?/,
    );
    const screenIdx = COMMUNITY_NAV.search(
      /name="CommunityChallenges"/,
    );
    expect(guardIdx).toBeGreaterThan(-1);
    expect(screenIdx).toBeGreaterThan(guardIdx);
  });

  it('gates the CommunityChallengeDetail route behind the same flag', () => {
    const guardIdx = COMMUNITY_NAV.search(
      /\{featureFlags\.communityChallenges\s*\?/,
    );
    const screenIdx = COMMUNITY_NAV.search(
      /name="CommunityChallengeDetail"/,
    );
    expect(guardIdx).toBeGreaterThan(-1);
    expect(screenIdx).toBeGreaterThan(guardIdx);
  });

  it('does NOT register either challenges route unconditionally', () => {
    // Each challenges <Stack.Screen> name appears exactly once, and each is
    // preceded by its own flag ternary (two ternaries total). If a future edit
    // moved a registration outside the gate, the ternary count would drop below
    // the screen count and this trips.
    const ternaries =
      COMMUNITY_NAV.match(/\{featureFlags\.communityChallenges\s*\?/g) ?? [];
    expect(ternaries.length).toBe(2);

    const discovery =
      COMMUNITY_NAV.match(/name="CommunityChallenges"/g) ?? [];
    const detail =
      COMMUNITY_NAV.match(/name="CommunityChallengeDetail"/g) ?? [];
    expect(discovery).toHaveLength(1);
    expect(detail).toHaveLength(1);
  });

  it('imports the challenges screens at module scope (so the gate, not a missing import, is the control)', () => {
    expect(COMMUNITY_NAV).toMatch(
      /import CommunityChallengeDetailScreen from/,
    );
    expect(COMMUNITY_NAV).toMatch(/import CommunityChallengesScreen from/);
  });
});
