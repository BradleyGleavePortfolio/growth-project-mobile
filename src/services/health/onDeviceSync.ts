/**
 * S14 — on-device history import and refresh.
 *
 * The single seam that turns a granted Apple Health / Health Connect
 * permission into data the Health and Sleep views can show:
 *
 *   register the device source  POST /v1/wearables/connections/on-device
 *     -> read + normalize on device (connector sync service)
 *     -> POST /v1/wearables/samples/ingest in request-sized batches
 *
 * The first run imports the last 30 days (each connector's
 * DEFAULT_BACKFILL_DAYS); later runs read from the stored cursor. Ingest is
 * idempotent on the backend dedup key, so a repeated or interrupted run never
 * double-counts.
 *
 * The subject user is never sent. Registration and ingest both take the user
 * from the JWT on the server.
 */

import axios from 'axios';
import { Platform } from 'react-native';
import {
  wearablesConnectionsApi,
  type WearableConnection,
  type WearableProvider,
} from '../../api/wearablesConnectionsApi';
import { healthKitSyncService } from './healthkit';
import { syncHealthConnect } from './healthConnect';

/** The device source for the current platform, or null (web, tests). */
export type OnDeviceSource = 'APPLE_HEALTHKIT' | 'HEALTH_CONNECT';

export function deviceSourceForPlatform(): OnDeviceSource | null {
  if (Platform.OS === 'ios') return 'APPLE_HEALTHKIT';
  if (Platform.OS === 'android') return 'HEALTH_CONNECT';
  return null;
}

/**
 * The device source a Connect tap maps to. Samsung Health writes into Health
 * Connect on Android, so both rows import through the Health Connect source.
 */
export function deviceSourceFor(provider: WearableProvider): OnDeviceSource | null {
  if (provider === 'APPLE_HEALTHKIT') return Platform.OS === 'ios' ? 'APPLE_HEALTHKIT' : null;
  if (provider === 'HEALTH_CONNECT' || provider === 'SAMSUNG_HEALTH') {
    return Platform.OS === 'android' ? 'HEALTH_CONNECT' : null;
  }
  return null;
}

export type OnDeviceImportOutcome =
  /** Data was read and posted (count may be 0 if the window had none). */
  | { kind: 'imported'; source: OnDeviceSource; postedCount: number }
  /** The server lane is switched off (FEATURE_WEARABLES_INGEST_POST). */
  | { kind: 'disabled'; source: OnDeviceSource };

/** True for the typed 503 the backend returns while the lane is off. */
export function isIngestDisabledError(err: unknown): boolean {
  if (!axios.isAxiosError(err) || err.response?.status !== 503) return false;
  const data: unknown = err.response?.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { code?: unknown }).code === 'wearables_ingest_disabled'
  );
}

/** Injectable seams (tests). */
export interface OnDeviceImportDeps {
  register?: (source: OnDeviceSource) => Promise<WearableConnection>;
  syncHealthKit?: (connectionId: string) => Promise<{ postedCount: number }>;
  syncHealthConnect?: (connectionId: string) => Promise<{ normalizedCount: number }>;
}

/**
 * Register the device source and run one import/refresh pass. Rejects on any
 * failure other than the lane being disabled, leaving the connector cursor in
 * place so the next run re-reads the same window.
 */
export async function importOnDeviceHistory(
  source: OnDeviceSource,
  deps: OnDeviceImportDeps = {},
): Promise<OnDeviceImportOutcome> {
  const register =
    deps.register ?? ((s: OnDeviceSource) => wearablesConnectionsApi.registerOnDevice(s));
  let connection: WearableConnection;
  try {
    connection = await register(source);
  } catch (err) {
    if (isIngestDisabledError(err)) return { kind: 'disabled', source };
    throw err;
  }

  try {
    if (source === 'APPLE_HEALTHKIT') {
      const run =
        deps.syncHealthKit ??
        ((connectionId: string) =>
          healthKitSyncService.sync({
            connectionId,
            sourceTz: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
          }));
      const { postedCount } = await run(connection.id);
      return { kind: 'imported', source, postedCount };
    }
    const run =
      deps.syncHealthConnect ?? ((connectionId: string) => syncHealthConnect(connectionId));
    const { normalizedCount } = await run(connection.id);
    return { kind: 'imported', source, postedCount: normalizedCount };
  } catch (err) {
    if (isIngestDisabledError(err)) return { kind: 'disabled', source };
    throw err;
  }
}
