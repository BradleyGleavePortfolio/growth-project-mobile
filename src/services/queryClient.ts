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

import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
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
 * AsyncStorage-backed persister for the React Query cache.
 *
 * Why we persist the cache:
 *   On a cold start the user opens the app and we have to wait for the network
 *   round-trip before showing anything. With persistence, we hydrate the cache
 *   from disk synchronously-ish on boot and the first paint shows last-known
 *   data while a fresh fetch runs in the background. That's the felt-native
 *   experience the audit asked for and what enterprise apps (Linear, Things,
 *   Cash App) all do under the hood.
 *
 * What we DON'T persist:
 *   Mutations are intentionally not persisted. A pending mutation surviving
 *   an app restart could double-create rows (e.g. a workout logged twice if
 *   the user force-quit mid-network). Re-issuing those is the queue's job
 *   (foodLogQueue.ts), not the query cache's.
 *
 * Cache TTL:
 *   24h max age. Anything older is treated as cold and refetched on first
 *   subscribe. This bounds the staleness window for users who open the app
 *   once a week without ever connecting.
 */
export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'TGP_RQ_CACHE_V1',
  // Throttle disk writes so heavy cache churn doesn't hammer AsyncStorage.
  throttleTime: 1000,
});

export const QUERY_CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

