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
 * Every stored authorization is also bound to this phone's consent session
 * ({@link ON_DEVICE_CONSENT_SESSION_KEY}); sign-out replaces that session
 * before it removes anything, so a grant left on disk by a failed removal
 * never authorizes again, in the same run or after a restart (Sol B-362-8).
 * It is bound as well to the consent authority in SecureStore
 * ({@link ON_DEVICE_CONSENT_AUTHORITY_KEY}), a different store that sign-out
 * revokes first, so even an outage of every AsyncStorage write at sign-out
 * leaves the old grant void after a restart (Sol B-369-1).
 *
 * Its only native import is expo-secure-store, which auth code already loads.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { OnDeviceSessionChangedError } from './sessionFence';

/** Every key this module writes starts with this prefix. */
export const ON_DEVICE_STATE_PREFIX = 'wearables_on_device:';

/**
 * Sol B-362-8: the consent session every stored grant is bound to. Sign-out
 * writes a new value first, so every grant already on disk stops matching.
 * Outside {@link ON_DEVICE_STATE_PREFIX} so the prefix sweep never removes
 * it; an absent or unreadable value authorizes nothing (fail closed), and the
 * next Connect starts a new session. Holds a random nonce, nothing personal.
 */
export const ON_DEVICE_CONSENT_SESSION_KEY = 'wearables_on_device_session';

/**
 * Sol B-369-1: the consent authority every stored grant is also bound to. It
 * lives in SecureStore (Keychain / Keystore), not in the AsyncStorage backing
 * store, so revoking it does not share a failure with the removals that
 * follow. Sign-out deletes it before any AsyncStorage write (a fresh random
 * value replaces it when the delete fails); an absent or unreadable value
 * authorizes nothing, and the next Connect starts a new one. Holds a random
 * nonce, nothing personal.
 */
export const ON_DEVICE_CONSENT_AUTHORITY_KEY = 'wearables_on_device_authority';

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

function newConsentSession(): string {
  return `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}`;
}

