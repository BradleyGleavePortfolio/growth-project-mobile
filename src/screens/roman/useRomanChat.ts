/**
 * useRomanChat — chat state machine for RomanChatScreen.
 *
 * Owns: open-or-resume the session, load the first page of messages
 * (newest-first, paged per ListMessagesQueryDto), append a user turn, send it,
 * and fold Roman's settled reply (DECLARED DEVIATION: buffered SSE read — see
 * romanApi header) back into the list. All backend calls go through romanApi,
 * which validates every response against the cited contract and maps errors to
 * the typed RomanApiError union.
 *
 * Concurrency / cleanup (FIFTY_FAILURES #31/#32): an `active` ref gates every
 * post-await setState so a state update never lands after unmount, and an
 * in-flight send is guarded by `sendingRef` so a double-tap cannot fire two
 * turns. Failed sends DO NOT clear the draft — the screen preserves it for
 * retry (brief §3).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteSession as apiDeleteSession,
  listMessages,
  openOrResumeSession,
  RomanApiError,
  sendMessage,
  type RomanAssistantReply,
  type RomanMessage,
  type RomanSession,
  type RomanSurface,
} from '../../api/romanApi';
import { logger } from '../../utils/logger';

/** Page size for the initial / "load older" message fetch (<= backend cap 100). */
const PAGE_LIMIT = 30;

export type RomanChatPhase =
  | 'loading' // opening the session / loading first page
  | 'ready' // session open, messages (possibly empty) shown
  | 'unavailable' // backend feature gate off (404) — calm typed state
  | 'offline' // no connection
  | 'error'; // generic load failure

export interface RomanSendError {
  kind: RomanApiError['kind'];
  message: string;
  retryAfterSeconds?: number;
}

/**
 * Outcome of a send attempt, so the screen can distinguish the two failure
 * modes the R1 code audit (F5) requires us to keep separate:
 *   - 'sent'        — the turn persisted; clear the composer.
 *   - 'send-failed' — the turn did NOT persist; keep the draft for retry.
 *   - 'noop'        — nothing was sent (empty/duplicate guard).
 */
export type RomanSendOutcome = 'sent' | 'send-failed' | 'noop';

export interface UseRomanChatResult {
  phase: RomanChatPhase;
  session: RomanSession | null;
  /**
   * True when the resumed session had no prior messages on open — i.e. this is
   * the user's first encounter with Roman, so the greeting shows the §2.1
   * self-introduction rather than returning-user copy (U1). Latched at open and
   * not flipped by the optimistic append of the first turn.
   */
  isFirstOpen: boolean;
  /** Oldest-first; presented newest-at-bottom and always scrolled into view. */
  messages: RomanMessage[];
  sending: boolean;
  /** Set when the last send failed (turn NOT persisted); screen shows retry. */
  sendError: RomanSendError | null;
  nextCursor: string | null;
  loadingOlder: boolean;
  reload: () => void;
  loadOlder: () => void;
  send: (content: string) => Promise<RomanSendOutcome>;
  clearSendError: () => void;
}

function phaseFromError(err: unknown): RomanChatPhase {
  if (err instanceof RomanApiError) {
    if (err.kind === 'unavailable') return 'unavailable';
    if (err.kind === 'offline') return 'offline';
  }
  return 'error';
}

