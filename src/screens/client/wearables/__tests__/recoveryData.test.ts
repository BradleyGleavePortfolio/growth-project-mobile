/**
 * recoveryData — pure selector tests. Assert REAL values (50-Failures #17 — no
 * `toBeDefined` theatre): exact minutes, fractions, deficits, and the
 * plain-language stage labels.
 */

import type { WearableSamplesResponse } from '../../../../api/wearablesSamplesApi';
import {
  recoveryScore,
  sleepStages,
  sleepDeficit,
  respiration,
  sleepConsistency,
  trendFor,
  latestValue,
  formatMinutes,
  DEFAULT_SLEEP_NEED_MIN,
  SPO2_ATTENTION_THRESHOLD,
} from '../recoveryData';

function resp(series: WearableSamplesResponse['series']): WearableSamplesResponse {
  return {
    version: 1,
    user_id: 'u1',
    bucket: 'SLEEP_RECOVERY',
    window: { from: '2026-05-01T00:00:00Z', to: '2026-05-08T00:00:00Z' },
    series,
    freshness: { providers: [] },
  };
}

function sample(value: number, day = 1) {
  const d = String(day).padStart(2, '0');
  return { start_at: `2026-05-${d}T22:00:00Z`, end_at: `2026-05-${d}T22:00:01Z`, value, provider: 'OURA' };
}

describe('recoveryScore', () => {
  it('prefers RECOVERY_SCORE when present', () => {
    const data = resp([
      { metric: 'RECOVERY_SCORE', unit: 'score', provider_used: 'OURA', sample_count: 1, samples: [sample(72)] },
      { metric: 'READINESS_SCORE', unit: 'score', provider_used: 'OURA', sample_count: 1, samples: [sample(40)] },
    ]);
    expect(recoveryScore(data)).toBe(72);
  });

  it('falls back to READINESS_SCORE when recovery is absent', () => {
    const data = resp([
      { metric: 'READINESS_SCORE', unit: 'score', provider_used: 'OURA', sample_count: 1, samples: [sample(58)] },
    ]);
    expect(recoveryScore(data)).toBe(58);
  });

  it('returns null when neither score has data', () => {
    expect(recoveryScore(resp([]))).toBeNull();
    expect(recoveryScore(undefined)).toBeNull();
  });

  it('clamps and rounds out-of-range values', () => {
    const data = resp([
      { metric: 'RECOVERY_SCORE', unit: 'score', provider_used: 'OURA', sample_count: 1, samples: [sample(108.6)] },
    ]);
    expect(recoveryScore(data)).toBe(100);
  });
});

