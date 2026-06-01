// PR-HK-2.b — Android Health Connect on-device connector: normalizer.
//
// Maps Android Health Connect provider-native records → canonical
// NormalizedSample[] (Agent 2 §3.1: "Health Connect — record types → all
// canonical metrics (both buckets) mapped device-side"). This is the seam
// where Health Connect idiosyncrasy stops; the ingestion lane downstream is
// provider-agnostic.
//
// Doctrine:
//   • No speculative ingestion (#42): a record field that is absent/NaN/null
//     yields NO sample rather than a 0 or a guess.
//   • Units are canonical (kg, %, bpm, ms, kcal, m, min, °C-deviation, brpm)
//     and MUST match WearableMetricDef.unit on the backend.
//   • bucket is denormalized from the metric per §2.2/§2.4.
//   • start/end are real Date objects; instantaneous records set end == start.
//   • Defensive parsing — Health Connect values arrive as nested objects
//     (e.g. energy.inKilocalories, weight.inKilograms) and the device may omit
//     fields. Every accessor is null-guarded; junk is dropped, not coerced.

import type {
  NormalizedSample,
  WearableMetricBucket,
  WearableMetricType,
} from './types';
import { HEALTH_CONNECT_PROVIDER } from './types';
import type { HealthConnectRecordType } from './healthConnectClient';

