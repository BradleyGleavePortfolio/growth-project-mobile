/**
 * PR-HK-2.a — Apple HealthKit device-side normalizer.
 *
 * Maps `react-native-health` sample shapes onto the canonical
 * {@link NormalizedSample} contract that the backend `IngestionService`
 * consumes (Agent 2 §3.2 — "the ingestion lane is identical for cloud and
 * on-device after the NormalizedSample[] boundary"). For on-device providers
 * the mapping happens HERE, on device, and the app POSTs pre-normalized
 * samples (Agent 2 §3.1 HealthKit row: "quantity/category types → all
 * canonical metrics (both buckets) mapped device-side, posted pre-normalized").
 *
 * The canonical metric/bucket/provider enums below mirror the backend Prisma
 * enums (`WearableMetricType`, `WearableMetricBucket`, `WearableProvider`) as
 * string-literal unions. They are duplicated rather than imported because the
 * mobile app has no `@prisma/client`; the values MUST stay byte-for-byte equal
 * to the backend enum members (verified against
 * `growth-project-backend/prisma/schema.prisma`).
 *
 * Mapping policy (Agent 2 §3.1 / UNIFIED lock "Schema canonical"):
 *  - Implement ALL HealthKit-source canonical metrics.
 *  - Drop unsupported / unmapped metrics SILENTLY (no speculative ingestion,
 *    50-Failures #42). RECOVERY_SCORE is N/A for Apple and is never produced.
 *  - Units match the canonical `WearableMetricDef.unit` strings.
 *  - `start_at`/`end_at` come straight from HealthKit ISO timestamps (UTC).
 */

import type {
  HealthKitBloodPressureSample,
  HealthKitReadResult,
  HealthKitSample,
  HealthKitWorkoutSample,
} from './healthKitClient';

/** Canonical provider enum value (backend `WearableProvider.APPLE_HEALTHKIT`). */
export const APPLE_HEALTHKIT = 'APPLE_HEALTHKIT' as const;

/** Canonical metric bucket (backend `WearableMetricBucket`). */
export type WearableMetricBucket = 'HEALTH_FITNESS' | 'SLEEP_RECOVERY';

/** Canonical metric type (backend `WearableMetricType`). */
export type WearableMetricType =
  // ── Health & Fitness ──
  | 'STEPS'
  | 'ACTIVE_ENERGY_KCAL'
  | 'RESTING_HEART_RATE_BPM'
  | 'HEART_RATE_BPM'
  | 'VO2_MAX'
  | 'WORKOUT_DURATION_MIN'
  | 'WORKOUT_DISTANCE_M'
  | 'TRAINING_LOAD'
  | 'BODY_WEIGHT_KG'
  | 'BODY_FAT_PCT'
  | 'BLOOD_PRESSURE_SYS'
  | 'BLOOD_PRESSURE_DIA'
  // ── Sleep & Recovery ──
  | 'SLEEP_TOTAL_MIN'
  | 'SLEEP_REM_MIN'
  | 'SLEEP_DEEP_MIN'
  | 'SLEEP_LIGHT_MIN'
  | 'SLEEP_AWAKE_MIN'
  | 'SLEEP_EFFICIENCY_PCT'
  | 'HRV_MS'
  | 'RECOVERY_SCORE'
  | 'READINESS_SCORE'
  | 'STRAIN_SCORE'
  | 'BODY_BATTERY'
  | 'BODY_TEMP_DEVIATION_C'
  | 'RESPIRATORY_RATE_BRPM'
  | 'SPO2_PCT';

/**
 * Canonical normalized sample — the on-device mirror of the backend
 * `NormalizedSample` (`normalizer.types.ts`), minus server-assigned fields
 * (id, dedup_key, recorded_at). Field names match the backend interface so
 * the POST body deserializes directly into `NormalizedSample[]`.
 */
