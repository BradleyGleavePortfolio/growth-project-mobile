// Test the actual shared day formatter under explicit device-zone defaults.
// This avoids relying on the CI runner's timezone.
const NativeDateTimeFormat = Intl.DateTimeFormat;
let mockDeviceZone = 'America/Los_Angeles';
let formatter: jest.SpyInstance;

function load(zone: string): typeof import('../utils/workout/workoutDay') {
  mockDeviceZone = zone;
  jest.resetModules();
  return require('../utils/workout/workoutDay');
}

beforeAll(() => {
  formatter = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation((locales, options) =>
    new NativeDateTimeFormat(locales, { ...options, timeZone: options?.timeZone ?? mockDeviceZone }));
});
afterAll(() => formatter.mockRestore());

it('Pacific: a workout crossing midnight retains its start day while a timestamp uses its local day', () => {
  const day = load('America/Los_Angeles');
  const started = Date.parse('2026-10-26T23:50:00-07:00');
  expect(day.workoutStartDay(started)).toBe('2026-10-26');
  expect(day.instantDay('2026-10-27T00:10:00-07:00')).toBe('2026-10-27');
  expect(day.assignmentDay({ scheduled_for: '2026-10-26T00:00:00.000Z' })).toBe('2026-10-26');
});

it('Tokyo: an instant after local midnight uses Tokyo day, but an assigned date is not shifted', () => {
  const day = load('Asia/Tokyo');
  const started = Date.parse('2026-10-26T00:30:00+09:00');
  expect(day.workoutStartDay(started)).toBe('2026-10-26');
  expect(day.instantDay('2026-10-25T15:30:00.000Z')).toBe('2026-10-26');
  expect(day.assignmentDay({ scheduled_for: '2026-10-26T00:00:00.000Z' })).toBe('2026-10-26');
});

it('LS-917 C: a cold restart in another device zone recomputes the stored start instant into another civil day', () => {
  const started = Date.parse('2026-10-26T23:50:00-07:00');
  const before = load('America/Los_Angeles').workoutStartDay(started);
  const after = load('Asia/Tokyo').workoutStartDay(started);
  expect(before).toBe('2026-10-26');
  expect(after).toBe('2026-10-27');
  // This is an observation of a deferred edge, not a claim that start-day
  // provenance survives travel. Only startedAtMs, not its civil day, persists.
  expect(after).not.toBe(before);
});
