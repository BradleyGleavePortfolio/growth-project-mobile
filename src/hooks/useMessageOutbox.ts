/**
 * Hooks over the Style B outbox (services/messageOutbox, C3B-THREAD-R1).
 *
 * useMessageOutboxDrain, mounted once by ClientNavigator next to useAiWithdrawalDrain: sends the signed-in client's
 * waiting messages when the app opens, when the signal returns and when the app comes back to the foreground, whether
 * or not the thread is open. These are the moments the food log queue (useFoodLogQueueSync) and the workout queue
 * (triggerWorkoutSync in RootNavigator) already use. Its cleanup (sign-out, another account) drops the copy in memory.
 *
 * useMessageOutbox: the thread's live view of the outbox, and each send result for the screen to show.
 */
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { featureFlags } from '../config/featureFlags';
import {
  drainOutbox,
  hydrateOutbox,
  readOutbox,
  releaseOutbox,
  subscribeOutbox,
  type OutboxEvent,
  type OutboxItem,
} from '../services/messageOutbox';
import { useCurrentUser } from './useCurrentUser';
import { isEffectivelyOnline, useNetworkStatus } from './useNetworkStatus';

export function useMessageOutboxDrain(): void {
  const uid = useCurrentUser()?.id ?? null;
  const online = isEffectivelyOnline(useNetworkStatus());
  useEffect(() => {
    if (featureFlags.c3StyleB && uid && online) void drainOutbox(uid);
  }, [uid, online]);
  useEffect(() => {
    if (!featureFlags.c3StyleB || !uid) return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void drainOutbox(uid);
    });
    return () => {
      sub.remove();
      releaseOutbox();
    };
  }, [uid]);
}

export function useMessageOutbox(uid: string | null | undefined, onEvent: (event: OutboxEvent) => void): OutboxItem[] {
  const [list, setList] = useState<OutboxItem[]>(() => (uid ? readOutbox(uid) : []));
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!uid) return undefined;
    const off = subscribeOutbox((next, event) => {
      setList(next);
      if (event) handler.current(event);
    });
    void hydrateOutbox(uid).then(() => setList(readOutbox(uid)));
    return off;
  }, [uid]);
  return list;
}