export interface NormalizedSample {
  /** Subject client User.id. */
  userId: string;
  /** The connection this sample was ingested through. */
  connectionId: string;
  /** Source provider — always APPLE_HEALTHKIT for this connector. */
  provider: typeof APPLE_HEALTHKIT;
  /** Canonical metric. */
  metric: WearableMetricType;
  /** Primary bucket for the metric (denormalized for fast bucket reads). */
  bucket: WearableMetricBucket;
  /** Numeric value in {@link unit}. */
  value: number;
  /** Canonical unit string (matches WearableMetricDef.unit). */
  unit: string;
  /** Observation window start (ISO8601). */
  startAt: string;
  /** Observation window end (ISO8601; == startAt for instantaneous). */
  endAt: string;
  /** IANA timezone the sample was reported in, if known. */
  sourceTz?: string | null;
  /** Provider-native id for the source record (backfill reconciliation). */
  sourceRecordId?: string | null;
}

/** Per-metric canonical unit + bucket descriptor (mirrors WearableMetricDef). */
interface MetricDescriptor {
  metric: WearableMetricType;
  bucket: WearableMetricBucket;
  unit: string;
}

const H = 'HEALTH_FITNESS' as const;
const S = 'SLEEP_RECOVERY' as const;

const DESCRIPTORS = {
  STEPS: { metric: 'STEPS', bucket: H, unit: 'count' },
  ACTIVE_ENERGY_KCAL: { metric: 'ACTIVE_ENERGY_KCAL', bucket: H, unit: 'kcal' },
  RESTING_HEART_RATE_BPM: { metric: 'RESTING_HEART_RATE_BPM', bucket: S, unit: 'bpm' },
  HEART_RATE_BPM: { metric: 'HEART_RATE_BPM', bucket: H, unit: 'bpm' },
  VO2_MAX: { metric: 'VO2_MAX', bucket: H, unit: 'mL/kg/min' },
  WORKOUT_DURATION_MIN: { metric: 'WORKOUT_DURATION_MIN', bucket: H, unit: 'min' },
  WORKOUT_DISTANCE_M: { metric: 'WORKOUT_DISTANCE_M', bucket: H, unit: 'm' },
  BODY_WEIGHT_KG: { metric: 'BODY_WEIGHT_KG', bucket: H, unit: 'kg' },
  BODY_FAT_PCT: { metric: 'BODY_FAT_PCT', bucket: H, unit: '%' },
  BLOOD_PRESSURE_SYS: { metric: 'BLOOD_PRESSURE_SYS', bucket: H, unit: 'mmHg' },
  BLOOD_PRESSURE_DIA: { metric: 'BLOOD_PRESSURE_DIA', bucket: H, unit: 'mmHg' },
  SLEEP_TOTAL_MIN: { metric: 'SLEEP_TOTAL_MIN', bucket: S, unit: 'min' },
  SLEEP_REM_MIN: { metric: 'SLEEP_REM_MIN', bucket: S, unit: 'min' },
  SLEEP_DEEP_MIN: { metric: 'SLEEP_DEEP_MIN', bucket: S, unit: 'min' },
  SLEEP_LIGHT_MIN: { metric: 'SLEEP_LIGHT_MIN', bucket: S, unit: 'min' },
  SLEEP_AWAKE_MIN: { metric: 'SLEEP_AWAKE_MIN', bucket: S, unit: 'min' },
  HRV_MS: { metric: 'HRV_MS', bucket: S, unit: 'ms' },
  BODY_TEMP_DEVIATION_C: { metric: 'BODY_TEMP_DEVIATION_C', bucket: S, unit: '°C' },
  RESPIRATORY_RATE_BRPM: { metric: 'RESPIRATORY_RATE_BRPM', bucket: S, unit: 'brpm' },
  SPO2_PCT: { metric: 'SPO2_PCT', bucket: S, unit: '%' },
} as const satisfies Record<string, MetricDescriptor>;

/** Identity for the normalizer — who the samples belong to / came through. */
export interface NormalizationContext {
  userId: string;
  connectionId: string;
  /** Optional IANA timezone for the device, threaded onto every sample. */
  sourceTz?: string | null;
}

/**
 * HealthKit body-temperature is an absolute reading (°C); our canonical metric
 * is a DEVIATION from a baseline. Apple does not expose a baseline, so we
 * report the deviation from a standard resting body temperature of 37.0 °C.
 * Documented so the value is interpretable downstream.
 */
const BODY_TEMP_BASELINE_C = 37.0;

