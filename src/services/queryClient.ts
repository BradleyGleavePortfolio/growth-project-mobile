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
      retry: 2,
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
