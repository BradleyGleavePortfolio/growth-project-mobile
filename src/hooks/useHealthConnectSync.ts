// PR-HK-2.b — useHealthConnectSync.
//
// Thin React hook over the Health Connect sync service. Exposes a TanStack
// Query mutation that runs the on-device ingestion lane
// (request-permission → read since-lastSync → normalize → POST) and surfaces
// the typed result / error to the caller.
//
// The hook is Android-only by nature; on other platforms `supported` is false
// and `sync()` rejects with HealthConnectUnsupportedError (the service guards
// it). Callers gate the "Sync now" affordance on `supported`.

import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import {
  isHealthConnectSupported,
  syncHealthConnect,
  type HealthConnectSyncDeps,
  type HealthConnectSyncResult,
} from '../services/health/healthConnect';

/** Mutation key — exported so a screen can target it for cache coordination. */
export const HEALTH_CONNECT_SYNC_MUTATION_KEY = ['healthConnect', 'sync'] as const;

/** Arguments to a single sync invocation. */
export interface HealthConnectSyncVariables {
  /** Subject client User.id. */
  userId: string;
  /** Server-assigned Health Connect connection row id. */
  connectionId: string;
}

export interface UseHealthConnectSyncOptions {
  /** Dependency overrides (tests inject mocks for client/api/now). */
  deps?: HealthConnectSyncDeps;
}

export interface UseHealthConnectSync {
  /** True only on Android (Health Connect's native module exists nowhere else). */
  supported: boolean;
  /** Trigger a sync (rejects on non-Android or permission-denied). */
  sync: (vars: HealthConnectSyncVariables) => Promise<HealthConnectSyncResult>;
  /** The underlying mutation (status, data, error) for UI binding. */
  mutation: UseMutationResult<
    HealthConnectSyncResult,
    Error,
    HealthConnectSyncVariables
  >;
}

/**
 * Hook entry point. Returns `supported`, an awaitable `sync()`, and the raw
 * mutation object so a screen can render loading/error state and disable the
 * trigger while in flight.
 */
export function useHealthConnectSync(
  options: UseHealthConnectSyncOptions = {},
): UseHealthConnectSync {
  const { deps } = options;

  const mutation = useMutation<
    HealthConnectSyncResult,
    Error,
    HealthConnectSyncVariables
  >({
    mutationKey: HEALTH_CONNECT_SYNC_MUTATION_KEY,
    mutationFn: ({ userId, connectionId }: HealthConnectSyncVariables) =>
      syncHealthConnect(userId, connectionId, deps),
  });

  return {
    supported: isHealthConnectSupported(),
    sync: (vars: HealthConnectSyncVariables) => mutation.mutateAsync(vars),
    mutation,
  };
}
