// PR-HK-2.b — Android Health Connect connector: sync orchestrator.
//
// Orchestrates the on-device ingestion lane (Agent 2 §3.2):
//
//   request-permission → read since progress → normalize → POST
//
// S14: progress is stored per account + connection + provider and per record
// type (`../onDeviceState.ts`), never provider-global (B-317-1). A type whose
// read failed keeps its progress; a type whose read stopped at the page bound
// keeps a resume token and is read on from there next time (B-317-2). The
// run reports `complete` only when every granted type was read to the end.
// Platform-guarded (Android only).

import { Platform } from 'react-native';
import { assertAndroidHealthConnectEnabled } from '../../../config/healthConnect';
import {
  getSyncProgress,
  setSyncProgress,
  type OnDeviceScope,
  type SyncProgress,
} from '../onDeviceState';
import { OnDeviceSessionChangedError, type SessionFence } from '../sessionFence';
import { logger } from '../../../utils/logger';
import {
  HealthConnectPermissionDeniedError,
  HealthConnectUnsupportedError,
} from './errors';
import {
  HEALTH_CONNECT_RECORD_TYPES,
  healthConnectClient as defaultClient,
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

/**
 * Legacy provider-global SecureStore cursor key (pre-S14). No longer read: a
 * cursor shared by every account on the phone made a second account skip its
 * import (B-317-1). `signOut()` removes it.
 */
export const LAST_SYNC_AT_KEY = 'health_connect_last_sync_at';

/**
 * History import on first connect (no persisted `lastSyncAt`). 30 days matches
 * the history Health Connect lets an app read by default (data older than 30
 * days before the first grant needs the separate history permission) and the
 * Apple Health connector's import window, so both platforms import the same
 * history. Batching in `../ingestBatching.ts` keeps each request small.
 */
export const DEFAULT_BACKFILL_DAYS = 30;

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
  /**
   * Required (S14 round 3): binds the run to the person who authorized this
   * phone; checked before reading, before every request and before saving.
   * Its user must be the scope's user.
   */
  fence: SessionFence;
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
  /** The earliest start and the end of the windows read this run. */
  windowStart: Date;
  windowEnd: Date;
  /** True only when every granted type was read to the end (B-317-2). */
  complete: boolean;
  /** Types whose read failed (progress kept for a retry). */
  failedRecordTypes: HealthConnectRecordType[];
  /** Types whose read stopped at the page bound (resumes next run). */
  truncatedRecordTypes: HealthConnectRecordType[];
}

function assertSupported(): void {
  if (Platform.OS !== 'android') {
    throw new HealthConnectUnsupportedError(Platform.OS);
  }
  assertAndroidHealthConnectEnabled();
}

/**
 * Window start for a type: its progress minus the overlap, or the 30-day
 * import start. Never older than the import window (older data needs the
 * separate Health Connect history permission).
 */
