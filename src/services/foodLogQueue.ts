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
//   Key:   `pending_food_logs`
//   Value: JSON string of PendingFoodLog[]
//
//   interface PendingFoodLog {
//     id: string;        // client-side uuid so UI can track the pending row
//     createdAt: number; // Date.now() when enqueued
//     kind: 'search' | 'manual';
//     // For 'search' writes: the already-resolved food_item_id OR the full
//     // food payload if this was an OpenFoodFacts item that needs creating.
//     // For 'manual' writes: the raw manual-entry payload.
//     payload: Record<string, unknown>;
//   }

import AsyncStorage from '@react-native-async-storage/async-storage';
import { foodApi, logApi } from './api';
import { readUserCacheSync } from '../lib/userCache';
import { logger } from '../utils/logger';

// Queue key is namespaced by userId so that if two accounts share a device
// their pending logs don't cross-contaminate and a logout + login as a
// different user starts with a clean queue.
const getQueueKey = (userId?: string): string =>
  userId ? `pending_food_logs_${userId}` : 'pending_food_logs_anonymous';

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

async function readQueue(): Promise<PendingFoodLog[]> {
  const key = getQueueKey(readUserCacheSync()?.id);
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

async function writeQueue(queue: PendingFoodLog[]): Promise<void> {
  const key = getQueueKey(readUserCacheSync()?.id);
  await AsyncStorage.setItem(key, JSON.stringify(queue));
}

export async function enqueue(entry: PendingSearchLog | PendingManualLog): Promise<void> {
  const queue = await readQueue();
  const item: PendingFoodLog = {
    ...entry,
    id: `pfl_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
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

// Flush the queue to the backend. Returns the number of successfully flushed
// entries. On failure, the remaining entries stay in the queue for the next
// attempt. We stop flushing on the first failure to preserve ordering and to
// avoid a cascade if the backend is temporarily unhappy.
export async function flush(): Promise<{ flushed: number; remaining: number }> {
  let queue = await readQueue();
  if (queue.length === 0) return { flushed: 0, remaining: 0 };

  let flushed = 0;
  for (const item of [...queue]) {
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
      // Remove this entry from the queue and persist after each success so we
      // don't re-send on crash.
      queue = queue.filter((q) => q.id !== item.id);
      await writeQueue(queue);
    } catch (err) {
      logger.warn('FoodLogQueue', 'flush stopped on error', err);
      break;
    }
  }
  return { flushed, remaining: queue.length };
}
