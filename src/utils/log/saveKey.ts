import { randomUUID } from 'expo-crypto';

/**
 * FOOD-1-M R3 (operator ruling): one client key per intended save, made at the tap and kept through
 * every retry, as the offline queue keeps its entry id. A save whose answer never came (no reply, or a
 * server error) keeps its key here, so the same food or water tapped again sends the same key and the
 * server keeps one row. A save the server answered, or refused, lets its key go.
 */
const unanswered = new Map<string, string[]>();

/** Sign-out (clientStore.reset): a key never passes from one account to the next on the same phone. */
export const forgetSaveKeys = (): void => unanswered.clear();

/** The same shape as the offline queue's ids, so one key can pass from the online try to the queue. */
export const newSaveKey = (): string => `pfl_${randomUUID()}`;

/** A value with its object keys in one order, so the same save always reads as the same intent. */
const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
      : v;

/**
 * FR-916 F1 / FR-916R2 F1: one food save, one intent, whichever path sends it (repeat, Recent, search, manual;
 * online or queued). The intent is only what every path sends the same way: the day, the meal, the portion
 * (the multiplier: for one food, the same grams), the plan link and the food (its server id, or the food it
 * creates). The entered amount (original_quantity / original_unit) is left out: Recent can prefill the same
 * portion with another amount, as "1 serving" for a hand-entered "2 servings".
 */
export function foodSaveIntent(
  log: { date: string; meal_type: string; quantity_multiplier: number; plan_slot_id?: string; fills_usual_meal?: boolean },
  food: unknown,
): unknown {
  const { date, meal_type, quantity_multiplier: m, plan_slot_id, fills_usual_meal } = log;
  return ['food', date, meal_type, Math.round(m * 1e6) / 1e6, plan_slot_id ?? null, fills_usual_meal === true, canonical(food)];
}

/**
 * Runs one intended save with its key. `intent` is everything the save sends except the key. Each lost
 * answer keeps its own key, so the same food twice in one repeated meal, both lost, are two kept keys: each
 * later save of that intent takes one (the occurrence), and a save after an answered one gets a new key.
 */
export async function withSaveKey<T>(intent: unknown, save: (key: string) => Promise<T>): Promise<T> {
  const id = JSON.stringify(intent);
  const kept = unanswered.get(id) ?? [];
  const key = kept.shift() ?? newSaveKey();
  if (kept.length === 0) unanswered.delete(id);
  try {
    return await save(key);
  } catch (err) {
    const status = (err as { response?: { status?: number } } | null)?.response?.status;
    if (!status || status >= 500) unanswered.set(id, [...(unanswered.get(id) ?? []), key]);
    throw err;
  }
}
