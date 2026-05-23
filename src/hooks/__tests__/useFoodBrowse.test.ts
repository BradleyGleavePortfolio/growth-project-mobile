/**
 * Behavioural test (R26) for `useFoodBrowse` — proves that the 7-day
 * "frequent foods" walk does NOT shift the calendar day backwards for
 * users west of UTC when `selectedDate` is a bare `YYYY-MM-DD`.
 *
 * Bug being guarded:
 *   Earlier code did `new Date(selectedDate)` which parses a bare date
 *   as UTC midnight. A user in America/Los_Angeles (UTC-7) opening the
 *   food log for "2026-05-23" would then see the first daily fetch
 *   target "2026-05-22" once `bucketDateLocal` re-projected it into
 *   local time. The Round-2 fix replaced that path with string-level
 *   `addDays(selectedDate, -i)` arithmetic.
 *
 * Strategy:
 *   We pin the local-tz behaviour of `bucketDateLocal` to
 *   America/Los_Angeles by mocking it to format with an explicit
 *   timeZone. Then we render the hook, capture every `logApi.getDaily`
 *   argument, and assert that the first daily fetch targets
 *   "2026-05-23" (not "2026-05-22").
 */

import { act, renderHook } from '@testing-library/react-native';

jest.mock('../../services/api', () => ({
  __esModule: true,
  logApi: {
    getDaily: jest.fn(),
  },
}));

// Pin `bucketDateLocal` to America/Los_Angeles. `addDays` calls this
// internally and is what produces the seven dates the hook fetches.
jest.mock('../../utils/date', () => {
  const actual = jest.requireActual('../../utils/date');
  return {
    ...actual,
    bucketDateLocal: (date?: Date) =>
      actual.bucketDateLocal(date ?? new Date(), 'America/Los_Angeles'),
  };
});

import { useFoodBrowse } from '../useFoodBrowse';
import { logApi } from '../../services/api';

const mockedGetDaily = logApi.getDaily as jest.MockedFunction<typeof logApi.getDaily>;

describe('useFoodBrowse — date-only string is not shifted west-of-UTC', () => {
  beforeEach(() => {
    mockedGetDaily.mockReset();
    mockedGetDaily.mockResolvedValue({ data: { entries: [] } } as never);
  });

  it('loadFrequentFoods includes "2026-05-23" itself among the seven fetched days', async () => {
    const { result } = renderHook(() => useFoodBrowse('user-1', '2026-05-23'));

    await act(async () => {
      await result.current.loadFrequentFoods();
    });

    const calledDates = mockedGetDaily.mock.calls.map((c) => c[0]);
    expect(calledDates).toContain('2026-05-23');
    // The prior-day UTC-midnight shift would have surfaced this string.
    expect(calledDates).not.toContain('2026-05-22T00:00:00.000Z');
    // Exactly seven date fetches.
    expect(calledDates).toHaveLength(7);
    // The first (i=0) fetch is the selected date itself.
    expect(calledDates[0]).toBe('2026-05-23');
  });

  it('loadRecentFoods passes selectedDate through verbatim', async () => {
    const { result } = renderHook(() => useFoodBrowse('user-1', '2026-05-23'));

    await act(async () => {
      await result.current.loadRecentFoods();
    });

    expect(mockedGetDaily).toHaveBeenCalledWith('2026-05-23');
  });
});
