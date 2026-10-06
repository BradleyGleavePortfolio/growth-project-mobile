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
  // S14: no `userId`. The backend derives the subject from the JWT and
  // rejects any body `userId` with WEARABLES_INGEST_USER_ID_FORBIDDEN.
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
  // S14: no userId — the backend stamps the subject from the JWT.
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
 * Gap that separates two sleep sessions. Segments closer than this belong to
 * the same night (a short wake in the night stays inside the session).
 */
export const SLEEP_SESSION_GAP_MS = 2 * 60 * 60 * 1000;

/**
 * Overlap priority when sources disagree about the same minute (S14 B-317-3).
 * HealthKit returns every source's segments (iPhone, Apple Watch, other
 * apps), and they overlap. Each minute is counted ONCE, as the most specific
 * stage any source reports for it: a staged watch value wins over a coarse
 * ASLEEP, and any staged asleep value wins over AWAKE.
 */
const SLEEP_STAGE_PRIORITY: Array<SleepStageBucket | 'asleep'> = [
  'deep',
  'rem',
  'light',
  'awake',
  'asleep',
];

interface SleepSegment {
  start: number;
  end: number;
  stage: SleepStageBucket | 'asleep';
}

/** Minutes per stage across overlapping segments, each instant counted once. */
function resolveOverlaps(segments: SleepSegment[]): Record<SleepStageBucket | 'asleep', number> {
  const totals: Record<SleepStageBucket | 'asleep', number> = {
    rem: 0,
    deep: 0,
    light: 0,
    awake: 0,
    asleep: 0,
  };
  const points = Array.from(new Set(segments.flatMap((g) => [g.start, g.end]))).sort(
    (x, y) => x - y,
  );
  for (let i = 0; i + 1 < points.length; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    let best: SleepStageBucket | 'asleep' | null = null;
    for (const g of segments) {
      if (g.start <= from && g.end >= to) {
        if (
          best === null ||
          SLEEP_STAGE_PRIORITY.indexOf(g.stage) < SLEEP_STAGE_PRIORITY.indexOf(best)
        ) {
          best = g.stage;
        }
      }
    }
    if (best !== null) totals[best] += (to - from) / 60000;
  }
  return totals;
}

/**
 * Map sleep category segments → one record set PER SLEEP SESSION (night).
 *
 * S14 (B-317-3): the old mapper summed every segment of the query into one
 * record spanning the whole query, so two nights became one 960-minute
 * "night", and the record's bounds (the backend dedup key) changed with the
 * query window. Now:
 *
 *  1. In-bed segments are containers and are ignored; asleep/stage segments
 *     from all sources are grouped into sessions split by gaps longer than
 *     {@link SLEEP_SESSION_GAP_MS}.
 *  2. Within a session, overlapping sources are resolved minute by minute
 *     ({@link SLEEP_STAGE_PRIORITY}), so a watch and a phone reporting the
 *     same night are not double counted.
 *  3. When the read window is known, a session that may be cut by it is not
 *     emitted yet: one starting within the gap of the window start (it may
 *     have begun before the read; the client reads sleep with a look-back so
 *     a real night is read whole) or ending within the gap of the window end
 *     (it may still be going on). It is emitted, whole, by a later sync.
 *  4. C-370-3: when `postEnds` is given, only sessions ending in
 *     [from, to) are emitted. The sync service gives each import piece the
 *     range [piece start - gap, piece end - gap), so a night is emitted only
 *     from the piece in which it ends, whose sleep read starts more than a
 *     day before that end and so holds the whole night. A later piece whose
 *     sleep look-back starts inside the night (behind a long segment that
 *     began before it) sees only the tail, which ends at the same time and is
 *     not emitted (probe: 330 + 180 minutes for one night counts once).
 *
 * Each session yields SLEEP_<STAGE>_MIN per stage present plus
 * SLEEP_TOTAL_MIN (= deep + rem + light + coarse asleep), all with the
 * session's own start/end. The same night therefore produces the same
 * records, and the same dedup keys, on every sync.
 */
