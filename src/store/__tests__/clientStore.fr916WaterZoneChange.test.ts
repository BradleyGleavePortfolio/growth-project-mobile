/**
 * FR-916 F4: the Food tab's water takes its day from the phone's zone at the tap. A phone moved from
 * Pacific to Tokyo while the Food tab stays open on "today" sends the glass to Tokyo's today.
 * Real store and day rule; only the HTTP boundaries, the logger and the phone's zone are replaced.
 */
import { useClientStore } from '../clientStore';

const mockAddWater = jest.fn();
jest.mock('../../services/api', () => ({
  logApi: { getDaily: jest.fn(async () => ({ data: { entries: [] } })) },
  waterApi: {
    getDaily: jest.fn(async () => ({ data: { total_ml: 0, logs: [] } })),
    log: (...a: unknown[]) => mockAddWater(...a),
  },
}));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

const RealDateTimeFormat = Intl.DateTimeFormat;
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('FR-916 F4: a glass added just after the phone moves from Pacific to Tokyo goes to the Tokyo day', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(new Date('2026-10-30T00:30:00Z')); // 17:30 Oct 29 in Pacific, 09:30 Oct 30 in Tokyo
  let deviceZone = 'America/Los_Angeles';
  jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(((locale, options) =>
    new RealDateTimeFormat(locale, { ...options, timeZone: options?.timeZone ?? deviceZone })
  ) as typeof Intl.DateTimeFormat);
  mockAddWater.mockResolvedValue({ data: { id: 'w1', amount_ml: 237, logged_at: '2026-10-30T00:30:00Z' } });

  useClientStore.getState().reset();
  await useClientStore.getState().loadDayData('synthetic-client');
  expect(useClientStore.getState().selectedDate).toBe('2026-10-29');

  deviceZone = 'Asia/Tokyo';
  await useClientStore.getState().logWater('synthetic-client', '', 8);
  expect(mockAddWater).toHaveBeenCalledWith({ amount_ml: 237, date: '2026-10-30' }, expect.stringMatching(/^pfl_/));
  expect(useClientStore.getState().selectedDate).toBe('2026-10-30');
});
