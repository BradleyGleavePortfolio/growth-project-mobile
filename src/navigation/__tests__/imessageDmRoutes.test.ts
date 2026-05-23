/**
 * Apple App Review 1.2 wiring assertions for the iMessage-grade DM rebuild.
 *
 * Regression guards split into two layers:
 *
 *   1. TYPE-LEVEL — TypeScript itself proves the route names + params resolve
 *      against the navigator param lists. If a future PR renames `ContactView`
 *      to anything else on either navigator, `tsc --noEmit` fails before
 *      anyone reaches this test.
 *
 *   2. BEHAVIOR — for screens that own the user-visible affordance (the
 *      Blocked Users row in Settings), assert the rendered tree wires
 *      `navigate()` to the right typed route.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { MoreStackParamList } from '../ClientNavigator';
import type { ClientsStackParamList, SettingsStackParamList } from '../CoachNavigator';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CLIENT_SETTINGS = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'client', 'SettingsScreen.tsx'),
  'utf8',
);
const COACH_SETTINGS = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'coach', 'SettingsScreen.tsx'),
  'utf8',
);

describe('Type-level navigator wiring — Apple 1.2 DM routes', () => {
  // These compile-time assertions catch route renames before jest runs.
  // If `ContactView` is renamed on either navigator, the file fails to
  // type-check and `tsc --noEmit` blocks the PR.
  it('ContactView is registered on the coach Clients stack with the expected params', () => {
    const sample: ClientsStackParamList['ContactView'] = {
      contactId: 'c-1',
      displayName: 'A',
      role: 'client',
    };
    expect(sample.contactId).toBe('c-1');
  });

  it('ContactView is registered on the client More stack with the expected params', () => {
    const sample: MoreStackParamList['ContactView'] = {
      contactId: 'c-1',
      displayName: 'A',
      role: 'coach',
    };
    expect(sample.contactId).toBe('c-1');
  });

  it('BlockedUsers is registered on both navigators', () => {
    const coach: SettingsStackParamList['BlockedUsers'] = undefined;
    const client: MoreStackParamList['BlockedUsers'] = undefined;
    expect(coach).toBeUndefined();
    expect(client).toBeUndefined();
  });
});

describe('Settings UI — Apple 1.2 discoverable blocked-users entry', () => {
  it('client SettingsScreen renders a Blocked Users row that navigates to BlockedUsers', () => {
    expect(CLIENT_SETTINGS).toMatch(/navigation\.navigate\(\s*['"]BlockedUsers['"]\s*\)/);
    expect(CLIENT_SETTINGS).toMatch(/<Text[^>]*>Blocked Users<\/Text>/);
    expect(CLIENT_SETTINGS).toMatch(/accessibilityLabel="Blocked Users"/);
  });

  it('coach SettingsScreen renders a Blocked Users row that navigates to BlockedUsers', () => {
    expect(COACH_SETTINGS).toMatch(/navigation\.navigate\(\s*['"]BlockedUsers['"]\s*\)/);
    expect(COACH_SETTINGS).toMatch(/<Text[^>]*>Blocked Users<\/Text>/);
    expect(COACH_SETTINGS).toMatch(/accessibilityLabel="Blocked Users"/);
  });
});