function mapSleep(
  ctx: NormalizationContext,
  samples: HealthKitSample[] | undefined,
  window?: { start: string; end: string },
  postEnds?: { from: string; to: string },
): NormalizedSample[] {
  if (!samples?.length) return [];
  const endsFrom = postEnds ? Date.parse(postEnds.from) : NaN;
  const endsTo = postEnds ? Date.parse(postEnds.to) : NaN;

  const segments: SleepSegment[] = [];
  for (const s of samples) {
    const value = typeof s.value === 'string' ? s.value : String(s.value);
    const stage = classifySleepStage(value);
    if (stage === null || stage === 'inbed') continue;
    const start = new Date(s.startDate).getTime();
    const end = new Date(s.endDate).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    segments.push({ start, end, stage });
  }
  if (segments.length === 0) return [];
  segments.sort((x, y) => x.start - y.start || x.end - y.end);

  // Group into sessions by gap.
  const sessions: SleepSegment[][] = [];
  let current: SleepSegment[] = [];
  let currentEnd = -Infinity;
  for (const g of segments) {
    if (current.length > 0 && g.start - currentEnd > SLEEP_SESSION_GAP_MS) {
      sessions.push(current);
      current = [];
      currentEnd = -Infinity;
    }
    current.push(g);
    currentEnd = Math.max(currentEnd, g.end);
  }
  if (current.length > 0) sessions.push(current);

  const windowStart = window ? Date.parse(window.start) : NaN;
  const windowEnd = window ? Date.parse(window.end) : NaN;

  const stageDescriptors: Array<[SleepStageBucket, MetricDescriptor]> = [
    ['rem', DESCRIPTORS.SLEEP_REM_MIN],
    ['deep', DESCRIPTORS.SLEEP_DEEP_MIN],
    ['light', DESCRIPTORS.SLEEP_LIGHT_MIN],
    ['awake', DESCRIPTORS.SLEEP_AWAKE_MIN],
  ];

  const out: NormalizedSample[] = [];
  for (const session of sessions) {
    const sessionStart = Math.min(...session.map((g) => g.start));
    const sessionEnd = Math.max(...session.map((g) => g.end));
    if (Number.isFinite(windowStart) && sessionStart - windowStart < SLEEP_SESSION_GAP_MS) {
      continue;
    }
    if (Number.isFinite(windowEnd) && windowEnd - sessionEnd < SLEEP_SESSION_GAP_MS) continue;
    if (Number.isFinite(endsFrom) && sessionEnd < endsFrom) continue;
    if (Number.isFinite(endsTo) && sessionEnd >= endsTo) continue;

    const minutes = resolveOverlaps(session);
    const startAt = new Date(sessionStart).toISOString();
    const endAt = new Date(sessionEnd).toISOString();
    const base = {
      connectionId: ctx.connectionId,
      provider: APPLE_HEALTHKIT,
      startAt,
      endAt,
      sourceTz: ctx.sourceTz ?? null,
      sourceRecordId: null,
    };
    for (const [bucket, descriptor] of stageDescriptors) {
      const value = Math.round(minutes[bucket]);
      if (value <= 0) continue;
      out.push({
        ...base,
        metric: descriptor.metric,
        bucket: descriptor.bucket,
        value,
        unit: descriptor.unit,
      });
    }
    const totalAsleep = Math.round(minutes.rem + minutes.deep + minutes.light + minutes.asleep);
    if (totalAsleep > 0) {
      out.push({ ...base, metric: 'SLEEP_TOTAL_MIN', bucket: S, value: totalAsleep, unit: 'min' });
    }
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
    ...mapSleep(ctx, result.sleep, result.sleepWindow, result.sleepPostEnds),
    ...mapTransformedArray(ctx, DESCRIPTORS.HRV_MS, result.hrv, hrvToMs),
    ...mapTransformedArray(ctx, DESCRIPTORS.SPO2_PCT, result.spo2, spo2ToPercent),
    ...mapQuantityArray(ctx, DESCRIPTORS.RESPIRATORY_RATE_BRPM, result.respiratoryRate),
    ...mapBodyTemperature(ctx, result.bodyTemperature),
  ];
}
