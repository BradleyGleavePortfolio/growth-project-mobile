import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  readPendingFoodLogCount,
  subscribePendingFoodLogs,
  syncFoodLogQueue,
} from '../services/foodLogSync';

/**
 * Sends foods saved offline whenever they may finally reach the server:
 * when the signed-in client's app starts (including a cold start after the
 * app was closed offline), when the connection returns, and when the app
 * comes back to the foreground. Mounted once, by RootNavigator.
 */
export function useFoodLogQueueSync(signedInClient: boolean, online: boolean): void {
  const wasOnline = useRef(online);

  useEffect(() => {
    if (signedInClient) void syncFoodLogQueue();
  }, [signedInClient]);

  useEffect(() => {
    if (signedInClient && online && !wasOnline.current) void syncFoodLogQueue();
    wasOnline.current = online;
  }, [signedInClient, online]);

  useEffect(() => {
    if (!signedInClient) return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncFoodLogQueue();
    });
    return () => sub.remove();
  }, [signedInClient]);
}

/** Foods saved offline on this device that are not in the log yet. */
export function usePendingFoodLogCount(): number {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribePendingFoodLogs((count) => {
      if (active) setPending(count);
    });
    void readPendingFoodLogCount().then((count) => {
      if (active) setPending(count);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return pending;
}
