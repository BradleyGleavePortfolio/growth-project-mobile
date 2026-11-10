/**
 * SEND-ONCE-PHONE (182-S10, the phone half of b#1228): one Idempotency-Key per draft.
 *
 * The server answers a resend that carries the first send's key with the first row (send-once rule, b#1228), so the
 * phone keeps that key with the draft for Send again, Publish again and Retry, and only there:
 * - made at the first send of these words;
 * - kept after a failure that may have stored the first try or stored nothing under the key: no answer, a timeout,
 *   offline, a 5xx, a 429, any other 4xx, a 2xx the phone could not read, an uncoded failure;
 * - replaced when the words change, when the send succeeded (the draft ends), and after a 400 or 409 answer (the
 *   server read this send and refused it; a 409 IDEMPOTENCY_KEY_REUSED means the key is spent on other words);
 *   Roman also after a coded frame once the stream opened (the turn is stored with no reply; under the same key the
 *   server could only replay that, so Send again would never ask once more), but not after ROMAN_REPLY_PENDING: the
 *   first send may still store its reply, and the same key then replays it.
 * Two separate sends of the same words are two drafts, so two keys. A draft kept on the device keeps its key there
 * (lib/chatDrafts `keyFor` / `keepFailed`); a draft held in screen state keeps it in the screen (useDraftSendKey).
 */
import { useMemo, useRef } from 'react';
import { generateIdempotencyKey } from '../utils/idempotency';

function answeredStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { status?: unknown; response?: { status?: unknown } };
  if (typeof e.status === 'number') return e.status; // CommunityApiError, RomanApiError
  const status = e.response?.status; // an axios error with an answer
  return typeof status === 'number' ? status : undefined;
}

/**
 * Whether a failed send keeps its key for Send again: every failure but a 400 or 409 answer, and (Roman) a coded frame
 * after the stream opened, which a same-key resend could only replay (romanApi RomanKeySpentError; ROMAN_REPLY_PENDING
 * is not one: the first send may still store its reply).
 */
export function failedSendKeepsKey(err: unknown): boolean {
  if ((err as { sendOnceKeySpent?: unknown } | null)?.sendOnceKeySpent === true) return false;
  const status = answeredStatus(err);
  return status !== 400 && status !== 409;
}

export interface DraftSendKey {
  /** The key for sending these words: the kept one when the words are the same, else a new one. */
  keyFor: (words: string) => string;
  /** The send succeeded: the draft ended, so the next send is a new key. */
  sent: () => void;
  /** The send failed: keep the key for Send again unless the server answered a 400 or 409. */
  failed: (err: unknown) => void;
}

/** The send-once key of a draft held only in screen state (it goes when the screen closes, with the draft). */
export function useDraftSendKey(): DraftSendKey {
  const held = useRef<{ words: string; key: string } | null>(null);
  return useMemo<DraftSendKey>(() => ({
    keyFor: (words) => {
      if (held.current?.words !== words) held.current = { words, key: generateIdempotencyKey() };
      return held.current.key;
    },
    sent: () => { held.current = null; },
    failed: (err) => { if (!failedSendKeepsKey(err)) held.current = null; },
  }), []);
}
