/**
 * PR-HK-2.a — Apple HealthKit on-device sync service.
 *
 * Orchestrates one full sync pass for the HealthKit connector:
 *
 *   requestAuth → readSamples(since=lastSyncAt, until=now) → normalize
 *     → POST NormalizedSample[] to the backend ingest endpoint
 *     → persist lastSyncAt (only on success).
 *
 * Design / contract notes:
 *  - ON-DEVICE provider (Agent 2 §3, UNIFIED lock "On-device native modules"):
 *    no OAuth, no server token issued for HealthKit. The bearer JWT for the
 *    ingest POST is the user's normal Supabase session token, which the shared
 *    axios instance (`../../api`) attaches automatically via its request
 *    interceptor — so this service just calls `api.post(...)`.
 *  - Backend ingest endpoint: at authoring time NO ingest route exists on
 *    `growth-project-backend@main` (only oauth/start, oauth/callback and the
 *    GET connection list in `connections.controller.ts`, whose header comment
 *    references a future `POST /v1/wearables/ingest`). Per the HK-1 decision we
 *    target the documented client-side contract
 *    `POST /v1/wearables/samples/ingest` with body `NormalizedSample[]` and
 *    mark the backend endpoint as a STUB to be implemented in the integration
 *    PR (see {@link HEALTHKIT_INGEST_PATH} TODO below).
 *  - S14: progress is stored per account + connection + provider
 *    (`../onDeviceState.ts`), per metric, never provider-global. A metric's
 *    "completed through" instant is advanced to the sync's `until` boundary
 *    ONLY after every batch was posted, and NOT for a metric whose native
 *    read failed (B-317-2). The legacy provider-global
 *    {@link HEALTHKIT_LAST_SYNC_KEY} is no longer read (sign-out removes it). On any failure (auth, read, or POST) it is left
 *    untouched so the next run safely re-pulls the same window (fail-explicit,
 *    UNIFIED lock "Fail-explicit on errors, never silent"; 50-Failures #42).
 *  - First-ever sync (no stored lastSyncAt) backfills a bounded lookback
 *    window ({@link DEFAULT_BACKFILL_DAYS}) rather than all-of-history, to keep
 *    the first payload sane.
 */

import { postIngestBatches, WEARABLES_INGEST_PATH, type PostIngestDeps } from '../ingestBatching';
import {
  getSyncProgress,
  setSyncProgress,
  type OnDeviceScope,
  type SyncProgress,
} from '../onDeviceState';
import { OnDeviceSessionChangedError, type SessionFence } from '../sessionFence';
import {
  HEALTHKIT_READ_PERMISSIONS,
  HealthKitReadPermission,
  healthKitClient,
  type HealthKitClient,
  type HealthKitMetricKey,
} from './healthKitClient';
import {
  normalizeHealthKitResult,
  type NormalizationContext,
  type NormalizedSample,
} from './healthKitNormalizer';

/**
 * Legacy provider-global `secureStorage` cursor key (pre-S14). No longer read:
 * a cursor shared by every account on the phone made a second account skip
 * its 30-day import (B-317-1). `signOut()` removes it.
 */
export const HEALTHKIT_LAST_SYNC_KEY = 'healthkit_last_sync_at';

/**
 * Backend ingest path for pre-normalized on-device samples
 * (`POST /v1/wearables/samples/ingest`, gated server-side by
 * FEATURE_WEARABLES_INGEST_POST). Posting goes through the shared batching in
 * `../ingestBatching.ts`; the body never carries `userId` (S14).
 */
export const HEALTHKIT_INGEST_PATH = WEARABLES_INGEST_PATH;

/** History import window for the first-ever sync of a scope. */
export const DEFAULT_BACKFILL_DAYS = 30;

/**
 * Re-read overlap behind the stored progress. Apple Watch data often reaches
 * the phone's Health store minutes to an hour after it was recorded, with a
 * start time before our last sync; re-reading the last hour picks those
 * samples up. Safe because ingest is idempotent on the backend dedup key.
 */
export const SYNC_OVERLAP_MINUTES = 60;

/** Every metric the HealthKit client reads (progress is tracked per metric). */
export const HEALTHKIT_METRIC_KEYS: readonly HealthKitMetricKey[] = [
  'steps',
  'activeEnergy',
  'restingHeartRate',
  'heartRate',
  'vo2Max',
  'workouts',
  'weight',
  'bodyFat',
  'bloodPressure',
  'sleep',
  'hrv',
  'spo2',
  'respiratoryRate',
  'bodyTemperature',
];

/**
 * Floor a Date to the start of its LOCAL hour. Hourly statistics buckets
 * (steps, active energy) are anchored at the query start, so a floored start
 * keeps bucket boundaries, and the backend dedup key, stable across syncs.
 */
