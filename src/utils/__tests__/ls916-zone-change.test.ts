import { bucketDateLocal } from '../date';

const RealDateTimeFormat = Intl.DateTimeFormat;

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it.each([
  ['America/Los_Angeles', '2026-10-30T00:30:00Z', '2026-10-29'],
  ['Asia/Tokyo', '2026-10-30T00:30:00Z', '2026-10-30'],
])('LS-916 local calendar control in %s', (zone, now, day) => {
  expect(bucketDateLocal(new Date(now), zone)).toBe(day);
});

it('LS-916 B5: changing the phone from Pacific to Tokyo while Food stays open advances its stale today', () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-30T00:30:00Z'));
  let deviceZone = 'America/Los_Angeles';
  // Intl formatters retain the default time zone captured at construction.
  // Change the device's default, not any already-created formatter's zone.
  jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(((locale, options) =>
    new RealDateTimeFormat(locale, { ...options, timeZone: options?.timeZone ?? deviceZone })
  ) as typeof Intl.DateTimeFormat);
  jest.isolateModules(() => {
    const { dayForNewLog } = require('../logDay');
    const { getTodayString } = require('../date');
    expect(getTodayString()).toBe('2026-10-29');
    const shown = { selectedDate: '2026-10-29', selectedOn: '2026-10-29' };
    deviceZone = 'Asia/Tokyo';
    expect(dayForNewLog(shown)).toBe('2026-10-30');
    expect(getTodayString()).toBe('2026-10-30');
  });
});
