/**
 * AUDIT-06-125 B1 / U3: GET /weight/history answers `{ logs, height_cm }` and
 * each row's `date` is a calendar day sent as "YYYY-MM-DDT00:00:00.000Z".
 * Main read only a bare array (so Progress never showed a weight) and moved
 * every US entry to the day before.
 */
import { parseWeightLogRow, weightHistoryRows } from '../weightHistory';

const serverRow = {
  id: 'w1',
  user_id: 'user-1',
  date: '2026-10-06T00:00:00.000Z',
  weight_lbs: 182.4,
  notes: 'after run',
  logged_at: '2026-10-06T15:02:11.000Z',
};

describe('weightHistoryRows', () => {
  it('reads the rows from the real server envelope', () => {
    expect(weightHistoryRows({ logs: [serverRow], height_cm: 178 })).toEqual([serverRow]);
  });

  it('still accepts a bare array', () => {
    expect(weightHistoryRows([serverRow])).toEqual([serverRow]);
  });

  it('answers no rows for anything else', () => {
    expect(weightHistoryRows(null)).toEqual([]);
    expect(weightHistoryRows({ height_cm: 178 })).toEqual([]);
  });
});

describe('parseWeightLogRow', () => {
  it('keeps the logged calendar day of a date-only column', () => {
    const log = parseWeightLogRow(serverRow, 'fallback');
    expect(log).not.toBeNull();
    expect(log?.date).toBe('2026-10-06');
    expect(log?.weight).toBe(182.4);
    expect(log?.unit).toBe('lbs');
    expect(log?.notes).toBe('after run');
  });
});
