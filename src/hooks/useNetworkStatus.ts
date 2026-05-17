// Network-status hook built on @react-native-community/netinfo.
// The dep has shipped in package.json for a while but was never imported — see
// audit item C11. This is the single source of truth for the OfflineBanner and
// the LogScreen food-log write queue.

import { useEffect, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { logger } from '../utils/logger';

export interface NetworkStatus {
  // `isOnline`: the device reports a connected interface. Defaults to true until
  // the first NetInfo event to avoid a banner flash on launch.
  isOnline: boolean;
  // `isInternetReachable`: NetInfo's best-effort reachability probe. Null means
  // "unknown yet" (e.g. first render). Treat null as online.
  isInternetReachable: boolean | null;
}

function toStatus(state: NetInfoState): NetworkStatus {
  return {
    isOnline: !!state.isConnected,
    isInternetReachable: state.isInternetReachable,
  };
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isOnline: true,
    isInternetReachable: null,
  });

  useEffect(() => {
    // fetch() kicks a one-shot probe; addEventListener subscribes for changes.
    // Both update the same state so we're consistent on cold start and on toggle.
    let mounted = true;
    NetInfo.fetch()
      .then((state) => {
        if (mounted) setStatus(toStatus(state));
      })
      .catch((err) => {
        // NetInfo.fetch can reject on certain platforms during early boot.
        // Non-critical: the listener below will populate status on next change.
        logger.log('NetworkStatus', 'initial fetch failed', err);
      });
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (mounted) setStatus(toStatus(state));
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return status;
}

// Convenience: true when we believe the network is usable for API calls.
// Used by the food-log offline queue; tolerates `isInternetReachable === null`
// because null just means "haven't probed yet."
export function isEffectivelyOnline(status: NetworkStatus): boolean {
  if (!status.isOnline) return false;
  if (status.isInternetReachable === false) return false;
  return true;
}
