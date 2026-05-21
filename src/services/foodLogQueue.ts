// Food-log offline queue.
//
// Scope (intentionally small for round 2):
//   - Only food-log writes go through this queue. Water logs, weight logs, and
//     habit logs are NOT queued. They can follow in a later round.
//   - Queue lives in AsyncStorage under a single JSON array key; no SQLite
//     dependency. Entries are idempotent-ish (backend creates a new row per
//     enqueue) — users who re-open the app after a crash may see a duplicate.
//     Acceptable for v1; a client-side dedupe key can come later.
//
// AsyncStorage schema:
//   Key:   `pending_food_logs_${userId}`  (or `pending_food_logs_anonymous`)
//   Value: JSON string of PendingFoodLog[]
//
//   interface PendingFoodLog {
//     id: string;        // crypto.randomUUID — idempotency key for the server
//     createdAt: number; // Date.now() when enqueued
//     kind: 'search' | 'manual';
//     payload: Record<string, unknown>;
//   }

import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { foodApi, logApi } from './api';
import { readUserCacheSync } from '../lib/userCache';
import { logger } from '../utils/logger';

const ANONYMOUS_QUEUE_KEY = 'pending_food_logs_anonymous';

// Queue key is namespaced by userId so that if two accounts share a device
// their pending logs don't cross-contaminate and a logout + login as a
// different user starts with a clean queue.
const getQueueKey = (userId?: string): string =>
  userId ? `pending_food_logs_${userId}` : ANONYMOUS_QUEUE_KEY;

export interface PendingSearchLog {
  kind: 'search';
  // If the food already exists in the backend, pass its id. Otherwise pass the
  // `food` block and the flush will create it first.
  foodItemId?: string;
  food?: {
    name: string;
    brand_or_restaurant: string | null;
    category: string;
    serving_description: string;
    // B4: a missing gram weight (manual entry with non-mass unit) is now
    // explicitly `null` rather than the silent `100` fallback the old code
    // used to inject; the backend treats null as unknown.
    serving_size_grams: number | null;
    nutrient_basis?: 'PER_100G' | 'PER_SERVING';
    // B4: macros are `null` when the upstream row truly didn't carry a value.
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    tags: string[];
    search_aliases: string[];
  };
  log: {
    date: string;
    meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    quantity_multiplier: number;
    original_quantity?: number;
    original_unit?: string;
  };
}

export interface PendingManualLog {
  kind: 'manual';
  food: PendingSearchLog['food'];
  log: PendingSearchLog['log'];
}

export type PendingFoodLog = (PendingSearchLog | PendingManualLog) & {
  id: string;
  createdAt: number;
};

// ─── Low-level helpers (always take an explicit key) ──────────────────────

async function readQueueForKey(key: string): Promise<PendingFoodLog[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logger.warn('FoodLogQueue', 'readQueue failed', err);
    return [];
  }
}

async function writeQueueForKey(
  key: string,
  queue: PendingFoodLog[],
): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(queue));
}

async function readQueue(): Promise<PendingFoodLog[]> {
  return readQueueForKey(getQueueKey(readUserCacheSync()?.id));
}

async function writeQueue(queue: PendingFoodLog[]): Promise<void> {
  await writeQueueForKey(getQueueKey(readUserCacheSync()?.id), queue);
}

export async function enqueue(
  entry: PendingSearchLog | PendingManualLog,
): Promise<void> {
  const queue = await readQueue();
  const item: PendingFoodLog = {
    ...entry,
    // Crypto UUID instead of Math.random so two parallel enqueues on a fast
    // device can never collide and produce duplicate idempotency keys (R19).
    id: `pfl_${randomUUID()}`,
    createdAt: Date.now(),
  };
  queue.push(item);
  await writeQueue(queue);
}

export async function getQueueLength(): Promise<number> {
  return (await readQueue()).length;
}

export async function clearQueue(): Promise<void> {
  const key = getQueueKey(readUserCacheSync()?.id);
  await AsyncStorage.removeItem(key);
}

// ─── Anonymous-queue handover ─────────────────────────────────────────────

