// React Query client configuration.
//
// We picked tanstack/react-query as the data layer for the API-first migration
// (Fix #2) for three reasons:
//
//   1. Caching + automatic background revalidation give us the "feels native"
//      offline experience the audit asked for without us hand-rolling a
//      sync engine. A user opening their Habits screen sees the last cached
//      list immediately while a fresh fetch runs in the background.
//
//   2. Mutations + automatic invalidation mean a coach posting a new nudge
//      and a client opening their Notifications screen see consistent state
//      with one line of `queryClient.invalidateQueries`. Previously every
//      screen wrote to its own SQLite table and there was no way to keep
//      two surfaces in sync.
//
//   3. Centralized retry policy. Network blips on a phone are normal; we
//      retry idempotent reads twice with exponential backoff and no retry
//      on mutations (the api.ts interceptor already coalesces 401s and
//      handles refresh).
//
// The defaults below intentionally err toward fewer network calls because
// the user base is mobile and metered. Screens that need always-fresh data
// can opt in per-query with `refetchOnWindowFocus: true` and shorter
// staleTime — see HabitsScreen for an example.

import { QueryClient, hydrate } from '@tanstack/react-query';
import type { Query } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { persistQueryClientSubscribe } from '@tanstack/react-query-persist-client';
import type { PersistedClient } from '@tanstack/react-query-persist-client';
import AsyncStorage from '@react-native-async-storage/async-storage';

function getHttpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 30s is the sweet spot for "fresh enough that opening the same screen
      // twice in 30s doesn't refetch" but "stale enough that a cold open
      // after a few minutes pulls fresh server state."
      staleTime: 30_000,
      // Keep cached data 10 minutes after the last subscriber unmounts so
      // tab-switching back to a screen is instant.
      gcTime: 10 * 60_000,
      // Mobile-first: do not auto-refetch on window focus. RN re-mounts on
      // focus already and we don't want a screen tab swipe to fire a fan-out.
      refetchOnWindowFocus: false,
      retry: (failureCount: number, error: unknown) => {
        if (getHttpStatus(error) === 402) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: {
      // Mutations should not retry blindly — the user already saw the spinner
      // resolve and a silent re-attempt could double-create rows. Callers can
      // override per-mutation when truly idempotent.
      retry: false,
    },
  },
});

/**
 * Persisted React Query cache — identity-bound (S6-P1).
 *
 * Why we persist the cache:
 *   On a cold start the user opens the app and we have to wait for the network
 *   round-trip before showing anything. With persistence, we hydrate the cache
 *   from disk on boot and the first paint shows last-known data while a fresh
 *   fetch runs in the background.
 *
 * What we DON'T persist:
 *   Mutations are intentionally not persisted. A pending mutation surviving
 *   an app restart could double-create rows (e.g. a workout logged twice if
 *   the user force-quit mid-network). Re-issuing those is the queue's job
 *   (foodLogQueue.ts), not the query cache's. Queries tagged with
 *   `meta: { persist: false }` are evicted before write.
 *
 * Cache TTL:
 *   24h max age. Anything older is treated as cold and refetched on first
 *   subscribe. This bounds the staleness window for users who open the app
 *   once a week without ever connecting.
 *
 * R15 / S6-P1: the persister key is namespaced by authenticated user id so a
 * shared device cannot hydrate user A's cache into user B's session. Before
 * S6-P1 the key was resolved ONCE at module load (always ':anonymous' on
 * AsyncStorage-shim builds, because lib/userCache has not hydrated yet) and
 * could never be swapped, so isolation rested on purge-on-sign-in/out plus
 * queryClient.clear(). S6-P1 removes the import-time singleton: persistence is
 * created per committed identity by `createIdentityPersistence()` and owned by
 * `PersistedQueryCacheGate` (RootNavigator supplies the committed bootstrap
 * identity). There is no persistence at all for the logged-out state.
 */
export const QUERY_CACHE_KEY_PREFIX = 'TGP_RQ_CACHE_V1';

// Bump this string whenever the wire shape of any cached query changes
// incompatibly. Cache entries with a different buster are discarded on
// restore instead of being deserialized into mismatched TypeScript types.
export const QUERY_CACHE_BUSTER = 'tgp-rq-v2-samples';

export const QUERY_CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

