/**
 * S14 — on-device history import and refresh.
 *
 * The single seam that turns a granted Apple Health / Health Connect
 * permission into data the Health and Sleep views can show:
 *
 *   register the device source  POST /v1/wearables/connections/on-device
 *     -> record LOCAL authorization (this user, this phone, this connection)
 *     -> read + normalize on device (connector sync service)
 *     -> POST /v1/wearables/samples/ingest in request-sized batches
 *
 * Audit A-317-1: only {@link connectOnDevice}, run from the Connect tap after
 * the platform permission step, may start reading this phone's store, and it
 * records a local authorization keyed by user id + source and bound to the
 * connection id. {@link refreshOnDevice} (Health screen open) runs ONLY when
 * that record exists for the CURRENTLY signed-in user and the server still
 * lists the same connection as connected. A remote "connected" row alone
 * never uploads phone data. Every run carries a session fence, checked before
 * each request and before saving progress, so one account's data can never
 * be sent under another account's session. Sign-out removes the records.
 *
 * The first run per account + connection imports the last 30 days; later runs
 * read from per-type progress. Ingest is idempotent on the backend dedup key.
 * The subject user is never sent: the server takes it from the JWT.
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
import {
  getLocalAuthorization,
  recordLocalAuthorization,
  type OnDeviceScope,
  type OnDeviceSource,
} from './onDeviceState';
import { createSessionFence, readSignedInUserId, type SessionFence } from './sessionFence';

export type { OnDeviceSource } from './onDeviceState';

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
  /**
   * Data was read and posted (count may be 0 if the window had none).
   * `complete` is false while any type still has history left to read (a
   * failed or page-bounded read); the next refresh continues it.
   */
  | { kind: 'imported'; source: OnDeviceSource; postedCount: number; complete: boolean }
  /** The server lane is switched off (FEATURE_WEARABLES_INGEST_POST). */
  | { kind: 'disabled'; source: OnDeviceSource }
  /** Refresh only: this user has not tapped Connect on this phone. */
  | { kind: 'not_authorized'; source: OnDeviceSource };

/** Thrown when no account is signed in. */
export class OnDeviceNotSignedInError extends Error {
  constructor() {
    super('No signed-in account for on-device health import.');
    this.name = 'OnDeviceNotSignedInError';
  }
}

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
  readUserId?: () => Promise<string | null>;
  syncHealthKit?: (
    scope: OnDeviceScope,
    fence: SessionFence,
  ) => Promise<{ postedCount: number; complete: boolean }>;
  syncHealthConnect?: (
    scope: OnDeviceScope,
    fence: SessionFence,
  ) => Promise<{ normalizedCount: number; complete: boolean }>;
}

/**
 * Passes per Connect or refresh. A pass that stopped at the Health Connect
 * page bound resumes in the next pass, so a large history finishes in one
 * visit; a pass that posted nothing stops the loop (a failing read would only
 * fail again).
 */
export const MAX_IMPORT_PASSES = 3;

async function runSyncPasses(
  scope: OnDeviceScope,
  fence: SessionFence,
  deps: OnDeviceImportDeps,
): Promise<OnDeviceImportOutcome> {
  let total = 0;
  let last: OnDeviceImportOutcome = { kind: 'imported', source: scope.source, postedCount: 0, complete: false };
  for (let pass = 0; pass < MAX_IMPORT_PASSES; pass += 1) {
    last = await runSync(scope, fence, deps);
    if (last.kind !== 'imported') return last;
    total += last.postedCount;
    if (last.complete || last.postedCount === 0) break;
    await fence.assertCurrent();
  }
  return last.kind === 'imported' ? { ...last, postedCount: total } : last;
}

async function runSync(
  scope: OnDeviceScope,
  fence: SessionFence,
  deps: OnDeviceImportDeps,
): Promise<OnDeviceImportOutcome> {
  const { source } = scope;
  try {
    if (source === 'APPLE_HEALTHKIT') {
      const run =
        deps.syncHealthKit ??
        ((sc: OnDeviceScope, f: SessionFence) =>
          healthKitSyncService.sync({
            scope: sc,
            fence: f,
            sourceTz: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
          }));
      const { postedCount, complete } = await run(scope, fence);
      return { kind: 'imported', source, postedCount, complete };
    }
    const run =
      deps.syncHealthConnect ??
      ((sc: OnDeviceScope, f: SessionFence) => syncHealthConnect(sc, { fence: f }));
    const { normalizedCount, complete } = await run(scope, fence);
    return { kind: 'imported', source, postedCount: normalizedCount, complete };
  } catch (err) {
    if (isIngestDisabledError(err)) return { kind: 'disabled', source };
    throw err;
  }
}

/**
 * Explicit Connect (the person tapped Connect and finished the platform
 * permission step on this phone): register the source, record the local
 * authorization for the signed-in user, then run the first import. Rejects on
 * any failure other than the lane being disabled; progress is kept so the
 * next run re-reads what is missing.
 */
export async function connectOnDevice(
  source: OnDeviceSource,
  deps: OnDeviceImportDeps = {},
): Promise<OnDeviceImportOutcome> {
  const readUserId = deps.readUserId ?? readSignedInUserId;
  const userId = await readUserId();
  if (!userId) throw new OnDeviceNotSignedInError();
  const fence = createSessionFence(userId, readUserId);

  const register =
    deps.register ?? ((s: OnDeviceSource) => wearablesConnectionsApi.registerOnDevice(s));
  let connection: WearableConnection;
  try {
    connection = await register(source);
  } catch (err) {
    if (isIngestDisabledError(err)) return { kind: 'disabled', source };
    throw err;
  }

  const scope: OnDeviceScope = { userId, connectionId: connection.id, source };
  await fence.assertCurrent();
  await recordLocalAuthorization(scope);
  return runSyncPasses(scope, fence, deps);
}

/** Minimal view of a server connection row the refresh check needs. */
export type RemoteConnectionView = Pick<WearableConnection, 'id' | 'provider' | 'status'>;

/**
 * Refresh on Health screen open. Runs ONLY when the signed-in user has a
 * local authorization for this source on this phone AND the server still
 * lists that same connection as connected; otherwise returns
 * `not_authorized` and reads nothing.
 */
export async function refreshOnDevice(
  source: OnDeviceSource,
  remoteConnections: readonly RemoteConnectionView[],
  deps: OnDeviceImportDeps = {},
): Promise<OnDeviceImportOutcome> {
  const readUserId = deps.readUserId ?? readSignedInUserId;
  const userId = await readUserId();
  if (!userId) return { kind: 'not_authorized', source };
  const fence = createSessionFence(userId, readUserId);

  const auth = await getLocalAuthorization(userId, source);
  if (!auth) return { kind: 'not_authorized', source };
  const remote = remoteConnections.find(
    (c) => c.id === auth.connectionId && c.provider === source && c.status === 'connected',
  );
  if (!remote) return { kind: 'not_authorized', source };

  await fence.assertCurrent();
  return runSyncPasses({ userId, connectionId: auth.connectionId, source }, fence, deps);
}
