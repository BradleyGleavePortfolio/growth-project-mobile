/**
 * PR-HK-2.a — healthKitNormalizer tests.
 *
 * Real value assertions for every HealthKit-source canonical metric mapping:
 * value, unit, bucket, metric, provider, identity stamping, unit conversions
 * (HRV s→ms, SpO2 fraction→%, workout sec→min, body-temp absolute→deviation),
 * blood-pressure SYS/DIA split, sleep stage bucketing, and the
 * dropped-silently policy for metrics Apple cannot source.
 */

import {
  APPLE_HEALTHKIT,
  normalizeHealthKitResult,
  type NormalizationContext,
  type NormalizedSample,
  type WearableMetricType,
} from '../healthKitNormalizer';
import type { HealthKitReadResult } from '../healthKitClient';

const CTX: NormalizationContext = {
  userId: 'user-1',
  connectionId: 'conn-1',
  sourceTz: 'America/Los_Angeles',
};

function one(samples: NormalizedSample[], metric: WearableMetricType): NormalizedSample {
  const found = samples.filter((s) => s.metric === metric);
  expect(found).toHaveLength(1);
  return found[0];
}

const q = (value: number, start = '2026-05-30T00:00:00.000Z', end = start, id?: string) => ({
  value,
  startDate: start,
  endDate: end,
  ...(id ? { id } : {}),
});

describe('normalizeHealthKitResult — quantity metrics', () => {
  it('maps STEPS with count unit and HEALTH_FITNESS bucket', () => {
    const out = normalizeHealthKitResult({ steps: [q(8500)] }, CTX);
    const s = one(out, 'STEPS');
    expect(s.value).toBe(8500);
    expect(s.unit).toBe('count');
    expect(s.bucket).toBe('HEALTH_FITNESS');
    expect(s.provider).toBe(APPLE_HEALTHKIT);
    expect(s.userId).toBe('user-1');
    expect(s.connectionId).toBe('conn-1');
    expect(s.sourceTz).toBe('America/Los_Angeles');
  });

  it('maps ACTIVE_ENERGY_KCAL (kcal)', () => {
    const out = normalizeHealthKitResult({ activeEnergy: [q(420)] }, CTX);
    expect(one(out, 'ACTIVE_ENERGY_KCAL')).toMatchObject({ value: 420, unit: 'kcal', bucket: 'HEALTH_FITNESS' });
  });

  it('maps RESTING_HEART_RATE_BPM (bpm, SLEEP_RECOVERY bucket)', () => {
    const out = normalizeHealthKitResult({ restingHeartRate: [q(52)] }, CTX);
    expect(one(out, 'RESTING_HEART_RATE_BPM')).toMatchObject({ value: 52, unit: 'bpm', bucket: 'SLEEP_RECOVERY' });
  });

  it('maps HEART_RATE_BPM (bpm, HEALTH_FITNESS)', () => {
    const out = normalizeHealthKitResult({ heartRate: [q(72)] }, CTX);
    expect(one(out, 'HEART_RATE_BPM')).toMatchObject({ value: 72, unit: 'bpm', bucket: 'HEALTH_FITNESS' });
  });

  it('maps VO2_MAX (mL/kg/min)', () => {
    const out = normalizeHealthKitResult({ vo2Max: [q(48.5)] }, CTX);
    expect(one(out, 'VO2_MAX')).toMatchObject({ value: 48.5, unit: 'mL/kg/min' });
  });

  it('maps BODY_WEIGHT_KG (kg)', () => {
    const out = normalizeHealthKitResult({ weight: [q(80.2)] }, CTX);
    expect(one(out, 'BODY_WEIGHT_KG')).toMatchObject({ value: 80.2, unit: 'kg' });
  });

  it('maps BODY_FAT_PCT (%)', () => {
    const out = normalizeHealthKitResult({ bodyFat: [q(18.4)] }, CTX);
    expect(one(out, 'BODY_FAT_PCT')).toMatchObject({ value: 18.4, unit: '%' });
  });

  it('maps RESPIRATORY_RATE_BRPM (brpm)', () => {
    const out = normalizeHealthKitResult({ respiratoryRate: [q(14)] }, CTX);
    expect(one(out, 'RESPIRATORY_RATE_BRPM')).toMatchObject({ value: 14, unit: 'brpm' });
  });

  it('carries the provider-native record id onto sourceRecordId', () => {
    const out = normalizeHealthKitResult({ steps: [q(100, '2026-05-30T00:00:00.000Z', '2026-05-30T00:00:00.000Z', 'rec-9')] }, CTX);
    expect(one(out, 'STEPS').sourceRecordId).toBe('rec-9');
  });

  it('drops non-finite values silently', () => {
    const out = normalizeHealthKitResult(
      { steps: [{ value: Number.NaN, startDate: 'x', endDate: 'x' }] },
      CTX,
    );
    expect(out).toHaveLength(0);
  });
});

