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
 *    (`../onDeviceState.ts`), per metric, never provider-global. H8
 *    (C-360-2): the window is read oldest first in day-sized pieces; after
 *    each piece is posted, every metric read without failure this run is
 *    saved as completed through that piece's end, so an interrupted import
 *    resumes after the last saved piece. A metric whose native read failed
 *    keeps its saved progress for the rest of the run (B-317-2). The legacy
 *    provider-global
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
import { LATE_DATA_LOOKBACK_MINUTES } from '../syncWindows';
import {
  HEALTHKIT_READ_PERMISSIONS,
  HealthKitReadPermission,
  healthKitClient,
  type HealthKitClient,
  type HealthKitMetricKey,
  type HealthKitReadResult,
  type HealthKitSample,
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
 * Re-read behind the stored progress. Apple Watch data reaches the phone's
 * Health store minutes to hours after it was recorded (a watch out of range,
 * a partner app that syncs on its own schedule), with a start time before
 * the last sync. H8 (C-360-1): was one hour; now one day, see
 * `../syncWindows.ts` for the bound and why re-reading never double-counts.
 */
export const SYNC_OVERLAP_MINUTES = LATE_DATA_LOOKBACK_MINUTES;

/**
 * H8 (C-360-1): how long an hourly steps or active-energy sum waits after its
 * hour ends before it is posted. The backend keeps the first value posted for
 * an hour and never replaces it, so an hour posted before a watch or partner
 * app wrote its share would stay short for good. Data reaching Apple Health
 * within this long of the hour's end is counted; the hour shows up in the app
 * this much later. Every other metric posts as soon as it is read.
 */
export const CUMULATIVE_SETTLE_MINUTES = 120;

/** The hourly-sum metrics that wait {@link CUMULATIVE_SETTLE_MINUTES}. */
export const CUMULATIVE_METRIC_KEYS: readonly HealthKitMetricKey[] = ['steps', 'activeEnergy'];

/**
 * H8 (C-360-2): length of one import piece. A 30-day import is read, posted
 * and saved one day at a time, oldest first.
 */
export const IMPORT_PIECE_HOURS = 24;

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

/**
 * End of the import piece starting at `start` (a local hour boundary): the
 * local hour boundary one piece later, never past `until`. Hourly buckets are
 * anchored at each piece's start, so every piece keeps local-hour buckets.
 */
function pieceEnd(start: Date, until: Date): Date {
  const next = floorToLocalHour(new Date(start.getTime() + IMPORT_PIECE_HOURS * 60 * 60_000));
  const end = next.getTime() > start.getTime() ? next : new Date(start.getTime() + IMPORT_PIECE_HOURS * 60 * 60_000);
  return end.getTime() < until.getTime() ? end : until;
}

/** Keep only hourly sums whose hour ended at or before `settledThrough`. */
function settledOnly(
  buckets: HealthKitSample[] | undefined,
  settledThrough: number,
): HealthKitSample[] | undefined {
  return buckets?.filter((b) => {
    const end = Date.parse(b.endDate);
    return Number.isFinite(end) && end <= settledThrough;
  });
}

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
  /** Inclusive lower bound of the window that was read (all pieces). */
  since: string;
  /** Exclusive upper bound of the window that was read (all pieces). */
  until: string;
  /** Whether progress was saved at least once (false when nothing was posted). */
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
   * (surfaced from the client's platform guard). Any auth/read/POST failure,
   * or a session change, propagates without saving the piece in hand; pieces
   * saved before it stay saved (H8, C-360-2), so the next run resumes there.
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

    const ctx: NormalizationContext = { connectionId: scope.connectionId, sourceTz };
    // Hourly sums are posted only once settled (CUMULATIVE_SETTLE_MINUTES).
    const settledThrough = floorToLocalHour(
      new Date(until.getTime() - CUMULATIVE_SETTLE_MINUTES * 60_000),
    ).getTime();
    const next: SyncProgress = {
      v: 1,
      completedThrough: { ...progress.completedThrough },
      resume: {},
    };
    const failed = new Set<HealthKitMetricKey>();
    let postedCount = 0;
    let cursorAdvanced = false;
    let savedThrough = since.getTime();
    // 5) Save every metric read without failure this run as complete through
    //    `through`, never moving one back; hourly sums only through the
    //    settled hour. Only after the fence passed (same person signed in).
    const save = async (through: number): Promise<void> => {
      await fence.assertCurrent();
      for (const key of HEALTHKIT_METRIC_KEYS) {
        if (failed.has(key)) continue;
        const t = CUMULATIVE_METRIC_KEYS.includes(key) ? Math.min(through, settledThrough) : through;
        const saved = next.completedThrough[key] ? Date.parse(next.completedThrough[key]) : -Infinity;
        if (t > saved) next.completedThrough[key] = new Date(t).toISOString();
      }
      await setSyncProgress(scope, next);
      savedThrough = through;
      cursorAdvanced = true;
    };

    // 2) Read the window oldest first, one piece at a time (H8, C-360-2).
    //    Each piece is read only if the same person is still signed in
    //    (after the possible permission sheet, then after every save). The
    //    synchronous check runs immediately before the native queries start
    //    (S-WEAR-3, Sol B-317-7); every metric query of a piece starts in
    //    that same tick, so no new read can start after sign-out begins.
    //    Results that arrive after a stop are dropped, never normalized or
    //    sent.
    for (let start = since; start.getTime() < until.getTime(); ) {
      const end = pieceEnd(start, until);
      await fence.assertCurrent();
      fence.throwIfStopped();
      const raw: HealthKitReadResult = await this.client.readSamples({ since: start, until: end });
      fence.throwIfStopped();
      for (const key of raw.failed ?? []) failed.add(key);

      // 3) Normalize to the canonical wire contract (unsettled hours wait).
      const samples: NormalizedSample[] = normalizeHealthKitResult(
        {
          ...raw,
          steps: settledOnly(raw.steps, settledThrough),
          activeEnergy: settledOnly(raw.activeEnergy, settledThrough),
        },
        ctx,
      );

      // A piece with nothing to post saves nothing by itself: the next piece
      // that posts saves through its own end, the end of the run saves the
      // empty pieces after the last one that posted, and a run that posts
      // nothing re-reads the same (still empty) window next time.
      if (samples.length > 0) {
        // 4) POST in request-sized batches. The fence runs before every
        //    request so a sign-out or account switch stops the upload.
        await postIngestBatches(samples, {
          ...options.ingestDeps,
          beforeEachRequest: async () => {
            await fence.assertCurrent();
            if (options.ingestDeps?.beforeEachRequest) await options.ingestDeps.beforeEachRequest();
          },
        });

        // Saved only after every batch of this piece resolved.
        await save(end.getTime());
        postedCount += samples.length;
      }
      start = end;
    }
    if (cursorAdvanced && savedThrough < until.getTime()) await save(until.getTime());

    const failedMetrics = HEALTHKIT_METRIC_KEYS.filter((key) => failed.has(key));
    return {
      postedCount,
      since: since.toISOString(),
      until: until.toISOString(),
      cursorAdvanced,
      complete: failedMetrics.length === 0,
      failedMetrics,
    };
  }
}

/** Shared singleton sync service over the default HealthKit client. */
export const healthKitSyncService = new HealthKitSyncService();