/** Canonical bucket for each metric (mirrors WearableMetricDef.bucket). */
const METRIC_BUCKET: Record<WearableMetricType, WearableMetricBucket> = {
  STEPS: 'HEALTH_FITNESS',
  ACTIVE_ENERGY_KCAL: 'HEALTH_FITNESS',
  RESTING_HEART_RATE_BPM: 'HEALTH_FITNESS',
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

/** Canonical unit for each metric (mirrors WearableMetricDef.unit). */
const METRIC_UNIT: Record<WearableMetricType, string> = {
  STEPS: 'count',
  ACTIVE_ENERGY_KCAL: 'kcal',
  RESTING_HEART_RATE_BPM: 'bpm',
  HEART_RATE_BPM: 'bpm',
  VO2_MAX: 'mL/kg/min',
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
  BODY_TEMP_DEVIATION_C: '°C',
  RESPIRATORY_RATE_BRPM: 'brpm',
  SPO2_PCT: '%',
};

/** Context the normalizer needs to stamp ownership onto each sample. */
export interface NormalizeContext {
  /** Subject client User.id. */
  userId: string;
  /** The Health Connect connection row id (server-assigned). */
  connectionId: string;
}

/** Health Connect sleep-stage numeric enum (per Android SDK / library). */
const SLEEP_STAGE = {
  UNKNOWN: 0,
  AWAKE: 1,
  SLEEPING: 2,
  OUT_OF_BED: 3,
  LIGHT: 4,
  DEEP: 5,
  REM: 6,
  AWAKE_IN_BED: 7,
} as const;

// ── small parsing helpers ────────────────────────────────────────────────

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Read a nested numeric field (e.g. obj.energy.inKilocalories) safely. */
function num(obj: unknown, path: string[]): number | null {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return isFiniteNumber(cur) ? cur : null;
}

function str(obj: unknown, key: string): string | null {
  if (obj == null || typeof obj !== 'object') return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : null;
}

/** Parse an ISO time string into a Date, or null if absent/invalid. */
function parseTime(obj: unknown, key: string): Date | null {
  const s = str(obj, key);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function metadataId(obj: unknown): string | null {
  if (obj == null || typeof obj !== 'object') return null;
  const md = (obj as Record<string, unknown>).metadata;
  return str(md, 'id');
}

function durationMinutes(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 60_000;
}

/** Build one NormalizedSample with canonical unit + bucket filled in. */
function makeSample(
  ctx: NormalizeContext,
  metric: WearableMetricType,
  value: number,
  startAt: Date,
  endAt: Date,
  sourceRecordId: string | null,
): NormalizedSample {
  return {
    userId: ctx.userId,
    connectionId: ctx.connectionId,
    provider: HEALTH_CONNECT_PROVIDER,
    metric,
    bucket: METRIC_BUCKET[metric],
    value,
    unit: METRIC_UNIT[metric],
    startAt,
    endAt,
    sourceRecordId,
  };
}

// ── per-record-type normalizers ──────────────────────────────────────────
// Each returns 0..n samples. A record that lacks the fields it needs yields
// an empty array (drop, never guess).

function normSteps(ctx: NormalizeContext, r: unknown): NormalizedSample[] {
  const start = parseTime(r, 'startTime');
  const end = parseTime(r, 'endTime');
  const count = num(r, ['count']);
  if (!start || !end || count == null) return [];
  return [makeSample(ctx, 'STEPS', count, start, end, metadataId(r))];
}

function normActiveCalories(ctx: NormalizeContext, r: unknown): NormalizedSample[] {
  const start = parseTime(r, 'startTime');
  const end = parseTime(r, 'endTime');
  const kcal = num(r, ['energy', 'inKilocalories']);
  if (!start || !end || kcal == null) return [];
  return [makeSample(ctx, 'ACTIVE_ENERGY_KCAL', kcal, start, end, metadataId(r))];
}

function normHeartRate(ctx: NormalizeContext, r: unknown): NormalizedSample[] {
  // HeartRate is a series record: { startTime, endTime, samples: [{ time, beatsPerMinute }] }
  if (r == null || typeof r !== 'object') return [];
  const samples = (r as Record<string, unknown>).samples;
  if (!Array.isArray(samples)) return [];
  const recordId = metadataId(r);
  const out: NormalizedSample[] = [];
  for (const s of samples) {
    const bpm = num(s, ['beatsPerMinute']);
    const t = parseTime(s, 'time');
    if (bpm == null || !t) continue;
    out.push(makeSample(ctx, 'HEART_RATE_BPM', bpm, t, t, recordId));
  }
  return out;
}

function normRestingHeartRate(ctx: NormalizeContext, r: unknown): NormalizedSample[] {
  const t = parseTime(r, 'time');
  const bpm = num(r, ['beatsPerMinute']);
  if (!t || bpm == null) return [];
  return [makeSample(ctx, 'RESTING_HEART_RATE_BPM', bpm, t, t, metadataId(r))];
}

function normVo2Max(ctx: NormalizeContext, r: unknown): NormalizedSample[] {
  const t = parseTime(r, 'time');
  const v = num(r, ['vo2MillilitersPerMinuteKilogram']);
  if (!t || v == null) return [];
  return [makeSample(ctx, 'VO2_MAX', v, t, t, metadataId(r))];
}

function normExerciseSession(ctx: NormalizeContext, r: unknown): NormalizedSample[] {
  const start = parseTime(r, 'startTime');
  const end = parseTime(r, 'endTime');
  if (!start || !end) return [];
  const mins = durationMinutes(start, end);
  if (!isFiniteNumber(mins) || mins <= 0) return [];
  return [makeSample(ctx, 'WORKOUT_DURATION_MIN', mins, start, end, metadataId(r))];
}

function normDistance(ctx: NormalizeContext, r: unknown): NormalizedSample[] {
  const start = parseTime(r, 'startTime');
  const end = parseTime(r, 'endTime');
  const meters = num(r, ['distance', 'inMeters']);
  if (!start || !end || meters == null) return [];
  return [makeSample(ctx, 'WORKOUT_DISTANCE_M', meters, start, end, metadataId(r))];
}

function normWeight(ctx: NormalizeContext, r: unknown): NormalizedSample[] {
  const t = parseTime(r, 'time');
  const kg = num(r, ['weight', 'inKilograms']);
  if (!t || kg == null) return [];
  return [makeSample(ctx, 'BODY_WEIGHT_KG', kg, t, t, metadataId(r))];
}

function normBodyFat(ctx: NormalizeContext, r: unknown): NormalizedSample[] {
  const t = parseTime(r, 'time');
  // Health Connect Percentage is { value: <0..100> }.
  const pct = num(r, ['percentage', 'value']) ?? num(r, ['percentage']);
  if (!t || pct == null) return [];
  return [makeSample(ctx, 'BODY_FAT_PCT', pct, t, t, metadataId(r))];
}

function normBloodPressure(ctx: NormalizeContext, r: unknown): NormalizedSample[] {
  const t = parseTime(r, 'time');
  if (!t) return [];
  const sys = num(r, ['systolic', 'inMillimetersOfMercury']);
  const dia = num(r, ['diastolic', 'inMillimetersOfMercury']);
  const recordId = metadataId(r);
  const out: NormalizedSample[] = [];
  if (sys != null) out.push(makeSample(ctx, 'BLOOD_PRESSURE_SYS', sys, t, t, recordId));
  if (dia != null) out.push(makeSample(ctx, 'BLOOD_PRESSURE_DIA', dia, t, t, recordId));
  return out;
}

function normSleepSession(ctx: NormalizeContext, r: unknown): NormalizedSample[] {
  const start = parseTime(r, 'startTime');
  const end = parseTime(r, 'endTime');
  if (!start || !end) return [];
  const recordId = metadataId(r);
  const out: NormalizedSample[] = [];

  // Total in-session time.
  const totalMin = durationMinutes(start, end);
  if (isFiniteNumber(totalMin) && totalMin > 0) {
    out.push(makeSample(ctx, 'SLEEP_TOTAL_MIN', totalMin, start, end, recordId));
  }

  // Per-stage breakdown (if the device reported stages).
  const stages =
    r != null && typeof r === 'object'
      ? (r as Record<string, unknown>).stages
      : undefined;
  if (Array.isArray(stages)) {
    let rem = 0;
    let deep = 0;
    let light = 0;
    let awake = 0;
    for (const stage of stages) {
      const s = parseTime(stage, 'startTime');
      const e = parseTime(stage, 'endTime');
      const code = num(stage, ['stage']);
      if (!s || !e || code == null) continue;
      const mins = durationMinutes(s, e);
      if (!isFiniteNumber(mins) || mins <= 0) continue;
      switch (code) {
        case SLEEP_STAGE.REM:
          rem += mins;
          break;
        case SLEEP_STAGE.DEEP:
          deep += mins;
          break;
        case SLEEP_STAGE.LIGHT:
        case SLEEP_STAGE.SLEEPING:
          light += mins;
          break;
        case SLEEP_STAGE.AWAKE:
        case SLEEP_STAGE.AWAKE_IN_BED:
          awake += mins;
          break;
        default:
          break;
      }
    }
    if (rem > 0) out.push(makeSample(ctx, 'SLEEP_REM_MIN', rem, start, end, recordId));
    if (deep > 0) out.push(makeSample(ctx, 'SLEEP_DEEP_MIN', deep, start, end, recordId));
    if (light > 0) out.push(makeSample(ctx, 'SLEEP_LIGHT_MIN', light, start, end, recordId));
    if (awake > 0) out.push(makeSample(ctx, 'SLEEP_AWAKE_MIN', awake, start, end, recordId));

    // Sleep efficiency = asleep / (asleep + awake) * 100.
    const asleep = rem + deep + light;
    const inBed = asleep + awake;
    if (inBed > 0) {
      const eff = (asleep / inBed) * 100;
      out.push(makeSample(ctx, 'SLEEP_EFFICIENCY_PCT', eff, start, end, recordId));
    }
  }

  return out;
}

function normHrv(ctx: NormalizeContext, r: unknown): NormalizedSample[] {
  const t = parseTime(r, 'time');
  const rmssd = num(r, ['heartRateVariabilityMillis']);
  if (!t || rmssd == null) return [];
  return [makeSample(ctx, 'HRV_MS', rmssd, t, t, metadataId(r))];
}

function normOxygenSaturation(ctx: NormalizeContext, r: unknown): NormalizedSample[] {
  const t = parseTime(r, 'time');
  const pct = num(r, ['percentage', 'value']) ?? num(r, ['percentage']);
  if (!t || pct == null) return [];
  return [makeSample(ctx, 'SPO2_PCT', pct, t, t, metadataId(r))];
}

function normRespiratoryRate(ctx: NormalizeContext, r: unknown): NormalizedSample[] {
  const t = parseTime(r, 'time');
  const rate = num(r, ['rate']);
  if (!t || rate == null) return [];
  return [makeSample(ctx, 'RESPIRATORY_RATE_BRPM', rate, t, t, metadataId(r))];
}

function normBodyTemperature(ctx: NormalizeContext, r: unknown): NormalizedSample[] {
  // Health Connect reports absolute body temperature in °C. The canonical
  // metric is a DEVIATION from a 36.5°C baseline (matching the Oura/Garmin
  // device-side semantics in §3.1); we derive the deviation device-side so the
  // canonical metric stays comparable across providers.
  const t = parseTime(r, 'time');
  const celsius = num(r, ['temperature', 'inCelsius']);
  if (!t || celsius == null) return [];
  const BASELINE_C = 36.5;
  const deviation = celsius - BASELINE_C;
  return [makeSample(ctx, 'BODY_TEMP_DEVIATION_C', deviation, t, t, metadataId(r))];
}

/** Dispatch table: record type → its normalizer. */
const NORMALIZERS: Record<
  HealthConnectRecordType,
  (ctx: NormalizeContext, record: unknown) => NormalizedSample[]
> = {
  Steps: normSteps,
  ActiveCaloriesBurned: normActiveCalories,
  HeartRate: normHeartRate,
  RestingHeartRate: normRestingHeartRate,
  Vo2Max: normVo2Max,
  ExerciseSession: normExerciseSession,
  Distance: normDistance,
  Weight: normWeight,
  BodyFat: normBodyFat,
  BloodPressure: normBloodPressure,
  SleepSession: normSleepSession,
  HeartRateVariabilityRmssd: normHrv,
  OxygenSaturation: normOxygenSaturation,
  RespiratoryRate: normRespiratoryRate,
  BodyTemperature: normBodyTemperature,
};

/** Normalize a single record of a known type into 0..n canonical samples. */
export function normalizeRecord(
  ctx: NormalizeContext,
  recordType: HealthConnectRecordType,
  record: unknown,
): NormalizedSample[] {
  const fn = NORMALIZERS[recordType];
  if (!fn) return [];
  return fn(ctx, record);
}

/** Normalize an array of records of one type. */
export function normalizeRecords(
  ctx: NormalizeContext,
  recordType: HealthConnectRecordType,
  records: unknown[],
): NormalizedSample[] {
  if (!Array.isArray(records)) return [];
  return records.flatMap((r) => normalizeRecord(ctx, recordType, r));
}

/**
 * Normalize a full record-type → records map (the shape returned by
 * `readAllSupportedRecords`) into a single flat NormalizedSample[].
 */
export function normalizeAll(
  ctx: NormalizeContext,
  byType: Partial<Record<HealthConnectRecordType, unknown[]>>,
): NormalizedSample[] {
  const out: NormalizedSample[] = [];
  for (const recordType of Object.keys(byType) as HealthConnectRecordType[]) {
    const records = byType[recordType];
    if (records) out.push(...normalizeRecords(ctx, recordType, records));
  }
  return out;
}

/** Exported for tests/assertions — the canonical unit/bucket maps. */
export const __metricMaps = { METRIC_BUCKET, METRIC_UNIT };