describe('normalizeHealthKitResult — unit conversions', () => {
  it('converts HRV seconds → milliseconds', () => {
    // 0.065 s SDNN → 65 ms.
    const out = normalizeHealthKitResult({ hrv: [q(0.065)] }, CTX);
    expect(one(out, 'HRV_MS')).toMatchObject({ value: 65, unit: 'ms', bucket: 'SLEEP_RECOVERY' });
  });

  it('passes HRV already in ms through unchanged', () => {
    const out = normalizeHealthKitResult({ hrv: [q(58)] }, CTX);
    expect(one(out, 'HRV_MS').value).toBe(58);
  });

  it('converts SpO2 fraction → percent', () => {
    const out = normalizeHealthKitResult({ spo2: [q(0.97)] }, CTX);
    const s = one(out, 'SPO2_PCT');
    expect(s.value).toBeCloseTo(97, 5);
    expect(s.unit).toBe('%');
  });

  it('passes SpO2 already in percent through unchanged', () => {
    const out = normalizeHealthKitResult({ spo2: [q(96)] }, CTX);
    expect(one(out, 'SPO2_PCT').value).toBe(96);
  });

  it('converts body temperature absolute °C → deviation from 37.0 baseline', () => {
    const out = normalizeHealthKitResult({ bodyTemperature: [q(37.4)] }, CTX);
    const s = one(out, 'BODY_TEMP_DEVIATION_C');
    expect(s.value).toBeCloseTo(0.4, 5);
    expect(s.unit).toBe('°C');
    expect(s.bucket).toBe('SLEEP_RECOVERY');
  });
});

describe('normalizeHealthKitResult — workouts', () => {
  const workout = {
    id: 'w1',
    activityName: 'Running',
    calories: 300,
    distance: 5000,
    duration: 1800, // 30 min
    start: '2026-05-30T06:00:00.000Z',
    end: '2026-05-30T06:30:00.000Z',
  };

  it('splits a workout into duration (sec→min) and distance (m)', () => {
    const out = normalizeHealthKitResult({ workouts: [workout] }, CTX);
    const dur = one(out, 'WORKOUT_DURATION_MIN');
    expect(dur.value).toBe(30);
    expect(dur.unit).toBe('min');
    const dist = one(out, 'WORKOUT_DISTANCE_M');
    expect(dist.value).toBe(5000);
    expect(dist.unit).toBe('m');
    expect(dur.startAt).toBe(workout.start);
    expect(dur.sourceRecordId).toBe('w1');
  });

  it('omits distance when the workout has none', () => {
    const out = normalizeHealthKitResult({ workouts: [{ ...workout, distance: 0 }] }, CTX);
    expect(out.filter((s) => s.metric === 'WORKOUT_DISTANCE_M')).toHaveLength(0);
    expect(out.filter((s) => s.metric === 'WORKOUT_DURATION_MIN')).toHaveLength(1);
  });
});

describe('normalizeHealthKitResult — blood pressure split', () => {
  it('emits BLOOD_PRESSURE_SYS and BLOOD_PRESSURE_DIA from one record', () => {
    const out = normalizeHealthKitResult(
      {
        bloodPressure: [
          {
            startDate: '2026-05-30T08:00:00.000Z',
            endDate: '2026-05-30T08:00:00.000Z',
            bloodPressureSystolicValue: 120,
            bloodPressureDiastolicValue: 80,
          },
        ],
      },
      CTX,
    );
    expect(one(out, 'BLOOD_PRESSURE_SYS')).toMatchObject({ value: 120, unit: 'mmHg', bucket: 'HEALTH_FITNESS' });
    expect(one(out, 'BLOOD_PRESSURE_DIA')).toMatchObject({ value: 80, unit: 'mmHg' });
  });
});

