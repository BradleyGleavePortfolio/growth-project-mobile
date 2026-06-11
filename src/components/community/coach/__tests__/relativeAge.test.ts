/**
 * Unit tests for relativeAge — the compact, deterministic "age" label used in
 * coach inbox + moderation rows. Pure function over epoch millis, so we pin a
 * fixed `nowMs` and walk every bucket boundary (now / m / h / d / w) plus the
 * graceful-degradation cases (future timestamps, unparseable input).
 */
import { relativeAge } from '../relativeAge';

// Fixed reference clock: 2026-06-10T17:00:00.000Z.
const NOW = Date.parse('2026-06-10T17:00:00.000Z');

/** Build an ISO string `ms` milliseconds before NOW. */
function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

describe('relativeAge', () => {
  describe('"now" bucket (under a minute)', () => {
    it('returns "now" for a timestamp equal to now', () => {
      expect(relativeAge(ago(0), NOW)).toBe('now');
    });

    it('returns "now" for 30 seconds ago', () => {
      expect(relativeAge(ago(30 * SECOND), NOW)).toBe('now');
    });

    it('returns "now" at 59 seconds (just under the minute boundary)', () => {
      expect(relativeAge(ago(59 * SECOND), NOW)).toBe('now');
    });
  });

  describe('minutes bucket', () => {
    it('rolls to "1m" exactly at 60 seconds', () => {
      expect(relativeAge(ago(MINUTE), NOW)).toBe('1m');
    });

    it('returns "5m" for five minutes ago', () => {
      expect(relativeAge(ago(5 * MINUTE), NOW)).toBe('5m');
    });

    it('returns "59m" just under the hour boundary', () => {
      expect(relativeAge(ago(59 * MINUTE), NOW)).toBe('59m');
    });
  });

  describe('hours bucket', () => {
    it('rolls to "1h" exactly at 60 minutes', () => {
      expect(relativeAge(ago(HOUR), NOW)).toBe('1h');
    });

    it('returns "3h" for three hours ago', () => {
      expect(relativeAge(ago(3 * HOUR), NOW)).toBe('3h');
    });

    it('returns "23h" just under the day boundary', () => {
      expect(relativeAge(ago(23 * HOUR), NOW)).toBe('23h');
    });
  });

  describe('days bucket', () => {
    it('rolls to "1d" exactly at 24 hours', () => {
      expect(relativeAge(ago(DAY), NOW)).toBe('1d');
    });

    it('returns "2d" for two days ago', () => {
      expect(relativeAge(ago(2 * DAY), NOW)).toBe('2d');
    });

    it('returns "6d" just under the week boundary', () => {
      expect(relativeAge(ago(6 * DAY), NOW)).toBe('6d');
    });
  });

  describe('weeks bucket', () => {
    it('rolls to "1w" exactly at 7 days', () => {
      expect(relativeAge(ago(WEEK), NOW)).toBe('1w');
    });

    it('returns "4w" for four weeks ago', () => {
      expect(relativeAge(ago(4 * WEEK), NOW)).toBe('4w');
    });

    it('keeps counting weeks past a month (no month/year bucket)', () => {
      expect(relativeAge(ago(10 * WEEK), NOW)).toBe('10w');
    });
  });

  describe('graceful degradation', () => {
    it('returns "now" for a future timestamp (clock skew)', () => {
      expect(relativeAge(new Date(NOW + 5 * MINUTE).toISOString(), NOW)).toBe('now');
    });

    it('returns "now" for an unparseable string (NaN)', () => {
      expect(relativeAge('not-a-date', NOW)).toBe('now');
    });

    it('returns "now" for an empty string', () => {
      expect(relativeAge('', NOW)).toBe('now');
    });
  });

  it('defaults nowMs to Date.now() when omitted', () => {
    // A timestamp a few seconds in the past should still read "now" against
    // the live wall clock, exercising the default-parameter branch.
    const recent = new Date(Date.now() - 2 * SECOND).toISOString();
    expect(relativeAge(recent)).toBe('now');
  });
});
