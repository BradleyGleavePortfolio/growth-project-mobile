/**
 * S-SCHED calendar time helpers: client-zone display, coach clock label
 * only when it differs, and day grouping across a DST change.
 */
import { coachTimeLabel, formatRange, formatSessionSpan, formatWhen, groupSlotsByDay, nowToMinuteIso, zonesDiffer } from '../calendarTime';

describe('calendarTime', () => {
  it('formats in the given client zone', () => {
    expect(formatWhen('2026-10-05T16:00:00.000Z', 'America/Los_Angeles')).toBe('Monday, October 5 at 9:00 AM');
    expect(formatRange('2026-10-05T16:00:00.000Z', '2026-10-05T16:20:00.000Z', 'America/New_York')).toBe('12:00 PM to 12:20 PM');
  });

  it('formats a compact session line with weekday, date and one period when both ends share it (U-04-4)', () => {
    expect(formatSessionSpan('2026-10-07T16:00:00.000Z', '2026-10-07T16:30:00.000Z', 'America/Los_Angeles')).toBe('Wed, Oct 7 \u00b7 9:00\u20139:30 AM');
    expect(formatSessionSpan('2026-10-07T18:30:00.000Z', '2026-10-07T19:15:00.000Z', 'America/Los_Angeles')).toBe('Wed, Oct 7 \u00b7 11:30 AM\u201312:15 PM');
    expect(formatSessionSpan('2026-10-07T16:00:00.000Z', '2026-10-07T16:30:00.000Z', 'America/New_York')).not.toMatch(/:\d\d:\d\d|\//);
  });

  it('labels the coach clock only when it differs from the client clock', () => {
    expect(coachTimeLabel('2026-10-05T16:00:00.000Z', 'America/Los_Angeles', 'America/Los_Angeles')).toBeNull();
    expect(coachTimeLabel('2026-10-05T16:00:00.000Z', null, 'America/New_York')).toBeNull();
    expect(coachTimeLabel('2026-10-05T16:00:00.000Z', 'America/Los_Angeles', 'America/New_York')).toBe('9:00 AM PDT coach time');
    // Same offset, different name: no label.
    expect(zonesDiffer(new Date('2026-10-05T16:00:00.000Z'), 'America/Los_Angeles', 'America/Vancouver')).toBe(false);
  });

  it('groups by client-local day and keeps wall-clock times across the fall DST change', () => {
    const days = groupSlotsByDay(
      [
        { start_at: '2026-11-02T17:00:00.000Z', end_at: '2026-11-02T17:30:00.000Z' }, // Mon 9:00 PST
        { start_at: '2026-10-30T16:00:00.000Z', end_at: '2026-10-30T16:30:00.000Z' }, // Fri 9:00 PDT
        { start_at: '2026-10-31T06:30:00.000Z', end_at: '2026-10-31T07:00:00.000Z' }, // Fri 23:30 PDT
      ],
      'America/Los_Angeles',
    );
    expect(days.map((d) => d.key)).toEqual(['2026-10-30', '2026-11-02']);
    expect(days[0].slots).toHaveLength(2);
    expect(days[1].label).toBe('Monday, November 2');
    expect(formatWhen(days[1].slots[0].start_at, 'America/Los_Angeles')).toBe('Monday, November 2 at 9:00 AM');
  });

  it('rounds now to the minute for a stable query key', () => {
    expect(nowToMinuteIso(Date.parse('2026-10-01T10:15:42.123Z'))).toBe('2026-10-01T10:15:00.000Z');
  });

  it('keeps both repeated fall-back times as distinct instants', () => {
    const days = groupSlotsByDay([
      { start_at: '2026-11-01T08:30:00Z', end_at: '2026-11-01T08:45:00Z' },
      { start_at: '2026-11-01T09:30:00Z', end_at: '2026-11-01T09:45:00Z' },
    ], 'America/Los_Angeles');
    expect(days).toHaveLength(1);
    expect(days[0].slots).toHaveLength(2);
    expect(days[0].slots[0].start_at).not.toBe(days[0].slots[1].start_at);
  });
});
