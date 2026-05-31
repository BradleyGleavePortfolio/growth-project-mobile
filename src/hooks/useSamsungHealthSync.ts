/**
 * useSamsungHealthSync — React Query mutation over the Samsung Health
 * on-device sync (PR-HK-2.c).
 *
 * Wraps {@link samsungHealthSyncService.sync} as a mutation so a screen can
 * trigger an on-demand sync (pull-to-refresh, "Sync now" affordance) and read
 * `isPending` / `error` for UI state. Also exposes the persisted `lastSyncAt`
 * via a lightweight query so the Connections UI can render a freshness chip.
 *
 * The hook is additive (ALLOWED additive in the write-set) and imports ONLY
 * the connector's public surface — it owns no connector logic itself.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getLastSyncAt,
  sync,
  type SamsungSyncResult,
} from '../services/health/samsungHealth';

/** Query key for the persisted lastSyncAt freshness read. */
export const SAMSUNG_HEALTH_LAST_SYNC_QUERY_KEY = [
  'wearable',
  'samsung-health',
  'lastSyncAt',
] as const;

/** Mutation key for the sync trigger. */
export const SAMSUNG_HEALTH_SYNC_MUTATION_KEY = [
  'wearable',
  'samsung-health',
  'sync',
] as const;

/**
 * Read the last successful Samsung Health sync timestamp (ISO 8601) or null.
 * Stale after 60s so a freshness chip stays reasonably current without
 * hammering AsyncStorage.
 */
export function useSamsungHealthLastSync() {
  return useQuery<string | null>({
    queryKey: SAMSUNG_HEALTH_LAST_SYNC_QUERY_KEY,
    queryFn: () => getLastSyncAt(),
    staleTime: 60_000,
  });
}

/**
 * Trigger a Samsung Health sync. On success, invalidates the lastSyncAt query
 * so any freshness chip re-reads the new value.
 */
export function useSamsungHealthSync() {
  const queryClient = useQueryClient();
  return useMutation<SamsungSyncResult, Error, void>({
    mutationKey: SAMSUNG_HEALTH_SYNC_MUTATION_KEY,
    mutationFn: () => sync(),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: SAMSUNG_HEALTH_LAST_SYNC_QUERY_KEY,
      });
    },
  });
}
