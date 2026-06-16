/**
 * v3-4 — flag-off guarantees for the COACH-ONLY Wearable Prompts route.
 *
 * The CoachCommunityWearablePrompts route must NOT be registered in
 * CoachCommunityNavigator unless `featureFlags.communityWearablePrompts` is
 * true. We assert this STATICALLY by reading the navigator source and pinning
 * the flag gate, rather than mounting React Navigation (which pulls in
 * reanimated / gesture-handler). This mirrors the v3-2/v3-3 flag-off pins.
 *
 * The screen additionally carries defense-in-depth runtime guards (static flag,
 * server-evaluated `coach_community_wearable_prompts` flag, and a coach/owner
 * role check), but the binding contract here is that the <Stack.Screen> is not
 * even REGISTERED when the static flag is off — the registration lives INSIDE a
 * `featureFlags.communityWearablePrompts ? (...) : null` ternary, in source
 * order.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

const COACH_NAV = fs.readFileSync(
  path.join(ROOT, 'navigation', 'CoachCommunityNavigator.tsx'),
  'utf8',
);

describe('Coach Wearable Prompts route — flag-gated registration (default OFF)', () => {
  it('gates the CoachCommunityWearablePrompts route behind featureFlags.communityWearablePrompts', () => {
    const guardIdx = COACH_NAV.search(
      /\{featureFlags\.communityWearablePrompts\s*\?/,
    );
    const screenIdx = COACH_NAV.search(/name="CoachCommunityWearablePrompts"/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(screenIdx).toBeGreaterThan(guardIdx);
  });

  it('does NOT register the wearable-prompts route unconditionally', () => {
    const ternaries =
      COACH_NAV.match(/\{featureFlags\.communityWearablePrompts\s*\?/g) ?? [];
    expect(ternaries).toHaveLength(1);

    const screen =
      COACH_NAV.match(/name="CoachCommunityWearablePrompts"/g) ?? [];
    expect(screen).toHaveLength(1);
  });

  it('orders the ternary immediately before its screen registration', () => {
    const ternaryIdx = COACH_NAV.search(
      /\{featureFlags\.communityWearablePrompts\s*\?/,
    );
    const segment = COACH_NAV.slice(ternaryIdx);
    const nameMatch = segment.match(/name="([A-Za-z]+)"/);
    expect(nameMatch).not.toBeNull();
    expect(nameMatch![1]).toBe('CoachCommunityWearablePrompts');
  });

  it('imports the wearable prompts screen at module scope (so the gate, not a missing import, is the control)', () => {
    expect(COACH_NAV).toMatch(/import CommunityWearablePromptsScreen from/);
  });

  it('defaults the EXPO_PUBLIC_FF_COMMUNITY_WEARABLE_PROMPTS flag to OFF', () => {
    const featureFlagsSrc = fs.readFileSync(
      path.join(ROOT, 'config', 'featureFlags.ts'),
      'utf8',
    );
    expect(featureFlagsSrc).toMatch(
      /communityWearablePrompts:\s*readFlag\([\s\S]*?'EXPO_PUBLIC_FF_COMMUNITY_WEARABLE_PROMPTS'[\s\S]*?,\s*false\s*\)/,
    );
  });
});
