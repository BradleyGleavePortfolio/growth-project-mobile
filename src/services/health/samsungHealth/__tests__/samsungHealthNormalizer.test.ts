/**
 * PR-HK-2.c — `samsungHealthNormalizer` unit tests.
 *
 * The record→metric mapping is identical to the Health Connect connector, but
 * the provider-distinct differentiator is asserted directly: every emitted
 * sample carries `provider: 'SAMSUNG_HEALTH'`, never `'HEALTH_CONNECT'`. Tests
 * also verify the canonical bucket/unit/value/time mapping for each record
 * type and that `normalizeRecords` re-asserts the Samsung-origin invariant
 * (defence in depth).
 */

import {
  normalizeRecord,
  normalizeRecords,
  type NormalizedSample,
} from '../samsungHealthNormalizer';
import {
  SAMSUNG_HEALTH_PACKAGE_NAME,
  type SamsungHealthRecord,
} from '../types';

const SAMSUNG_META = {
  id: 'm1',
  dataOrigin: { packageName: SAMSUNG_HEALTH_PACKAGE_NAME },
};

function rec(partial: Partial<SamsungHealthRecord>): SamsungHealthRecord {
  return {
    metadata: SAMSUNG_META,
    startTime: '2026-05-30T10:00:00.000Z',
    endTime: '2026-05-30T11:00:00.000Z',
    ...partial,
  } as SamsungHealthRecord;
}

