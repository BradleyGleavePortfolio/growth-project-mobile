/**
 * FX-871 (agent 169; Sol B4 and Opus B4 on m#871): the space chat outbox. Texts the viewer sent stay here until the
 * server list carries them: sending, waiting (written offline) or failed (Try again reuses the same Idempotency-Key,
 * Delete drops it). The rows are kept on the device per signed-in user (cacheStorage, so a sign-out wipes them), and the
 * outbox runs from the first space chat or Community Home of the session until sign-out: back online, waiting rows go
 * out one at a time, oldest first, whichever page is open. After an app restart they go out once the outbox starts again.
 */
import { useMemo, useSyncExternalStore } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { cacheStorage } from '../../../storage/mmkv';
import { authEvents } from '../../../utils/authEvents';
import { generateIdempotencyKey } from '../../../utils/idempotency';
import { isEffectivelyOnline } from '../../../hooks/useNetworkStatus';
import { spaceChatApi } from './spaceChatApi';

export type PendingState = 'sending' | 'waiting' | 'failed' | 'sent';
export interface PendingRow {
  localId: string; key: string; cohortId: string; body: string; createdAt: string; state: PendingState; serverId?: string;
}

export const SPACE_OUTBOX_PREFIX = 'space_outbox_';
let uid: string | null = null;
let rows: PendingRow[] = [];
let online = false;
// Each sign-in (and sign-out) starts a new generation; a send still out for an earlier one never touches the rows.
let gen = 0;
let running = -1;
let stopNet: (() => void) | null = null;
const subs = new Set<() => void>();
const onSent = new Set<(cohortId: string) => void>();

function set(next: PendingRow[]): void {
  rows = next;
  if (uid) {
    const k = `${SPACE_OUTBOX_PREFIX}${uid}`;
    const keep = rows.filter((r) => r.state !== 'sent');
    void Promise.resolve()
      .then(() => (keep.length ? cacheStorage.set(k, JSON.stringify(keep)) : cacheStorage.delete(k)))
      .catch(() => undefined);
  }
  subs.forEach((fn) => fn());
}
const patch = (localId: string, change: Partial<PendingRow>) =>
  set(rows.map((r) => (r.localId === localId ? { ...r, ...change } : r)));

/** One send at a time, oldest first, so a space reads in the order the texts were written. */
async function flush(): Promise<void> {
  if (running === gen || !online || !uid) return;
  const g = gen;
  running = g;
  try {
    for (;;) {
      const next = rows.filter((r) => r.state === 'waiting').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!next || !online || gen !== g) break;
      patch(next.localId, { state: 'sending' });
      try {
        const sent = await spaceChatApi.send(next.cohortId, next.body, next.key);
        if (gen !== g) break;
        patch(next.localId, { state: 'sent', serverId: sent.id });
        onSent.forEach((fn) => fn(next.cohortId));
      } catch (err) {
        if (gen !== g) break;
        // Lost the connection on the way: it waits for the next reconnect; any answer from the server is a failure.
        const dropped = (err as { kind?: string })?.kind === 'network' && !online;
        patch(next.localId, { state: dropped ? 'waiting' : 'failed' });
      }
    }
  } finally {
    if (running === g) running = -1;
  }
}

export function setSpaceOutboxOnline(next: boolean): void {
  online = next;
  if (next) void flush();
}

function reset(): void {
  uid = null;
  gen += 1;
  set([]);
  void Promise.resolve()
    .then(() => cacheStorage.getAllKeys())
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith(SPACE_OUTBOX_PREFIX)).map((k) => cacheStorage.delete(k))))
    .catch(() => undefined);
}
try {
  authEvents.on('logout', reset);
  authEvents.on('login', reset);
} catch {
  // A test double without named events; a real sign-out still wipes the cache store.
}

const valid = (r: Partial<PendingRow>): r is PendingRow =>
  typeof r?.localId === 'string' && typeof r.key === 'string' && typeof r.cohortId === 'string' &&
  typeof r.body === 'string' && typeof r.createdAt === 'string';

/** Starts (or keeps) the outbox for the signed-in user: reads the kept rows and follows the connection. */
export function startSpaceOutbox(userId: string | null): void {
  if (!userId || uid === userId) return;
  uid = userId;
  gen += 1;
  const g = gen;
  rows = [];
  subs.forEach((fn) => fn());
  void cacheStorage.getStringAsync(`${SPACE_OUTBOX_PREFIX}${userId}`).then((raw) => {
    if (gen !== g || !raw) return;
    const kept = (JSON.parse(raw) as Partial<PendingRow>[]).filter(valid)
      .map((r): PendingRow => (r.state === 'failed' ? r : { ...r, state: 'waiting', serverId: undefined }));
    set([...kept, ...rows.filter((r) => !kept.some((k) => k.localId === r.localId))]);
    void flush();
  }).catch(() => undefined);
  if (!stopNet) {
    stopNet = NetInfo.addEventListener((s) =>
      setSpaceOutboxOnline(isEffectivelyOnline({ isOnline: !!s.isConnected, isInternetReachable: s.isInternetReachable ?? null })));
  }
}

export const spaceOutbox = {
  add(cohortId: string, body: string): void {
    const k = generateIdempotencyKey();
    set([...rows, { localId: k, key: k, cohortId, body, createdAt: new Date().toISOString(), state: 'waiting' }]);
    void flush();
  },
  retry(localId: string): void {
    patch(localId, { state: 'waiting' });
    void flush();
  },
  discard(localId: string): void {
    set(rows.filter((r) => r.localId !== localId));
  },
  /** A sent row leaves once the server list carries it. */
  settle(serverIds: Set<string>): void {
    if (rows.some((r) => r.serverId && serverIds.has(r.serverId))) set(rows.filter((r) => !(r.serverId && serverIds.has(r.serverId))));
  },
  onSent(fn: (cohortId: string) => void): () => void {
    onSent.add(fn);
    return () => { onSent.delete(fn); };
  },
};

const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; };
const snapshot = () => rows;

/** This space's outbox rows, in the order they were written. */
export function useSpaceOutbox(cohortId: string): PendingRow[] {
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  return useMemo(() => all.filter((r) => r.cohortId === cohortId), [all, cohortId]);
}
