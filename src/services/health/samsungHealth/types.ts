/**
 * PR-HK-2.c — Samsung Health on-device connector: shared types.
 *
 * Samsung Health has no stable JS↔RN bridge package on mainstream npm. The
 * implemented approach (per UNIFIED_BUILD_PLAN §0 on-device locks and
 * AGENT_2_CODING_PLAN §3 "Samsung Health … data types → all canonical metrics
 * mapped device-side") reads Samsung-origin samples through the Android
 * **Health Connect** bridge (`react-native-health-connect`): Samsung Health
 * writes into Health Connect on devices that have it, tagging every record
 * with a `dataOrigin` of `com.sec.android.app.shealth`. This connector FILTERS
 * Health Connect records to that origin and reports them as
 * `provider: SAMSUNG_HEALTH` — the provider-distinct differentiator vs the
 * Health Connect connector (PR-HK-2.b), which reports `HEALTH_CONNECT`.
 *
 * `samsungHealthClient.ts` is also the clean seam for a future native Samsung
 * SDK module: swapping the underlying reader changes nothing in this file's
 * public `readRecords` contract.
 *
 * These types intentionally mirror the subset of the Health Connect record
 * shape this connector depends on. They are kept local (not imported from
 * `@prisma/client`, which is a backend-only dependency) so the mobile bundle
 * stays free of server packages. The string-union enums below are the
 * canonical wire values the backend ingest endpoint
 * (`POST /v1/wearables/samples/ingest`) expects — they match the Prisma
 * `WearableProvider` / `WearableMetricType` / `WearableMetricBucket` enums
 * 1:1 (AGENT_2_CODING_PLAN §2.1/§2.2).
 */

/** Samsung Health's Health Connect package id — the filter discriminator. */
export const SAMSUNG_HEALTH_PACKAGE_NAME = 'com.sec.android.app.shealth' as const;

/**
 * Canonical wearable provider tag (mirror of Prisma `WearableProvider`). This
 * connector only ever emits `SAMSUNG_HEALTH`.
 */
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

/** The provider value this connector always tags samples with. */
export const SAMSUNG_HEALTH_PROVIDER: WearableProvider = 'SAMSUNG_HEALTH';

/** Canonical metric taxonomy (mirror of Prisma `WearableMetricType`). */
export type WearableMetricType =
  // Health & Fitness
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
  // Sleep & Recovery
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

/** Canonical metric bucket (mirror of Prisma `WearableMetricBucket`). */
export type WearableMetricBucket = 'HEALTH_FITNESS' | 'SLEEP_RECOVERY';

/**
 * The Health Connect record types this connector reads. Kept as a string
 * union (matching `react-native-health-connect` `RecordType` values) so the
 * client and normalizer agree on the recognised set without depending on the
 * native package's generated types at compile time.
 */
export type SamsungReadableRecordType =
  | 'Steps'
  | 'ActiveCaloriesBurned'
  | 'HeartRate'
  | 'RestingHeartRate'
  | 'Vo2Max'
  | 'ExerciseSession'
  | 'Distance'
  | 'Weight'
  | 'BodyFat'
  | 'BloodPressure'
  | 'SleepSession'
  | 'HeartRateVariabilityRmssd'
  | 'OxygenSaturation'
  | 'RespiratoryRate'
  | 'BodyTemperature';

/**
 * The `dataOrigin` shape this connector filters on. The task contract is
 * binding on `record.metadata.dataOrigin.packageName`. Some
 * `react-native-health-connect` builds surface `dataOrigin` as a bare string
 * (the package name) rather than an object; {@link extractPackageName}
 * tolerates both shapes so the filter never silently passes the wrong origin.
 */
export interface SamsungDataOrigin {
  packageName: string;
}

/** Minimal metadata block we depend on from a Health Connect record. */
export interface SamsungRecordMetadata {
  id?: string;
  /** Either `{ packageName }` (contract shape) or a bare package-name string. */
  dataOrigin: SamsungDataOrigin | string;
  lastModifiedTime?: string;
  clientRecordId?: string | null;
}

/**
 * A Health Connect record as returned by `readRecords`, narrowed to the fields
 * this connector consumes. Metric-specific value fields are kept open via an
 * index signature so the normalizer can read the per-record-type payload
 * (e.g. `count`, `beatsPerMinute`, `energy.inKilocalories`).
 */
export interface SamsungHealthRecord {
  recordType: SamsungReadableRecordType;
  metadata: SamsungRecordMetadata;
  startTime?: string;
  endTime?: string;
  time?: string;
  [key: string]: unknown;
}

/** Time-range filter passed through to the underlying Health Connect reader. */
export interface SamsungTimeRangeFilter {
  operator: 'between' | 'after' | 'before';
  startTime?: string;
  endTime?: string;
}

/** Options accepted by {@link readRecords}. Mirrors `ReadRecordsOptions`. */
export interface SamsungReadRecordsOptions {
  timeRangeFilter: SamsungTimeRangeFilter;
  pageSize?: number;
  pageToken?: string;
}

/**
 * Resolve a `dataOrigin` (object-or-string) to its package name. Returns an
 * empty string for malformed origins so the Samsung filter rejects them rather
 * than throwing mid-read.
 */
export function extractPackageName(
  dataOrigin: SamsungDataOrigin | string | null | undefined,
): string {
  if (!dataOrigin) return '';
  if (typeof dataOrigin === 'string') return dataOrigin;
  return typeof dataOrigin.packageName === 'string' ? dataOrigin.packageName : '';
}

/**
 * True iff a record originated from Samsung Health. This is the single
 * predicate the client filter and any future native SDK seam share.
 */
export function isSamsungHealthRecord(record: SamsungHealthRecord): boolean {
  return extractPackageName(record?.metadata?.dataOrigin) === SAMSUNG_HEALTH_PACKAGE_NAME;
}
