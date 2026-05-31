// PR-HK-2.b — Android Health Connect connector: sync orchestrator.
//
// Orchestrates the on-device ingestion lane (Agent 2 §3.2):
//
//   request-permission → read since-lastSync → normalize → POST
//
// and persists `lastSyncAt` in secureStorage so each run reads only the
// incremental window. Platform-guarded (Android only). Fails loud on
// unrecoverable errors (#36/#50); a per-record-type read failure degrades
// gracefully (handled in the client's readAllSupportedRecords).

import { Platform } from 'react-native';
import { secureStorage } from '../../secureStorage';
import { logger } from '../../../utils/logger';
import {
  HealthConnectPermissionDeniedError,
  HealthConnectUnsupportedError,
} from './errors';
import {
  HEALTH_CONNECT_RECORD_TYPES,
  healthConnectClient as defaultClient,
  isHealthConnectSupported,
  type HealthConnectClient,
  type HealthConnectRecordType,
} from './healthConnectClient';
import {
  normalizeAll,
  type NormalizeContext,
} from './healthConnectNormalizer';
import {
  healthConnectIngestApi as defaultIngestApi,
} from './healthConnectIngestApi';
import type { NormalizedSample } from './types';

/** SecureStore key under which the last successful sync instant is persisted. */
export const LAST_SYNC_AT_KEY = 'health_connect_last_sync_at';

/**
 * Default look-back when there is no persisted `lastSyncAt` (first sync). Seven
 * days balances a useful initial backfill against the device-permitted history
 * window without flooding the ingestion lane on first connect.
 */
export const DEFAULT_BACKFILL_DAYS = 7;

/**
 * Overlap re-read, in minutes. We rewind the read-window start by this much
 * past the persisted `lastSyncAt` so a sample written slightly late on the
 * device (or a clock skew) is not missed. Safe because ingestion is idempotent
 * (dedup_key), so the overlap never double-counts.
 */
export const SYNC_OVERLAP_MINUTES = 5;

/** Injectable dependencies — defaults wire the real client/api; tests inject mocks. */
export interface HealthConnectSyncDeps {
  client?: HealthConnectClient;
  ingestApi?: Pick<typeof defaultIngestApi, 'ingest'>;
  /** Override "now" for deterministic tests. */
  now?: () => Date;
}

/** Result of a sync run. */
export interface HealthConnectSyncResult {
  /** Number of canonical samples produced + posted. */
  normalizedCount: number;
  /** Backend-reported rows inserted. */
  inserted: number;
  /** Backend-reported rows skipped (already present). */
  skipped: number;
  /** Granted read record types this run observed. */
  grantedRecordTypes: HealthConnectRecordType[];
  /** The window read this run. */
  windowStart: Date;
  windowEnd: Date;
}

function assertSupported(): void {
  if (!isHealthConnectSupported()) {
    throw new HealthConnectUnsupportedError(Platform.OS);
  }
}

