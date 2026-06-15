/**
 * v3-4 — flag-off guarantees for the Community Search routes.
 *
 * Two routes consume the search surface and BOTH must be gated behind
 * `featureFlags.communitySearch`:
 *   - CommunityFind            — the search screen itself.
 *   - CommunityVoiceNoteDetail — the detail a `voice_note_transcript` hit opens
 *                                into (F1). It is search-only and must share the
 *                                same build-time kill switch.
 *
 * We assert this STATICALLY by reading the navigator source and pinning the
 * flag gates, rather than mounting React Navigation (which pulls in reanimated /
 * gesture-handler). This mirrors the v3-2 communityClassroomFlagOff.test.ts and
 * v3-3 communityVoiceFlagOff.test.ts patterns.
 *
 * Both screens additionally carry a defense-in-depth runtime guard (server-
 * evaluated `useFeatureFlags().flags.community_search`, fail-safe OFF), but the
 * binding contract here is that the <Stack.Screen>s are not even REGISTERED
 * when the static flag is off — each registration lives INSIDE a
 * `featureFlags.communitySearch ? (...) : null` ternary, in source order.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

const COMMUNITY_NAV = fs.readFileSync(
  path.join(ROOT, 'navigation', 'CommunityNavigator.tsx'),
  'utf8',
);

describe('Community Search routes — flag-gated registration (default OFF)', () => {
  it('gates the CommunityFind route behind featureFlags.communitySearch', () => {
    const guardIdx = COMMUNITY_NAV.search(
      /\{featureFlags\.communitySearch\s*\?/,
    );
    const screenIdx = COMMUNITY_NAV.search(/name="CommunityFind"/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(screenIdx).toBeGreaterThan(guardIdx);
  });

  it('gates the CommunityVoiceNoteDetail route behind featureFlags.communitySearch', () => {
    const screenIdx = COMMUNITY_NAV.search(/name="CommunityVoiceNoteDetail"/);
    expect(screenIdx).toBeGreaterThan(-1);
    // The nearest preceding flag ternary must be the communitySearch one.
    const before = COMMUNITY_NAV.slice(0, screenIdx);
    const lastGuard = before.lastIndexOf('{featureFlags.communitySearch ?');
    expect(lastGuard).toBeGreaterThan(-1);
    // No other Stack.Screen registration is interleaved between that gate and
    // the voice-note-detail screen.
    const between = COMMUNITY_NAV.slice(lastGuard, screenIdx);
    expect(between.match(/name="/g) ?? []).toHaveLength(0);
  });

  it('registers BOTH search routes only behind the flag (one ternary per screen)', () => {
    const ternaries =
      COMMUNITY_NAV.match(/\{featureFlags\.communitySearch\s*\?/g) ?? [];
    expect(ternaries).toHaveLength(2);

    expect(COMMUNITY_NAV.match(/name="CommunityFind"/g) ?? []).toHaveLength(1);
    expect(
      COMMUNITY_NAV.match(/name="CommunityVoiceNoteDetail"/g) ?? [],
    ).toHaveLength(1);
  });

  it('imports both search screens at module scope (so the gate, not a missing import, is the control)', () => {
    expect(COMMUNITY_NAV).toMatch(/import CommunityFindScreen from/);
    expect(COMMUNITY_NAV).toMatch(/import CommunityVoiceNoteDetail from/);
  });

  it('defaults the EXPO_PUBLIC_FF_COMMUNITY_SEARCH flag to OFF', () => {
    const featureFlagsSrc = fs.readFileSync(
      path.join(ROOT, 'config', 'featureFlags.ts'),
      'utf8',
    );
    expect(featureFlagsSrc).toMatch(
      /communitySearch:\s*readFlag\([\s\S]*?'EXPO_PUBLIC_FF_COMMUNITY_SEARCH'[\s\S]*?,\s*false\s*\)/,
    );
  });
});
