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
 */

import {
  useMutation,
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

/**
 * Mutation hook to set the preferred provider for a metric.
 *
 * onMutate: cancel in-flight reads of the preference key, snapshot the prior
 *   value, optimistically write the new one.
 * onError: roll back to the snapshot (NEVER leave the chip in a lying state)
 *   — the screen surfaces the actionable toast off `mutation.isError`.
 * onSuccess: write the server-confirmed provider.
 * onSettled: invalidate all samples queries so preferred reads re-resolve.
 */
export function useWearablePreference(): UseMutationResult<
  PreferenceResult,
  Error,
  SetPreferenceVars,
  OptimisticContext
> {
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
