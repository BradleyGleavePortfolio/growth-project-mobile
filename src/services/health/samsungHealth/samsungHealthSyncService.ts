/**
 * PR-HK-2.c — `samsungHealthSyncService`
 *
 * Orchestrates the on-device Samsung Health sync:
 *   1. PLATFORM GUARD — Android only (throws {@link SamsungHealthUnsupportedError}).
 *   2. Initialize the Health Connect bridge Samsung writes into; if it is not
 *      installed, degrade gracefully (no-op result, status reported) rather
 *      than crash (UNIFIED_BUILD_PLAN §0; 50-Failures #50).
 *   3. Read each granted, Samsung-eligible record type since `lastSyncAt`
 *      (falling back to a 30-day backfill on first run), filtered to
 *      Samsung-origin records by {@link samsungHealthClient}.
 *   4. Normalize to canonical {@link NormalizedSample}s tagged
 *      `provider: SAMSUNG_HEALTH`.
 *   5. POST the batch to `POST /v1/wearables/samples/ingest` (one batched
 *      request — no N+1, 50-Failures #21).
 *   6. Persist `lastSyncAt` under `wearable:samsung-health:lastSyncAt` ONLY on
 *      a successful ingest, so a failed sync re-reads the same window next run.
 *
 * This service holds the orchestration; the read seam (client) and the mapping
 * seam (normalizer) are separate and independently testable.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import api from '../../api';
import { logger } from '../../../utils/logger';
import { samsungHealthClient } from './samsungHealthClient';
import {
  normalizeRecords,
  type NormalizedSample,
} from './samsungHealthNormalizer';
import {
  SamsungHealthPermissionDeniedError,
  SamsungHealthUnavailableError,
  SamsungHealthUnsupportedError,
} from './errors';
import type { SamsungReadableRecordType } from './types';

const LOG_CONTEXT = 'samsungHealthSyncService';

/** AsyncStorage key for the last successful sync timestamp (ISO 8601). */
export const SAMSUNG_LAST_SYNC_KEY = 'wearable:samsung-health:lastSyncAt';

/** Backend ingest endpoint (relative to the `/api` base URL). */
export const SAMSUNG_INGEST_PATH = '/v1/wearables/samples/ingest';

/** Default first-run backfill window: 30 days (AGENT_1 §3.4 "last 30 days"). */
export const DEFAULT_BACKFILL_DAYS = 30;

/** Outcome of a sync run. */
export interface SamsungSyncResult {
  /** Whether any samples were read + ingested. */
  ingested: boolean;
  /** Count of canonical samples POSTed. */
  sampleCount: number;
  /** Record types actually read (granted + Samsung-eligible). */
  recordTypesRead: SamsungReadableRecordType[];
  /** The window start used for this run (ISO 8601). */
  windowStart: string;
  /** The window end used for this run (ISO 8601). */
  windowEnd: string;
  /** New lastSyncAt persisted (ISO 8601), or null if nothing was persisted. */
  lastSyncAt: string | null;
}

// ─── lastSyncAt persistence ──────────────────────────────────────────────────

/** Read the persisted lastSyncAt, or null if never synced / unreadable. */
export async function getLastSyncAt(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(SAMSUNG_LAST_SYNC_KEY);
    if (!raw) return null;
    // Validate it is a parseable ISO timestamp before trusting it.
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? raw : null;
  } catch (err) {
    logger.warn(LOG_CONTEXT, 'getLastSyncAt read failed', err);
    return null;
  }
}

/** Persist a new lastSyncAt (ISO 8601). */
export async function setLastSyncAt(iso: string): Promise<void> {
  await AsyncStorage.setItem(SAMSUNG_LAST_SYNC_KEY, iso);
}

/** Clear the persisted lastSyncAt (e.g. on disconnect). */
export async function clearLastSyncAt(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SAMSUNG_LAST_SYNC_KEY);
  } catch (err) {
    logger.warn(LOG_CONTEXT, 'clearLastSyncAt failed', err);
  }
}

// ─── ingest ──────────────────────────────────────────────────────────────────

async function postSamples(samples: NormalizedSample[]): Promise<void> {
  // Single batched request — never one POST per sample (50-Failures #21).
  await api.post(SAMSUNG_INGEST_PATH, {
    provider: 'SAMSUNG_HEALTH',
    samples,
  });
}

// ─── sync ─────────────────────────────────────────────────────────────────────

/**
 * Run one Samsung Health sync cycle.
 *
 * @param now injectable clock (defaults to `Date`) for deterministic tests.
 */
export async function sync(
  now: () => Date = () => new Date(),
): Promise<SamsungSyncResult> {
  if (Platform.OS !== 'android') {
    throw new SamsungHealthUnsupportedError(Platform.OS);
  }

  const end = now();
  const windowEnd = end.toISOString();

  const last = await getLastSyncAt();
  const start = last
    ? new Date(last)
    : new Date(end.getTime() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  const windowStart = start.toISOString();

  // Initialize the bridge; a missing Health Connect install degrades to a
  // no-op result rather than throwing up the stack (graceful degrade).
  try {
    await samsungHealthClient.initialize();
  } catch (err) {
    if (err instanceof SamsungHealthUnavailableError) {
      logger.warn(LOG_CONTEXT, 'Health Connect unavailable; skipping sync', err);
      return {
        ingested: false,
        sampleCount: 0,
        recordTypesRead: [],
        windowStart,
        windowEnd,
        lastSyncAt: last,
      };
    }
    throw err;
  }

  // Only read the record types the user actually granted.
  const grantedTypes = await samsungHealthClient.getGrantedRecordTypes();
  if (grantedTypes.length === 0) {
    // Permission-denied path: nothing readable. Surface explicitly so the
    // connection status can reflect it; do NOT advance lastSyncAt.
    throw new SamsungHealthPermissionDeniedError([]);
  }

  const timeRangeFilter = {
    operator: 'between' as const,
    startTime: windowStart,
    endTime: windowEnd,
  };

  const allSamples: NormalizedSample[] = [];
  for (const recordType of grantedTypes) {
    const records = await samsungHealthClient.readRecords(recordType, {
      timeRangeFilter,
    });
    // Normalizer re-asserts Samsung-origin (defence in depth) and tags
    // provider: SAMSUNG_HEALTH.
    allSamples.push(...normalizeRecords(records));
  }

  if (allSamples.length > 0) {
    await postSamples(allSamples);
  }

  // Persist lastSyncAt ONLY after a successful ingest (or a clean empty read),
  // so a transient failure above re-reads the same window next run.
  await setLastSyncAt(windowEnd);

  logger.log(
    LOG_CONTEXT,
    `sync complete: ${allSamples.length} samples from ${grantedTypes.length} ` +
      `record types; lastSyncAt=${windowEnd}`,
  );

  return {
    ingested: allSamples.length > 0,
    sampleCount: allSamples.length,
    recordTypesRead: grantedTypes,
    windowStart,
    windowEnd,
    lastSyncAt: windowEnd,
  };
}

export const samsungHealthSyncService = {
  sync,
  getLastSyncAt,
  setLastSyncAt,
  clearLastSyncAt,
  SAMSUNG_LAST_SYNC_KEY,
  SAMSUNG_INGEST_PATH,
  DEFAULT_BACKFILL_DAYS,
};

export type SamsungHealthSyncService = typeof samsungHealthSyncService;
