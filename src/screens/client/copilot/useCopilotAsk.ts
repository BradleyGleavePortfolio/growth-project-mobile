/**
 * One Copilot question at a time through Roman's normal send path (the client's open Roman chat, the same safety
 * routing, consent, caps and credits), with the Copilot opt-in header so the reply carries its facts and suggestion
 * (backend #1129). Only this surface sends the header. A failed turn keeps the question; "Try again" is the client's call.
 * A failure after the server accepted the send (an in-stream error, a cut stream, no done frame) means the question is
 * already stored and charged: the turn is marked `turnStored` and never re-sent on its own (main's rule, Sol B-326-3).
 * When Settings erases the chat it holds (Delete on its row or transcript, or Delete all), its turns and session go and
 * the next question opens a fresh chat, as main's Roman chat does (useRomanChat, B-376-1).
 * SEND-ONCE-PHONE (b#1228): a question keeps one send-once key (the Idempotency-Key header) while a failure leaves it
 * open (lib/sendOnce failedSendKeepsKey): Try again, or the same words asked again, sends the same key, so the server
 * answers from what the first send stored. New words, an answer, or a refusal that ends the key make a new one.
 * Each failed turn keeps its own key (by turn id), so asking another question never takes an earlier turn's Try again
 * key away (LS-953 B1); an answer or a refusal that ends a key ends it for every turn that holds it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { openOrResumeSession, RomanApiError, RomanWireError, sendMessage, type RomanAssistantReply } from '../../../api/romanApi';
import { parseReply, type CopilotReply } from '../../../api/copilotApi';
import { romanChatsEvents } from '../../settings/romanChatsEvents';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { generateIdempotencyKey } from '../../../utils/idempotency';
import { failedSendKeepsKey } from '../../../lib/sendOnce';

export interface CopilotTurn {
  id: string;
  question: string;
  askedAt: Date;
  answer: { text: string; reply: CopilotReply | null; safety?: RomanAssistantReply['safetyActions'] } | null;
  error: RomanApiError | null;
}

const LIVE = { open: openOrResumeSession, send: sendMessage };

/**
 * 'stored': the server kept the question but sent no answer; 'held': refused with no Try again (wait, daily cap, credits
 * out). Both put the question back in the composer: sending again is the client's call. 'failed': Try again on the turn.
 */
export type AskOutcome = 'sent' | 'stored' | 'held' | 'failed' | 'skipped';
const HELD = new Set(['rateLimited', 'dailyCap', 'poolEmpty']);

export function useCopilotAsk(deps = LIVE) {
  const session = useRef<Promise<string> | null>(null);
  const held = useRef<string | null>(null);
  const busyRef = useRef(false);
  const [turns, setTurns] = useState<CopilotTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [erased, setErased] = useState(0);
  const live = useRef(true);
  const drops = useRef(0);
  const kept = useRef(new Map<string, { question: string; key: string }>());

  useEffect(() => {
    live.current = true;
    const drop = (id: string | null) => {
      if (id !== null && id !== held.current) return;
      session.current = null;
      held.current = null;
      kept.current.clear();
      drops.current += 1;
      setTurns([]);
      setErased((n) => n + 1);
    };
    const offGone = romanChatsEvents.onGone((e) => drop(e.id));
    const offErased = romanChatsEvents.onErased((e) => drop(e.id));
    return () => { live.current = false; offGone(); offErased(); };
  }, []);

  const ask = useCallback(async (text: string, retryId?: string): Promise<AskOutcome> => {
    const question = text.trim();
    if (!question || busyRef.current) return 'skipped';
    busyRef.current = true;
    setBusy(true);
    const id = retryId ?? `turn-${Date.now()}`;
    const patch = (p: Partial<CopilotTurn>) => setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...p } : t)));
    if (retryId) patch({ error: null });
    else setTurns((all) => [...all, { id, question, askedAt: new Date(), answer: null, error: null }]);
    const drop = drops.current;
    const own = retryId ? kept.current.get(retryId) : undefined;
    const same = own?.question === question ? own : [...kept.current.values()].reverse().find((k) => k.question === question);
    const key = same?.key ?? generateIdempotencyKey();
    // The send ended this key: no turn holds it any more (the next ask of these words is a new send).
    const end = () => { for (const [t, k] of kept.current) if (k.key === key) kept.current.delete(t); };
    try {
      const pending = (session.current ??= deps.open('client').then((s) => (held.current = s.id)));
      const sessionId = await pending.catch((err: unknown) => { session.current = null; throw err; });
      const r = await deps.send(sessionId, question, { copilot: true, idempotencyKey: key });
      end();
      patch({ answer: { text: r.text, reply: parseReply(r.copilot), safety: r.safetyActions } });
      return 'sent';
    } catch (err) {
      if (drop !== drops.current) {
        // The chat was erased meanwhile: its turns, and their keys, are gone.
      } else if (failedSendKeepsKey(err)) kept.current.set(id, { question, key });
      else end();
      const stored = (err instanceof RomanApiError && err.turnStored) || err instanceof RomanWireError;
      patch({ error: err instanceof RomanApiError ? err : new RomanApiError('generic', 'Copilot turn failed', undefined, undefined, stored) });
      // One error tap for an answer that failed (GOAL index section 3, Sol B-S4); none once the screen has closed or
      // the chat was erased meanwhile (its turn is gone).
      if (live.current && drop === drops.current) void HapticService.error();
      return stored ? 'stored' : err instanceof RomanApiError && HELD.has(err.kind) ? 'held' : 'failed';
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [deps]);

  /** `erased` counts the drops, so the screen can clear what it drew from the erased chat. */
  return { turns, busy, ask, erased };
}
