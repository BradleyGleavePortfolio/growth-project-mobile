/**
 * One Copilot question at a time through Roman's normal send path (the client's open Roman chat, the same safety
 * routing, consent, caps and credits), with the Copilot opt-in header so the reply carries its facts and suggestion
 * (backend #1129). Only this surface sends the header. A failed turn keeps the question; "Try again" is the client's call.
 * A failure after the server accepted the send (an in-stream error, a cut stream, no done frame) means the question is
 * already stored and charged: the turn is marked `turnStored` and never re-sent on its own (main's rule, Sol B-326-3).
 */
import { useCallback, useRef, useState } from 'react';
import { openOrResumeSession, RomanApiError, RomanWireError, sendMessage, type RomanAssistantReply } from '../../../api/romanApi';
import { parseReply, type CopilotReply } from '../../../api/copilotApi';

export interface CopilotTurn {
  id: string;
  question: string;
  askedAt: Date;
  answer: { text: string; reply: CopilotReply | null; safety?: RomanAssistantReply['safetyActions'] } | null;
  error: RomanApiError | null;
}

const LIVE = { open: openOrResumeSession, send: sendMessage };

/** 'stored': the server kept the question but sent no answer (sending again is the client's call, from the composer). */
export type AskOutcome = 'sent' | 'stored' | 'failed' | 'skipped';

export function useCopilotAsk(deps = LIVE) {
  const session = useRef<Promise<string> | null>(null);
  const busyRef = useRef(false);
  const [turns, setTurns] = useState<CopilotTurn[]>([]);
  const [busy, setBusy] = useState(false);

  const ask = useCallback(async (text: string, retryId?: string): Promise<AskOutcome> => {
    const question = text.trim();
    if (!question || busyRef.current) return 'skipped';
    busyRef.current = true;
    setBusy(true);
    const id = retryId ?? `turn-${Date.now()}`;
    const patch = (p: Partial<CopilotTurn>) => setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...p } : t)));
    if (retryId) patch({ error: null });
    else setTurns((all) => [...all, { id, question, askedAt: new Date(), answer: null, error: null }]);
    try {
      const pending = (session.current ??= deps.open('client').then((s) => s.id));
      const sessionId = await pending.catch((err: unknown) => { session.current = null; throw err; });
      const r = await deps.send(sessionId, question, { copilot: true });
      patch({ answer: { text: r.text, reply: parseReply(r.copilot), safety: r.safetyActions } });
      return 'sent';
    } catch (err) {
      const stored = (err instanceof RomanApiError && err.turnStored) || err instanceof RomanWireError;
      patch({ error: err instanceof RomanApiError ? err : new RomanApiError('generic', 'Copilot turn failed', undefined, undefined, stored) });
      return stored ? 'stored' : 'failed';
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [deps]);

  return { turns, busy, ask };
}
