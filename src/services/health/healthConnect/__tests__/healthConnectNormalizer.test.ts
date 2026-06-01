// PR-HK-2.b — healthConnectNormalizer tests.
//
// One test per supported record type: a realistic Health Connect record shape
// → the expected canonical NormalizedSample(s). Plus drop-on-missing-field and
// the normalizeAll fan-out. Assertions check concrete values (not toBeDefined).

import {
  normalizeRecord,
  normalizeRecords,
  normalizeAll,
  type NormalizeContext,
} from '../healthConnectNormalizer';

const ctx: NormalizeContext = { userId: 'user-1', connectionId: 'conn-1' };
const COMMON = {
  userId: 'user-1',
  connectionId: 'conn-1',
  provider: 'HEALTH_CONNECT' as const,
};

describe('Steps', () => {
  it('maps count → STEPS (HEALTH_FITNESS, count)', () => {
    const rec = {
      startTime: '2026-05-01T08:00:00.000Z',
      endTime: '2026-05-01T09:00:00.000Z',
      count: 1234,
      metadata: { id: 'steps-1' },
    };
    expect(normalizeRecord(ctx, 'Steps', rec)).toEqual([
      {
        ...COMMON,
        metric: 'STEPS',
        bucket: 'HEALTH_FITNESS',
        value: 1234,
        unit: 'count',
        startAt: new Date('2026-05-01T08:00:00.000Z'),
        endAt: new Date('2026-05-01T09:00:00.000Z'),
        sourceRecordId: 'steps-1',
      },
    ]);
  });

  it('drops a record with no count', () => {
    expect(
      normalizeRecord(ctx, 'Steps', {
        startTime: '2026-05-01T08:00:00.000Z',
        endTime: '2026-05-01T09:00:00.000Z',
      }),
    ).toEqual([]);
  });
});

describe('ActiveCaloriesBurned', () => {
  it('maps energy.inKilocalories → ACTIVE_ENERGY_KCAL', () => {
    const rec = {
      startTime: '2026-05-01T08:00:00.000Z',
      endTime: '2026-05-01T09:00:00.000Z',
      energy: { inKilocalories: 250, inCalories: 250000 },
      metadata: { id: 'cal-1' },
    };
    const [s] = normalizeRecord(ctx, 'ActiveCaloriesBurned', rec);
    expect(s.metric).toBe('ACTIVE_ENERGY_KCAL');
    expect(s.value).toBe(250);
    expect(s.unit).toBe('kcal');
    expect(s.bucket).toBe('HEALTH_FITNESS');
  });
});

describe('HeartRate', () => {
  it('expands a series record into one sample per beat sample', () => {
    const rec = {
      startTime: '2026-05-01T08:00:00.000Z',
      endTime: '2026-05-01T08:10:00.000Z',
      samples: [
        { time: '2026-05-01T08:00:00.000Z', beatsPerMinute: 60 },
        { time: '2026-05-01T08:05:00.000Z', beatsPerMinute: 72 },
      ],
      metadata: { id: 'hr-1' },
    };
    const out = normalizeRecord(ctx, 'HeartRate', rec);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      ...COMMON,
      metric: 'HEART_RATE_BPM',
      bucket: 'HEALTH_FITNESS',
      value: 60,
      unit: 'bpm',
      startAt: new Date('2026-05-01T08:00:00.000Z'),
      endAt: new Date('2026-05-01T08:00:00.000Z'),
      sourceRecordId: 'hr-1',
    });
    expect(out[1].value).toBe(72);
  });

  it('skips beat samples missing bpm or time', () => {
    const rec = {
      samples: [{ time: '2026-05-01T08:00:00.000Z' }, { beatsPerMinute: 80 }],
    };
    expect(normalizeRecord(ctx, 'HeartRate', rec)).toEqual([]);
  });
});

describe('RestingHeartRate', () => {
  it('maps beatsPerMinute → RESTING_HEART_RATE_BPM', () => {
    const [s] = normalizeRecord(ctx, 'RestingHeartRate', {
      time: '2026-05-01T06:00:00.000Z',
      beatsPerMinute: 52,
      metadata: { id: 'rhr-1' },
    });
    expect(s.metric).toBe('RESTING_HEART_RATE_BPM');
    expect(s.value).toBe(52);
    expect(s.startAt).toEqual(s.endAt);
  });
});

