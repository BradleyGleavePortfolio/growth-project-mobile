import * as fs from 'fs';
import * as path from 'path';

// React Navigation silently drops a navigate() to a screen that is not in the
// current navigator (or a parent), so a missing registration is a dead tap.
const read = (relative: string) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

function stackScreens(navigatorSource: string, stack: string): Record<string, string> {
  const start = navigatorSource.indexOf(`<${stack}.Navigator`);
  const end = navigatorSource.indexOf(`</${stack}.Navigator>`, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = navigatorSource.slice(start, end);
  const screens: Record<string, string> = {};
  const re = new RegExp(`<${stack}\\.Screen\\s+name="([^"]+)"\\s+component=\\{([A-Za-z0-9_]+)\\}`, 'g');
  for (let m = re.exec(body); m; m = re.exec(body)) screens[m[1]] = m[2];
  return screens;
}

describe('client taps that used to do nothing (AUD-E2E-CLIENT-126)', () => {
  const nav = read('navigation/ClientNavigator.tsx');

  it('the coach name in the client Messages thread opens the contact card', () => {
    const home = stackScreens(nav, 'HomeStackNav');
    expect(home.Messages).toBe('MessagesScreen');
    expect(home.ContactView).toBe('ContactView');
    expect(read('screens/client/MessagesScreen.tsx')).toContain("navigation.navigate('ContactView'");
  });

  it('client Settings opens the full notification screen with Mute all, in the same stack', () => {
    const more = stackScreens(nav, 'MoreStackNav');
    expect(more.Settings).toBeDefined();
    expect(more.NotificationSettings).toBe('NotificationPreferencesScreen');
    expect(nav).toContain("import NotificationPreferencesScreen from '../screens/notifications/NotificationPreferencesScreen';");
    expect(read('screens/client/SettingsScreen.tsx')).toContain("navigation.navigate('NotificationSettings')");
    expect(read('screens/notifications/NotificationPreferencesScreen.tsx')).toContain('navigation.goBack()');
  });

  it('the System switch describes what it actually turns off', () => {
    const src = read('screens/settings/NotificationPreferencesScreen.tsx');
    expect(src).toContain("system: { weekly_summary_enabled: true }");
    expect(src).toContain("description: 'Weekly summary email.'");
    expect(src).not.toContain('App updates, billing, and critical alerts.');
  });

  it('Support names Roman, not a Client Bot that does not exist', () => {
    const src = read('screens/support/SupportInboxScreen.tsx');
    expect(src).not.toContain('Client Bot');
    expect(src).toContain('Support is separate from Roman.');
  });
});
