/**
 * WATER-WEIGHT-KEYS-M: the one-time key (client_uuid) of a water or weight save.
 *
 * The server stores a keyed save once and answers a resend of the same key
 * with the first row (backend #1206, CONTRACT 6588001442). The key is made
 * when the client saves. A send that ended with no answer, or with a server
 * error, may already be stored, so its key waits for the resend of the same
 * save (the same session and the same fields) and goes out again with it.
 * Any other answer ends the key: 2xx stored it, 4xx refused it (404 is
 * another member's key: a new key, never the same one again).
 *
 * Keys live in memory only. An app restart, a sign-out or sign-in (a new
 * session generation) or forget() ends every waiting key.
 */
import { generateIdempotencyKey } from '../utils/idempotency';
import { sessionGeneration } from './sessionFence';

/** False only when the server answered 4xx: then nothing was stored. */
export function mayBeStored(err: unknown): boolean {
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
  return !(typeof status === 'number' && status >= 400 && status < 500);
}

export function saveKeys() {
  let waiting: { generation: number; save: string; key: string }[] = [];
  return {
    /** Runs one send of `save` (its fields, as a string) with its key. */
    async send<T>(save: string, run: (key: string) => Promise<T>): Promise<T> {
      const generation = sessionGeneration();
      waiting = waiting.filter((w) => w.generation === generation);
      const i = waiting.findIndex((w) => w.save === save);
      const key = i < 0 ? generateIdempotencyKey() : waiting.splice(i, 1)[0].key;
      try {
        return await run(key);
      } catch (err) {
        if (mayBeStored(err) && generation === sessionGeneration()) waiting.push({ generation, save, key });
        throw err;
      }
    },
    /** Ends the waiting keys of the saves that `match` picks. */
    forget(match: (save: string) => boolean): void {
      waiting = waiting.filter((w) => !match(w.save));
    },
  };
}

/** The waiting keys of water saves (waterApi.log). */
export const waterKeys = saveKeys();

/** A water save, as waterKeys holds it: the save's own date and amount. */
export const waterSave = (date: string | undefined, amountMl: number): string => `${date ?? ''}|${amountMl}`;

/**
 * LS-921 B1: the client store calls this once a water read of `date` is on
 * screen (applied to the day the client sees). Only then does the client see
 * every glass the server holds for that day, so the next glass is a new save
 * with a new key. A read that is dropped (the food read failed, or another
 * day or account opened meanwhile) ends no key.
 */
export function waterDayShown(date: string): void {
  waterKeys.forget((save) => save.startsWith(`${date}|`));
}
