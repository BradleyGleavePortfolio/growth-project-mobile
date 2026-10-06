/**
 * S-SCHED-3 C-325-5: "Add to my calendar" only opens the OS event editor
 * (an intent on Android), which needs no calendar permission. The
 * expo-calendar plugin would otherwise add READ_CALENDAR and WRITE_CALENDAR
 * to the Android manifest, so both are blocked in every build mode.
 */
const app = require('../../../app.json').expo;
const configure = require('../../../app.config');

const CALENDAR = ['android.permission.READ_CALENDAR', 'android.permission.WRITE_CALENDAR'];
const originalSwitch = process.env.TGP_ANDROID_HEALTH_CONNECT;

afterEach(() => {
  if (originalSwitch === undefined) delete process.env.TGP_ANDROID_HEALTH_CONNECT;
  else process.env.TGP_ANDROID_HEALTH_CONNECT = originalSwitch;
});

test.each([undefined, '1'])('calendar permissions are blocked with TGP_ANDROID_HEALTH_CONNECT=%s', (value) => {
  if (value === undefined) delete process.env.TGP_ANDROID_HEALTH_CONNECT;
  else process.env.TGP_ANDROID_HEALTH_CONNECT = value;
  const result = configure();
  expect(result.android.blockedPermissions).toEqual(expect.arrayContaining(CALENDAR));
  expect(result.android.permissions ?? []).not.toEqual(expect.arrayContaining([CALENDAR[0]]));
});

test('the phone-calendar feature never asks for calendar access', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '../../calendar/phoneCalendar.ts'), 'utf8');
  expect(source).not.toMatch(/requestCalendarPermissionsAsync|getCalendarsAsync|createEventAsync\(/);
  expect(app.android.blockedPermissions).toEqual(expect.arrayContaining(CALENDAR));
});
