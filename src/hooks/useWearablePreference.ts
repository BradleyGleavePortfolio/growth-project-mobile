/**
 * useWearablePreference — write hook for the preferred-source toggle on the
 * Metric Detail screen (provider-overlap chips).
 *
 * Tapping a provider chip writes `WearableUserMetricPreference` via
 * `wearablesSamplesApi.setPreference`. We optimistically flip the active chip
 * (so the tap feels instant — Revolut/Phantom polish) and roll back on error
 * with an actionable toast ("Couldn't update preferred source — try again",
 * brief §4.4). On success we invalidate every samples query so the next read
 * resolves the newly-preferred provider (`preferredOnly=true` reads change).
 *
 * The optimistic value lives in a tiny dedicated query cache entry keyed by
 * metric, NOT inside the (param-heavy) samples cache — a preference is a
 * per-metric scalar, and overwriting it there keeps the chip's "active"
 * highlight in sync across every window/granularity view of that metric
 * without us guessing which samples cache entries exist.
 *
 * Two caller shapes (R1 P0 #5 — HK-3b contract compat):
 *   - LEGACY (zero-arg): returns the raw mutation; `mutate({ metric,
 *     preferredProvider }, opts?)`. Used by `ProviderOverlapChips`.
 *   - CONTRACT ({ metric }): returns `{ data, mutate, isPending }` where the
 *     metric is bound, so `mutate(preferredProvider | null)` is the simpler
 *     surface HK-3b documents. `data` is the optimistically-tracked preferred
 *     provider (or null), read live from the preference cache.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  wearablesSamplesApi,
  type PreferenceResult,
  type WearableMetricType,
} from '../api/wearablesSamplesApi';
import { type WearableProvider } from '../api/wearablesConnectionsApi';
import { WEARABLE_SAMPLES_ROOT_KEY } from './useWearableSamples';
import { logger } from '../utils/logger';

/**
 * Cache key for the locally-tracked preferred provider of a single metric.
 * Exported so the Metric Detail screen can seed/read the active chip and tests
 * can assert the optimistic flip + rollback.
 */
export function wearablePreferenceQueryKey(metric: WearableMetricType) {
  return ['wearables', 'preference', metric] as const;
}

/** The variables for a preference write. */
export interface SetPreferenceVars {
  readonly metric: WearableMetricType;
  readonly preferredProvider: WearableProvider;
}

interface OptimisticContext {
  readonly previous: WearableProvider | undefined;
}

type PreferenceMutation = UseMutationResult<
  PreferenceResult,
  Error,
  SetPreferenceVars,
  OptimisticContext
>;

type ClearPreferenceMutation = UseMutationResult<
  void,
  Error,
  WearableMetricType,
  unknown
>;

/** The metric-bound contract return (R1 P0 #5). */
export interface BoundPreference {
  /** Optimistically-tracked preferred provider for this metric (or null). */
  readonly data: WearableProvider | null;
  /** Set/clear the preferred provider for the bound metric. */
  readonly mutate: (
    preferredProvider: WearableProvider | null,
    opts?: { onError?: (err: Error) => void },
  ) => void;
  readonly isPending: boolean;
  /**
   * True when the most recent set OR clear write failed. Surfaced (R65 #36) so
   * the screen can render an observable error state — passing `opts.onError`
   * is additive and never suppresses this flag.
   */
  readonly isError: boolean;
  /** The error from the failed set/clear write, or null when none. */
  readonly error: Error | null;
}

/**
 * Internal factory: the raw mutation. Shared by both overloads so the
 * optimistic write / rollback / invalidate logic lives in ONE place.
 */
function usePreferenceMutation(): PreferenceMutation {
  const qc = useQueryClient();

  return useMutation<PreferenceResult, Error, SetPreferenceVars, OptimisticContext>({
    mutationFn: ({ metric, preferredProvider }) =>
      wearablesSamplesApi.setPreference(metric, preferredProvider),

    onMutate: async ({ metric, preferredProvider }) => {
      const key = wearablePreferenceQueryKey(metric);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<WearableProvider>(key);
      qc.setQueryData<WearableProvider>(key, preferredProvider);
      return { previous };
    },

    onError: (_err, { metric }, context) => {
      // Roll back to the exact prior value. When there was no prior value we
      // REMOVE the cache entry rather than calling setQueryData(key, undefined)
      // — React Query treats an `undefined` next-value as a no-op and would
      // leave the optimistic write in place, so the chip would keep lying.
      // We do NOT swallow the error — it propagates to the caller's
      // `isError`/`onError` so the actionable toast can fire (#36).
      const key = wearablePreferenceQueryKey(metric);
      if (context?.previous === undefined) {
        qc.removeQueries({ queryKey: key, exact: true });
      } else {
        qc.setQueryData<WearableProvider>(key, context.previous);
      }
    },

    onSuccess: (result) => {
      const key = wearablePreferenceQueryKey(result.metric);
      qc.setQueryData<WearableProvider>(key, result.preferred_provider);
    },

    onSettled: () => {
      // A changed preference changes every preferredOnly=true read, so refetch
      // the whole samples subtree (cheap: only currently-mounted queries
      // actually refetch; the rest are just marked stale).
      void qc.invalidateQueries({ queryKey: WEARABLE_SAMPLES_ROOT_KEY });
    },
  });
}

