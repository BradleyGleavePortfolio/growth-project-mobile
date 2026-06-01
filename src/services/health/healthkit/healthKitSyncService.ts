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
 *  - `lastSyncAt` is persisted in `secureStorage` keyed per provider
 *    ({@link HEALTHKIT_LAST_SYNC_KEY}) so incremental syncs only pull the new
 *    window. It is advanced to the sync's `until` boundary ONLY after a
 *    successful POST. On any failure (auth, read, or POST) it is left
 *    untouched so the next run safely re-pulls the same window (fail-explicit,
 *    UNIFIED lock "Fail-explicit on errors, never silent"; 50-Failures #42).
 *  - First-ever sync (no stored lastSyncAt) backfills a bounded lookback
 *    window ({@link DEFAULT_BACKFILL_DAYS}) rather than all-of-history, to keep
 *    the first payload sane.
 */

import api from '../../api';
import { secureStorage } from '../../secureStorage';
import {
  HEALTHKIT_READ_PERMISSIONS,
  HealthKitReadPermission,
  healthKitClient,
  type HealthKitClient,
} from './healthKitClient';
import {
  normalizeHealthKitResult,
  type NormalizationContext,
  type NormalizedSample,
} from './healthKitNormalizer';

/**
 * `secureStorage` key holding the ISO8601 timestamp of the last *successful*
 * HealthKit sync. Namespaced by provider so other connectors (Health Connect,
 * Samsung Health) keep independent cursors.
 */
export const HEALTHKIT_LAST_SYNC_KEY = 'healthkit_last_sync_at';

/**
 * Backend ingest path for pre-normalized on-device samples.
 *
 * TODO(integration PR / backend HK): the backend route is a STUB — no
 * `POST /v1/wearables/samples/ingest` handler exists on
 * `growth-project-backend@main` yet. The integration PR must implement it to
 * accept `NormalizedSample[]` (bearer-JWT authenticated) and feed the shared
 * `IngestionService`. Until then the client posts against this documented
 * contract path.
 */
export const HEALTHKIT_INGEST_PATH = '/v1/wearables/samples/ingest';

/** Lookback window for the first-ever sync when no cursor is stored. */
export const DEFAULT_BACKFILL_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Inputs needed to attribute and route the sync. */
export interface HealthKitSyncOptions {
  /** Subject client User.id (stamped onto every sample). */
  userId: string;
  /** The wearable connection id this sync ingests through. */
  connectionId: string;
  /** Optional IANA timezone for the device, threaded onto every sample. */
  sourceTz?: string | null;
  /**
   * Override the read-permission set (defaults to the full
   * {@link HEALTHKIT_READ_PERMISSIONS}). Mainly a testing seam.
   */
  permissions?: HealthKitReadPermission[];
  /**
   * Override "now" (the upper bound of the read window and the value persisted
   * as the new cursor). Defaults to the wall clock. Testing seam.
   */
  now?: Date;
}

/** Outcome of a sync pass. */
export interface HealthKitSyncResult {
  /** Number of normalized samples POSTed. */
  postedCount: number;
  /** Inclusive lower bound of the window that was read. */
  since: string;
  /** Exclusive upper bound of the window that was read (the new cursor). */
  until: string;
  /** Whether the cursor was advanced (false when there was nothing to post). */
  cursorAdvanced: boolean;
}

/**
 * The HealthKit sync orchestrator. Stateless aside from the persisted cursor;
 * the client dependency is injected for testability (defaults to the shared
 * singleton).
 */
export class HealthKitSyncService {
  constructor(private readonly client: HealthKitClient = healthKitClient) {}

  /**
   * Read the persisted last-sync cursor, or `null` if none / unreadable.
   */
  async getLastSyncAt(): Promise<Date | null> {
    const raw = await secureStorage.getItem(HEALTHKIT_LAST_SYNC_KEY);
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /**
   * Run one full HealthKit sync pass.
   *
   * Throws {@link HealthKitUnsupportedError} immediately on non-iOS platforms
   * (surfaced from the client's platform guard). Any auth/read/POST failure
   * propagates to the caller WITHOUT advancing the cursor.
   */
  async sync(options: HealthKitSyncOptions): Promise<HealthKitSyncResult> {
    const { userId, connectionId, sourceTz = null } = options;
    const permissions = options.permissions ?? HEALTHKIT_READ_PERMISSIONS;
    const until = options.now ?? new Date();

    // Window lower bound: stored cursor, else a bounded backfill. Throwing off
    // iOS happens inside requestAuth/readSamples (the client guards there).
    const lastSyncAt = await this.getLastSyncAt();
    const since =
      lastSyncAt ?? new Date(until.getTime() - DEFAULT_BACKFILL_DAYS * MS_PER_DAY);

    // 1) Ensure read authorization (presents the consent sheet on first run).
    await this.client.requestAuth(permissions);

    // 2) Read raw samples for the incremental window.
    const raw = await this.client.readSamples({ since, until });

    // 3) Normalize to the canonical wire contract.
    const ctx: NormalizationContext = { userId, connectionId, sourceTz };
    const samples: NormalizedSample[] = normalizeHealthKitResult(raw, ctx);

    const sinceIso = since.toISOString();
    const untilIso = until.toISOString();

    // Nothing to post: do NOT advance the cursor — leaving it lets the next
    // run re-attempt the same (still-empty) window cheaply, and avoids
    // skipping samples that may land late in HealthKit for this window.
    if (samples.length === 0) {
      return {
        postedCount: 0,
        since: sinceIso,
        until: untilIso,
        cursorAdvanced: false,
      };
    }

    // 4) POST pre-normalized samples. Bearer JWT is attached by the shared
    //    axios request interceptor. A rejection here propagates and the
    //    cursor is intentionally NOT advanced (catch-free: we only persist
    //    AFTER a resolved POST).
    await api.post(HEALTHKIT_INGEST_PATH, samples);

    // 5) Persist the cursor ONLY after a successful POST.
    await secureStorage.setItem(HEALTHKIT_LAST_SYNC_KEY, untilIso);

    return {
      postedCount: samples.length,
      since: sinceIso,
      until: untilIso,
      cursorAdvanced: true,
    };
  }
}

/** Shared singleton sync service over the default HealthKit client. */
export const healthKitSyncService = new HealthKitSyncService();