export function floorToLocalHour(d: Date): Date {
  const out = new Date(d.getTime());
  out.setMinutes(0, 0, 0);
  return out;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Inputs needed to attribute and route the sync. */
export interface HealthKitSyncOptions {
  /**
   * Account + server connection this sync runs for (S14). The user id only
   * keys local progress; it is never sent (the server uses the JWT).
   */
  scope: OnDeviceScope;
  /**
   * Required (S14 round 3): binds the run to the person who authorized this
   * phone. Checked before the phone's store is read, before every ingest
   * request and before progress is saved; a sign-out or account switch stops
   * the run. Its user must be the scope's user.
   */
  fence: SessionFence;
  /** Optional IANA timezone for the device, threaded onto every sample. */
  sourceTz?: string | null;
  /**
   * Override the read-permission set (defaults to the full
   * {@link HEALTHKIT_READ_PERMISSIONS}). Mainly a testing seam.
   */
  permissions?: HealthKitReadPermission[];
  /**
   * Override "now" (the upper bound of the read window and the value persisted
   * as the new progress). Defaults to the wall clock. Testing seam.
   */
  now?: Date;
  /** Testing seam for the batched POST (default: shared axios instance). */
  ingestDeps?: PostIngestDeps;
}

/** Outcome of a sync pass. */
export interface HealthKitSyncResult {
  /** Number of normalized samples POSTed. */
  postedCount: number;
  /** Inclusive lower bound of the window that was read. */
  since: string;
  /** Exclusive upper bound of the window that was read. */
  until: string;
  /** Whether progress was advanced (false when there was nothing to post). */
  cursorAdvanced: boolean;
  /** True only when every metric read succeeded (B-317-2). */
  complete: boolean;
  /** Metrics whose read failed; their progress was kept for a retry. */
  failedMetrics: HealthKitMetricKey[];
}

/**
 * Window start for a scope: the earliest per-metric progress minus the
 * overlap, or the 30-day import start for any metric not yet imported. Never
 * older than the import window.
 */
function windowStart(progress: SyncProgress, until: Date): Date {
  const importStart = until.getTime() - DEFAULT_BACKFILL_DAYS * MS_PER_DAY;
  let earliest = until.getTime();
  for (const key of HEALTHKIT_METRIC_KEYS) {
    const done = progress.completedThrough[key];
    const t = done ? Date.parse(done) - SYNC_OVERLAP_MINUTES * 60_000 : importStart;
    earliest = Math.min(earliest, t);
  }
  return floorToLocalHour(new Date(Math.max(earliest, importStart)));
}

/**
 * The HealthKit sync orchestrator. Stateless aside from the persisted
 * progress; the client dependency is injected for testability (defaults to
 * the shared singleton).
 */
export class HealthKitSyncService {
  constructor(private readonly client: HealthKitClient = healthKitClient) {}

  /**
   * Run one full HealthKit sync pass for a scope.
   *
   * Throws {@link HealthKitUnsupportedError} immediately on non-iOS platforms
   * (surfaced from the client's platform guard). Any auth/POST failure, or a
   * session change, propagates WITHOUT advancing progress.
   */
  async sync(options: HealthKitSyncOptions): Promise<HealthKitSyncResult> {
    const { scope, fence, sourceTz = null } = options;
    const permissions = options.permissions ?? HEALTHKIT_READ_PERMISSIONS;
    const until = options.now ?? new Date();

    if (fence.userId !== scope.userId) throw new OnDeviceSessionChangedError();
    await fence.assertCurrent();

    const progress = await getSyncProgress(scope);
    const since = windowStart(progress, until);

    // 1) Ensure read authorization (presents the consent sheet on first run).
    fence.throwIfStopped();
    await this.client.requestAuth(permissions);

    // 2) Read raw samples for the window, only if the same person is still
    //    signed in after the (possible) permission sheet. The synchronous
    //    check runs immediately before the native queries start (S-WEAR-3,
    //    Sol B-317-7); every metric query starts in that same tick, so no
    //    new read can start after sign-out begins. Results that arrive after
    //    a stop are dropped, never normalized or sent.
    await fence.assertCurrent();
    fence.throwIfStopped();
    const raw = await this.client.readSamples({ since, until });
    fence.throwIfStopped();
    const failedMetrics = [...(raw.failed ?? [])];

    // 3) Normalize to the canonical wire contract.
    const ctx: NormalizationContext = { connectionId: scope.connectionId, sourceTz };
    const samples: NormalizedSample[] = normalizeHealthKitResult(raw, ctx);

    const sinceIso = since.toISOString();
    const untilIso = until.toISOString();
    const complete = failedMetrics.length === 0;

    // Nothing to post: do NOT advance progress — the next run re-attempts the
    // same (still-empty) window cheaply and picks up late samples.
    if (samples.length === 0) {
      return {
        postedCount: 0,
        since: sinceIso,
        until: untilIso,
        cursorAdvanced: false,
        complete,
        failedMetrics,
      };
    }

    // 4) POST in request-sized batches. The fence runs before every request
    //    so a sign-out or account switch stops the upload.
    await postIngestBatches(samples, {
      ...options.ingestDeps,
      beforeEachRequest: async () => {
        await fence.assertCurrent();
        if (options.ingestDeps?.beforeEachRequest) await options.ingestDeps.beforeEachRequest();
      },
    });

    // 5) Persist progress ONLY after every batch resolved, and only for the
    //    metrics that were actually read.
    await fence.assertCurrent();
    const next: SyncProgress = {
      v: 1,
      completedThrough: { ...progress.completedThrough },
      resume: {},
    };
    for (const key of HEALTHKIT_METRIC_KEYS) {
      if (!failedMetrics.includes(key)) next.completedThrough[key] = untilIso;
    }
    await setSyncProgress(scope, next);

    return {
      postedCount: samples.length,
      since: sinceIso,
      until: untilIso,
      cursorAdvanced: true,
      complete,
      failedMetrics,
    };
  }
}

/** Shared singleton sync service over the default HealthKit client. */
export const healthKitSyncService = new HealthKitSyncService();
