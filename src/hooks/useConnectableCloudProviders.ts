/**
 * B-WEARLIST-125: the cloud trackers (Oura, Polar, Withings, ...) the server
 * can connect right now. The Connections screen offers a cloud tracker only
 * when it is listed here, so a provider lights up as soon as its keys are set
 * on the server, with no new app build.
 *
 * Any failure (an older server without the route answers 404, no network, a
 * drifted body) means "none listed": the screen then shows exactly what it
 * showed before (this phone's own health source plus existing connections),
 * never a Connect that cannot work. The failure is logged, never shown.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { wearablesConnectionsApi, type WearableProvider } from '../api/wearablesConnectionsApi';
import { logger } from '../utils/logger';

export const CONNECTABLE_CLOUD_PROVIDERS_QUERY_KEY = ['wearable-cloud-providers'] as const;

const NONE: ReadonlySet<WearableProvider> = new Set<WearableProvider>();

export async function fetchConnectableCloudProviders(): Promise<WearableProvider[]> {
  try {
    return await wearablesConnectionsApi.cloudProviders();
  } catch (err) {
    logger.warn('wearables', 'cloud provider list unavailable; showing none', {
      error: err instanceof Error ? err.name : typeof err,
    });
    return [];
  }
}

/** The connectable cloud providers as a set (empty while loading or on failure). */
export function useConnectableCloudProviders(): ReadonlySet<WearableProvider> {
  const query = useQuery<WearableProvider[], Error>({
    queryKey: CONNECTABLE_CLOUD_PROVIDERS_QUERY_KEY,
    queryFn: fetchConnectableCloudProviders,
    staleTime: 5 * 60_000,
  });
  const data = query.data;
  return useMemo(() => (data && data.length > 0 ? new Set(data) : NONE), [data]);
}
