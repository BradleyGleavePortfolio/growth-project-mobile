// PR-HK-2.b — Android Health Connect on-device connector: shared types.
//
// The mobile app has no `@prisma/client` dependency, so the canonical
// wearable enums and the `NormalizedSample` shape that the backend defines in
// `growth-project-backend/src/wearables/normalization/normalizer.types.ts`
// are mirrored here as plain string-literal unions. This is the single seam
// where Android Health Connect record idiosyncrasy stops and the canonical
// schema begins (Agent 2 §3.2 — "the ingestion lane is identical after the
// NormalizedSample[] boundary").
//
// IMPORTANT: these literals MUST stay in lock-step with the backend Prisma
// enums (`WearableProvider`, `WearableMetricType`, `WearableMetricBucket`).
// The values below are copied verbatim from AGENT_2_CODING_PLAN.md §2.1/§2.2.

/** Canonical provider enum — this connector only ever emits HEALTH_CONNECT. */
export type WearableProvider =
  | 'APPLE_HEALTHKIT'
  | 'HEALTH_CONNECT'
  | 'GARMIN'
  | 'FITBIT'
  | 'STRAVA'
  | 'POLAR'
  | 'SAMSUNG_HEALTH'
  | 'WAHOO'
  | 'WITHINGS'
  | 'PELOTON'
  | 'MYFITNESSPAL'
  | 'OURA'
  | 'WHOOP'
  | 'EIGHT_SLEEP'
  | 'BEDDIT';

/** The two UX buckets — a per-metric taxonomy attribute (Agent 2 §0). */
export type WearableMetricBucket = 'HEALTH_FITNESS' | 'SLEEP_RECOVERY';

/** Canonical metric taxonomy (Agent 2 §2.2). */
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
 * Canonical, provider-neutral sample — mirrors the backend `NormalizedSample`
 * interface 1:1 (camelCase, `Date` for time fields). The ingestion lane
 * computes the server-side fields (id, dedup_key, recorded_at).
 *
 * On-device note: `connectionId` is supplied by the caller (the sync service)
 * because the Health Connect connection row is created/looked-up server-side;
 * the device does not hold a Prisma id, so the sync service threads it in.
 */
export interface NormalizedSample {
  /** Subject client User.id. */
  userId: string;
  /** The connection this sample was ingested through. */
  connectionId: string;
  /** Source provider — always 'HEALTH_CONNECT' for this connector. */
  provider: WearableProvider;
  /** Canonical metric. */
  metric: WearableMetricType;
  /** Primary bucket for the metric (denormalized for fast reads). */
  bucket: WearableMetricBucket;
  /** Numeric value in {@link unit}. */
  value: number;
  /** Canonical unit string (matches WearableMetricDef.unit). */
  unit: string;
  /** Observation window start. */
  startAt: Date;
  /** Observation window end (== startAt for instantaneous samples). */
  endAt: Date;
  /** IANA timezone the provider reported the sample in, if known. */
  sourceTz?: string | null;
  /** Provider-native id for the source record (backfill reconciliation). */
  sourceRecordId?: string | null;
  /** Optional pointer to an archived raw payload. */
  rawRef?: string | null;
}

/**
 * The wire shape posted to `POST /v1/wearables/samples/ingest`. `Date` fields
 * are serialized to ISO-8601 strings over the wire; the backend Zod schema
 * coerces them back to `Date`. Kept distinct from {@link NormalizedSample} so
 * the serialization boundary is explicit (no accidental `Date` over JSON).
 */
export interface NormalizedSampleWire
  extends Omit<NormalizedSample, 'startAt' | 'endAt'> {
  startAt: string;
  endAt: string;
}

/** The canonical provider literal this connector emits. */
export const HEALTH_CONNECT_PROVIDER: WearableProvider = 'HEALTH_CONNECT';
