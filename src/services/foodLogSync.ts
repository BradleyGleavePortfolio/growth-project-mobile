// Sends foods saved offline and shows them in the day once they land.
//
// The queue itself lives in foodLogQueue.ts. This module decides WHEN it is
// sent (sign-in / cold start, back online, back in the foreground, pull to
// refresh) and refreshes the day on screen afterwards: Food Log and Home read
// the same client store, so one reload updates both. It also tells the Food
// Log how many foods are still waiting, so a food saved offline is never
// invisible.

import { flush as flushFoodLogQueue, getQueueLength } from './foodLogQueue';
import { useClientStore } from '../store/clientStore';
import { readUserCacheSync } from '../lib/userCache';
import { logger } from '../utils/logger';

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

/** Re-reads the pending count and tells every subscriber. */
export async function notifyPendingFoodLogs(): Promise<number> {
  const pending = await readPendingFoodLogCount();
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
      flushed = (await flushFoodLogQueue()).flushed;
      const userId = readUserCacheSync()?.id;
      if (flushed > 0 && userId) {
        const store = useClientStore.getState();
        await store.loadDayData(userId, store.selectedDate);
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
