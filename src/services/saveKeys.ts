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
import type { AccountBinding } from './accountBinding';
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

/**
 * FIX-972R2 (B1): the owner of a queued send. foodLogQueue.flush takes it when it takes the queue's owner: the
 * sign-in (an account binding, see accountBinding.ts; null when no token was stored) and the session generation.
 */
export interface QueuedSendOwner {
  readonly binding: AccountBinding | null;
  readonly session: number;
}

let sendingFor: QueuedSendOwner | undefined;

/**
 * FIX-972R2 (B1): starts one queued send (water, weight, a food or its log) for `owner`. The API call that `start`
 * makes (api.ts queuedSendConfig) reads the owner while it is called, before it awaits anything, and binds the request to it:
 * the request and its 401 replay go out only with that account's credential in that session; otherwise nothing is
 * sent (AccountChangedError) and the entry stays queued. A call made outside sendQueued is sent as before.
 */
export function sendQueued<T>(owner: QueuedSendOwner, start: () => T): T {
  const outer = sendingFor;
  sendingFor = owner;
  try {
    return start();
  } finally {
    sendingFor = outer;
  }
}

/** FIX-972R2 (B1): the owner of the queued send being started now (inside sendQueued), if any. */
export function queuedSendOwner(): QueuedSendOwner | undefined {
  return sendingFor;
}
