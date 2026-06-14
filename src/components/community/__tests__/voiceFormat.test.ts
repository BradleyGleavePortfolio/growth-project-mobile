/**
 * voiceFormat — pure-helper tests (no rendering). Pins duration formatting,
 * the waveform downsampler's stable bar count + flat-baseline degradation, and
 * the compact byte formatter.
 */
import {
  formatDuration,
  downsamplePeaks,
  formatBytes,
} from '../voiceFormat';

describe('formatDuration', () => {
  it('formats m:ss with a zero-padded seconds field', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(4200)).toBe('0:04');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(300_000)).toBe('5:00');
  });

  it('treats non-finite / negative input as zero', () => {
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(-10)).toBe('0:00');
  });
});

describe('downsamplePeaks', () => {
  it('always returns exactly barCount bars', () => {
    expect(downsamplePeaks([0.1, 0.2, 0.3, 0.4, 0.5], 3)).toHaveLength(3);
    expect(downsamplePeaks([0.9], 8)).toHaveLength(8);
  });

  it('degrades to a flat baseline (zeros) when there are no peaks', () => {
    expect(downsamplePeaks([], 4)).toEqual([0, 0, 0, 0]);
  });

  it('clamps each bar into [0,1]', () => {
    const bars = downsamplePeaks([2, -1, 0.5, 1.5], 4);
    for (const b of bars) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });

  it('returns an empty array for a zero bar count', () => {
    expect(downsamplePeaks([0.5, 0.5], 0)).toEqual([]);
  });
});

describe('formatBytes', () => {
  it('formats KB and MB compactly', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
