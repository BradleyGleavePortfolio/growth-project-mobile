/**
 * smoothPath — monotone-cubic SVG path builder tests (R1 visual P0 #1).
 *
 * The chart's premium feel depends on a smooth bezier line that NEVER overshoots
 * the underlying health data. These tests pin the path-string contract the chart
 * + its render test rely on (starts with `M`, contains `C`) and the no-overshoot
 * guarantee that distinguishes monotone-cubic from a naive spline.
 */

import {
  smoothAreaPath,
  smoothLinePath,
  type PathPoint,
} from '../smoothPath';

describe('smoothLinePath', () => {
  it('returns an empty string for no points', () => {
    expect(smoothLinePath([])).toBe('');
  });

  it('returns a lone move command for a single point', () => {
    const d = smoothLinePath([{ x: 10, y: 20 }]);
    expect(d).toBe('M 10 20');
    expect(d).not.toContain('C');
  });

  it('builds a cubic-bezier path for >=2 points (starts with M, contains C)', () => {
    const pts: PathPoint[] = [
      { x: 0, y: 50 },
      { x: 25, y: 10 },
      { x: 50, y: 80 },
      { x: 100, y: 30 },
    ];
    const d = smoothLinePath(pts);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('C');
    // One cubic segment per interval between points.
    expect(d.match(/C/g)?.length).toBe(pts.length - 1);
  });

  it('does not overshoot between points (monotone guarantee)', () => {
    // A sharp local peak: a naive Catmull-Rom would push a control point above
    // y=10's neighbours; monotone-cubic must keep every control point's y within
    // the surrounding data range so the curve never invents an out-of-range value.
    const pts: PathPoint[] = [
      { x: 0, y: 100 },
      { x: 1, y: 100 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    const d = smoothLinePath(pts);
    // Extract every numeric y-coordinate from the path string.
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    // Path numbers come in x,y pairs after the initial M; collect ys (odd idx).
    const ys = nums.filter((_, i) => i % 2 === 1);
    // No control point may exceed the data's [0, 100] envelope.
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
    }
  });
});

describe('smoothAreaPath', () => {
  it('returns empty for fewer than 2 points', () => {
    expect(smoothAreaPath([], 99)).toBe('');
    expect(smoothAreaPath([{ x: 0, y: 0 }], 99)).toBe('');
  });

  it('closes the area down to the baseline (ends with Z)', () => {
    const pts: PathPoint[] = [
      { x: 0, y: 10 },
      { x: 50, y: 40 },
      { x: 100, y: 20 },
    ];
    const d = smoothAreaPath(pts, 99);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('C');
    expect(d.trimEnd().endsWith('Z')).toBe(true);
    // Drops to the baseline at the last and first x before closing.
    expect(d).toContain('L 100 99');
    expect(d).toContain('L 0 99');
  });
});
