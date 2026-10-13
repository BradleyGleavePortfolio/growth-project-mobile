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
import { emitTutorialSignal } from '../tutorial/tutorialEvents';
import { isHeld, isRetryLater, retryAfterMs } from '../offline/sync/retryLater';

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
  /** Set when the server refused this entry: it stays on the phone, never resent. */
  parkedAt?: number;
};

const waiting = (queue: PendingFoodLog[]) => queue.filter((q) => !q.parkedAt);

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

// ─── Owner capture / fence (S6 R3) ────────────────────────────────────────
//
// Every operation resolves the owning user id ONCE, up front, and keeps
// reading and writing the queue keyed by that captured owner. Before any
// write-back it re-checks that the owner is unchanged: if a sign-out or an
// account switch landed between the read and the write, the write is refused
// (the entry is NOT re-keyed to whoever is signed in now and never folded into
// another account's queue). `readUserCacheSync()` is the in-process identity
// mirror: on the AsyncStorage-shim build it is null until the cache has been
// hydrated, in which case the entry lands in the anonymous queue, exactly as
// before — this fence narrows attribution, it never widens it.

/** Current owner id, or undefined for the anonymous queue. */
function currentOwnerId(): string | undefined {
  return readUserCacheSync()?.id || undefined;
}

export class FoodLogQueueOwnerChangedError extends Error {
  constructor() {
    super('food-log queue owner changed during operation; write refused');
    this.name = 'FoodLogQueueOwnerChangedError';
  }
}

/** Write the queue for `owner` only if `owner` is still the signed-in identity. */
async function writeQueueFenced(
  owner: string | undefined,
  queue: PendingFoodLog[],
): Promise<void> {
  if (currentOwnerId() !== owner) throw new FoodLogQueueOwnerChangedError();
  await writeQueueForKey(getQueueKey(owner), queue);
}

// Queue changes run one at a time, each on the latest stored queue, so a food
// logged while a send is in flight is never overwritten by an older copy.
let lastChange: Promise<unknown> = Promise.resolve();

/** Apply `change` to the stored queue of `owner` (fenced) and return the result. */
function changeQueue(owner: string | undefined, change: (q: PendingFoodLog[]) => PendingFoodLog[]) {
  const run = lastChange.then(async () => {
    const next = change(await readQueueForKey(getQueueKey(owner)));
    await writeQueueFenced(owner, next);
    return next;
  });
  lastChange = run.catch(() => undefined);
  return run;
}

export async function enqueue(
  entry: PendingSearchLog | PendingManualLog,
): Promise<void> {
  const item: PendingFoodLog = {
    ...entry,
    // Crypto UUID instead of Math.random so two parallel enqueues on a fast
    // device can never collide and produce duplicate idempotency keys (R19).
    id: `pfl_${randomUUID()}`,
    createdAt: Date.now(),
  };
  await changeQueue(currentOwnerId(), (queue) => [...queue, item]);
  // Clinic tutorial: an entry accepted by the offline queue counts as the
  // client's first logged meal (it is saved and will sync).
  emitTutorialSignal('meal_logged');
}

/** Foods waiting to be sent; `includeParked` also counts the ones the server refused. */
export async function getQueueLength(opts: { includeParked?: boolean } = {}): Promise<number> {
  const queue = await readQueueForKey(getQueueKey(currentOwnerId()));
  return (opts.includeParked ? queue : waiting(queue)).length;
}

export async function clearQueue(): Promise<void> {
  // Removes only the queue of the owner captured here and now.
  await AsyncStorage.removeItem(getQueueKey(currentOwnerId()));
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

// ─── Flush ────────────────────────────────────────────────────────────────

// The server asked for a pause (Retry-After): no send before this time.
let retryNotBefore = 0;

// Flush the queue to the backend. Returns the number of successfully flushed
// entries. On "try again later" (retryLater.ts) we stop flushing, leave the
// rest queued and wait out any Retry-After. A refused item is parked (kept for
// the sign-out warning, never resent) so one broken payload can't freeze the queue.
export async function flush(): Promise<{ flushed: number; remaining: number; parked: number }> {
  // P2-1: capture the userId once at the top of flush so a sign-out mid-flush
  // cannot cause us to read from user A's key and write back into user B's.
  // S6 R3: additionally, every write-back below is fenced on that captured
  // owner still being the signed-in identity; an owner change mid-flush stops
  // the flush and leaves the remaining items where they are.
  const userId = currentOwnerId();
  const key = getQueueKey(userId);

  let queue = await readQueueForKey(key);
  let flushed = 0;
  let parked = 0;
  // Nothing is sent while the server's Retry-After runs.
  let stopped = isHeld(retryNotBefore);

  /**
   * Apply `change` to the captured owner's latest stored queue. Returns false
   * (and leaves memory + disk untouched) when the owner changed: the item stays
   * queued for its real owner and the flush stops.
   */
  const commit = async (change: (q: PendingFoodLog[]) => PendingFoodLog[]): Promise<boolean> => {
    try {
      queue = await changeQueue(userId, change);
    } catch (err) {
      if (!(err instanceof FoodLogQueueOwnerChangedError)) throw err;
      logger.warn('FoodLogQueue', 'flush stopped: queue owner changed');
      stopped = true;
      return false;
    }
    return true;
  };

  for (const item of [...queue]) {
    if (stopped) break;
    if (item.parkedAt) continue;
    // Owner changed since capture (sign-out / account switch): the item must
    // not be POSTed under another account's JWT, and nothing is written back.
    if (currentOwnerId() !== userId) {
      logger.warn('FoodLogQueue', 'flush stopped: queue owner changed');
      stopped = true;
      break;
    }
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
      // The server accepted the item. If the owner changed before the local
      // write-back, the item stays queued for its owner (idempotent by
      // `client_uuid` on retry) rather than touching another account's key.
      if (await commit((q) => q.filter((x) => x.id !== item.id))) flushed++;
    } catch (err) {
      if (!isRetryLater(err)) {
        logger.warn('FoodLogQueue', 'flush: parking item the server refused', {
          id: item.id,
          err,
        });
        const park = (q: PendingFoodLog[]) => q.map((x) => (x.id === item.id ? { ...x, parkedAt: Date.now() } : x));
        if (await commit(park)) parked++;
        continue;
      }
      const wait = retryAfterMs(err);
      if (wait > 0) retryNotBefore = Date.now() + wait;
      logger.warn('FoodLogQueue', 'flush stopped on transient error', err);
      stopped = true;
    }
  }
  return { flushed, remaining: waiting(queue).length, parked };
}
