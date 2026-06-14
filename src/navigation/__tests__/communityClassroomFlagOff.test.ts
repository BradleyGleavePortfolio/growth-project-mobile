/**
 * v3-2 — flag-off guarantees for the Community Classroom routes.
 *
 * The CommunityClassroom (student feed) and CommunityLessonDetail routes must
 * NOT be registered in CommunityNavigator unless
 * `featureFlags.communityClassroom` is true. We assert this STATICALLY by
 * reading the navigator source and pinning the flag gate, rather than mounting
 * React Navigation (which pulls in reanimated / gesture-handler). This mirrors
 * the v3-1 communityChallengesFlagOff.test.ts pattern exactly.
 *
 * The classroom screen additionally carries a defense-in-depth runtime guard
 * (it renders a neutral "not available" state when reached with the flag off),
 * but the binding contract here is that neither <Stack.Screen> is even
 * registered when the flag is off — both screen registrations live INSIDE a
 * `featureFlags.communityClassroom ? (...) : null` ternary, in source order.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

const COMMUNITY_NAV = fs.readFileSync(
  path.join(ROOT, 'navigation', 'CommunityNavigator.tsx'),
  'utf8',
);

describe('Community Classroom routes — flag-gated registration (default OFF)', () => {
  it('gates the CommunityClassroom feed route behind featureFlags.communityClassroom', () => {
    // The flag ternary must appear before the screen registration in source.
    const guardIdx = COMMUNITY_NAV.search(
      /\{featureFlags\.communityClassroom\s*\?/,
    );
    const screenIdx = COMMUNITY_NAV.search(/name="CommunityClassroom"/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(screenIdx).toBeGreaterThan(guardIdx);
  });

  it('gates the CommunityLessonDetail route behind the same flag', () => {
    const guardIdx = COMMUNITY_NAV.search(
      /\{featureFlags\.communityClassroom\s*\?/,
    );
    const screenIdx = COMMUNITY_NAV.search(/name="CommunityLessonDetail"/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(screenIdx).toBeGreaterThan(guardIdx);
  });

  it('does NOT register either classroom route unconditionally', () => {
    // Each classroom <Stack.Screen> name appears exactly once, and each is
    // preceded by its own flag ternary (two ternaries total). If a future edit
    // moved a registration outside the gate, the ternary count would drop below
    // the screen count and this trips.
    const ternaries =
      COMMUNITY_NAV.match(/\{featureFlags\.communityClassroom\s*\?/g) ?? [];
    expect(ternaries.length).toBe(2);

    const feed = COMMUNITY_NAV.match(/name="CommunityClassroom"/g) ?? [];
    const detail = COMMUNITY_NAV.match(/name="CommunityLessonDetail"/g) ?? [];
    expect(feed).toHaveLength(1);
    expect(detail).toHaveLength(1);
  });

  it('orders each ternary immediately before its corresponding screen registration', () => {
    // The flag controls REGISTRATION (not just render): each
    // `featureFlags.communityClassroom ?` ternary must directly precede a
    // CommunityStack.Screen whose `name` is one of the two classroom routes,
    // with no unrelated screen registration interleaved between the gate and
    // its screen.
    const classroomNames = ['CommunityClassroom', 'CommunityLessonDetail'];
    const ternaryRe = /\{featureFlags\.communityClassroom\s*\?/g;
    let match: RegExpExecArray | null;
    const gatedNames: string[] = [];
    while ((match = ternaryRe.exec(COMMUNITY_NAV)) !== null) {
      // The slice from this ternary to the next ternary (or EOF) must contain
      // exactly one of the classroom screen names as its first name= token.
      const rest = COMMUNITY_NAV.slice(match.index);
      const nextTernary = rest.slice(1).search(/\{featureFlags\.communityClassroom\s*\?/);
      const segment = nextTernary === -1 ? rest : rest.slice(0, nextTernary + 1);
      const nameMatch = segment.match(/name="([A-Za-z]+)"/);
      expect(nameMatch).not.toBeNull();
      gatedNames.push(nameMatch![1]);
    }
    expect(gatedNames).toEqual(classroomNames);
  });

  it('imports the classroom screens at module scope (so the gate, not a missing import, is the control)', () => {
    expect(COMMUNITY_NAV).toMatch(/import CommunityClassroomScreen from/);
    expect(COMMUNITY_NAV).toMatch(/import CommunityLessonDetailScreen from/);
  });

  it('defaults the EXPO_PUBLIC_FF_COMMUNITY_CLASSROOM_POSTS flag to OFF', () => {
    const featureFlagsSrc = fs.readFileSync(
      path.join(ROOT, 'config', 'featureFlags.ts'),
      'utf8',
    );
    // The flag reads the env var with an explicit `false` default — a build
    // without the env set must register zero classroom routes.
    expect(featureFlagsSrc).toMatch(
      /communityClassroom:\s*readFlag\([\s\S]*?'EXPO_PUBLIC_FF_COMMUNITY_CLASSROOM_POSTS'[\s\S]*?,\s*false\s*,?\s*\)/,
    );
  });
});