describe('Vo2Max', () => {
  it('maps vo2MillilitersPerMinuteKilogram → VO2_MAX', () => {
    const [s] = normalizeRecord(ctx, 'Vo2Max', {
      time: '2026-05-01T06:00:00.000Z',
      vo2MillilitersPerMinuteKilogram: 48.5,
    });
    expect(s.metric).toBe('VO2_MAX');
    expect(s.value).toBe(48.5);
    expect(s.unit).toBe('mL/kg/min');
  });
});

describe('ExerciseSession', () => {
  it('maps duration → WORKOUT_DURATION_MIN', () => {
    const [s] = normalizeRecord(ctx, 'ExerciseSession', {
      startTime: '2026-05-01T08:00:00.000Z',
      endTime: '2026-05-01T08:45:00.000Z',
      metadata: { id: 'ex-1' },
    });
    expect(s.metric).toBe('WORKOUT_DURATION_MIN');
    expect(s.value).toBe(45);
    expect(s.unit).toBe('min');
  });

  it('drops a zero-length session', () => {
    expect(
      normalizeRecord(ctx, 'ExerciseSession', {
        startTime: '2026-05-01T08:00:00.000Z',
        endTime: '2026-05-01T08:00:00.000Z',
      }),
    ).toEqual([]);
  });
});

describe('Distance', () => {
  it('maps distance.inMeters → WORKOUT_DISTANCE_M', () => {
    const [s] = normalizeRecord(ctx, 'Distance', {
      startTime: '2026-05-01T08:00:00.000Z',
      endTime: '2026-05-01T08:45:00.000Z',
      distance: { inMeters: 5000 },
    });
    expect(s.metric).toBe('WORKOUT_DISTANCE_M');
    expect(s.value).toBe(5000);
    expect(s.unit).toBe('m');
  });
});

describe('Weight', () => {
  it('maps weight.inKilograms → BODY_WEIGHT_KG', () => {
    const [s] = normalizeRecord(ctx, 'Weight', {
      time: '2026-05-01T07:00:00.000Z',
      weight: { inKilograms: 81.2 },
    });
    expect(s.metric).toBe('BODY_WEIGHT_KG');
    expect(s.value).toBe(81.2);
    expect(s.unit).toBe('kg');
  });
});

describe('BodyFat', () => {
  it('maps percentage.value → BODY_FAT_PCT', () => {
    const [s] = normalizeRecord(ctx, 'BodyFat', {
      time: '2026-05-01T07:00:00.000Z',
      percentage: { value: 18.4 },
    });
    expect(s.metric).toBe('BODY_FAT_PCT');
    expect(s.value).toBe(18.4);
    expect(s.unit).toBe('%');
  });
});

describe('BloodPressure', () => {
  it('emits both SYS and DIA samples', () => {
    const out = normalizeRecord(ctx, 'BloodPressure', {
      time: '2026-05-01T07:00:00.000Z',
      systolic: { inMillimetersOfMercury: 120 },
      diastolic: { inMillimetersOfMercury: 80 },
      metadata: { id: 'bp-1' },
    });
    expect(out).toHaveLength(2);
    expect(out.find((s) => s.metric === 'BLOOD_PRESSURE_SYS')?.value).toBe(120);
    expect(out.find((s) => s.metric === 'BLOOD_PRESSURE_DIA')?.value).toBe(80);
    expect(out.every((s) => s.unit === 'mmHg')).toBe(true);
  });
});

