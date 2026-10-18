/**
 * Send to {coach} (SHARE-A, featureFlags.shareSendV1): POST /messages with `card: { type: 'share', snapshot }` alone
 * (backend SHARE-BE `share-card.ts`, stored as card_type 'share'; the thread bubble is mobile PR B). The snapshot is
 * the card's number, words and dates only. A server without SHARE-BE refuses the unknown `card` field with a 400, and
 * no current coach is a 409: both mean "not available" (SoT A5 rule 5); anything else may be tried again.
 */
import axios from 'axios';
import api from '../services/api';

export type ShareSnapshot = { kind: 'weigh_in_run' | 'recent_best'; value: number; words: string; from?: string; to: string };

export type ShareSendResult = 'sent' | 'unavailable' | 'failed';

export async function sendShareCard(snapshot: ShareSnapshot, clientMessageId: string): Promise<ShareSendResult> {
  try {
    await api.post('/messages', { card: { type: 'share', snapshot }, client_message_id: clientMessageId });
    return 'sent';
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    return status === 400 || status === 409 ? 'unavailable' : 'failed';
  }
}