describe('sleepStages — plain language only', () => {
  it('builds slices with plain-language labels and exact minutes', () => {
    const data = resp([
      { metric: 'SLEEP_REM_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1, samples: [sample(90)] },
      { metric: 'SLEEP_DEEP_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1, samples: [sample(60)] },
      { metric: 'SLEEP_LIGHT_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1, samples: [sample(240)] },
      { metric: 'SLEEP_AWAKE_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1, samples: [sample(30)] },
    ]);
    const view = sleepStages(data)!;
    expect(view.totalMinutes).toBe(420);
    const labels = view.slices.map((s) => s.label);
    // Plain language ONLY — never clinical sleep-stage codes.
    expect(labels).toEqual(['REM', 'Deep sleep', 'Light sleep', 'Awake']);
    const rem = view.slices.find((s) => s.key === 'rem')!;
    expect(rem.minutes).toBe(90);
    expect(rem.fraction).toBeCloseTo(90 / 420, 5);
  });

  it('drops zero-minute stages from the bar', () => {
    const data = resp([
      { metric: 'SLEEP_REM_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1, samples: [sample(80)] },
      { metric: 'SLEEP_LIGHT_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1, samples: [sample(200)] },
    ]);
    const view = sleepStages(data)!;
    expect(view.slices.map((s) => s.key)).toEqual(['rem', 'light']);
  });

  it('returns null when no stage data exists', () => {
    expect(sleepStages(resp([]))).toBeNull();
  });
});

describe('sleepDeficit', () => {
  it('uses SLEEP_DURATION_MIN when present', () => {
    const data = resp([
      { metric: 'SLEEP_DURATION_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1, samples: [sample(435)] },
    ]);
    const view = sleepDeficit(data)!;
    expect(view.asleepMinutes).toBe(435);
    expect(view.needMinutes).toBe(DEFAULT_SLEEP_NEED_MIN);
    expect(view.deficitMinutes).toBe(45);
  });

  it('derives asleep from stages (excluding awake) when duration absent', () => {
    const data = resp([
      { metric: 'SLEEP_REM_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1, samples: [sample(90)] },
      { metric: 'SLEEP_DEEP_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1, samples: [sample(60)] },
      { metric: 'SLEEP_LIGHT_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1, samples: [sample(240)] },
      { metric: 'SLEEP_AWAKE_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1, samples: [sample(30)] },
    ]);
    const view = sleepDeficit(data)!;
    expect(view.asleepMinutes).toBe(390); // 90+60+240, awake excluded
    expect(view.deficitMinutes).toBe(90);
  });

  it('reports zero deficit when need is met', () => {
    const data = resp([
      { metric: 'SLEEP_DURATION_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1, samples: [sample(510)] },
    ]);
    expect(sleepDeficit(data)!.deficitMinutes).toBe(0);
  });

  it('returns null with no sleep data', () => {
    expect(sleepDeficit(resp([]))).toBeNull();
  });
});

describe('respiration', () => {
  it('flags SpO2 below the clinical-attention threshold', () => {
    const data = resp([
      { metric: 'RESPIRATORY_RATE_BRPM', unit: 'br/min', provider_used: 'OURA', sample_count: 1, samples: [sample(14.2)] },
      { metric: 'SPO2_PCT', unit: '%', provider_used: 'OURA', sample_count: 1, samples: [sample(88)] },
    ]);
    const view = respiration(data);
    expect(view.respiratoryRate).toBe(14.2);
    expect(view.spo2).toBe(88);
    expect(view.spo2NeedsAttention).toBe(true);
    expect(SPO2_ATTENTION_THRESHOLD).toBe(90);
  });

  it('does not flag SpO2 at or above threshold', () => {
    const data = resp([
      { metric: 'SPO2_PCT', unit: '%', provider_used: 'OURA', sample_count: 1, samples: [sample(96)] },
    ]);
    expect(respiration(data).spo2NeedsAttention).toBe(false);
  });

  it('returns nulls and no attention flag with no data', () => {
    const view = respiration(resp([]));
    expect(view.spo2).toBeNull();
    expect(view.spo2NeedsAttention).toBe(false);
  });
});

describe('sleepConsistency', () => {
  it('computes bedtime/wake spread in minutes-of-day', () => {
    const data = resp([
      {
        metric: 'SLEEP_ONSET_ISO',
        unit: 'min',
        provider_used: 'OURA',
        sample_count: 3,
        samples: [sample(1380, 1), sample(1410, 2), sample(1350, 3)], // 23:00, 23:30, 22:30
      },
      {
        metric: 'SLEEP_WAKE_ISO',
        unit: 'min',
        provider_used: 'OURA',
        sample_count: 3,
        samples: [sample(420, 1), sample(450, 2), sample(405, 3)],
      },
    ]);
    const view = sleepConsistency(data);
    expect(view.bedtimeSpreadMin).toBe(60); // 1410 - 1350
    expect(view.wakeSpreadMin).toBe(45); // 450 - 405
    expect(view.nights).toBe(3);
  });

  it('returns nulls with no onset data', () => {
    const view = sleepConsistency(resp([]));
    expect(view.bedtimeSpreadMin).toBeNull();
    expect(view.nights).toBe(0);
  });
});

describe('trendFor / latestValue', () => {
  it('prefers day buckets when present', () => {
    const data = resp([
      {
        metric: 'HRV_MS',
        unit: 'ms',
        provider_used: 'OURA',
        sample_count: 2,
        samples: [sample(40, 1), sample(42, 2)],
        buckets: [
          { bucket_start: '2026-05-01T00:00:00Z', bucket_end: '2026-05-02T00:00:00Z', agg: 41, count: 2 },
        ],
      },
    ]);
    const trend = trendFor(data, 'HRV_MS');
    expect(trend).toEqual([{ at: '2026-05-01T00:00:00Z', value: 41 }]);
  });

  it('latestValue returns the last sample', () => {
    const data = resp([
      { metric: 'HRV_MS', unit: 'ms', provider_used: 'OURA', sample_count: 2, samples: [sample(40, 1), sample(55, 2)] },
    ]);
    expect(latestValue(data, 'HRV_MS')).toBe(55);
  });
});

describe('formatMinutes', () => {
  it.each([
    [45, '45 min'],
    [60, '1h'],
    [435, '7h 15m'],
    [0, '0 min'],
  ])('formats %i minutes as %s', (input, expected) => {
    expect(formatMinutes(input)).toBe(expected);
  });
});
