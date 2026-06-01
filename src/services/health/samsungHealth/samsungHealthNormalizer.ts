/**
 * PR-HK-2.c — `samsungHealthNormalizer`
 *
 * Maps Samsung-origin Health Connect records to canonical
 * {@link NormalizedSample}s. The record→metric mapping is the SAME as the
 * Health Connect connector (PR-HK-2.b) — Samsung Health writes Health Connect
 * record types — but every emitted sample carries `provider: 'SAMSUNG_HEALTH'`
 * instead of `'HEALTH_CONNECT'`. That single field is the provider-distinct
 * differentiator at the normalization boundary.
 *
 * The canonical boundary mirrors the backend `NormalizedSample`
 * (growth-project-backend `src/wearables/normalization/normalizer.types.ts`),
 * in camelCase, so the sync service can POST it straight to
 * `POST /v1/wearables/samples/ingest`. Anything not listed below is dropped —
 * no speculative ingestion (50-Failures #42; AGENT_2_CODING_PLAN §3.1).
 */

import {
  SAMSUNG_HEALTH_PROVIDER,
  extractPackageName,
  type SamsungHealthRecord,
  type WearableMetricBucket,
  type WearableMetricType,
  type WearableProvider,
} from './types';

/**
 * Canonical normalized sample (mobile mirror of the backend type, camelCase).
 * `dedup_key` / `recorded_at` are computed server-side and intentionally
 * absent here.
 */
export interface NormalizedSample {
  provider: WearableProvider;
  metric: WearableMetricType;
  bucket: WearableMetricBucket;
  value: number;
  unit: string;
  startAt: string;
  endAt: string;
  sourceTz?: string | null;
  sourceRecordId?: string | null;
}

/** Canonical bucket for each metric (mirror of `WearableMetricDef.bucket`). */
const METRIC_BUCKET: Record<WearableMetricType, WearableMetricBucket> = {
  STEPS: 'HEALTH_FITNESS',
  ACTIVE_ENERGY_KCAL: 'HEALTH_FITNESS',
  RESTING_HEART_RATE_BPM: 'SLEEP_RECOVERY',
  HEART_RATE_BPM: 'HEALTH_FITNESS',
  VO2_MAX: 'HEALTH_FITNESS',
  WORKOUT_DURATION_MIN: 'HEALTH_FITNESS',
  WORKOUT_DISTANCE_M: 'HEALTH_FITNESS',
  TRAINING_LOAD: 'HEALTH_FITNESS',
  BODY_WEIGHT_KG: 'HEALTH_FITNESS',
  BODY_FAT_PCT: 'HEALTH_FITNESS',
  BLOOD_PRESSURE_SYS: 'HEALTH_FITNESS',
  BLOOD_PRESSURE_DIA: 'HEALTH_FITNESS',
  SLEEP_TOTAL_MIN: 'SLEEP_RECOVERY',
  SLEEP_REM_MIN: 'SLEEP_RECOVERY',
  SLEEP_DEEP_MIN: 'SLEEP_RECOVERY',
  SLEEP_LIGHT_MIN: 'SLEEP_RECOVERY',
  SLEEP_AWAKE_MIN: 'SLEEP_RECOVERY',
  SLEEP_EFFICIENCY_PCT: 'SLEEP_RECOVERY',
  HRV_MS: 'SLEEP_RECOVERY',
  RECOVERY_SCORE: 'SLEEP_RECOVERY',
  READINESS_SCORE: 'SLEEP_RECOVERY',
  STRAIN_SCORE: 'SLEEP_RECOVERY',
  BODY_BATTERY: 'SLEEP_RECOVERY',
  BODY_TEMP_DEVIATION_C: 'SLEEP_RECOVERY',
  RESPIRATORY_RATE_BRPM: 'SLEEP_RECOVERY',
  SPO2_PCT: 'SLEEP_RECOVERY',
};