/**
 * On successful login, fold any items that were enqueued before the user was
 * known (the `pending_food_logs_anonymous` queue) into the freshly-signed-in
 * user's queue. The anonymous key is removed once the merge is durable.
 *
 * Silent deletion would lose user data — keep this behaviour explicit so any
 * future contributor can grep for the merge path.
 */
export async function mergeAnonymousQueueIntoUser(userId: string): Promise<{
  merged: number;
}> {
  if (!userId) return { merged: 0 };
  const anonymous = await readQueueForKey(ANONYMOUS_QUEUE_KEY);
  if (anonymous.length === 0) return { merged: 0 };

  const userKey = getQueueKey(userId);
  const userQueue = await readQueueForKey(userKey);
  // Anonymous items come first (FIFO); they were created before any of the
  // user's items by definition.
  const merged = [...anonymous, ...userQueue];
  await writeQueueForKey(userKey, merged);
  await AsyncStorage.removeItem(ANONYMOUS_QUEUE_KEY);
  return { merged: anonymous.length };
}

// ─── Error classification ─────────────────────────────────────────────────

type FlushErrorClass = 'drop' | 'stop';

function classifyFlushError(err: unknown): FlushErrorClass {
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (typeof status === 'number') {
    // 401 → keep the item, refresh-and-retry next cycle.
    if (status === 401) return 'stop';
    // 5xx → backend hiccup, retry next cycle.
    if (status >= 500) return 'stop';
    // Any other 4xx is a permanent rejection of this payload; drop the item
    // so a single bad row can't freeze the entire queue.
    if (status >= 400) return 'drop';
  }
  // Network / timeout / unknown shape → stop so we don't drop on a flaky
  // connection.
  return 'stop';
}

// ─── Flush ────────────────────────────────────────────────────────────────

// Flush the queue to the backend. Returns the number of successfully flushed
// entries. On transient failure (401, 5xx, network) we stop flushing and
// leave the remaining items in the queue. On permanent failure (4xx other
// than 401) we drop the offending item and continue with the next one so a
// single broken payload can't freeze the queue indefinitely.
export async function flush(): Promise<{ flushed: number; remaining: number; dropped: number }> {
  // P2-1: capture the userId once at the top of flush so a sign-out mid-flush
  // cannot cause us to read from user A's key and write back into user B's.
  const userId = readUserCacheSync()?.id;
  const key = getQueueKey(userId);

  let queue = await readQueueForKey(key);
  if (queue.length === 0) return { flushed: 0, remaining: 0, dropped: 0 };

  let flushed = 0;
  let dropped = 0;
  let stopped = false;

  for (const item of [...queue]) {
    if (stopped) break;
    try {
      let foodItemId: string | undefined;
      if (item.kind === 'search' && item.foodItemId) {
        foodItemId = item.foodItemId;
      } else if (item.food) {
        const res = await foodApi.create(item.food);
        foodItemId = res.data?.id;
      }
      if (!foodItemId) throw new Error('Could not resolve food item id');
      await logApi.logFood({
        date: item.log.date,
        meal_type: item.log.meal_type,
        food_item_id: foodItemId,
        quantity_multiplier: item.log.quantity_multiplier,
        original_quantity: item.log.original_quantity,
        original_unit: item.log.original_unit,
        // Pass the queue entry's client-side id as the idempotency key so
        // the backend upserts on retry rather than creating a duplicate row.
        client_uuid: item.id,
      });
      flushed++;
      queue = queue.filter((q) => q.id !== item.id);
      await writeQueueForKey(key, queue);
    } catch (err) {
      const cls = classifyFlushError(err);
      if (cls === 'drop') {
        logger.warn('FoodLogQueue', 'flush: dropping item on permanent error', {
          id: item.id,
          err,
        });
        queue = queue.filter((q) => q.id !== item.id);
        await writeQueueForKey(key, queue);
        dropped++;
        continue;
      }
      logger.warn('FoodLogQueue', 'flush stopped on transient error', err);
      stopped = true;
    }
  }
  return { flushed, remaining: queue.length, dropped };
}