describe('samsungHealthNormalizer', () => {
  describe('provider-distinct differentiator', () => {
    it('tags every sample with provider SAMSUNG_HEALTH (never HEALTH_CONNECT)', () => {
      const out = normalizeRecord(rec({ recordType: 'Steps', count: 4200 }));
      expect(out).toHaveLength(1);
      expect(out[0].provider).toBe('SAMSUNG_HEALTH');
      expect(out[0].provider).not.toBe('HEALTH_CONNECT');
    });
  });

  describe('Steps', () => {
    it('maps count → STEPS in HEALTH_FITNESS bucket, unit count', () => {
      const [s] = normalizeRecord(rec({ recordType: 'Steps', count: 4200 }));
      expect(s).toMatchObject<Partial<NormalizedSample>>({
        metric: 'STEPS',
        bucket: 'HEALTH_FITNESS',
        unit: 'count',
        value: 4200,
        startAt: '2026-05-30T10:00:00.000Z',
        endAt: '2026-05-30T11:00:00.000Z',
        sourceRecordId: 'm1',
      });
    });

    it('drops a Steps record with a non-numeric count', () => {
      expect(
        normalizeRecord(rec({ recordType: 'Steps', count: 'lots' as never })),
      ).toEqual([]);
    });
  });

  describe('ActiveCaloriesBurned', () => {
    it('maps energy.inKilocalories → ACTIVE_ENERGY_KCAL (kcal)', () => {
      const [s] = normalizeRecord(
        rec({
          recordType: 'ActiveCaloriesBurned',
          energy: { inKilocalories: 312.5 },
        }),
      );
      expect(s).toMatchObject({
        metric: 'ACTIVE_ENERGY_KCAL',
        bucket: 'HEALTH_FITNESS',
        unit: 'kcal',
        value: 312.5,
      });
    });
  });

  describe('HeartRate', () => {
    it('emits one HEART_RATE_BPM sample per bpm reading at its own time', () => {
      const out = normalizeRecord(
        rec({
          recordType: 'HeartRate',
          samples: [
            { time: '2026-05-30T10:00:00.000Z', beatsPerMinute: 60 },
            { time: '2026-05-30T10:01:00.000Z', beatsPerMinute: 72 },
          ],
        }),
      );
      expect(out).toHaveLength(2);
      expect(out.map((s) => s.value)).toEqual([60, 72]);
      expect(out[0]).toMatchObject({
        metric: 'HEART_RATE_BPM',
        unit: 'bpm',
        startAt: '2026-05-30T10:00:00.000Z',
        endAt: '2026-05-30T10:00:00.000Z',
      });
    });
  });

  describe('RestingHeartRate', () => {
    it('maps beatsPerMinute → RESTING_HEART_RATE_BPM in SLEEP_RECOVERY', () => {
      const [s] = normalizeRecord(
        rec({ recordType: 'RestingHeartRate', beatsPerMinute: 48 }),
      );
      expect(s).toMatchObject({
        metric: 'RESTING_HEART_RATE_BPM',
        bucket: 'SLEEP_RECOVERY',
        unit: 'bpm',
        value: 48,
      });
    });
  });

  describe('Vo2Max', () => {
    it('maps vo2MillilitersPerMinuteKilogram → VO2_MAX', () => {
      const [s] = normalizeRecord(
        rec({ recordType: 'Vo2Max', vo2MillilitersPerMinuteKilogram: 51.2 }),
      );
      expect(s).toMatchObject({ metric: 'VO2_MAX', unit: 'ml/kg/min', value: 51.2 });
    });
  });

  describe('ExerciseSession', () => {
    it('maps session duration → WORKOUT_DURATION_MIN (min)', () => {
      const [s] = normalizeRecord(
        rec({
          recordType: 'ExerciseSession',
          startTime: '2026-05-30T10:00:00.000Z',
          endTime: '2026-05-30T10:45:00.000Z',
        }),
      );
      expect(s).toMatchObject({
        metric: 'WORKOUT_DURATION_MIN',
        unit: 'min',
        value: 45,
      });
    });
  });

  describe('Distance', () => {
    it('maps distance.inMeters → WORKOUT_DISTANCE_M (m)', () => {
      const [s] = normalizeRecord(
        rec({ recordType: 'Distance', distance: { inMeters: 5025 } }),
      );
      expect(s).toMatchObject({ metric: 'WORKOUT_DISTANCE_M', unit: 'm', value: 5025 });
    });
  });

  describe('Weight', () => {
    it('maps weight.inKilograms → BODY_WEIGHT_KG (kg)', () => {
      const [s] = normalizeRecord(
        rec({ recordType: 'Weight', weight: { inKilograms: 81.4 } }),
      );
      expect(s).toMatchObject({ metric: 'BODY_WEIGHT_KG', unit: 'kg', value: 81.4 });
    });
  });

  describe('BodyFat', () => {
    it('maps percentage.value → BODY_FAT_PCT (%)', () => {
      const [s] = normalizeRecord(
        rec({ recordType: 'BodyFat', percentage: { value: 18.3 } }),
      );
      expect(s).toMatchObject({ metric: 'BODY_FAT_PCT', unit: '%', value: 18.3 });
    });
  });

  describe('BloodPressure', () => {
    it('emits both systolic and diastolic samples', () => {
      const out = normalizeRecord(
        rec({
          recordType: 'BloodPressure',
          systolic: { inMillimetersOfMercury: 118 },
          diastolic: { inMillimetersOfMercury: 76 },
        }),
      );
      const byMetric = Object.fromEntries(out.map((s) => [s.metric, s]));
      expect(byMetric.BLOOD_PRESSURE_SYS).toMatchObject({ value: 118, unit: 'mmHg' });
      expect(byMetric.BLOOD_PRESSURE_DIA).toMatchObject({ value: 76, unit: 'mmHg' });
    });
  });

  describe('SleepSession', () => {
    it('emits total duration plus per-stage minutes', () => {
      const out = normalizeRecord(
        rec({
          recordType: 'SleepSession',
          startTime: '2026-05-30T00:00:00.000Z',
          endTime: '2026-05-30T08:00:00.000Z',
          stages: [
            {
              stage: 'STAGE_TYPE_DEEP',
              startTime: '2026-05-30T00:00:00.000Z',
              endTime: '2026-05-30T01:30:00.000Z',
            },
            {
              stage: 'STAGE_TYPE_REM',
              startTime: '2026-05-30T01:30:00.000Z',
              endTime: '2026-05-30T03:00:00.000Z',
            },
          ],
        }),
      );
      const byMetric = Object.fromEntries(out.map((s) => [s.metric, s.value]));
      expect(byMetric.SLEEP_TOTAL_MIN).toBe(480);
      expect(byMetric.SLEEP_DEEP_MIN).toBe(90);
      expect(byMetric.SLEEP_REM_MIN).toBe(90);
      // Stages not present are not emitted.
      expect(byMetric.SLEEP_LIGHT_MIN).toBeUndefined();
    });
  });

  describe('HeartRateVariabilityRmssd', () => {
    it('maps heartRateVariabilityMillis → HRV_MS (ms)', () => {
      const [s] = normalizeRecord(
        rec({
          recordType: 'HeartRateVariabilityRmssd',
          heartRateVariabilityMillis: 42,
        }),
      );
      expect(s).toMatchObject({ metric: 'HRV_MS', unit: 'ms', value: 42 });
    });
  });

  describe('OxygenSaturation', () => {
    it('maps percentage.value → SPO2_PCT (%)', () => {
      const [s] = normalizeRecord(
        rec({ recordType: 'OxygenSaturation', percentage: { value: 97 } }),
      );
      expect(s).toMatchObject({ metric: 'SPO2_PCT', unit: '%', value: 97 });
    });
  });

  describe('RespiratoryRate', () => {
    it('maps rate → RESPIRATORY_RATE_BRPM (brpm)', () => {
      const [s] = normalizeRecord(
        rec({ recordType: 'RespiratoryRate', rate: 14.5 }),
      );
      expect(s).toMatchObject({ metric: 'RESPIRATORY_RATE_BRPM', unit: 'brpm', value: 14.5 });
    });
  });

  describe('BodyTemperature', () => {
    it('maps temperature.inCelsius → BODY_TEMP_DEVIATION_C (C)', () => {
      const [s] = normalizeRecord(
        rec({ recordType: 'BodyTemperature', temperature: { inCelsius: 36.6 } }),
      );
      expect(s).toMatchObject({ metric: 'BODY_TEMP_DEVIATION_C', unit: 'C', value: 36.6 });
    });
  });

  describe('unrecognised / empty records', () => {
    it('drops an unrecognised record type', () => {
      expect(
        normalizeRecord(rec({ recordType: 'UnknownThing' as never })),
      ).toEqual([]);
    });

    it('drops a record with no recordType', () => {
      expect(normalizeRecord({} as SamsungHealthRecord)).toEqual([]);
    });
  });

  describe('normalizeRecords — Samsung-origin invariant (defence in depth)', () => {
    it('drops a non-Samsung record even if it reaches the normalizer', () => {
      const google = rec({
        recordType: 'Steps',
        count: 999,
        metadata: { id: 'g', dataOrigin: { packageName: 'com.google.android.apps.fitness' } },
      });
      expect(normalizeRecords([google])).toEqual([]);
    });

    it('keeps Samsung-origin records and tags them SAMSUNG_HEALTH', () => {
      const samsung = rec({ recordType: 'Steps', count: 100 });
      const out = normalizeRecords([samsung]);
      expect(out).toHaveLength(1);
      expect(out[0].provider).toBe('SAMSUNG_HEALTH');
      expect(out[0].value).toBe(100);
    });

    it('flattens samples across a mixed-origin batch, Samsung only', () => {
      const samsung = rec({ recordType: 'Steps', count: 100 });
      const google = rec({
        recordType: 'Steps',
        count: 200,
        metadata: { id: 'g', dataOrigin: { packageName: 'com.google.android.apps.fitness' } },
      });
      const out = normalizeRecords([samsung, google]);
      expect(out.map((s) => s.value)).toEqual([100]);
    });
  });
});
