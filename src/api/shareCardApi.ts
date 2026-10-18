/**
 * Send to {coach} (SHARE-A, featureFlags.shareSendV1): `card: { type: 'share', snapshot }` alone on POST /messages
 * (backend SHARE-BE `share-card.ts`, stored as card_type 'share'). The snapshot is the card's number, words and dates
 * only. SHARE-B: the sheet sends it through the client's thread outbox (services/messageOutbox sendCardViaOutbox), so
 * offline it waits and sends on reconnect; a refusal (a 400 from a server without SHARE-BE) means "not available"
 * (SoT A5 rule 5). readShareCard reads a thread row's card back.
 */
export type ShareSnapshot = { kind: 'weigh_in_run' | 'recent_best'; value: number; words: string; from?: string; to: string };

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
