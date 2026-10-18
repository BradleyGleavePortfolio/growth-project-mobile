/**
 * Send to {coach} (SHARE-A, featureFlags.shareSendV1): POST /messages with `card: { type: 'share', snapshot }` alone
 * (backend SHARE-BE `share-card.ts`, stored as card_type 'share'; the thread bubble is mobile PR B). The snapshot is
 * the card's number, words and dates only. A server without SHARE-BE refuses the unknown `card` field with a 400, and
 * no current coach is a 409: both mean "not available" (SoT A5 rule 5); anything else may be tried again. SHARE-B: with
 * Style B on, the card goes through the thread outbox instead (services/messageOutbox), and readShareCard reads it back.
 */
import axios from 'axios';
import api from '../services/api';

export type ShareSnapshot = { kind: 'weigh_in_run' | 'recent_best'; value: number; words: string; from?: string; to: string };

export type ShareSendResult = 'sent' | 'unavailable' | 'failed';

type Loose = Partial<Record<keyof ShareSnapshot, unknown>>;
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** A thread row's `card` (SHARE-BE: `{ card_type: 'share', snapshot }`) as a snapshot this build can draw, else undefined. */
export function readShareCard(card: unknown): ShareSnapshot | undefined {
  const c = card as { card_type?: unknown; snapshot?: Loose | null } | null;
  const { kind: k, value, words, from, to }: Loose = (c?.card_type === 'share' && c.snapshot) || {};
  const kind = k === 'weigh_in_run' ? 'weigh_in_run' : k === 'recent_best' ? 'recent_best' : null;
  if (!kind || typeof value !== 'number' || !(value > 0) || typeof words !== 'string' || !words || !isDay(to)) return undefined;
  return { kind, value, words, ...(isDay(from) ? { from } : {}), to };
}

export async function sendShareCard(snapshot: ShareSnapshot, clientMessageId: string): Promise<ShareSendResult> {
  try {
    await api.post('/messages', { card: { type: 'share', snapshot }, client_message_id: clientMessageId });
    return 'sent';
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    return status === 400 || status === 409 ? 'unavailable' : 'failed';
  }
}
