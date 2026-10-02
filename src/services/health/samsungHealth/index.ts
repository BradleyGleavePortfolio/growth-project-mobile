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

// S14 round 3: no Samsung upload path. The dormant Samsung sync service
// posted samples under a phone-wide cursor with no account binding; it had no
// caller and was removed. Samsung data reaches the app through Health Connect
// (`../onDeviceSync.ts`), which is bound to the person who tapped Connect.

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