/**
 * Internal factory: the CLEAR mutation. Routed through React Query (mirrors
 * `usePreferenceMutation`) so clearing a preference is a first-class mutation —
 * it tracks `isPending`, invalidates the samples subtree, drops the per-metric
 * preference cache entry, and surfaces errors instead of failing silently
 * (R65 #36). Previously the clear path called the API directly, bypassing the
 * query client entirely: no pending state, no cache invalidation, and a failed
 * DELETE was never observable by the UI.
 */
function useClearPreferenceMutation(): ClearPreferenceMutation {
  const qc = useQueryClient();

  return useMutation<void, Error, WearableMetricType, unknown>({
    mutationFn: (metric) => wearablesSamplesApi.clearPreference(metric),

    onSuccess: (_void, metric) => {
      // Clear the per-metric preference cache so the chip drops its "active"
      // highlight, then invalidate the samples subtree so the next read falls
      // back to recency (`resolveBest`).
      qc.setQueryData<WearableProvider | null>(
        wearablePreferenceQueryKey(metric),
        null,
      );
      void qc.invalidateQueries({ queryKey: WEARABLE_SAMPLES_ROOT_KEY });
    },

    onError: (error, metric) => {
      // Never swallow — log for diagnostics; the caller's `opts.onError` (wired
      // below) still fires so the screen's actionable toast can surface it.
      logger.error('useWearablePreference.clear', { metric, error });
    },
  });
}

/**
 * Read the optimistically-tracked preferred provider for a metric from the
 * dedicated preference cache. Exported so chips can subscribe to the optimistic
 * value BEFORE the network confirms (R1 P1 #1). The query has no `queryFn`
 * (the value is written only by the mutation's optimistic path / onSuccess), so
 * it never fetches — it is a pure cache subscription.
 */
export function useOptimisticPreferredProvider(
  metric: WearableMetricType,
): WearableProvider | null {
  const { data } = useQuery<WearableProvider | null>({
    queryKey: wearablePreferenceQueryKey(metric),
    enabled: false,
    // No queryFn: this entry is populated only by the mutation. Default to null
    // so a never-written metric reads as "no explicit preference".
    initialData: null,
  });
  return data ?? null;
}

// ── Overloads (R1 P0 #5) ──────────────────────────────────────────────────────

/** Legacy zero-arg form: returns the raw mutation. */
export function useWearablePreference(): PreferenceMutation;
/** Contract form: metric-bound `{ data, mutate, isPending }`. */
export function useWearablePreference(args: {
  metric: WearableMetricType;
}): BoundPreference;
export function useWearablePreference(args?: {
  metric: WearableMetricType;
}): PreferenceMutation | BoundPreference {
  const mutation = usePreferenceMutation();
  // Clear mutation is ALWAYS instantiated (rules-of-hooks: stable hook order
  // across overloads). It is only invoked from the bound overload's mutate(null).
  const clearMutation = useClearPreferenceMutation();
  // The hook order is stable: we ALWAYS read the (cheap, fetch-disabled)
  // preference query so the rules-of-hooks hold regardless of the overload.
  const boundMetric = args?.metric;
  const optimistic = useQuery<WearableProvider | null>({
    queryKey: wearablePreferenceQueryKey(
      // A stable placeholder key when unbound keeps the hook count constant;
      // its value is never read in the legacy branch.
      boundMetric ?? ('__unbound__' as unknown as WearableMetricType),
    ),
    enabled: false,
    initialData: null,
  });

  if (boundMetric === undefined) {
    return mutation;
  }

  return {
    data: optimistic.data ?? null,
    // Either write is in flight → the chip row shows pending.
    isPending: mutation.isPending || clearMutation.isPending,
    // Either write failed → the bound return reflects an observable error
    // state. A caller-supplied `opts.onError` runs ADDITIVELY (see below) and
    // never consumes/suppresses these flags (R65 #36 — no silent failure). We
    // prefer the clear error when both somehow carry one, but in practice only
    // one write path is exercised per bound metric at a time.
    isError: mutation.isError || clearMutation.isError,
    error: clearMutation.error ?? mutation.error ?? null,
    mutate: (
      preferredProvider: WearableProvider | null,
      opts?: { onError?: (err: Error) => void },
    ) => {
      if (preferredProvider === null) {
        // Clearing: route through the dedicated clear mutation so the request
        // is tracked (isPending), the samples subtree is invalidated on
        // success, and a failed DELETE surfaces via isError + opts.onError
        // (no silent failure — R65 #36).
        clearMutation.mutate(boundMetric, {
          onError: (err) => opts?.onError?.(err),
        });
        return;
      }
      mutation.mutate(
        { metric: boundMetric, preferredProvider },
        { onError: (err) => opts?.onError?.(err) },
      );
    },
  };
}
