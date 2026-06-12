/**
 * detectPersonalRecord — ED.4 PR-detection logic.
 *
 * Pins the Math.max-derived fallback contract: a PR is the FIRST point that
 * strictly exceeds every prior point; a flat / descending / single-point
 * series has no PR.
 */
import { detectPersonalRecord } from '../detectPersonalRecord';

describe('detectPersonalRecord', () => {
  it('returns null for fewer than two points', () => {
    expect(detectPersonalRecord([])).toBeNull();
    expect(detectPersonalRecord([{ x: 0, y: 100 }])).toBeNull();
  });

  it('flags the point that sets a new high-water mark', () => {
    const series = [
      { x: 1, y: 185 },
      { x: 2, y: 205 },
      { x: 3, y: 225 }, // new high
      { x: 4, y: 215 },
    ];
    const pr = detectPersonalRecord(series);
    expect(pr).not.toBeNull();
    expect(pr?.index).toBe(2);
    expect(pr?.point.y).toBe(225);
  });

  it('returns the FIRST occurrence when the max is tied', () => {
    const series = [
      { x: 1, y: 100 },
      { x: 2, y: 120 }, // first time 120 is reached
      { x: 3, y: 120 },
    ];
    expect(detectPersonalRecord(series)?.index).toBe(1);
  });

  it('returns null when the series only descends (no point beats the start)', () => {
    const series = [
      { x: 1, y: 250 },
      { x: 2, y: 240 },
      { x: 3, y: 230 },
    ];
    expect(detectPersonalRecord(series)).toBeNull();
  });

  it('returns null for a flat series', () => {
    const series = [
      { x: 1, y: 200 },
      { x: 2, y: 200 },
      { x: 3, y: 200 },
    ];
    expect(detectPersonalRecord(series)).toBeNull();
  });
});
