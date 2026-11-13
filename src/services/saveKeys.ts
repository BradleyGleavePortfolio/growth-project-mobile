/**
 * WATER-WEIGHT-KEYS-M: the one-time key (client_uuid) of a weight save.
 * (A glass of water's key is the client store's: withSaveKey in
 * src/utils/log/saveKey.ts, FR-921R2.)
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
 * session generation) ends every waiting key.
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
    /**
     * OFFLINE-WATER-WEIGHT-M (G7): the key a lost send of `save` keeps, taken (it leaves this list) for the same save
     * queued with no signal, so the queue sends it and the server keeps one row. Undefined when none waits.
     */
    take(save: string): string | undefined {
      const generation = sessionGeneration();
      waiting = waiting.filter((w) => w.generation === generation);
      const i = waiting.findIndex((w) => w.save === save);
      return i < 0 ? undefined : waiting.splice(i, 1)[0].key;
    },
  };
}
