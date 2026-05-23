/**
 * Tests for src/utils/date.ts — particularly the locale-aware
 * `bucketDateLocal` helper introduced for audit P0-3 / P0-4.
 *
 * Node honours `process.env.TZ` only at process startup, so we instead
 * exercise the helpers with explicit `timeZone` arguments. The production
 * call sites use the device's local zone, but the helper's correctness is
 * the same in both modes (Intl.DateTimeFormat does the heavy lifting).
 */

import { bucketDateLocal, getLocalWeekStart, getTodayString, addDays } from '../date';

describe('bucketDateLocal', () => {
  it('returns YYYY-MM-DD in UTC when timeZone=UTC', () => {
    // 2026-03-05 13:00 UTC → still 2026-03-05 in UTC.
    expect(bucketDateLocal(new Date('2026-03-05T13:00:00Z'), 'UTC')).toBe('2026-03-05');
  });

  it('Australia/Sydney: 09:00 local on the next calendar day rolls to that day', () => {
    // Sydney in early March is UTC+11. 22:00 UTC on Mar 4 = 09:00 Sydney on Mar 5.
    // Old `toISOString().split('T')[0]` would return "2026-03-04" — the bug.
    expect(
      bucketDateLocal(new Date('2026-03-04T22:00:00Z'), 'Australia/Sydney'),
    ).toBe('2026-03-05');
  });

  it('Europe/London: 00:30 local on a new day rolls to that new day', () => {
    // London on Mar 5 is UTC+0 (still GMT). 00:30 local == 00:30 UTC.
    expect(
      bucketDateLocal(new Date('2026-03-05T00:30:00Z'), 'Europe/London'),
    ).toBe('2026-03-05');
  });

  it('America/Los_Angeles: 22:00 local is still "today" even after UTC has rolled over', () => {
    // PST is UTC-8 in late Jan. 22:00 LA on Jan 28 = 06:00 UTC on Jan 29.
    // Old UTC bucketing would have called it "2026-01-29" — wrong.
    expect(
      bucketDateLocal(new Date('2026-01-29T06:00:00Z'), 'America/Los_Angeles'),
    ).toBe('2026-01-28');
  });

  it('America/Los_Angeles: Sunday 23:30 local on DST fall-back day stays on Sunday', () => {
    // 2026-11-01 is the US DST fall-back. At 23:30 local on the Sunday
    // (== 07:30 UTC Monday once back on PST/UTC-8), the calendar day is
    // still Sunday Nov 1 for the user.
    expect(
      bucketDateLocal(new Date('2026-11-02T07:30:00Z'), 'America/Los_Angeles'),
    ).toBe('2026-11-01');
  });
});

describe('getLocalWeekStart (Monday-anchored)', () => {
  it('positive offset advances by exactly N weeks (UTC anchor)', () => {
    const monday0 = getLocalWeekStart(0, 'UTC');
    const monday1 = getLocalWeekStart(1, 'UTC');
    const mondayMinus1 = getLocalWeekStart(-1, 'UTC');

    const d0 = new Date(`${monday0}T00:00:00Z`);
    const d1 = new Date(`${monday1}T00:00:00Z`);
    const dMinus1 = new Date(`${mondayMinus1}T00:00:00Z`);

    expect((d1.getTime() - d0.getTime()) / 86_400_000).toBe(7);
    expect((d0.getTime() - dMinus1.getTime()) / 86_400_000).toBe(7);
  });

  it('always returns a Monday in YYYY-MM-DD shape', () => {
    const result = getLocalWeekStart(0, 'UTC');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Day-of-week 1 is Monday under UTC.
    expect(new Date(`${result}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('Pacific user, Sunday 23:30 local on DST fall-back week resolves to the previous Monday', () => {
    // Prove the DST-safe path: bucket a known DST-fall-back UTC moment in
    // LA tz, then derive the Monday from the bucketed date. The bucketed
    // day must be Sunday 2026-11-01, and the Monday computed from a
    // Sunday is the previous Monday (2026-10-26).
    const bucketed = bucketDateLocal(new Date('2026-11-02T07:30:00Z'), 'America/Los_Angeles');
    expect(bucketed).toBe('2026-11-01');
    const anchor = new Date(`${bucketed}T00:00:00Z`);
    const day = anchor.getUTCDay();
    const daysBack = day === 0 ? 6 : day - 1;
    anchor.setUTCDate(anchor.getUTCDate() - daysBack);
    const y = anchor.getUTCFullYear();
    const m = String(anchor.getUTCMonth() + 1).padStart(2, '0');
    const d = String(anchor.getUTCDate()).padStart(2, '0');
    expect(`${y}-${m}-${d}`).toBe('2026-10-26');
  });

  it('Pacific user spring-forward Sunday still resolves to the correct Monday', () => {
    // 2026-03-08 is the US spring-forward Sunday. 19:00 UTC == 12:00 PT.
    // The bucketed day is Sunday 2026-03-08; the Monday of that ISO week
    // is 2026-03-02.
    const bucketed = bucketDateLocal(new Date('2026-03-08T19:00:00Z'), 'America/Los_Angeles');
    expect(bucketed).toBe('2026-03-08');
    const anchor = new Date(`${bucketed}T00:00:00Z`);
    const day = anchor.getUTCDay();
    const daysBack = day === 0 ? 6 : day - 1;
    anchor.setUTCDate(anchor.getUTCDate() - daysBack);
    const y = anchor.getUTCFullYear();
    const m = String(anchor.getUTCMonth() + 1).padStart(2, '0');
    const d = String(anchor.getUTCDate()).padStart(2, '0');
    expect(`${y}-${m}-${d}`).toBe('2026-03-02');
  });
});

describe('getTodayString', () => {
  it('returns a YYYY-MM-DD string for "right now" in the device tz', () => {
    expect(getTodayString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(getTodayString()).toBe(bucketDateLocal(new Date()));
  });
});

describe('addDays', () => {
  it('shifts the date by the requested whole-day count', () => {
    expect(addDays('2026-03-05', 1)).toBe('2026-03-06');
    expect(addDays('2026-03-05', -1)).toBe('2026-03-04');
    expect(addDays('2026-03-05', 30)).toBe('2026-04-04');
  });
});
