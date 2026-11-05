// Sends foods saved offline and shows them in the day once they land.
//
// The queue itself lives in foodLogQueue.ts. This module decides WHEN it is
// sent (sign-in / cold start, back online, back in the foreground, pull to
// refresh) and refreshes the day on screen afterwards: Food Log and Home read
// the same client store, so one reload updates both. It also tells the Food
// Log how many foods are still waiting, so a food saved offline is never
// invisible.

import { flush as flushFoodLogQueue, getQueueLength, readQueue, readSent, type PendingFoodLog, type SentFoodLog } from './foodLogQueue';
import { useClientStore } from '../store/clientStore';
import { readUserCacheSync } from '../lib/userCache';
import { logger } from '../utils/logger';
import { featureFlags } from '../config/featureFlags';

type PendingListener = (pending: number) => void;

const listeners = new Set<PendingListener>();
let inFlight: Promise<number> | null = null;

/** Number of foods saved offline that have not reached the server yet. */
export async function readPendingFoodLogCount(): Promise<number> {
  try {
    return await getQueueLength();
  } catch (err) {
    logger.warn('FoodLogSync', 'pending count read failed', err);
    return 0;
  }
}

/** OFFLINE-FOOD-M: the phone's queue (waiting and refused), or null when it cannot be read. */
async function readQueueSafe(): Promise<PendingFoodLog[] | null> {
  try {
    return await readQueue();
  } catch (err) {
    logger.warn('FoodLogSync', 'queue read failed', err);
    return null;
  }
}

/** FIX-931R2: the foods sent and not read back yet (foodLogQueue.readSent), or null when unreadable. */
async function readSentSafe(): Promise<SentFoodLog[] | null> {
  try {
    return await readSent();
  } catch (err) {
    logger.warn('FoodLogSync', 'sent foods read failed', err);
    return null;
  }
}

/** Re-reads the pending count and tells every subscriber; the day on screen gets the queue too. */
export async function notifyPendingFoodLogs(): Promise<number> {
  const inDay = featureFlags.offlineFoodInDay;
  const [pending, queue] = await Promise.all([readPendingFoodLogCount(), inDay ? readQueueSafe() : null]);
  if (queue) useClientStore.getState().showQueuedFoods?.(queue);
  listeners.forEach((listener) => listener(pending));
  return pending;
}

export function subscribePendingFoodLogs(listener: PendingListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Sends every food saved offline. When at least one lands, the selected day
 * reloads so the entry and the day's totals appear without a manual refresh.
 * Calls that overlap share one send. Never rejects; returns the number sent.
 */
export function syncFoodLogQueue(): Promise<number> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    let flushed = 0;
    try {
      const inDay = featureFlags.offlineFoodInDay;
      flushed = (await flushFoodLogQueue()).flushed;
      const userId = readUserCacheSync()?.id;
      if (flushed > 0 && userId) {
        const store = useClientStore.getState();
        // OFFLINE-FOOD-M: a food the server took stays in the day until a read of the day holds its
        // key, so a failed refresh (signal gone again) never takes it off the screen. FIX-931R2: the
        // queue keeps exactly the foods it sent (LO-931B C3: never one removed meanwhile), on disk, so
        // a restart or a revisit of the day keeps them too (LS-931R2B B1).
        if (inDay) {
          const sent = await readSentSafe();
          if (sent) store.holdSentFoods?.(sent);
        }
        await store.refreshShownDay(userId, store.selectedDate);
      }
    } catch (err) {
      logger.warn('FoodLogSync', 'offline food sync failed', err);
    } finally {
      inFlight = null;
    }
    await notifyPendingFoodLogs();
    return flushed;
  })();
  return inFlight;
}
