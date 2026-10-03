/**
 * S14 round 3 — the coach wearable-prompts screen is reachable.
 *
 * Before: CommunityWearablePromptsScreen was registered only inside the
 * Community navigator (itself behind `coachCommunity`) and no screen ever
 * navigated to it, so a coach could not open it. Now ClientsStack registers
 * `ClientWearablePrompts` behind `featureFlags.communityWearablePrompts`, and
 * the client's Health tab opens it only when that build flag AND the server
 * flag `coach_community_wearable_prompts` are on. Static source pins, like the
 * other navigator flag tests (mounting React Navigation pulls native modules).
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const COACH_NAV = read('navigation', 'CoachNavigator.tsx');
const CLIENT_DETAIL = read('screens', 'coach', 'ClientDetailScreen.tsx');

describe('ClientWearablePrompts route', () => {
  it('is declared in the ClientsStack param list with the client id', () => {
    const list = COACH_NAV.slice(COACH_NAV.indexOf('export type ClientsStackParamList'));
    expect(list).toMatch(/ClientWearablePrompts:\s*\{\s*clientId: string; clientName\?: string \}/);
  });

  it('is registered once, inside the communityWearablePrompts gate, with the prompts screen', () => {
    const matches = COACH_NAV.match(/name="ClientWearablePrompts"/g) ?? [];
    expect(matches).toHaveLength(1);
    const screenIdx = COACH_NAV.search(/name="ClientWearablePrompts"/);
    const before = COACH_NAV.slice(0, screenIdx);
    const gateIdx = before.lastIndexOf('{featureFlags.communityWearablePrompts ?');
    expect(gateIdx).toBeGreaterThan(-1);
    // Nothing else is registered between the gate and this screen.
    expect(before.slice(gateIdx)).not.toMatch(/name="/);
    expect(COACH_NAV.slice(screenIdx, screenIdx + 200)).toMatch(
      /component=\{CommunityWearablePromptsScreen\}/,
    );
    expect(COACH_NAV).toMatch(
      /import CommunityWearablePromptsScreen from '\.\.\/screens\/community\/CommunityWearablePromptsScreen'/,
    );
  });

  it('is opened from the client Health tab only when both flags are on', () => {
    expect(CLIENT_DETAIL).toMatch(/featureFlags\.communityWearablePrompts &&/);
    expect(CLIENT_DETAIL).toMatch(/serverFlags\.flags\.coach_community_wearable_prompts === true/);
    expect(CLIENT_DETAIL).toMatch(
      /wearablePromptsOn\s*\?\s*\(\) => navigation\.navigate\('ClientWearablePrompts', \{ clientId, clientName \}\)\s*:\s*undefined/,
    );
  });
});
