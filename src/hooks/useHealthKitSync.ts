/**
 * useHealthKitSync — React hook wrapping the HealthKit sync service for the
 * Connections Hub (PR-HK-2.a, ALLOWED additive edit).
 *
 * A HealthKit sync is an imperative action (request consent → read → POST), so
 * this is a `useMutation` rather than a `useQuery`. The Connections Hub calls
 * `sync({ userId, connectionId })` from an "Sync now" button and renders
 * `isPending` / `data` / `error`.
 *
 * Platform: on non-iOS devices the underlying client throws
 * {@link HealthKitUnsupportedError}; the hook exposes `isSupported` so the UI
 * can disable the control up front, and the mutation's `error` carries the
 * typed error if invoked anyway.
 */

import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import {
  HealthKitUnsupportedError,
  healthKitClient,
  healthKitSyncService,
  type HealthKitSyncOptions,
  type HealthKitSyncResult,
} from '../services/health/healthkit';

export interface UseHealthKitSyncReturn {
  /** Whether HealthKit is usable on this platform (iOS only). */
  isSupported: boolean;
  /** Trigger a sync; resolves with the {@link HealthKitSyncResult}. */
  sync: (options: HealthKitSyncOptions) => Promise<HealthKitSyncResult>;
  /** The underlying react-query mutation (status, data, error, reset). */
  mutation: UseMutationResult<HealthKitSyncResult, Error, HealthKitSyncOptions>;
}

/**
 * Hook over the shared {@link healthKitSyncService}. `mutateAsync` is exposed
 * as `sync` so callers can `await` the result and branch on `postedCount`.
 */
export function useHealthKitSync(): UseHealthKitSyncReturn {
  const mutation = useMutation<HealthKitSyncResult, Error, HealthKitSyncOptions>({
    mutationKey: ['healthkit-sync'],
    mutationFn: (options: HealthKitSyncOptions) => healthKitSyncService.sync(options),
  });

  return {
    isSupported: healthKitClient.isSupported,
    sync: mutation.mutateAsync,
    mutation,
  };
}

export { HealthKitUnsupportedError };