/** Canonical unit for each metric (mirror of `WearableMetricDef.unit`). */
const METRIC_UNIT: Record<WearableMetricType, string> = {
  STEPS: 'count',
  ACTIVE_ENERGY_KCAL: 'kcal',
  RESTING_HEART_RATE_BPM: 'bpm',
  HEART_RATE_BPM: 'bpm',
  VO2_MAX: 'ml/kg/min',
  WORKOUT_DURATION_MIN: 'min',
  WORKOUT_DISTANCE_M: 'm',
  TRAINING_LOAD: 'score',
  BODY_WEIGHT_KG: 'kg',
  BODY_FAT_PCT: '%',
  BLOOD_PRESSURE_SYS: 'mmHg',
  BLOOD_PRESSURE_DIA: 'mmHg',
  SLEEP_TOTAL_MIN: 'min',
  SLEEP_REM_MIN: 'min',
  SLEEP_DEEP_MIN: 'min',
  SLEEP_LIGHT_MIN: 'min',
  SLEEP_AWAKE_MIN: 'min',
  SLEEP_EFFICIENCY_PCT: '%',
  HRV_MS: 'ms',
  RECOVERY_SCORE: 'score',
  READINESS_SCORE: 'score',
  STRAIN_SCORE: 'score',
  BODY_BATTERY: 'score',
  BODY_TEMP_DEVIATION_C: 'C',
  RESPIRATORY_RATE_BRPM: 'brpm',
  SPO2_PCT: '%',
};

// ─── value/time helpers ──────────────────────────────────────────────────────

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Read a nested numeric field, e.g. path ['energy','inKilocalories']. */
function nestedNum(record: SamsungHealthRecord, path: string[]): number | null {
  let cur: unknown = record;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return num(cur);
}

function startOf(record: SamsungHealthRecord): string | null {
  return record.startTime ?? record.time ?? null;
}

function endOf(record: SamsungHealthRecord): string | null {
  return record.endTime ?? record.startTime ?? record.time ?? null;
}

function durationMinutes(record: SamsungHealthRecord): number | null {
  const start = startOf(record);
  const end = record.endTime ?? null;
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / 60000;
}

/** Sum the durations (minutes) of sleep stages matching the given stage codes. */
function sleepStageMinutes(
  record: SamsungHealthRecord,
  stageTypes: string[],
): number | null {
  const stages = (record as { stages?: unknown }).stages;
  if (!Array.isArray(stages)) return null;
  let total = 0;
  let matched = false;
  for (const stage of stages) {
    if (!stage || typeof stage !== 'object') continue;
    const s = stage as { stage?: string; startTime?: string; endTime?: string };
    if (s.stage && stageTypes.includes(s.stage) && s.startTime && s.endTime) {
      const ms = new Date(s.endTime).getTime() - new Date(s.startTime).getTime();
      if (Number.isFinite(ms) && ms >= 0) {
        total += ms / 60000;
        matched = true;
      }
    }
  }
  return matched ? total : null;
}

// ─── per-metric sample factory ───────────────────────────────────────────────

function sample(
  metric: WearableMetricType,
  value: number,
  record: SamsungHealthRecord,
  window?: { startAt?: string | null; endAt?: string | null },
): NormalizedSample | null {
  const startAt = window?.startAt ?? startOf(record);
  const endAt = window?.endAt ?? endOf(record);
  if (!startAt || !endAt) return null;
  if (!Number.isFinite(value)) return null;
  return {
    provider: SAMSUNG_HEALTH_PROVIDER,
    metric,
    bucket: METRIC_BUCKET[metric],
    value,
    unit: METRIC_UNIT[metric],
    startAt,
    endAt,
    sourceTz: (record as { sourceTz?: string | null }).sourceTz ?? null,
    sourceRecordId: record.metadata?.id ?? null,
  };
}

/**
 * Map a single Samsung-origin Health Connect record to zero-or-more canonical
 * samples. Records of unrecognised types, or with no usable value, yield [].
 */
