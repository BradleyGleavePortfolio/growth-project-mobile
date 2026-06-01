/**
 * useWearableConnections — React Query hooks over `wearablesConnectionsApi`.
 *
 * Mirrors the repo's existing data-hook conventions (see `useHolisticInsights`
 * for the query pattern and `useMealTemplates` for the mutation +
 * `invalidateQueries` pattern). One canonical cache key, `['wearable-
 * connections']`, is shared by the list query and is invalidated after every
 * connect/disconnect so the Connections Hub re-reads authoritative status from
 * the server rather than guessing client-side.
 *
 * Connect is split into two steps to match the backend OAuth shape:
 *   1. `useStartOauth` mutation → returns `{ authorizationUrl, state }`. The
 *      screen opens that URL in an in-app auth session.
 *   2. On the auth session returning, the screen calls `invalidate()` (exposed
 *      here) to re-fetch the list and learn the result — the backend's server
 *      callback created/updated the connection row out-of-band.
 *
 * Disconnect is a single mutation that invalidates on success.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  wearablesConnectionsApi,
  type DisconnectResult,
  type StartOauthResult,
  type WearableConnection,
  type WearableProvider,
} from '../api/wearablesConnectionsApi';

/** Canonical cache key for the user's wearable connection list. */
export const WEARABLE_CONNECTIONS_QUERY_KEY = ['wearable-connections'] as const;

/**
 * Read the caller's wearable connections. The list is the single source of
 * truth for every provider row's status / last-sync in the Connections Hub.
 */
export function useWearableConnections(): UseQueryResult<
  WearableConnection[],
  Error
> {
  return useQuery<WearableConnection[], Error>({
    queryKey: WEARABLE_CONNECTIONS_QUERY_KEY,
    queryFn: () => wearablesConnectionsApi.list(),
  });
}

/**
 * Begin a cloud-OAuth connect flow for a provider. Returns the authorization
 * URL + CSRF state; the caller opens the URL and, once the auth session
 * returns, invalidates the connections cache to learn the outcome. We do NOT
 * invalidate on `onSuccess` here — starting the flow does not change server
 * state; the connection row is created by the server callback later.
 */
export function useStartOauth() {
  return useMutation<StartOauthResult, Error, WearableProvider>({
    mutationFn: (provider) => wearablesConnectionsApi.startOauth(provider),
  });
}

/**
 * Soft-disconnect a provider, then invalidate the connections cache so the row
 * re-renders with `status='disconnected'`.
 */
export function useDisconnectProvider() {
  const qc = useQueryClient();
  return useMutation<DisconnectResult, Error, WearableProvider>({
    mutationFn: (provider) => wearablesConnectionsApi.disconnect(provider),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WEARABLE_CONNECTIONS_QUERY_KEY });
    },
  });
}

/**
 * Imperative invalidation of the connections cache. Used by the connect flow
 * after an OAuth auth session returns (the result lands server-side, so the
 * client must re-fetch to observe it).
 */
export function useInvalidateWearableConnections(): () => void {
  const qc = useQueryClient();
  return () =>
    void qc.invalidateQueries({ queryKey: WEARABLE_CONNECTIONS_QUERY_KEY });
}