export function useRomanChat(surface: RomanSurface): UseRomanChatResult {
  const [phase, setPhase] = useState<RomanChatPhase>('loading');
  const [session, setSession] = useState<RomanSession | null>(null);
  const [isFirstOpen, setIsFirstOpen] = useState(false);
  const [messages, setMessages] = useState<RomanMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sendError, setSendError] = useState<RomanSendError | null>(null);

  const active = useRef(true);
  const sendingRef = useRef(false);
  const sessionRef = useRef<RomanSession | null>(null);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const open = useCallback(async () => {
    if (active.current) setPhase('loading');
    try {
      const s = await openOrResumeSession(surface);
      const page = await listMessages(s.id, { limit: PAGE_LIMIT });
      if (!active.current) return;
      sessionRef.current = s;
      setSession(s);
      // First open = the resumed session carries no prior turns. Latched here so
      // the greeting's §2.1 self-introduction is chosen on the empty state and
      // does not flip mid-conversation (U1).
      setIsFirstOpen(s.messageCount === 0 && page.messages.length === 0);
      // Backend returns newest-first; present oldest-first so the inverted
      // list reads naturally bottom-up.
      setMessages([...page.messages].reverse());
      setNextCursor(page.nextCursor);
      setPhase('ready');
    } catch (err) {
      logger.warn('useRomanChat.open', err);
      if (!active.current) return;
      setPhase(phaseFromError(err));
    }
  }, [surface]);

  useEffect(() => {
    open();
  }, [open]);

  const loadOlder = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || nextCursor == null || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await listMessages(s.id, {
        cursor: nextCursor,
        limit: PAGE_LIMIT,
      });
      if (!active.current) return;
      // Older messages prepend (oldest-first list).
      setMessages((prev) => [...[...page.messages].reverse(), ...prev]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      logger.warn('useRomanChat.loadOlder', err);
      // A paging failure is non-fatal: keep the current list, surface nothing
      // destructive. The user can pull again.
    } finally {
      if (active.current) setLoadingOlder(false);
    }
  }, [nextCursor, loadingOlder]);

  const send = useCallback(async (content: string): Promise<RomanSendOutcome> => {
    const trimmed = content.trim();
    const s = sessionRef.current;
    if (trimmed === '' || !s || sendingRef.current) return 'noop';
    sendingRef.current = true;
    setSending(true);
    setSendError(null);

    // Optimistically append the user turn with a temporary id so the list
    // updates immediately. We ROLL IT BACK ONLY when the SEND itself fails
    // (FIFTY_FAILURES #30) — never when a post-send refresh fails (F5).
    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: RomanMessage = {
      id: optimisticId,
      role: 'user',
      content: trimmed,
      interrupted: false,
      createdAt: new Date().toISOString(),
    };
    if (active.current) setMessages((prev) => [...prev, optimistic]);

    let reply: RomanAssistantReply;
    try {
      reply = await sendMessage(s.id, trimmed);
    } catch (err) {
      // The SEND failed: the backend did not persist the turn. Roll the
      // optimistic user turn back and surface a retryable send error. The
      // screen preserves the draft so the user can send it again.
      logger.warn('useRomanChat.send', err);
      if (active.current) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        const e = err instanceof RomanApiError ? err : null;
        setSendError({
          kind: e?.kind ?? 'generic',
          message: e?.message ?? 'That request did not complete.',
          retryAfterSeconds: e?.retryAfterSeconds,
        });
      }
      sendingRef.current = false;
      if (active.current) setSending(false);
      return 'send-failed';
    }

    // The send SUCCEEDED: the user turn (and Roman's reply) are persisted. From
    // here on we must NOT roll the user turn back, even if the canonical
    // refresh fails — doing so would discard a persisted turn and (without send
    // idempotency) invite a duplicate on retry (F5).
    if (!active.current) {
      sendingRef.current = false;
      return 'sent';
    }

    // Fold Roman's settled reply in beside the optimistic user turn so the
    // thread is complete immediately, independent of the refresh below.
    const localAssistant: RomanMessage = {
      id: reply.messageId ?? `assistant-${Date.now()}`,
      role: 'assistant',
      content: reply.text,
      interrupted: reply.interrupted,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, localAssistant]);

    try {
      // Reconcile with the canonical backend page so the optimistic stand-ins
      // are replaced by their persisted shapes (real ids, ordering, cursor).
      const page = await listMessages(s.id, { limit: PAGE_LIMIT });
      if (active.current) {
        setMessages([...page.messages].reverse());
        setNextCursor(page.nextCursor);
      }
    } catch (err) {
      // A refresh failure is NON-destructive: the turn is already persisted and
      // shown via the optimistic + local-reply pair. Log it and leave the
      // visible thread intact; the next reload reconciles ids.
      logger.warn('useRomanChat.send.refresh', err);
    } finally {
      sendingRef.current = false;
      if (active.current) setSending(false);
    }
    return 'sent';
  }, []);

  const clearSendError = useCallback(() => setSendError(null), []);

  return {
    phase,
    session,
    isFirstOpen,
    messages,
    sending,
    sendError,
    nextCursor,
    loadingOlder,
    reload: open,
    loadOlder,
    send,
    clearSendError,
  };
}

/** Exposed for an explicit "clear conversation" affordance (soft-delete). */
export async function softDeleteRomanSession(sessionId: string): Promise<void> {
  return apiDeleteSession(sessionId);
}
