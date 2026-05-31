/**
 * PR-HK-2.c — Samsung Health on-device connector (Android).
 *
 * Public surface for the Samsung Health connector. Samsung-origin samples are
 * read through the Android Health Connect bridge, filtered to
 * `com.sec.android.app.shealth`, and ingested as `provider: SAMSUNG_HEALTH`.
 *
 * The folder is file-disjoint from `src/services/health/healthConnect/`
 * (PR-HK-2.b). The two connectors share the Health Connect bridge but report
 * distinct providers and filter to distinct data origins.
 */

export {
  samsungHealthClient,
  initialize,
  getGrantedRecordTypes,
  readRecords,
  getBridge,
  __setBridgeForTests,
  SAMSUNG_REQUIRED_RECORD_TYPES,
  type SamsungHealthClient,
  type SamsungHealthBridge,
} from './samsungHealthClient';

export {
  samsungHealthNormalizer,
  normalizeRecord,
  normalizeRecords,
  type NormalizedSample,
  type SamsungHealthNormalizer,
} from './samsungHealthNormalizer';

export {
  samsungHealthSyncService,
  sync,
  getLastSyncAt,
  setLastSyncAt,
  clearLastSyncAt,
  SAMSUNG_LAST_SYNC_KEY,
  SAMSUNG_INGEST_PATH,
  DEFAULT_BACKFILL_DAYS,
  type SamsungSyncResult,
  type SamsungHealthSyncService,
} from './samsungHealthSyncService';

export {
  SamsungHealthError,
  SamsungHealthUnsupportedError,
  SamsungHealthUnavailableError,
  SamsungHealthPermissionDeniedError,
} from './errors';

export {
  SAMSUNG_HEALTH_PACKAGE_NAME,
  SAMSUNG_HEALTH_PROVIDER,
  extractPackageName,
  isSamsungHealthRecord,
  type SamsungHealthRecord,
  type SamsungReadableRecordType,
  type SamsungReadRecordsOptions,
  type SamsungTimeRangeFilter,
  type SamsungDataOrigin,
  type SamsungRecordMetadata,
  type WearableProvider,
  type WearableMetricType,
  type WearableMetricBucket,
} from './types';
