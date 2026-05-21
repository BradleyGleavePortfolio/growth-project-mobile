/**
 * Apple App Review 1.2 wiring assertions for the iMessage-grade DM rebuild.
 *
 * These tests fail loudly if someone:
 *   - removes the ContactView registration from the coach Clients stack
 *     (the coach-side header tap from ClientMessagesScreen depends on it),
 *   - removes the BlockedUsers registration from either client or coach
 *     navigator (the Settings → Blocked Users entries depend on it),
 *   - drops the Blocked Users row from either Settings screen (Apple 1.2
 *     requires the user to be able to view and undo their blocks).
 *
 * Pure source-level inspection — no NavigationContainer is mounted. Same
 * pattern as the sibling coachNavigation.test.ts.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const COACH_NAV = fs.readFileSync(
  path.join(ROOT, 'src', 'navigation', 'CoachNavigator.tsx'),
  'utf8',
);
const CLIENT_NAV = fs.readFileSync(
  path.join(ROOT, 'src', 'navigation', 'ClientNavigator.tsx'),
  'utf8',
);
const CLIENT_SETTINGS = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'client', 'SettingsScreen.tsx'),
  'utf8',
);
const COACH_SETTINGS = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'coach', 'SettingsScreen.tsx'),
  'utf8',
);

describe('CoachNavigator — Apple 1.2 DM routes', () => {
  it('imports ContactView and BlockedUsersScreen', () => {
    expect(COACH_NAV).toMatch(
      /import ContactView from ['"]\.\.\/screens\/messaging\/ContactView['"]/,
    );
    expect(COACH_NAV).toMatch(
      /import BlockedUsersScreen from ['"]\.\.\/screens\/settings\/BlockedUsersScreen['"]/,
    );
  });

  it('registers ContactView on the ClientsStack so coach header tap works', () => {
    expect(COACH_NAV).toMatch(/ClientsStack\.Screen\s+name="ContactView"\s+component=\{ContactView\}/);
  });

  it('declares ContactView in ClientsStackParamList with the expected shape', () => {
    expect(COACH_NAV).toMatch(/ContactView:\s*\{\s*contactId:\s*string;[\s\S]*displayName:\s*string;[\s\S]*role\?:/);
  });

  it('registers BlockedUsers on the coach SettingsStack', () => {
    expect(COACH_NAV).toMatch(/SettingsStack\.Screen\s+name="BlockedUsers"\s+component=\{BlockedUsersScreen\}/);
  });

  it('declares BlockedUsers in SettingsStackParamList', () => {
    expect(COACH_NAV).toMatch(/BlockedUsers:\s*undefined/);
  });
});

describe('ClientNavigator — Apple 1.2 DM routes (regression guard)', () => {
  it('registers ContactView and BlockedUsers on the client MoreStack', () => {
    expect(CLIENT_NAV).toMatch(/MoreStackNav\.Screen\s+name="ContactView"\s+component=\{ContactView\}/);
    expect(CLIENT_NAV).toMatch(/MoreStackNav\.Screen\s+name="BlockedUsers"\s+component=\{BlockedUsersScreen\}/);
  });
});

describe('Coach ClientMessagesScreen — header navigate target exists', () => {
  it('navigates to ContactView, which is registered on the coach stack', () => {
    const COACH_MESSAGES = fs.readFileSync(
      path.join(ROOT, 'src', 'screens', 'coach', 'ClientMessagesScreen.tsx'),
      'utf8',
    );
    // The coach tap-for-details affordance fires navigate('ContactView', …).
    expect(COACH_MESSAGES).toMatch(/navigate\(\s*['"]ContactView['"]/);
    // And ContactView is registered on the coach navigator (see above).
    expect(COACH_NAV).toMatch(/name="ContactView"/);
  });
});

describe('Settings UI — Apple 1.2 discoverable blocked-users entry', () => {
  it('client SettingsScreen renders a Blocked Users row that navigates to BlockedUsers', () => {
    expect(CLIENT_SETTINGS).toMatch(/navigation\.navigate\(\s*['"]BlockedUsers['"]\s*\)/);
    expect(CLIENT_SETTINGS).toMatch(/<Text[^>]*>Blocked Users<\/Text>/);
    // Accessibility metadata is required so the row is reachable via VoiceOver.
    expect(CLIENT_SETTINGS).toMatch(/accessibilityLabel="Blocked Users"/);
  });

  it('coach SettingsScreen renders a Blocked Users row that navigates to BlockedUsers', () => {
    expect(COACH_SETTINGS).toMatch(/navigation\.navigate\(\s*['"]BlockedUsers['"]\s*\)/);
    expect(COACH_SETTINGS).toMatch(/<Text[^>]*>Blocked Users<\/Text>/);
    expect(COACH_SETTINGS).toMatch(/accessibilityLabel="Blocked Users"/);
  });
});