export function normalizeRecord(record: SamsungHealthRecord): NormalizedSample[] {
  if (!record || !record.recordType) return [];
  const out: NormalizedSample[] = [];
  const push = (s: NormalizedSample | null): void => {
    if (s) out.push(s);
  };

  switch (record.recordType) {
    case 'Steps': {
      const v = num((record as { count?: unknown }).count);
      if (v != null) push(sample('STEPS', v, record));
      break;
    }
    case 'ActiveCaloriesBurned': {
      const v = nestedNum(record, ['energy', 'inKilocalories']);
      if (v != null) push(sample('ACTIVE_ENERGY_KCAL', v, record));
      break;
    }
    case 'HeartRate': {
      // Health Connect HeartRate carries a `samples[]` of bpm readings.
      const samples = (record as { samples?: unknown }).samples;
      if (Array.isArray(samples)) {
        for (const hr of samples) {
          const bpm = num((hr as { beatsPerMinute?: unknown })?.beatsPerMinute);
          const t = (hr as { time?: string })?.time;
          if (bpm != null && t) {
            push(sample('HEART_RATE_BPM', bpm, record, { startAt: t, endAt: t }));
          }
        }
      }
      break;
    }
    case 'RestingHeartRate': {
      const v = num((record as { beatsPerMinute?: unknown }).beatsPerMinute);
      if (v != null) push(sample('RESTING_HEART_RATE_BPM', v, record));
      break;
    }
    case 'Vo2Max': {
      const v = num((record as { vo2MillilitersPerMinuteKilogram?: unknown })
        .vo2MillilitersPerMinuteKilogram);
      if (v != null) push(sample('VO2_MAX', v, record));
      break;
    }
    case 'ExerciseSession': {
      const dur = durationMinutes(record);
      if (dur != null) push(sample('WORKOUT_DURATION_MIN', dur, record));
      break;
    }
    case 'Distance': {
      const v = nestedNum(record, ['distance', 'inMeters']);
      if (v != null) push(sample('WORKOUT_DISTANCE_M', v, record));
      break;
    }
    case 'Weight': {
      const v = nestedNum(record, ['weight', 'inKilograms']);
      if (v != null) push(sample('BODY_WEIGHT_KG', v, record));
      break;
    }
    case 'BodyFat': {
      const v = nestedNum(record, ['percentage', 'value']);
      if (v != null) push(sample('BODY_FAT_PCT', v, record));
      break;
    }
    case 'BloodPressure': {
      const sys = nestedNum(record, ['systolic', 'inMillimetersOfMercury']);
      const dia = nestedNum(record, ['diastolic', 'inMillimetersOfMercury']);
      if (sys != null) push(sample('BLOOD_PRESSURE_SYS', sys, record));
      if (dia != null) push(sample('BLOOD_PRESSURE_DIA', dia, record));
      break;
    }
    case 'SleepSession': {
      const total = durationMinutes(record);
      if (total != null) push(sample('SLEEP_TOTAL_MIN', total, record));
      push(sampleStage(record, 'SLEEP_REM_MIN', ['STAGE_TYPE_REM', 'rem']));
      push(sampleStage(record, 'SLEEP_DEEP_MIN', ['STAGE_TYPE_DEEP', 'deep']));
      push(sampleStage(record, 'SLEEP_LIGHT_MIN', ['STAGE_TYPE_LIGHT', 'light']));
      push(sampleStage(record, 'SLEEP_AWAKE_MIN', ['STAGE_TYPE_AWAKE', 'awake']));
      break;
    }
    case 'HeartRateVariabilityRmssd': {
      const v = num((record as { heartRateVariabilityMillis?: unknown })
        .heartRateVariabilityMillis);
      if (v != null) push(sample('HRV_MS', v, record));
      break;
    }
    case 'OxygenSaturation': {
      const v = nestedNum(record, ['percentage', 'value']);
      if (v != null) push(sample('SPO2_PCT', v, record));
      break;
    }
    case 'RespiratoryRate': {
      const v = num((record as { rate?: unknown }).rate);
      if (v != null) push(sample('RESPIRATORY_RATE_BRPM', v, record));
      break;
    }
    case 'BodyTemperature': {
      const v = nestedNum(record, ['temperature', 'inCelsius']);
      if (v != null) push(sample('BODY_TEMP_DEVIATION_C', v, record));
      break;
    }
    default:
      // Unrecognised record type → drop (no speculative ingestion).
      break;
  }

  return out;
}

function sampleStage(
  record: SamsungHealthRecord,
  metric: WearableMetricType,
  stageTypes: string[],
): NormalizedSample | null {
  const mins = sleepStageMinutes(record, stageTypes);
  return mins != null ? sample(metric, mins, record) : null;
}

/**
 * Normalize a batch of records. Defends the Samsung-origin invariant a second
 * time (defence in depth): even if a non-Samsung record reaches the
 * normalizer, it is dropped, so a sample tagged `SAMSUNG_HEALTH` can never have
 * come from another data origin.
 */
export function normalizeRecords(records: SamsungHealthRecord[]): NormalizedSample[] {
  const out: NormalizedSample[] = [];
  for (const record of records ?? []) {
    if (extractPackageName(record?.metadata?.dataOrigin) !== 'com.sec.android.app.shealth') {
      continue;
    }
    out.push(...normalizeRecord(record));
  }
  return out;
}

export const samsungHealthNormalizer = {
  normalizeRecord,
  normalizeRecords,
  METRIC_BUCKET,
  METRIC_UNIT,
};

export type SamsungHealthNormalizer = typeof samsungHealthNormalizer;
