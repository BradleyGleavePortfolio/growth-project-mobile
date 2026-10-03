/**
 * S14 — local, account-scoped state for the on-device health lane.
 *
 * Two kinds of record, both in AsyncStorage under {@link ON_DEVICE_STATE_PREFIX}
 * (swept by `signOut()` in `services/authActions.ts`, which also runs after
 * account deletion):
 *
 *  1. Local Connect authorization (audit A-317-1). Written ONLY when the
 *     signed-in person taps Connect on THIS phone and the platform permission
 *     step completes. Keyed by user id + device source and bound to the
 *     server connection id. A remote "connected" row is never enough to read
 *     this phone's health store: automatic refresh requires this record for
 *     the current user AND a matching connection id.
 *
 *  2. Sync progress (audit B-317-1 / B-317-2). Keyed by source + user id +
 *     connection id, never provider-global, so a second account (or a
 *     recreated connection) starts its own 30-day import. Holds a per-type
 *     "completed through" instant and, for Health Connect, a per-type resume
 *     page token, so a failed or truncated read is retried instead of being
 *     marked complete.
 *
 * This module has no native imports, so it is safe to load from auth code.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Every key this module writes starts with this prefix. */
export const ON_DEVICE_STATE_PREFIX = 'wearables_on_device:';

/** The on-device sources this lane supports. */
export type OnDeviceSource = 'APPLE_HEALTHKIT' | 'HEALTH_CONNECT';

/** Who and through which server connection a sync runs. */
export interface OnDeviceScope {
  userId: string;
  connectionId: string;
  source: OnDeviceSource;
}

/** Stored proof that the current user tapped Connect on this phone. */
export interface LocalAuthorization {
  v: 1;
  userId: string;
  source: OnDeviceSource;
  connectionId: string;
  grantedAt: string;
}

/** A Health Connect read that stopped at the page bound and can resume. */
export interface ResumePoint {
  /** The window the paged read covers (ISO). */
  startTime: string;
  endTime: string;
  pageToken: string;
}

/** Per-scope sync progress. */
export interface SyncProgress {
  v: 1;
  /** Per data type: everything before this instant (ISO) has been posted. */
  completedThrough: Record<string, string>;
  /** Per data type: a truncated read to resume (Health Connect only). */
  resume: Record<string, ResumePoint>;
}

export function emptyProgress(): SyncProgress {
  return { v: 1, completedThrough: {}, resume: {} };
}

function authKey(userId: string, source: OnDeviceSource): string {
  return `${ON_DEVICE_STATE_PREFIX}auth:${source}:${userId}`;
}

function progressKey(scope: OnDeviceScope): string {
  return `${ON_DEVICE_STATE_PREFIX}progress:${scope.source}:${scope.userId}:${scope.connectionId}`;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

async function readJson(key: string): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/** Record that the current user authorized this phone's source (Connect tap). */
export async function recordLocalAuthorization(
  scope: OnDeviceScope,
  now: Date = new Date(),
): Promise<LocalAuthorization> {
  const record: LocalAuthorization = {
    v: 1,
    userId: scope.userId,
    source: scope.source,
    connectionId: scope.connectionId,
    grantedAt: now.toISOString(),
  };
  await AsyncStorage.setItem(authKey(scope.userId, scope.source), JSON.stringify(record));
  return record;
}

/** The local authorization for this user + source, or null. */
export async function getLocalAuthorization(
  userId: string,
  source: OnDeviceSource,
): Promise<LocalAuthorization | null> {
  const parsed = await readJson(authKey(userId, source));
  if (!isRecord(parsed)) return null;
  if (
    parsed.v !== 1 ||
    parsed.userId !== userId ||
    parsed.source !== source ||
    typeof parsed.connectionId !== 'string' ||
    parsed.connectionId.length === 0 ||
    typeof parsed.grantedAt !== 'string'
  ) {
    return null;
  }
  return {
    v: 1,
    userId,
    source,
    connectionId: parsed.connectionId,
    grantedAt: parsed.grantedAt,
  };
}

/**
 * Remove local authorizations and progress. With a source, only that
 * source's records (all users) are removed (disconnect); without one,
 * everything this module wrote (sign-out sweeps the same prefix).
 */
export async function retireOnDeviceState(source?: OnDeviceSource): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const doomed = keys.filter((k) => {
    if (!k.startsWith(ON_DEVICE_STATE_PREFIX)) return false;
    if (!source) return true;
    return (
      k.startsWith(`${ON_DEVICE_STATE_PREFIX}auth:${source}:`) ||
      k.startsWith(`${ON_DEVICE_STATE_PREFIX}progress:${source}:`)
    );
  });
  if (doomed.length > 0) await AsyncStorage.removeMany(doomed);
}

/** Read the progress for a scope (empty when none or unreadable). */
export async function getSyncProgress(scope: OnDeviceScope): Promise<SyncProgress> {
  const parsed = await readJson(progressKey(scope));
  if (!isRecord(parsed) || parsed.v !== 1) return emptyProgress();
  const completedThrough: Record<string, string> = {};
  if (isRecord(parsed.completedThrough)) {
    for (const [k, v] of Object.entries(parsed.completedThrough)) {
      if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) completedThrough[k] = v;
    }
  }
  const resume: Record<string, ResumePoint> = {};
  if (isRecord(parsed.resume)) {
    for (const [k, v] of Object.entries(parsed.resume)) {
      if (
        isRecord(v) &&
        typeof v.startTime === 'string' &&
        typeof v.endTime === 'string' &&
        typeof v.pageToken === 'string' &&
        v.pageToken.length > 0
      ) {
        resume[k] = { startTime: v.startTime, endTime: v.endTime, pageToken: v.pageToken };
      }
    }
  }
  return { v: 1, completedThrough, resume };
}

/** Persist the progress for a scope. */
export async function setSyncProgress(scope: OnDeviceScope, progress: SyncProgress): Promise<void> {
  await AsyncStorage.setItem(progressKey(scope), JSON.stringify(progress));
}
