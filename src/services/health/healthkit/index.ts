/**
 * PR-HK-2.a — Apple HealthKit on-device connector public surface.
 *
 * Single import site for the on-device sync lane (`../onDeviceSync.ts`).
 * Re-exports the typed client, the normalizer, and the sync orchestrator.
 */

// ── Client (native bridge wrapper) ──
export {
  HealthKitClient,
  HealthKitUnsupportedError,
  healthKitClient,
  HEALTHKIT_READ_PERMISSIONS,
} from './healthKitClient';
export type {
  HealthKitReadPermission,
  HealthKitQueryWindow,
  HealthKitSample,
  HealthKitBloodPressureSample,
  HealthKitWorkoutSample,
  HealthKitMetricKey,
  HealthKitReadResult,
} from './healthKitClient';

// ── Normalizer (HealthKit → canonical NormalizedSample[]) ──
export {
  APPLE_HEALTHKIT,
  normalizeHealthKitResult,
} from './healthKitNormalizer';
export type {
  NormalizedSample,
  NormalizationContext,
  WearableMetricBucket,
  WearableMetricType,
} from './healthKitNormalizer';

// ── Sync service (orchestration + cursor persistence) ──
export {
  HealthKitSyncService,
  healthKitSyncService,
  HEALTHKIT_LAST_SYNC_KEY,
  HEALTHKIT_INGEST_PATH,
  HEALTHKIT_METRIC_KEYS,
  DEFAULT_BACKFILL_DAYS,
} from './healthKitSyncService';
export type {
  HealthKitSyncOptions,
  HealthKitSyncResult,
} from './healthKitSyncService';
