import { bucketDateLocal } from '../date';

/**
 * Regression coverage for the streak miscount bug (P0-4): toISOString()
 * returns UTC, so a fast started after ~14:00 local in Hawaii/Australia was
 * bucketed into the next/previous UTC day and the streak silently reset.
 *
 * Every assertion below picks a wall-clock instant where the UTC date and the
 * local-tz date are different, and asserts we emit the LOCAL day.
 */
describe('bucketDateLocal', () => {
  it('returns YYYY-MM-DD for the resolved local time zone', () => {
    const d = new Date('2026-05-21T15:00:00Z');
    expect(bucketDateLocal(d, 'UTC')).toBe('2026-05-21');
  });

  it('buckets a Hawaii (-10) fast started 19:00 local into that local day, not the UTC tomorrow', () => {
    // 7pm HST on 2026-05-21 == 05:00 UTC on 2026-05-22.
    // The old toISOString().split('T')[0] code would have returned 2026-05-22,
    // breaking the streak for the HST user.
    const d = new Date('2026-05-22T05:00:00Z');
    expect(bucketDateLocal(d, 'Pacific/Honolulu')).toBe('2026-05-21');
  });

  it('buckets a Sydney (+10) fast started 01:00 local into that local day, not the UTC yesterday', () => {
    // 01:00 AEST on 2026-05-22 == 15:00 UTC on 2026-05-21.
    // Old code would have returned 2026-05-21 for an AU user whose local day
    // is already 2026-05-22, again resetting the streak.
    const d = new Date('2026-05-21T15:00:00Z');
    expect(bucketDateLocal(d, 'Australia/Sydney')).toBe('2026-05-22');
  });

  it('emits a 4-2-2 YYYY-MM-DD shape for any timezone', () => {
    const d = new Date('2026-05-21T12:00:00Z');
    for (const tz of [
      'UTC',
      'Pacific/Honolulu',
      'America/Los_Angeles',
      'America/New_York',
      'Europe/London',
      'Australia/Sydney',
      'Asia/Tokyo',
    ]) {
      expect(bucketDateLocal(d, tz)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