function typeWindowStart(progress: SyncProgress, recordType: string, now: Date): Date {
  const importStart = now.getTime() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60_000;
  const done = progress.completedThrough[recordType];
  const fromProgress = done ? Date.parse(done) - SYNC_OVERLAP_MINUTES * 60_000 : importStart;
  return new Date(Math.max(fromProgress, importStart));
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
 * Run a full Health Connect sync for a scope (account + server connection).
 * The subject user is never sent: the backend derives it from the JWT; the
 * scope's user id only keys local progress.
 *
 * Steps:
 *   1. Platform guard (Android only), initialize the SDK.
 *   2. Read the granted permissions; only when none of our read types is
 *      granted, show the permission UI once. If still NONE granted → throw
 *      HealthConnectPermissionDeniedError.
 *   3. For every granted type: resume a truncated read, or read from its
 *      progress (or the 30-day import start) to now.
 *   4. Normalize → POST in batches (the fence runs before every request).
 *   5. Save progress: completed types advance; truncated types keep a resume
 *      token; failed types keep their old progress.
 *
 * Nothing is saved if the POST fails or the session changed, so the next run
 * re-reads the same windows (ingest is idempotent).
 */
export async function syncHealthConnect(
  scope: OnDeviceScope,
  deps: HealthConnectSyncDeps,
): Promise<HealthConnectSyncResult> {
  assertSupported();

  const client = deps.client ?? defaultClient;
  const ingestApi = deps.ingestApi ?? defaultIngestApi;
  const now = (deps.now ?? (() => new Date()))();
  const fence = deps.fence;
  if (fence.userId !== scope.userId) throw new OnDeviceSessionChangedError();
  await fence.assertCurrent();

  await client.initialize();

  let grantedRecordTypes = grantedReadRecordTypes(await client.getGrantedPermissions());
  if (grantedRecordTypes.length === 0) {
    await client.requestPermission();
    grantedRecordTypes = grantedReadRecordTypes(await client.getGrantedPermissions());
  }
  if (grantedRecordTypes.length === 0) {
    logger.warn('healthConnectSync', 'all read permissions denied', {
      requested: HEALTH_CONNECT_RECORD_TYPES.length,
    });
    throw new HealthConnectPermissionDeniedError([...HEALTH_CONNECT_RECORD_TYPES]);
  }

  // Read the phone only if the same person is still signed in after the
  // (possible) permission screen.
  await fence.assertCurrent();
  const progress = await getSyncProgress(scope);
  const next: SyncProgress = {
    v: 1,
    completedThrough: { ...progress.completedThrough },
    resume: { ...progress.resume },
  };
  const byType: Partial<Record<HealthConnectRecordType, unknown[]>> = {};
  const failedRecordTypes: HealthConnectRecordType[] = [];
  const truncatedRecordTypes: HealthConnectRecordType[] = [];
  let earliest = now.getTime();

  for (const recordType of grantedRecordTypes) {
    const resume = progress.resume[recordType];
    const range = resume
      ? { startTime: resume.startTime, endTime: resume.endTime }
      : { startTime: typeWindowStart(progress, recordType, now).toISOString(), endTime: now.toISOString() };
    earliest = Math.min(earliest, Date.parse(range.startTime));
    try {
      const read = await client.readRecordsPaged(recordType, range, resume?.pageToken);
      byType[recordType] = read.records;
      if (read.nextPageToken) {
        next.resume[recordType] = { ...range, pageToken: read.nextPageToken };
        truncatedRecordTypes.push(recordType);
      } else {
        delete next.resume[recordType];
        next.completedThrough[recordType] = range.endTime;
      }
    } catch (err) {
      // Degrade per type (#50) but never count it as read: keep its progress.
      // A failed RESUME drops the token (it may have expired) so the next run
      // re-reads that type's window from its saved progress.
      byType[recordType] = [];
      failedRecordTypes.push(recordType);
      if (resume) delete next.resume[recordType];
      logger.error('healthConnectSync', 'readRecords failed', {
        recordType,
        resumed: Boolean(resume),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const ctx: NormalizeContext = { connectionId: scope.connectionId };
  const samples: NormalizedSample[] = normalizeAll(ctx, byType);

  const { inserted, skipped } = await ingestApi.ingest(samples, {
    beforeEachRequest: () => fence.assertCurrent(),
  });

  await fence.assertCurrent();
  await setSyncProgress(scope, next);

  const complete = failedRecordTypes.length === 0 && truncatedRecordTypes.length === 0;
  logger.log('healthConnectSync', 'sync pass done', {
    normalizedCount: samples.length,
    inserted,
    skipped,
    grantedRecordTypes: grantedRecordTypes.length,
    failed: failedRecordTypes.length,
    truncated: truncatedRecordTypes.length,
    complete,
  });

  return {
    normalizedCount: samples.length,
    inserted,
    skipped,
    grantedRecordTypes,
    windowStart: new Date(earliest),
    windowEnd: now,
    complete,
    failedRecordTypes,
    truncatedRecordTypes,
  };
}

/** Grouped service surface (handy for mocking from the hook). */
export const healthConnectSyncService = {
  LAST_SYNC_AT_KEY,
  syncHealthConnect,
};

export type HealthConnectSyncService = typeof healthConnectSyncService;
