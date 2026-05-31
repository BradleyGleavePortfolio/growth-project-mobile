// PR-HK-2.b — Android Health Connect on-device connector: public barrel.
//
// The connector's public surface. Other modules (e.g. the
// `useHealthConnectSync` hook, future Wearables connection screens) import
// from here, never from individual files, so the internal layout can evolve
// without churning call sites.

export * from './types';
export * from './errors';
export {
  HEALTH_CONNECT_RECORD_TYPES,
  type HealthConnectRecordType,
  type HealthConnectPermission,
  type TimeRange,
  type HealthConnectClient,
  isHealthConnectSupported,
  buildReadPermissions,
  healthConnectClient,
} from './healthConnectClient';
export {
  normalizeRecord,
  normalizeRecords,
  normalizeAll,
  type NormalizeContext,
} from './healthConnectNormalizer';
export {
  WEARABLES_INGEST_PATH,
  healthConnectIngestApi,
  toWire,
  type IngestResult,
} from './healthConnectIngestApi';
export {
  syncHealthConnect,
  healthConnectSyncService,
  getLastSyncAt,
  setLastSyncAt,
  clearLastSyncAt,
  LAST_SYNC_AT_KEY,
  DEFAULT_BACKFILL_DAYS,
  SYNC_OVERLAP_MINUTES,
  type HealthConnectSyncDeps,
  type HealthConnectSyncResult,
  type HealthConnectSyncService,
} from './healthConnectSyncService';