/** Read the persisted last-sync instant, or null if never synced. */
export async function getLastSyncAt(): Promise<Date | null> {
  const raw = await secureStorage.getItem(LAST_SYNC_AT_KEY);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Persist the last-sync instant (ISO-8601) in secureStorage. */
export async function setLastSyncAt(when: Date): Promise<void> {
  await secureStorage.setItem(LAST_SYNC_AT_KEY, when.toISOString());
}

/** Clear the persisted last-sync instant (e.g. on disconnect / re-link). */
export async function clearLastSyncAt(): Promise<void> {
  await secureStorage.removeItem(LAST_SYNC_AT_KEY);
}

/**
 * Compute the read-window start: `lastSyncAt - overlap`, or
 * `now - DEFAULT_BACKFILL_DAYS` on first sync.
 */
function computeWindowStart(lastSyncAt: Date | null, now: Date): Date {
  if (lastSyncAt) {
    return new Date(lastSyncAt.getTime() - SYNC_OVERLAP_MINUTES * 60_000);
  }
  return new Date(now.getTime() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60_000);
}

/** The granted record types intersected with the ones this connector reads. */
function grantedReadRecordTypes(
  granted: { accessType: string; recordType: string }[],
): HealthConnectRecordType[] {
  const grantedRead = new Set(
    granted
      .filter((p) => p.accessType === 'read')
      .map((p) => p.recordType),
  );
  return HEALTH_CONNECT_RECORD_TYPES.filter((rt) => grantedRead.has(rt));
}

/**
 * Run a full Health Connect sync for the given subject user + connection.
 *
 * Steps:
 *   1. Platform guard (Android only).
 *   2. Initialize the SDK.
 *   3. Request permission; if NONE granted → throw HealthConnectPermissionDeniedError.
 *   4. Read every granted record type for `[windowStart, now)`.
 *   5. Normalize → NormalizedSample[].
 *   6. POST to the ingestion lane.
 *   7. On success, persist `lastSyncAt = now`.
 *
 * `lastSyncAt` is persisted ONLY after a successful POST so a failed run is
 * retried over the same window next time (no silent data gap, #36).
 */
export async function syncHealthConnect(
  userId: string,
  connectionId: string,
  deps: HealthConnectSyncDeps = {},
): Promise<HealthConnectSyncResult> {
  assertSupported();

  const client = deps.client ?? defaultClient;
  const ingestApi = deps.ingestApi ?? defaultIngestApi;
  const now = (deps.now ?? (() => new Date()))();

  // (2) Boot the SDK.
  await client.initialize();

  // (3) Ask for permissions; reconcile against what's actually granted.
  await client.requestPermission();
  const granted = await client.getGrantedPermissions();
  const grantedRecordTypes = grantedReadRecordTypes(granted);
  if (grantedRecordTypes.length === 0) {
    logger.warn('healthConnectSync', 'all read permissions denied', {
      requested: HEALTH_CONNECT_RECORD_TYPES.length,
    });
    throw new HealthConnectPermissionDeniedError([...HEALTH_CONNECT_RECORD_TYPES]);
  }

  // (4) Determine the incremental window and read every granted type.
  const lastSyncAt = await getLastSyncAt();
  const windowStart = computeWindowStart(lastSyncAt, now);
  const range = {
    startTime: windowStart.toISOString(),
    endTime: now.toISOString(),
  };

  const byType: Partial<Record<HealthConnectRecordType, unknown[]>> = {};
  for (const recordType of grantedRecordTypes) {
    try {
      byType[recordType] = await client.readRecords(recordType, range);
    } catch (err) {
      // Per-type read failure degrades gracefully — log + skip, never abort
      // the whole sync (#50). Other types still flow through.
      byType[recordType] = [];
      logger.error('healthConnectSync', 'readRecords failed', {
        recordType,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // (5) Normalize device-side.
  const ctx: NormalizeContext = { userId, connectionId };
  const samples: NormalizedSample[] = normalizeAll(ctx, byType);

  // (6) POST (idempotent; empty batch is a no-op).
  const { inserted, skipped } = await ingestApi.ingest(samples);

  // (7) Persist watermark ONLY after a successful POST.
  await setLastSyncAt(now);

  logger.log('healthConnectSync', 'sync complete', {
    normalizedCount: samples.length,
    inserted,
    skipped,
    grantedRecordTypes: grantedRecordTypes.length,
  });

  return {
    normalizedCount: samples.length,
    inserted,
    skipped,
    grantedRecordTypes,
    windowStart,
    windowEnd: now,
  };
}

/** Grouped service surface (handy for mocking from the hook). */
export const healthConnectSyncService = {
  LAST_SYNC_AT_KEY,
  getLastSyncAt,
  setLastSyncAt,
  clearLastSyncAt,
  syncHealthConnect,
};

export type HealthConnectSyncService = typeof healthConnectSyncService;
