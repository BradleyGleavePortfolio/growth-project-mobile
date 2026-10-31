import { randomUUID } from 'expo-crypto';

/**
 * FOOD-1-M R3 (operator ruling): one client key per intended save, made at the tap and kept through
 * every retry, as the offline queue keeps its entry id. A save whose answer never came (no reply, or a
 * server error) keeps its key here, so the same food or water tapped again sends the same key and the
 * server keeps one row. A save the server answered, or refused, lets its key go.
 */
const unanswered = new Map<string, string>();

/** Sign-out (clientStore.reset): a key never passes from one account to the next on the same phone. */
export const forgetSaveKeys = (): void => unanswered.clear();

/** The same shape as the offline queue's ids, so one key can pass from the online try to the queue. */
export const newSaveKey = (): string => `pfl_${randomUUID()}`;

/** Runs one intended save with its key. `intent` is everything the save sends except the key. */
export async function withSaveKey<T>(intent: unknown, save: (key: string) => Promise<T>): Promise<T> {
  const id = JSON.stringify(intent);
  const key = unanswered.get(id) ?? newSaveKey();
  unanswered.delete(id);
  try {
    return await save(key);
  } catch (err) {
    const status = (err as { response?: { status?: number } } | null)?.response?.status;
    if (!status || status >= 500) unanswered.set(id, key);
    throw err;
  }
}