/**
 * HealthKit sleep category labels. `getSleepSamples` returns one record per
 * stage segment with a string `value`. We bucket each segment's duration by
 * stage and emit per-stage SLEEP_*_MIN totals plus SLEEP_TOTAL_MIN.
 * Values observed from `react-native-health` (HKCategoryValueSleepAnalysis):
 *   INBED, ASLEEP, AWAKE, CORE, DEEP, REM, ASLEEPCORE, ASLEEPDEEP, ASLEEPREM,
 *   ASLEEPUNSPECIFIED.
 */
type SleepStageBucket = 'rem' | 'deep' | 'light' | 'awake';

function classifySleepStage(value: string): SleepStageBucket | 'inbed' | 'asleep' | null {
  const v = value.toUpperCase();
  if (v.includes('REM')) return 'rem';
  if (v.includes('DEEP')) return 'deep';
  if (v.includes('AWAKE')) return 'awake';
  if (v.includes('CORE') || v === 'LIGHT' || v === 'ASLEEPUNSPECIFIED') return 'light';
  if (v === 'INBED') return 'inbed';
  if (v === 'ASLEEP') return 'asleep';
  return null;
}

function durationMinutes(startDate: string, endDate: string): number {
  const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
  return ms > 0 ? ms / 60000 : 0;
}

/**
 * Build a NormalizedSample from a quantity sample + descriptor.
 */
function quantitySample(
  ctx: NormalizationContext,
  descriptor: MetricDescriptor,
  sample: HealthKitSample,
  valueOverride?: number,
): NormalizedSample | null {
  const raw = valueOverride ?? sample.value;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return null;
  return {
    userId: ctx.userId,
    connectionId: ctx.connectionId,
    provider: APPLE_HEALTHKIT,
    metric: descriptor.metric,
    bucket: descriptor.bucket,
    value,
    unit: descriptor.unit,
    startAt: sample.startDate,
    endAt: sample.endDate,
    sourceTz: ctx.sourceTz ?? null,
    sourceRecordId: sample.id ?? null,
  };
}

function mapQuantityArray(
  ctx: NormalizationContext,
  descriptor: MetricDescriptor,
  samples: HealthKitSample[] | undefined,
): NormalizedSample[] {
  if (!samples?.length) return [];
  const out: NormalizedSample[] = [];
  for (const s of samples) {
    const n = quantitySample(ctx, descriptor, s);
    if (n) out.push(n);
  }
  return out;
}

/** Map workouts → duration (min) + distance (m). */
function mapWorkouts(
  ctx: NormalizationContext,
  workouts: HealthKitWorkoutSample[] | undefined,
): NormalizedSample[] {
  if (!workouts?.length) return [];
  const out: NormalizedSample[] = [];
  for (const w of workouts) {
    const base = {
      userId: ctx.userId,
      connectionId: ctx.connectionId,
      provider: APPLE_HEALTHKIT,
      startAt: w.start,
      endAt: w.end,
      sourceTz: ctx.sourceTz ?? null,
      sourceRecordId: w.id ?? null,
    } as const;
    // Duration: HealthKit reports seconds; canonical metric is minutes.
    if (Number.isFinite(w.duration) && w.duration > 0) {
      out.push({
        ...base,
        metric: 'WORKOUT_DURATION_MIN',
        bucket: H,
        unit: 'min',
        value: w.duration / 60,
      });
    }
    // Distance: HealthKit reports metres; emit only when present (> 0).
    if (Number.isFinite(w.distance) && w.distance > 0) {
      out.push({
        ...base,
        metric: 'WORKOUT_DISTANCE_M',
        bucket: H,
        unit: 'm',
        value: w.distance,
      });
    }
  }
  return out;
}

