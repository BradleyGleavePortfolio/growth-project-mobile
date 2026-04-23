// Single-flight refresh coordinator.
//
// Problem this solves: when N requests hit 401 simultaneously (e.g.
// HomeScreen's Promise.all on cold start), a bare `isRefreshing` flag lets
// only the first trigger a refresh — the rest fall through to the logout
// path. This helper ensures exactly one refresh call is in flight; other
// callers await the same promise.
//
// Unwired in this PR (round 4); api.ts will consume this in a follow-up.

type RefreshFn = () => Promise<string>;

let refreshPromise: Promise<string> | null = null;

export function coalesceRefresh(run: RefreshFn): Promise<string> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = run().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

// Test-only: reset internal state between tests.
export function __resetRefreshQueueForTests(): void {
  refreshPromise = null;
}
