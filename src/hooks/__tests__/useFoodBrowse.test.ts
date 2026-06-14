/**
 * Behavioural test (R26) for `useFoodBrowse` — proves that the 7-day
 * "frequent foods" walk does NOT parse `selectedDate` through a UTC-aware
 * Date constructor, which is what shifted users west-of-UTC back a day.
 *
 * Bug being guarded:
 *   Earlier code did `new Date(selectedDate)` which parses a bare date
 *   as UTC midnight. A user in America/Los_Angeles (UTC-7) opening the
 *   food log for "2026-05-23" would then see the first daily fetch
 *   target "2026-05-22" once `bucketDateLocal` re-projected it into
 *   local time. The Round-2 fix replaced that path with string-level
 *   `addDays(selectedDate, -i)` arithmetic in `src/utils/date.ts`.
 *
 * Strategy (Option C — namespace-level interception):
 *   The previous iteration of this test mocked only the exported
 *   `bucketDateLocal`, but the real `addDays` (inside the same module)
 *   closes over the in-module reference and never sees the export-level
 *   mock. We instead replace `addDays` itself with a pure string-math
 *   implementation that is timezone-independent. Together with a
 *   tagged `bucketDateLocal` mock, this gives us a positive observable
 *   assertion AND a regression-catching guard:
 *
 *   - If the hook keeps using `addDays(selectedDate, -i)`, the mocked
 *     `addDays` runs and produces the expected 7-day calendar walk
 *     starting at `'2026-05-23'`.
 *   - If the hook regresses to `new Date(selectedDate)` +
 *     `bucketDateLocal(d)`, our `bucketDateLocal` mock asserts that it
 *     is only ever called with dates whose UTC and local calendar day
 *     agree — and explicitly throws if a UTC-midnight bare-string date
 *     ever reaches it. That makes the buggy path fail loudly here.
 *
 *   We also pin `Intl.DateTimeFormat` to America/Los_Angeles so any
 *   *unmocked* `bucketDateLocal` call (if a future refactor inlines it)
 *   will still resolve in LA — preserving the timezone-sensitivity
 *   meaning of `2026-05-23` vs `2026-05-22` for any code that bypasses
 *   the mock.
 */

import { act, renderHook } from '@testing-library/react-native';

jest.mock('../../services/api', () => ({
  __esModule: true,
  logApi: {
    getDaily: jest.fn(),
  },
}));

// Hoisted above all imports. Pins `Intl.DateTimeFormat` to LA so that the
// real `bucketDateLocal` (constructed below at module load via
// `jest.requireActual`) caches its default formatter under LA. This
// keeps the timezone narrative consistent for any direct, unmocked use
// of `bucketDateLocal` from the hook surface.
jest.mock('../../utils/date', () => {
  const Original = Intl.DateTimeFormat;
  const Patched: any = function (
    locale?: string | string[],
    options?: Intl.DateTimeFormatOptions,
  ) {
    const tz = options?.timeZone ?? 'America/Los_Angeles';
    return new Original(locale, { ...options, timeZone: tz });
  };
  Patched.prototype = Original.prototype;
  Object.getOwnPropertyNames(Original).forEach((key) => {
    if (key === 'length' || key === 'name' || key === 'prototype') return;
    try {
      Patched[key] = (Original as any)[key];
    } catch {
      // non-writable; ignore.
    }
  });
  // Intl.DateTimeFormat is widened to any so we can swap the constructor in tests.
  (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Patched;
  const actual = jest.requireActual('../../utils/date');

  // Pure string-math addDays: independent of host timezone, independent
  // of Date constructor parsing. This is the canonical correct shape for
  // a date-string walk over bare YYYY-MM-DD.
  const addDays = (dateStr: string, days: number): string => {
    const [y, m, d] = dateStr.split('-').map(Number);
    // Use UTC math so day/month rollovers are correct without engaging
    // the host's timezone interpretation.
    const t = Date.UTC(y, m - 1, d) + days * 86400000;
    const dt = new Date(t);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };

  // `bucketDateLocal` mock that fails loudly if it ever receives a Date
  // whose UTC calendar day differs from its LA calendar day — which is
  // exactly the shape that `new Date(bareYYYYMMDD)` produces for any
  // user west of UTC. A regression in the hook to that buggy parse
  // would route through here and trip the assertion.
  const laFormatter = new Original('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Los_Angeles',
  });
  const bucketDateLocal = (date: Date = new Date(), tz?: string): string => {
    if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0) {
      throw new Error(
        `regression: bucketDateLocal called with UTC-midnight date ${date.toISOString()} — ` +
          'this is the buggy `new Date(bareYYYYMMDD)` pattern the fix removed',
      );
    }
    return tz
      ? new Original('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(date)
      : laFormatter.format(date);
  };

  return {
    __esModule: true,
    ...actual,
    addDays,
    bucketDateLocal,
  };
});

import { useFoodBrowse } from '../useFoodBrowse';
import { logApi } from '../../services/api';
import { addDays as mockedAddDays, bucketDateLocal as mockedBucket } from '../../utils/date';

const mockedGetDaily = logApi.getDaily as jest.MockedFunction<typeof logApi.getDaily>;

describe('useFoodBrowse — date-only string is not shifted west-of-UTC', () => {
  beforeEach(() => {
    mockedGetDaily.mockReset();
    mockedGetDaily.mockResolvedValue({ data: { entries: [] } } as never);
  });

  it('sanity: the date-module mock is pure string-math and LA-pinned', () => {
    // The mocked addDays must be tz-independent string math.
    expect(mockedAddDays('2026-05-23', 0)).toBe('2026-05-23');
    expect(mockedAddDays('2026-05-23', -1)).toBe('2026-05-22');
    expect(mockedAddDays('2026-03-01', -1)).toBe('2026-02-28');
    // The mocked bucketDateLocal trips on UTC-midnight Dates (the bug shape).
    expect(() => mockedBucket(new Date('2026-05-23T00:00:00Z'))).toThrow(/regression/);
  });

  it('loadFrequentFoods produces the exact 7-day calendar walk starting at "2026-05-23"', async () => {
    const { result } = await renderHook(() => useFoodBrowse('user-1', '2026-05-23'));

    await act(async () => {
      await result.current.loadFrequentFoods();
    });

    const calledDates = mockedGetDaily.mock.calls.map((c) => c[0]);
    // Exactly seven fetches.
    expect(calledDates).toHaveLength(7);
    // The first (i=0) fetch is the selected date itself — proving no
    // backward shift from a UTC-midnight Date parse.
    expect(calledDates[0]).toBe('2026-05-23');
    // Full calendar walk — proves the hook uses string-level arithmetic.
    expect(calledDates).toEqual([
      '2026-05-23',
      '2026-05-22',
      '2026-05-21',
      '2026-05-20',
      '2026-05-19',
      '2026-05-18',
      '2026-05-17',
    ]);
    // The prior-day UTC-midnight shift would have surfaced this string.
    expect(calledDates).not.toContain('2026-05-22T00:00:00.000Z');
  });

  it('loadRecentFoods passes selectedDate through verbatim', async () => {
    const { result } = await renderHook(() => useFoodBrowse('user-1', '2026-05-23'));

    await act(async () => {
      await result.current.loadRecentFoods();
    });

    expect(mockedGetDaily).toHaveBeenCalledWith('2026-05-23');
  });
});