/** Map blood-pressure samples → SYS + DIA pair. */
function mapBloodPressure(
  ctx: NormalizationContext,
  samples: HealthKitBloodPressureSample[] | undefined,
): NormalizedSample[] {
  if (!samples?.length) return [];
  const out: NormalizedSample[] = [];
  for (const s of samples) {
    const base = {
      userId: ctx.userId,
      connectionId: ctx.connectionId,
      provider: APPLE_HEALTHKIT,
      startAt: s.startDate,
      endAt: s.endDate,
      sourceTz: ctx.sourceTz ?? null,
      sourceRecordId: s.id ?? null,
      unit: 'mmHg',
    } as const;
    if (Number.isFinite(s.bloodPressureSystolicValue)) {
      out.push({
        ...base,
        metric: 'BLOOD_PRESSURE_SYS',
        bucket: H,
        value: s.bloodPressureSystolicValue,
      });
    }
    if (Number.isFinite(s.bloodPressureDiastolicValue)) {
      out.push({
        ...base,
        metric: 'BLOOD_PRESSURE_DIA',
        bucket: H,
        value: s.bloodPressureDiastolicValue,
      });
    }
  }
  return out;
}

/**
 * Map a quantity array applying a per-sample value transform. Used for unit
 * conversions where HealthKit's native unit differs from the canonical unit.
 */
function mapTransformedArray(
  ctx: NormalizationContext,
  descriptor: MetricDescriptor,
  samples: HealthKitSample[] | undefined,
  transform: (v: number) => number,
): NormalizedSample[] {
  if (!samples?.length) return [];
  const out: NormalizedSample[] = [];
  for (const s of samples) {
    const raw = typeof s.value === 'number' ? s.value : Number(s.value);
    if (!Number.isFinite(raw)) continue;
    const n = quantitySample(ctx, descriptor, s, transform(raw));
    if (n) out.push(n);
  }
  return out;
}

/**
 * HealthKit oxygen saturation is reported as a fraction in [0,1]; canonical
 * SPO2_PCT is a percentage. Values already in percent range (>1) are passed
 * through defensively (some sources report 0–100 directly).
 */
function spo2ToPercent(v: number): number {
  return v <= 1 ? v * 100 : v;
}

/**
 * HealthKit HRV (SDNN) is reported in seconds; canonical HRV_MS is
 * milliseconds. Values already in ms range (>5, since physiological SDNN in
 * seconds is <0.3) are passed through defensively.
 */
function hrvToMs(v: number): number {
  return v < 5 ? v * 1000 : v;
}

/** Map body-temperature absolute readings → deviation from baseline. */
function mapBodyTemperature(
  ctx: NormalizationContext,
  samples: HealthKitSample[] | undefined,
): NormalizedSample[] {
  if (!samples?.length) return [];
  const out: NormalizedSample[] = [];
  for (const s of samples) {
    const abs = typeof s.value === 'number' ? s.value : Number(s.value);
    if (!Number.isFinite(abs)) continue;
    out.push(
      quantitySample(
        ctx,
        DESCRIPTORS.BODY_TEMP_DEVIATION_C,
        s,
        abs - BODY_TEMP_BASELINE_C,
      ) as NormalizedSample,
    );
  }
  return out;
}

/**
 * Map sleep category segments → per-stage SLEEP_*_MIN totals.
 *
 * One HealthKit sleep query can return many segments. We sum each segment's
 * duration into its stage bucket and emit one SLEEP_<STAGE>_MIN sample per
 * stage spanning the full sleep window. SLEEP_TOTAL_MIN = rem + deep + light
 * (asleep stages); "inbed" segments are container records and are not counted
 * toward asleep totals (avoids double-counting). If only coarse ASLEEP/INBED
 * data is present (older watchOS), ASLEEP rolls into SLEEP_TOTAL_MIN.
 */