describe('normalizeHealthKitResult — sleep stage bucketing', () => {
  const sleep = [
    { value: 'INBED', startDate: '2026-05-30T05:00:00.000Z', endDate: '2026-05-30T13:00:00.000Z' },
    { value: 'CORE', startDate: '2026-05-30T05:00:00.000Z', endDate: '2026-05-30T06:00:00.000Z' }, // 60 light
    { value: 'DEEP', startDate: '2026-05-30T06:00:00.000Z', endDate: '2026-05-30T07:30:00.000Z' }, // 90 deep
    { value: 'REM', startDate: '2026-05-30T07:30:00.000Z', endDate: '2026-05-30T08:30:00.000Z' }, // 60 rem
    { value: 'AWAKE', startDate: '2026-05-30T08:30:00.000Z', endDate: '2026-05-30T08:45:00.000Z' }, // 15 awake
  ];

  it('sums per-stage minutes into SLEEP_*_MIN with SLEEP_RECOVERY bucket', () => {
    const out = normalizeHealthKitResult({ sleep }, CTX);
    expect(one(out, 'SLEEP_LIGHT_MIN').value).toBe(60);
    expect(one(out, 'SLEEP_DEEP_MIN').value).toBe(90);
    expect(one(out, 'SLEEP_REM_MIN').value).toBe(60);
    expect(one(out, 'SLEEP_AWAKE_MIN').value).toBe(15);
    expect(one(out, 'SLEEP_LIGHT_MIN').bucket).toBe('SLEEP_RECOVERY');
  });

  it('computes SLEEP_TOTAL_MIN as the sum of asleep stages (excludes awake & inbed)', () => {
    const out = normalizeHealthKitResult({ sleep }, CTX);
    // 60 light + 90 deep + 60 rem = 210; awake & inbed excluded.
    expect(one(out, 'SLEEP_TOTAL_MIN').value).toBe(210);
  });

  it('spans the sleep window from earliest staged start to latest end', () => {
    const out = normalizeHealthKitResult({ sleep }, CTX);
    const total = one(out, 'SLEEP_TOTAL_MIN');
    expect(total.startAt).toBe('2026-05-30T05:00:00.000Z');
    expect(total.endAt).toBe('2026-05-30T08:45:00.000Z');
  });

  it('rolls coarse ASLEEP into SLEEP_TOTAL_MIN when no fine stages exist', () => {
    const coarse = [
      { value: 'INBED', startDate: '2026-05-30T05:00:00.000Z', endDate: '2026-05-30T11:00:00.000Z' },
      { value: 'ASLEEP', startDate: '2026-05-30T05:30:00.000Z', endDate: '2026-05-30T10:30:00.000Z' }, // 300
    ];
    const out = normalizeHealthKitResult({ sleep: coarse }, CTX);
    expect(one(out, 'SLEEP_TOTAL_MIN').value).toBe(300);
  });
});

describe('normalizeHealthKitResult — drop policy', () => {
  it('produces nothing for an empty read result', () => {
    expect(normalizeHealthKitResult({}, CTX)).toEqual([]);
  });

  it('never emits metrics Apple cannot source (RECOVERY_SCORE, etc.)', () => {
    const full: HealthKitReadResult = {
      steps: [q(1)],
      heartRate: [q(60)],
      hrv: [q(0.05)],
    };
    const out = normalizeHealthKitResult(full, CTX);
    const metrics = new Set(out.map((s) => s.metric));
    for (const absent of [
      'RECOVERY_SCORE',
      'READINESS_SCORE',
      'STRAIN_SCORE',
      'BODY_BATTERY',
      'TRAINING_LOAD',
      'SLEEP_EFFICIENCY_PCT',
    ] as WearableMetricType[]) {
      expect(metrics.has(absent)).toBe(false);
    }
  });

  it('stamps sourceTz null when omitted from context', () => {
    const out = normalizeHealthKitResult({ steps: [q(5)] }, { userId: 'u', connectionId: 'c' });
    expect(one(out, 'STEPS').sourceTz).toBeNull();
  });
});
