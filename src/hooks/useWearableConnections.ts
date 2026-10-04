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

import { WEARABLE_SAMPLES_ROOT_KEY } from './useWearableSamples';
import { Platform } from 'react-native';
import {
  getLocalAuthorization,
  retireOnDeviceSource,
  type OnDeviceSource,
} from '../services/health/onDeviceState';
import {
  currentAuthGeneration,
  readSignedInUserId,
  stopOnDeviceHealthWork,
} from '../services/health/sessionFence';
import { logger } from '../utils/logger';
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

/** Cache key for this phone's local Connect authorization (S14 B-317-5). */
export const ON_DEVICE_LOCAL_AUTH_QUERY_KEY = ['wearable-on-device-local-auth'] as const;

/** This phone's local Connect authorization for the signed-in person. */
export interface LocalOnDeviceAuthView {
  userId: string | null;
  source: OnDeviceSource;
  /** The connection this phone syncs for that person, or null when none. */
  connectionId: string | null;
}

/**
 * Read (never the phone's health store, only app storage) whether the
 * signed-in person tapped Connect for `source` on this phone, and for which
 * connection. Lets Connections offer Reconnect when the server row is
 * connected but this phone does not sync it (Opus B-317-5).
 */
export function useLocalOnDeviceAuthorization(
  source: OnDeviceSource | null,
): UseQueryResult<LocalOnDeviceAuthView | null, Error> {
  return useQuery<LocalOnDeviceAuthView | null, Error>({
    queryKey: [...ON_DEVICE_LOCAL_AUTH_QUERY_KEY, source],
    enabled: source != null,
    queryFn: async () => {
      if (source == null) return null;
      const userId = await readSignedInUserId();
      const auth = userId ? await getLocalAuthorization(userId, source) : null;
      return { userId, source, connectionId: auth?.connectionId ?? null };
    },
  });
}

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
 * B-364-1: Samsung Health shares its data through Health Connect and has no
 * connection of its own, so its row disconnects Health Connect.
 */
function connectionProviderFor(provider: WearableProvider): WearableProvider {
  return provider === 'SAMSUNG_HEALTH' ? 'HEALTH_CONNECT' : provider;
}

/** This phone's on-device source, or null (web). */
function phoneSource(): OnDeviceSource | null {
  if (Platform.OS === 'ios') return 'APPLE_HEALTHKIT';
  if (Platform.OS === 'android') return 'HEALTH_CONNECT';
  return null;
}

/**
 * Soft-disconnect a provider, then invalidate the connections cache so the row
 * re-renders with `status='disconnected'`.
 *
 * On-device sources (A-317-1 / B-317-1) also retire this phone's local
 * authorization and progress, so nothing is read again until Connect:
 * - Sol B-362-2: the person and auth generation are captured before the
 *   first await. Cleanup removes only that person's records, and only while
 *   the authorization seen at the start is still the stored one. A response
 *   that lands after a sign-out or account switch refetches and reports
 *   nothing for the next person.
 * - Sol B-362-3 / C-362-3: on a current success for this phone's source,
 *   every running on-device read stops synchronously, before any cleanup
 *   await: no further native page, ingest request or progress write.
 * - Sol B-362-1 / C-362-1: a failed cleanup logs a fixed class only.
 */
export function useDisconnectProvider() {
  const qc = useQueryClient();
  return useMutation<DisconnectResult, Error, WearableProvider>({
    mutationFn: async (requested) => {
      const provider = connectionProviderFor(requested);
      const generation = currentAuthGeneration();
      const source: OnDeviceSource | null =
        provider === 'APPLE_HEALTHKIT' || provider === 'HEALTH_CONNECT' ? provider : null;
      const userId = source != null ? await readSignedInUserId() : null;
      const grant =
        userId != null && source != null ? await getLocalAuthorization(userId, source) : null;
      const result = await wearablesConnectionsApi.disconnect(provider);
      const retire = () =>
        userId != null && source != null
          ? retireOnDeviceSource(userId, source, grant?.grantedAt ?? null)
          : Promise.resolve();
      if (currentAuthGeneration() !== generation) {
        // Stale: only the originating person's own records are retired.
        void retire().catch(() => undefined);
        return result;
      }
      if (source != null && source === phoneSource()) stopOnDeviceHealthWork();
      const live = currentAuthGeneration(); // the stop above moves it
      void retire()
        .catch((err: unknown) => {
          if (currentAuthGeneration() !== live) return;
          logger.warn('[wearables] retire on-device state failed', {
            error: err instanceof Error ? 'error' : 'other',
          });
        })
        .finally(() => {
          if (source != null && currentAuthGeneration() === live) {
            void qc.invalidateQueries({ queryKey: ON_DEVICE_LOCAL_AUTH_QUERY_KEY });
          }
        });
      void qc.invalidateQueries({ queryKey: WEARABLE_CONNECTIONS_QUERY_KEY });
      return result;
    },
  });
}

/**
 * Imperative invalidation of the connections cache. Used by the connect flow
 * after an OAuth auth session returns (the result lands server-side, so the
 * client must re-fetch to observe it).
 *
 * S14: also invalidates the wearable samples cache. A connect or on-device
 * history import changes which samples exist, so the Health and Sleep views
 * must refetch rather than keep showing an empty window.
 */
export function useInvalidateWearableConnections(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: WEARABLE_CONNECTIONS_QUERY_KEY });
    void qc.invalidateQueries({ queryKey: WEARABLE_SAMPLES_ROOT_KEY });
    void qc.invalidateQueries({ queryKey: ON_DEVICE_LOCAL_AUTH_QUERY_KEY });
  };
}