function mapSleep(
  ctx: NormalizationContext,
  samples: HealthKitSample[] | undefined,
): NormalizedSample[] {
  if (!samples?.length) return [];

  const minutes: Record<SleepStageBucket, number> = { rem: 0, deep: 0, light: 0, awake: 0 };
  let asleepCoarseMin = 0;
  let windowStart: number | null = null;
  let windowEnd: number | null = null;

  for (const s of samples) {
    const value = typeof s.value === 'string' ? s.value : String(s.value);
    const stage = classifySleepStage(value);
    const mins = durationMinutes(s.startDate, s.endDate);
    if (stage === null) continue;

    const startMs = new Date(s.startDate).getTime();
    const endMs = new Date(s.endDate).getTime();
    if (stage !== 'inbed') {
      windowStart = windowStart === null ? startMs : Math.min(windowStart, startMs);
      windowEnd = windowEnd === null ? endMs : Math.max(windowEnd, endMs);
    }

    if (stage === 'inbed') continue;
    if (stage === 'asleep') {
      asleepCoarseMin += mins;
      continue;
    }
    minutes[stage] += mins;
  }

  if (windowStart === null || windowEnd === null) return [];
  const startAt = new Date(windowStart).toISOString();
  const endAt = new Date(windowEnd).toISOString();

  const stageDescriptors: Array<[SleepStageBucket, MetricDescriptor]> = [
    ['rem', DESCRIPTORS.SLEEP_REM_MIN],
    ['deep', DESCRIPTORS.SLEEP_DEEP_MIN],
    ['light', DESCRIPTORS.SLEEP_LIGHT_MIN],
    ['awake', DESCRIPTORS.SLEEP_AWAKE_MIN],
  ];

  const out: NormalizedSample[] = [];
  for (const [bucket, descriptor] of stageDescriptors) {
    if (minutes[bucket] <= 0) continue;
    out.push({
      userId: ctx.userId,
      connectionId: ctx.connectionId,
      provider: APPLE_HEALTHKIT,
      metric: descriptor.metric,
      bucket: descriptor.bucket,
      value: minutes[bucket],
      unit: descriptor.unit,
      startAt,
      endAt,
      sourceTz: ctx.sourceTz ?? null,
      sourceRecordId: null,
    });
  }

  // Total asleep = staged asleep (rem+deep+light) + any coarse ASLEEP segments.
  const totalAsleep = minutes.rem + minutes.deep + minutes.light + asleepCoarseMin;
  if (totalAsleep > 0) {
    out.push({
      userId: ctx.userId,
      connectionId: ctx.connectionId,
      provider: APPLE_HEALTHKIT,
      metric: 'SLEEP_TOTAL_MIN',
      bucket: S,
      value: totalAsleep,
      unit: 'min',
      startAt,
      endAt,
      sourceTz: ctx.sourceTz ?? null,
      sourceRecordId: null,
    });
  }

  return out;
}

/**
 * Normalize a full HealthKit read pass into canonical samples.
 *
 * Implements ALL HealthKit-source mappings from Agent 2 §3.1. Metrics with no
 * HealthKit source (RECOVERY_SCORE, READINESS_SCORE, STRAIN_SCORE,
 * BODY_BATTERY, TRAINING_LOAD, SLEEP_EFFICIENCY_PCT — Apple does not expose
 * an efficiency figure) are never produced (dropped silently, #42).
 */
export function normalizeHealthKitResult(
  result: HealthKitReadResult,
  ctx: NormalizationContext,
): NormalizedSample[] {
  return [
    ...mapQuantityArray(ctx, DESCRIPTORS.STEPS, result.steps),
    ...mapQuantityArray(ctx, DESCRIPTORS.ACTIVE_ENERGY_KCAL, result.activeEnergy),
    ...mapQuantityArray(ctx, DESCRIPTORS.RESTING_HEART_RATE_BPM, result.restingHeartRate),
    ...mapQuantityArray(ctx, DESCRIPTORS.HEART_RATE_BPM, result.heartRate),
    ...mapQuantityArray(ctx, DESCRIPTORS.VO2_MAX, result.vo2Max),
    ...mapWorkouts(ctx, result.workouts),
    ...mapQuantityArray(ctx, DESCRIPTORS.BODY_WEIGHT_KG, result.weight),
    ...mapQuantityArray(ctx, DESCRIPTORS.BODY_FAT_PCT, result.bodyFat),
    ...mapBloodPressure(ctx, result.bloodPressure),
    ...mapSleep(ctx, result.sleep),
    ...mapTransformedArray(ctx, DESCRIPTORS.HRV_MS, result.hrv, hrvToMs),
    ...mapTransformedArray(ctx, DESCRIPTORS.SPO2_PCT, result.spo2, spo2ToPercent),
    ...mapQuantityArray(ctx, DESCRIPTORS.RESPIRATORY_RATE_BRPM, result.respiratoryRate),
    ...mapBodyTemperature(ctx, result.bodyTemperature),
  ];
}