describe('SleepSession', () => {
  it('maps total + stage breakdown + efficiency', () => {
    const rec = {
      startTime: '2026-05-01T23:00:00.000Z',
      endTime: '2026-05-02T07:00:00.000Z', // 480 min total
      stages: [
        { startTime: '2026-05-01T23:00:00.000Z', endTime: '2026-05-02T01:00:00.000Z', stage: 4 }, // LIGHT 120
        { startTime: '2026-05-02T01:00:00.000Z', endTime: '2026-05-02T02:30:00.000Z', stage: 5 }, // DEEP 90
        { startTime: '2026-05-02T02:30:00.000Z', endTime: '2026-05-02T04:00:00.000Z', stage: 6 }, // REM 90
        { startTime: '2026-05-02T04:00:00.000Z', endTime: '2026-05-02T04:30:00.000Z', stage: 1 }, // AWAKE 30
      ],
      metadata: { id: 'sleep-1' },
    };
    const out = normalizeRecord(ctx, 'SleepSession', rec);
    const by = (m: string) => out.find((s) => s.metric === m)?.value;
    expect(by('SLEEP_TOTAL_MIN')).toBe(480);
    expect(by('SLEEP_LIGHT_MIN')).toBe(120);
    expect(by('SLEEP_DEEP_MIN')).toBe(90);
    expect(by('SLEEP_REM_MIN')).toBe(90);
    expect(by('SLEEP_AWAKE_MIN')).toBe(30);
    // efficiency = asleep(300) / inBed(330) * 100 = 90.909...
    expect(by('SLEEP_EFFICIENCY_PCT')).toBeCloseTo(90.909, 2);
    expect(out.every((s) => s.bucket === 'SLEEP_RECOVERY')).toBe(true);
  });

  it('emits only total when no stages present', () => {
    const out = normalizeRecord(ctx, 'SleepSession', {
      startTime: '2026-05-01T23:00:00.000Z',
      endTime: '2026-05-02T06:00:00.000Z',
    });
    expect(out).toHaveLength(1);
    expect(out[0].metric).toBe('SLEEP_TOTAL_MIN');
    expect(out[0].value).toBe(420);
  });
});

describe('HeartRateVariabilityRmssd', () => {
  it('maps heartRateVariabilityMillis → HRV_MS', () => {
    const [s] = normalizeRecord(ctx, 'HeartRateVariabilityRmssd', {
      time: '2026-05-01T06:00:00.000Z',
      heartRateVariabilityMillis: 65.3,
    });
    expect(s.metric).toBe('HRV_MS');
    expect(s.value).toBe(65.3);
    expect(s.unit).toBe('ms');
  });
});

describe('OxygenSaturation', () => {
  it('maps percentage.value → SPO2_PCT', () => {
    const [s] = normalizeRecord(ctx, 'OxygenSaturation', {
      time: '2026-05-01T06:00:00.000Z',
      percentage: { value: 97.5 },
    });
    expect(s.metric).toBe('SPO2_PCT');
    expect(s.value).toBe(97.5);
  });
});

describe('RespiratoryRate', () => {
  it('maps rate → RESPIRATORY_RATE_BRPM', () => {
    const [s] = normalizeRecord(ctx, 'RespiratoryRate', {
      time: '2026-05-01T06:00:00.000Z',
      rate: 14.2,
    });
    expect(s.metric).toBe('RESPIRATORY_RATE_BRPM');
    expect(s.value).toBe(14.2);
    expect(s.unit).toBe('brpm');
  });
});

describe('BodyTemperature', () => {
  it('maps temperature.inCelsius → BODY_TEMP_DEVIATION_C (deviation from 36.5)', () => {
    const [s] = normalizeRecord(ctx, 'BodyTemperature', {
      time: '2026-05-01T06:00:00.000Z',
      temperature: { inCelsius: 37.0 },
    });
    expect(s.metric).toBe('BODY_TEMP_DEVIATION_C');
    expect(s.value).toBeCloseTo(0.5, 6);
    expect(s.unit).toBe('°C');
  });
});

describe('normalizeRecords / normalizeAll', () => {
  it('normalizeRecords flattens an array of one type', () => {
    const out = normalizeRecords(ctx, 'Steps', [
      { startTime: '2026-05-01T08:00:00.000Z', endTime: '2026-05-01T09:00:00.000Z', count: 10 },
      { startTime: '2026-05-01T09:00:00.000Z', endTime: '2026-05-01T10:00:00.000Z', count: 20 },
    ]);
    expect(out.map((s) => s.value)).toEqual([10, 20]);
  });

  it('normalizeAll fans across record types', () => {
    const out = normalizeAll(ctx, {
      Steps: [{ startTime: '2026-05-01T08:00:00.000Z', endTime: '2026-05-01T09:00:00.000Z', count: 5 }],
      Weight: [{ time: '2026-05-01T07:00:00.000Z', weight: { inKilograms: 80 } }],
    });
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.metric).sort()).toEqual(['BODY_WEIGHT_KG', 'STEPS']);
  });

  it('returns [] for an unknown record type', () => {
    expect(
      normalizeRecord(ctx, 'NotARealType' as unknown as 'Steps', {}),
    ).toEqual([]);
  });
});
