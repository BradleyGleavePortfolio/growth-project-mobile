import * as fs from 'fs';
import * as path from 'path';

const key = 'EXPO_PUBLIC_FF_CLIENT_CALENDAR_V2';
const saved = process.env[key];
afterEach(() => {
  if (saved === undefined) delete process.env[key];
  else process.env[key] = saved;
  jest.resetModules();
});
it.each([undefined, '', 'false', '0'])('calendar V2 defaults off with %s', (value) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  jest.resetModules();
  expect(require('../featureFlags').featureFlags.clientCalendarV2).toBe(false);
});
it('only explicit opt-in enables the new screen', () => {
  process.env[key] = 'true';
  jest.resetModules();
  expect(require('../featureFlags').featureFlags.clientCalendarV2).toBe(true);
});
it('no checked-in build profile enables V2; legacy root remains the flag-off branch', () => {
  const root = path.resolve(__dirname, '../..');
  const eas = fs.readFileSync(path.join(root, '../eas.json'), 'utf8');
  expect(eas).not.toContain(key);
  const nav = fs.readFileSync(path.join(root, 'navigation/ClientNavigator.tsx'), 'utf8');
  expect(nav).toContain('featureFlags.clientCalendarV2 ? CalendarWeekScreen : ProtectedCalendarHomeScreen');
  expect(nav).toContain("initialTab={route.params?.initialTab}");
});