// Throttle disk writes so heavy cache churn doesn't hammer AsyncStorage.
const QUERY_CACHE_THROTTLE_MS = 1000;
/** Upper bound signOut() waits for a retired identity's in-flight writes
 *  (same bound as PersistedQueryCacheGate's drain step). */
export const QUERY_CACHE_SIGN_OUT_DRAIN_TIMEOUT_MS = 1000;

export function persisterKeyForUser(userId: string | null | undefined): string {
  const suffix = userId && userId.trim() ? userId : 'anonymous';
  return `${QUERY_CACHE_KEY_PREFIX}:${suffix}`;
}

// Persistence opt-out: anything tagged `meta: { persist: false }` is never
// written to disk (unchanged semantics from the PersistQueryClientProvider
// composition this replaces).
function shouldDehydrateQuery(query: Query): boolean {
  return query.meta?.persist !== false;
}

export type RestoreOutcome = 'restored' | 'empty' | 'timeout' | 'retired' | 'failed';
export type DrainOutcome = 'drained' | 'timeout';

export interface IdentityPersistence {
  readonly userId: string;
  readonly key: string;
  /**
   * Read this identity's blob and hydrate it into `queryClient`, then subscribe
   * cache changes to disk. Resolves:
   *   'restored' — a valid blob was hydrated;
   *   'empty'    — nothing on disk (or a busted/expired blob, which is removed);
   *   'timeout'  — `timeoutMs` elapsed first: nothing is hydrated, persistence
   *                is subscribed for new writes, and the late read is discarded
   *                at the restore→hydrate boundary when it finally completes;
   *   'retired'  — `retire()` was called before the read settled: nothing is
   *                hydrated and nothing is subscribed;
   *   'failed'   — the read/deserialize threw: the blob is removed, persistence
   *                is subscribed for new writes.
   */
  restore(options?: { timeoutMs?: number }): Promise<RestoreOutcome>;
  /**
   * Fence this identity: unsubscribe from cache changes and refuse every
   * storage write from now on — including queued/throttled writes the library
   * has already accepted, which are dropped at the actual `setItem`. Idempotent.
   */
  retire(): void;
  /**
   * Wait for storage writes that were already in flight at `retire()`.
   * Resolves 'drained' once they have completed, or 'timeout' after
   * `timeoutMs`. After a 'timeout' the persistence fails closed: any write
   * that lands later removes its own key again.
   */
  drain(options?: { timeoutMs?: number }): Promise<DrainOutcome>;
  isRetired(): boolean;
}

// Every identity persistence that has been created and not yet BOTH retired
// and drained. Membership is the accountability record for outstanding disk
// writes: signOut() (S6-P2, S6-A-02) retires and drains these itself, before
// its final purge, instead of depending on a later PersistedQueryCacheGate
// effect; a gate that unmounted mid-transition (S6-A-01) leaves its fenced
// persistence here until that drain happens.
const liveIdentityPersistences = new Set<IdentityPersistence>();

/**
 * Retire (write fence + unsubscribe) every live identity persistence and wait,
 * bounded by `timeoutMs`, for their in-flight storage writes. A write that
 * outlives the bound fails closed inside its persistence (removes its own key
 * when it lands). After this resolves no registered persistence can start a
 * new write, so a purge performed afterwards is final.
 */
export async function retireAndDrainIdentityPersistences(
  options: { timeoutMs?: number } = {},
): Promise<DrainOutcome> {
  const live = Array.from(liveIdentityPersistences);
  live.forEach((persistence) => persistence.retire());
  const outcomes = await Promise.all(
    live.map((persistence) => persistence.drain({ timeoutMs: options.timeoutMs ?? QUERY_CACHE_SIGN_OUT_DRAIN_TIMEOUT_MS })),
  );
  return outcomes.includes('timeout') ? 'timeout' : 'drained';
}

/**
 * Create the persistence for one committed identity.
 *
 * Fences (all checked at the moment of the actual storage operation, not at
 * `persistClient` entry, because the async-storage persister throttles and
 * serializes before it reaches storage):
 *   - write fence:   `setItem` is a no-op once retired;
 *   - restore fence: a read that completes after `retire()` or after the
 *                    bounded restore window hydrates nothing;
 *   - fail-closed:   a write that was in flight at retirement and outlives the
 *                    bounded drain removes its own key when it lands.
 */
