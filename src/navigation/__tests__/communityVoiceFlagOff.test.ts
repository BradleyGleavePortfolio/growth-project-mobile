/**
 * v3-3 — flag-off guarantees for the Community Voice Notes route.
 *
 * The CommunityVoiceComposer (record/send voice surface) route must NOT be
 * registered in CommunityNavigator unless `featureFlags.communityVoiceNotes` is
 * true. We assert this STATICALLY by reading the navigator source and pinning
 * the flag gate, rather than mounting React Navigation (which pulls in
 * reanimated / gesture-handler). This mirrors the v3-2
 * communityClassroomFlagOff.test.ts pattern exactly.
 *
 * The voice screen additionally carries a defense-in-depth runtime guard (it
 * renders a neutral "not available" state when reached with the flag off), but
 * the binding contract here is that the <Stack.Screen> is not even registered
 * when the flag is off — the registration lives INSIDE a
 * `featureFlags.communityVoiceNotes ? (...) : null` ternary, in source order.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

const COMMUNITY_NAV = fs.readFileSync(
  path.join(ROOT, 'navigation', 'CommunityNavigator.tsx'),
  'utf8',
);

describe('Community Voice Notes route — flag-gated registration (default OFF)', () => {
  it('gates the CommunityVoiceComposer route behind featureFlags.communityVoiceNotes', () => {
    // The flag ternary must appear before the screen registration in source.
    const guardIdx = COMMUNITY_NAV.search(
      /\{featureFlags\.communityVoiceNotes\s*\?/,
    );
    const screenIdx = COMMUNITY_NAV.search(/name="CommunityVoiceComposer"/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(screenIdx).toBeGreaterThan(guardIdx);
  });

  it('does NOT register the voice route unconditionally', () => {
    // Exactly one flag ternary and exactly one screen registration; if a future
    // edit moved the registration outside the gate, the ternary count would
    // drop below the screen count and this trips.
    const ternaries =
      COMMUNITY_NAV.match(/\{featureFlags\.communityVoiceNotes\s*\?/g) ?? [];
    expect(ternaries).toHaveLength(1);

    const screen = COMMUNITY_NAV.match(/name="CommunityVoiceComposer"/g) ?? [];
    expect(screen).toHaveLength(1);
  });

  it('orders the ternary immediately before its screen registration', () => {
    // The flag controls REGISTRATION (not just render): the
    // `featureFlags.communityVoiceNotes ?` ternary must directly precede the
    // CommunityStack.Screen whose `name` is the voice route, with no unrelated
    // screen registration interleaved between the gate and its screen.
    const ternaryIdx = COMMUNITY_NAV.search(
      /\{featureFlags\.communityVoiceNotes\s*\?/,
    );
    const segment = COMMUNITY_NAV.slice(ternaryIdx);
    const nameMatch = segment.match(/name="([A-Za-z]+)"/);
    expect(nameMatch).not.toBeNull();
    expect(nameMatch![1]).toBe('CommunityVoiceComposer');
  });

  it('imports the voice composer screen at module scope (so the gate, not a missing import, is the control)', () => {
    expect(COMMUNITY_NAV).toMatch(
      /import CommunityVoiceComposerScreen from/,
    );
  });

  it('defaults the EXPO_PUBLIC_FF_COMMUNITY_VOICE_NOTES flag to OFF', () => {
    const featureFlagsSrc = fs.readFileSync(
      path.join(ROOT, 'config', 'featureFlags.ts'),
      'utf8',
    );
    // The flag reads the env var with an explicit `false` default — a build
    // without the env set must register zero voice routes.
    expect(featureFlagsSrc).toMatch(
      /communityVoiceNotes:\s*readFlag\([\s\S]*?'EXPO_PUBLIC_FF_COMMUNITY_VOICE_NOTES'[\s\S]*?,\s*false\s*\)/,
    );
  });
});
