/**
 * wearablesTheme — tone mapping + metric metadata single-source-of-truth tests.
 */

import {
  toneTokens,
  toneForBucket,
  bucketForParam,
  paramForBucket,
  metricMeta,
  METRIC_META,
  SHELL_CROSSFADE_MS,
} from '../wearablesTheme';

describe('tone mapping', () => {
  it('maps H&F → warm and S&R → cool', () => {
    expect(toneForBucket('HEALTH_FITNESS')).toBe('warm');
    expect(toneForBucket('SLEEP_RECOVERY')).toBe('cool');
  });

  it('produces distinct accent/glow tokens per tone', () => {
    const warm = toneTokens('warm');
    const cool = toneTokens('cool');
    expect(warm.accent).not.toBe(cool.accent);
    expect(warm.glow).not.toBe(cool.glow);
    expect(typeof warm.track).toBe('string');
  });

  it('cross-fade timing matches the §1.4 spec (200ms)', () => {
    expect(SHELL_CROSSFADE_MS).toBe(200);
  });
});

describe('bucket ⇄ param round-trip', () => {
  it('defaults unknown/absent param to fitness', () => {
    expect(bucketForParam(undefined)).toBe('HEALTH_FITNESS');
    expect(bucketForParam('fitness')).toBe('HEALTH_FITNESS');
    expect(bucketForParam('recovery')).toBe('SLEEP_RECOVERY');
  });
  it('round-trips both directions', () => {
    expect(paramForBucket(bucketForParam('recovery'))).toBe('recovery');
    expect(paramForBucket(bucketForParam('fitness'))).toBe('fitness');
  });
});

describe('metricMeta', () => {
  it('returns the curated meta for known H&F metrics', () => {
    const steps = metricMeta('STEPS');
    expect(steps.shortLabel).toBe('Steps');
    expect(steps.summary).toBe('sum');
    expect(steps.format(12345, 'count')).toBe('12,345');
  });

  it('formats kcal and bpm with units', () => {
    expect(metricMeta('ACTIVE_ENERGY_KCAL').format(500, 'kcal')).toBe('500 kcal');
    expect(metricMeta('RESTING_HEART_RATE_BPM').format(58.4, 'bpm')).toBe('58 bpm');
  });

  it('falls back to a safe generic presentation for an unmapped metric', () => {
    // HRV_MS is intentionally absent from METRIC_META (HK-3b owns S&R curation).
    expect(METRIC_META.HRV_MS).toBeUndefined();
    const meta = metricMeta('HRV_MS');
    expect(meta.label).toBe('Hrv Ms');
    expect(meta.icon).toBe('stats-chart-outline');
    expect(meta.format(42, 'ms')).toBe('42 ms');
  });

  it('never throws on a non-finite value', () => {
    expect(() => metricMeta('STEPS').format(Number.NaN, 'count')).not.toThrow();
    expect(metricMeta('STEPS').format(Number.NaN, 'count')).toBe('—');
  });
});
