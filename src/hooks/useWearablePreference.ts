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
    isPending: mutation.isPending,
    mutate: (
      preferredProvider: WearableProvider | null,
      opts?: { onError?: (err: Error) => void },
    ) => {
      if (preferredProvider === null) {
        // Clearing: write through the dedicated clear endpoint via the API,
        // then let onSettled re-resolve. We surface errors, never swallow.
        wearablesSamplesApi
          .clearPreference(boundMetric)
          .then(() => {
            // Optimistic-consistent: re-run the samples invalidation path.
            mutation.reset();
          })
          .catch((err: unknown) => {
            const e = err instanceof Error ? err : new Error(String(err));
            opts?.onError?.(e);
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