export function createIdentityPersistence(
  userId: string,
  options: { client?: QueryClient } = {},
): IdentityPersistence {
  const client = options.client ?? queryClient;
  const key = persisterKeyForUser(userId);
  let retired = false;
  let drainTimedOut = false;
  let unsubscribe: (() => void) | null = null;
  const inflightWrites = new Set<Promise<void>>();

  const fencedStorage = {
    getItem: (k: string) => AsyncStorage.getItem(k),
    removeItem: (k: string) => AsyncStorage.removeItem(k),
    setItem: async (k: string, value: string): Promise<void> => {
      if (retired) return; // write fence: dropped at the actual write
      const write = (async () => {
        try {
          await AsyncStorage.setItem(k, value);
        } finally {
          if (retired && drainTimedOut) {
            // Fail-closed: this write outlived the bounded drain (and any purge
            // the transition performed), so it must not resurrect the blob.
            try {
              await AsyncStorage.removeItem(k);
            } catch {
              // Non-fatal: purgePersistedQueryCacheForAllUsers() on the next
              // sign-in/out is the backstop.
            }
          }
        }
      })();
      const tracked = write.catch(() => undefined);
      inflightWrites.add(tracked);
      try {
        await write;
      } finally {
        inflightWrites.delete(tracked);
      }
    },
  };

  const persister = createAsyncStoragePersister({
    storage: fencedStorage,
    key,
    throttleTime: QUERY_CACHE_THROTTLE_MS,
  });

  const subscribe = () => {
    if (retired || unsubscribe) return;
    unsubscribe = persistQueryClientSubscribe({
      queryClient: client,
      persister,
      buster: QUERY_CACHE_BUSTER,
      dehydrateOptions: { shouldDehydrateQuery },
    });
  };

  const removeBlob = async () => {
    try {
      await persister.removeClient();
    } catch {
      // Non-fatal: see purgePersistedQueryCacheForAllUsers().
    }
  };

  type ReadResult =
    | { kind: 'read'; client: PersistedClient | undefined }
    | { kind: 'error' }
    | { kind: 'timeout' };

  const persistence: IdentityPersistence = {
    userId,
    key,
    isRetired: () => retired,
    retire: () => {
      retired = true;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
    async restore({ timeoutMs }: { timeoutMs?: number } = {}): Promise<RestoreOutcome> {
      if (retired) return 'retired';
      const read: Promise<ReadResult> = Promise.resolve()
        .then(() => persister.restoreClient())
        .then(
          (persisted) => ({ kind: 'read', client: persisted ?? undefined }),
          () => ({ kind: 'error' }),
        );
      let timer: ReturnType<typeof setTimeout> | undefined;
      let result: ReadResult;
      try {
        if (timeoutMs === undefined) {
          result = await read;
        } else {
          const timeout = new Promise<ReadResult>((resolve) => {
            timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
          });
          result = await Promise.race([read, timeout]);
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      // Restore fence: a retirement that raced the read wins — nothing is
      // hydrated and nothing is subscribed.
      if (retired) return 'retired';
      if (result.kind === 'timeout') {
        // The read continues in the background; its result is unreachable
        // (the race already settled), so it can never hydrate.
        subscribe();
        return 'timeout';
      }
      if (result.kind === 'error') {
        await removeBlob();
        if (retired) return 'retired';
        subscribe();
        return 'failed';
      }
      const persisted = result.client;
      if (!persisted) {
        subscribe();
        return 'empty';
      }
      const expired = !persisted.timestamp || Date.now() - persisted.timestamp > QUERY_CACHE_MAX_AGE;
      const busted = persisted.buster !== QUERY_CACHE_BUSTER;
      if (expired || busted) {
        await removeBlob();
        if (retired) return 'retired';
        subscribe();
        return 'empty';
      }
      hydrate(client, persisted.clientState);
      subscribe();
      return 'restored';
    },
    async drain({ timeoutMs }: { timeoutMs?: number } = {}): Promise<DrainOutcome> {
      const pending = Array.from(inflightWrites);
      let outcome: DrainOutcome = 'drained';
      if (pending.length > 0) {
        const all = Promise.all(pending).then((): DrainOutcome => 'drained');
        if (timeoutMs === undefined) {
          outcome = await all;
        } else {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const timeout = new Promise<DrainOutcome>((resolve) => {
              timer = setTimeout(() => resolve('timeout'), timeoutMs);
            });
            outcome = await Promise.race([all, timeout]);
            if (outcome === 'timeout') drainTimedOut = true;
          } finally {
            if (timer !== undefined) clearTimeout(timer);
          }
        }
      }
      // Retired and drained (or fenced fail-closed after an expired drain): this
      // persistence can never write again, so it leaves the live registry.
      if (retired) liveIdentityPersistences.delete(persistence);
      return outcome;
    },
  };
  liveIdentityPersistences.add(persistence);
  return persistence;
}

/**
 * Settle and clear the in-memory query cache at an identity boundary
 * (sign-out, identity replacement, committed logout).
 *
 * Why not a bare `queryClient.clear()` (traced in the pinned
 * @tanstack/query-core 5.100.14 sources; observed in S6-C6 as two 600 000 ms
 * timers created via `Query.removeObserver → scheduleGc` that survived
 * `cancelQueries()` + `clear()`):
 *
 *   1. `QueryCache.clear()` → `remove(query)` → `query.destroy()` clears the
 *      gc timer, silently cancels the retryer and deletes the map entry — but
 *      it does NOT detach observers. Every still-mounted `useQuery` keeps its
 *      `QueryObserver` pointed at the now-orphaned Query object.
 *   2. Later, `Query.removeObserver()` runs on that orphan — from
 *      `QueryObserver.destroy()` when the screen unmounts, or from
 *      `QueryObserver.#updateQuery()` on the observer's next render — and,
 *      because the observer list becomes empty, calls `scheduleGc()`: a
 *      gcTime (600 000 ms) timer on an object no longer in the cache, which
 *      nothing can clear. `removeObserver()` is a no-op for an observer that
 *      is not in `query.observers`, so detaching observers while the query is
 *      still cached makes every later call inert.
 *   3. `Query.#fetch`'s `finally { scheduleGc() }` runs when the retryer
 *      settles. `destroy()`'s silent cancel settles it AFTER `clearGcTimeout`,
 *      i.e. it re-arms on the orphan as well. `cancelQueries()` settles the
 *      fetch while the query is still cached (its `finally` runs before the
 *      cancel promise resolves), so the re-armed timer is then cleared by
 *      `destroy()`.
 *
 * Privacy is not weakened: the cache is still emptied synchronously at the
 * end of this call; the extra steps only ensure the emptied objects are truly
 * released instead of leaving observed orphans behind. Nothing here shortens
 * gcTime or masks timers. The detached observers re-attach to fresh Query
 * objects on their next render (or are destroyed on unmount) exactly as after
 * a plain `clear()`.
 */
export async function settleAndClearQueryCache(
  client: QueryClient = queryClient,
  options: { shouldContinue?: () => boolean } = {},
): Promise<boolean> {
  // 1. Settle in-flight fetches while their queries are still cached, so the
  //    `finally { scheduleGc() }` in Query.#fetch re-arms a timer that step 3
  //    can still clear.
  await client.cancelQueries();
  // A caller whose transition was superseded while cancelling must not clear
  // the cache the superseding transition has already rebuilt.
  if (options.shouldContinue && !options.shouldContinue()) return false;
  // 2. Detach observers while their queries are still cached, so the observers'
  //    later removeObserver() calls (on unmount, or on their next render) are
  //    no-ops instead of arming gc on an orphan.
  for (const query of client.getQueryCache().getAll()) {
    for (const observer of [...query.observers]) {
      query.removeObserver(observer);
    }
  }
  // 3. Empty the cache. destroy() clears each query's gc timeout for good.
  client.clear();
  return true;
}

/**
 * Remove every persisted React Query cache key from AsyncStorage. Used on
 * sign-out to honor R15: a shared device must not retain user A's cache into
 * user B's session, even at a stale legacy key. Also wipes the legacy
 * unsuffixed key from pre-R15 builds.
 */
export async function purgePersistedQueryCacheForAllUsers(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const matching = allKeys.filter(
      (k) => k === QUERY_CACHE_KEY_PREFIX || k.startsWith(`${QUERY_CACHE_KEY_PREFIX}:`),
    );
    if (matching.length) await AsyncStorage.removeMany(matching);
  } catch {
    // Non-fatal: the persister will hydrate empty on next sign-in.
  }
}