/** The stored consent session, or null when absent (a rejection propagates). */
async function readConsentSession(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(ON_DEVICE_CONSENT_SESSION_KEY);
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/** The consent authority in SecureStore, or null when absent (a rejection propagates). */
async function readConsentAuthority(): Promise<string | null> {
  const raw = await SecureStore.getItemAsync(ON_DEVICE_CONSENT_AUTHORITY_KEY);
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/** Void every grant through the SecureStore authority. Never rejects. */
async function revokeConsentAuthority(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(ON_DEVICE_CONSENT_AUTHORITY_KEY);
  } catch {
    // A new value voids every grant as well.
    await SecureStore.setItemAsync(ON_DEVICE_CONSENT_AUTHORITY_KEY, newConsentSession()).catch(
      () => undefined,
    );
  }
}

async function readJson(key: string): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/**
 * Sol B-362-2: every local authorization written in this app run gets the
 * next sequence number, set synchronously when the write starts. A Disconnect
 * captures the sequence when it starts, and its retirement never removes a
 * grant (or that person's progress) written after that point.
 */
let authWriteSeq = 0;
const authWrittenAt = new Map<string, number>();
/** C-362-13 remainder: the sequence of the latest grant per key that reached disk. */
const authCommittedAt = new Map<string, number>();

/**
 * Sol B-362-2 / Opus C-362-11: Android AsyncStorage runs each native call on
 * its own IO coroutine, so JS call order is not commit order. Every write and
 * removal in this module runs through this one chain: each native operation
 * starts only after the previous one settled (resolved or rejected), and a
 * rejection never stalls the operations behind it.
 */
let storageTail: Promise<void> = Promise.resolve();

function serialStorage<T>(op: () => Promise<T>): Promise<T> {
  const run = storageTail.then(op);
  storageTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Sol B-362-7: moves when sign-out starts; a write queued before it never runs. */
let signOutEpoch = 0;
/** No grant written at or before this sequence is honoured after a sign-out. */
let signedOutThroughSeq = 0;

/**
 * Run `op` in the chain unless a sign-out started since the call. Sol B-369-2:
 * `op` gets `current`, which throws once a sign-out has started; a write that
 * awaits more than one native step calls it after every await and right
 * before every write, so a write already running when sign-out starts never
 * creates consent state after the immediate authority revocation.
 */
function serialWrite(op: (current: () => void) => Promise<void>): Promise<void> {
  const epoch = signOutEpoch;
  const current = (): void => {
    if (epoch !== signOutEpoch) throw new OnDeviceSessionChangedError();
  };
  return serialStorage(() => {
    current();
    return op(current);
  });
}

/** The local authorization write sequence now (capture it before any await). */
export function localAuthorizationSeq(): number {
  return authWriteSeq;
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
  const key = authKey(scope.userId, scope.source);
  authWriteSeq += 1; // before the await: a retirement already running sees it (Sol B-362-2)
  const seq = authWriteSeq;
  authWrittenAt.set(key, seq);
  try {
    await serialWrite(async (current) => {
      // Sol B-362-8: bind the grant to the current consent session (start one
      // when none is stored). A sign-out that starts meanwhile is queued
      // behind this write and replaces that session, so the grant stays void.
      let session = await readConsentSession();
      current();
      if (session == null) {
        session = newConsentSession();
        await AsyncStorage.setItem(ON_DEVICE_CONSENT_SESSION_KEY, session);
        current();
      }
      // Sol B-369-1: and to the SecureStore authority (same rule).
      let authority = await readConsentAuthority();
      current();
      if (authority == null) {
        authority = newConsentSession();
        await SecureStore.setItemAsync(ON_DEVICE_CONSENT_AUTHORITY_KEY, authority);
        // Sol B-369-2: an authority created while sign-out began binds no grant.
        current();
      }
      // Sol B-369-2: no await between this check and the grant write, so the
      // grant is bound only to an authority sign-out has not yet revoked.
      await AsyncStorage.setItem(key, JSON.stringify({ ...record, session, authority }));
      authCommittedAt.set(key, seq);
    });
  } catch (err) {
    // Opus C-362-13 (and its remainder): a grant that failed or was dropped
    // never counts as newer; the latest grant that reached disk does.
    if (authWrittenAt.get(key) === seq) {
      const committed = authCommittedAt.get(key);
      if (committed === undefined) authWrittenAt.delete(key);
      else authWrittenAt.set(key, committed);
    }
    throw err;
  }
  return record;
}

/** The local authorization for this user + source, or null. */
export async function getLocalAuthorization(
  userId: string,
  source: OnDeviceSource,
): Promise<LocalAuthorization | null> {
  await storageTail; // every write already queued has settled
  const epoch = signOutEpoch;
  const key = authKey(userId, source);
  if (signOutEpoch > 0 && (authWrittenAt.get(key) ?? 0) <= signedOutThroughSeq) return null;
  const parsed = await readJson(key);
  if (!isRecord(parsed)) return null;
  if (
    parsed.v !== 1 ||
    parsed.userId !== userId ||
    parsed.source !== source ||
    typeof parsed.connectionId !== 'string' ||
    parsed.connectionId.length === 0 ||
    typeof parsed.grantedAt !== 'string' ||
    typeof parsed.session !== 'string' ||
    parsed.session.length === 0 ||
    typeof parsed.authority !== 'string' ||
    parsed.authority.length === 0
  ) {
    return null;
  }
  // Sol B-362-8: a grant from an earlier consent session (a sign-out happened
  // since, even in an earlier app run) or an unreadable session is no grant.
  // Sol B-369-1: the same for the SecureStore authority.
  let session: string | null;
  let authority: string | null;
  try {
    session = await readConsentSession();
    authority = await readConsentAuthority();
  } catch {
    return null;
  }
  if (session !== parsed.session || authority !== parsed.authority) return null;
  if (epoch !== signOutEpoch) return null; // a sign-out started during the reads
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
 * everything this module wrote, the consent session included.
 */
export async function retireOnDeviceState(source?: OnDeviceSource): Promise<void> {
  await storageTail;
  if (!source) await serialStorage(revokeConsentAuthority);
  const keys = await AsyncStorage.getAllKeys();
  const doomed = keys.filter((k) => {
    if (!source && k === ON_DEVICE_CONSENT_SESSION_KEY) return true; // voids every grant too
    if (!k.startsWith(ON_DEVICE_STATE_PREFIX)) return false;
    if (!source) return true;
    return (
      k.startsWith(`${ON_DEVICE_STATE_PREFIX}auth:${source}:`) ||
      k.startsWith(`${ON_DEVICE_STATE_PREFIX}progress:${source}:`)
    );
  });
  if (doomed.length > 0) await serialStorage(() => AsyncStorage.removeMany(doomed));
}

/**
 * Sign-out (Sol B-362-7). Synchronously drops every queued write and voids
 * every grant written so far in this run, and at once revokes the SecureStore
 * authority (Sol B-369-1: a different store, so an AsyncStorage outage, or an
 * app exit before the chain below runs, cannot keep a grant valid). Then, in
 * the same chain, it waits for the native operation in flight, revokes the
 * authority again (a grant write in flight may have started a new one),
 * replaces the consent session before any removal (Sol B-362-8: when the new
 * value cannot be written the stored one is removed, which also voids every
 * grant) and removes every key under the prefix.
 * Never rejects: sign-out always completes.
 */
export function retireOnDeviceStateAtSignOut(): Promise<void> {
  signOutEpoch += 1;
  signedOutThroughSeq = authWriteSeq;
  const revoked = revokeConsentAuthority();
  return serialStorage(async () => {
    await revoked;
    await revokeConsentAuthority();
    const keys = await AsyncStorage.getAllKeys().catch(() => null);
    // Before any removal and whether or not enumeration worked.
    try {
      await AsyncStorage.setItem(ON_DEVICE_CONSENT_SESSION_KEY, newConsentSession());
    } catch {
      await AsyncStorage.removeItem(ON_DEVICE_CONSENT_SESSION_KEY).catch(() => undefined);
    }
    const doomed = (keys ?? []).filter((k) => k.startsWith(ON_DEVICE_STATE_PREFIX));
    if (doomed.length > 0) await AsyncStorage.removeMany(doomed);
  }).catch(() => undefined);
}

/**
 * Disconnect cleanup for `source` (Sol B-362-2): removes `userId`'s local
 * authorization and progress, never another account's; with `userId` null
 * (no readable session), every account's on this phone. `grantedAt` is the
 * authorization seen when the disconnect started (null for none): when a
 * different one is stored now, nothing is removed. `since` is
 * {@link localAuthorizationSeq} at that start: a grant written after it, and
 * that person's progress, are kept. Enumeration waits for every write already
 * queued; the sequence check and the queueing of the removal run with no await
 * between them, and the queue starts a later Connect's native write only after
 * this removal settled, so an older Disconnect never removes a newer Connect.
 */
export async function retireOnDeviceSource(
  userId: string | null,
  source: OnDeviceSource,
  grantedAt: string | null,
  since: number = authWriteSeq,
): Promise<void> {
  await storageTail;
  if (userId != null) {
    const current = await getLocalAuthorization(userId, source);
    if ((current?.grantedAt ?? null) !== grantedAt) return;
  }
  const keys = await AsyncStorage.getAllKeys();
  const authPrefix = `${ON_DEVICE_STATE_PREFIX}auth:${source}:`;
  const progressPrefix = `${ON_DEVICE_STATE_PREFIX}progress:${source}:`;
  const ownerOf = (k: string): string | null => {
    if (k.startsWith(authPrefix)) return k.slice(authPrefix.length);
    if (!k.startsWith(progressPrefix)) return null;
    const rest = k.slice(progressPrefix.length);
    const cut = rest.lastIndexOf(':');
    return cut > 0 ? rest.slice(0, cut) : null;
  };
  const doomed = keys.filter((k) => {
    const owner = ownerOf(k);
    if (owner == null || (userId != null && owner !== userId)) return false;
    return (authWrittenAt.get(authKey(owner, source)) ?? 0) <= since;
  });
  if (doomed.length > 0) await serialStorage(() => AsyncStorage.removeMany(doomed));
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
  const value = JSON.stringify(progress);
  await serialWrite(() => AsyncStorage.setItem(progressKey(scope), value));
}
