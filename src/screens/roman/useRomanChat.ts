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
 *
 * Erased chats (B-376-1): this screen stays mounted under the history screens
 * its header opens. When the person erases the chat it holds there (Delete on
 * its row or in its transcript, or Delete all), it drops that chat at once (no
 * erased text stays on screen) and opens a fresh one; a send made before the
 * fresh chat is open waits for it, so nothing is ever sent to the erased chat.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteSession as apiDeleteSession,
  listMessages,
  openOrResumeSession,
  RomanApiError,
  RomanWireError,
  sendMessage,
  type RomanAssistantReply,
  type RomanMessage,
  type RomanSession,
  type RomanSurface,
} from '../../api/romanApi';
import { logger } from '../../utils/logger';
import type { AiRefusal } from '../../lib/ai/aiRefusal';
import type { AiDailyCap } from '../../lib/ai/aiDailyCap';
import { romanChatsEvents } from '../settings/romanChatsEvents';
import { romanChatsApi } from '../../api/romanChatsApi';
import { captureAccountBinding } from '../../services/accountBinding';

/** Page size for the initial / "load older" message fetch (<= backend cap 100). */
const PAGE_LIMIT = 30;

export type RomanChatPhase =
  | 'loading' // opening the session / loading first page
  | 'ready' // session open, messages (possibly empty) shown
  | 'unavailable' // backend feature gate off (404) — calm typed state
  | 'requiresCoach' // 403 ROMAN_REQUIRES_COACH: a client with no coach
  | 'offline' // no connection
  | 'error'; // generic load failure

export interface RomanSendError {
  kind: RomanApiError['kind'];
  message: string;
  retryAfterSeconds?: number;
  /** R2b refusal (kind `aiRefused`): consent required or egress blocked. */
  refusal?: AiRefusal;
  /** Kind `dailyCap`: when AI help resets (shown in the daily cap pop-up). */
  dailyCap?: AiDailyCap;
  /**
   * The server had already stored the user turn when this failed (an
   * in-stream error after HTTP 200). The turn stays in the thread; nothing
   * may append it again automatically (Sol B-326-3, Opus C-326-1).
   */
  turnStored?: boolean;
}

/**
 * Outcome of a send attempt, so the screen can distinguish the two failure
 * modes the R1 code audit (F5) requires us to keep separate:
 *   - 'sent'        — the turn persisted; clear the composer.
 *   - 'send-failed' — the turn did NOT persist; keep the draft for retry.
 *   - 'stored-no-reply' — the server stored the turn, then failed before
 *                     answering (in-stream refusal or error). The turn stays;
 *                     the thread is re-read from the server (B-326-3).
 *   - 'noop'        — nothing was sent (empty/duplicate guard).
 */
export type RomanSendOutcome = 'sent' | 'send-failed' | 'stored-no-reply' | 'noop';

export interface UseRomanChatResult {
  phase: RomanChatPhase;
  session: RomanSession | null;
  /**
   * True only when the account had no earlier chats and the resumed session
   * is empty. A history failure uses returning-user copy, never guesses that
   * this is a first meeting. Latched at open, not on the first optimistic turn.
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
    if (err.kind === 'requiresCoach') return 'requiresCoach';
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
  /** The open in flight, if any (never rejects). */
  const openingRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const runOpen = useCallback(async () => {
    if (active.current) setPhase('loading');
    try {
      // Check before open-or-resume creates today's chat: an empty daily
      // session alone does not mean this person has never met Roman.
      let noEarlierChats = false;
      try {
        const binding = await captureAccountBinding();
        if (binding) {
          const history = await romanChatsApi.list(binding, { limit: 1 });
          noEarlierChats = history.ok && history.value.sessions.length === 0;
        }
      } catch (err) {
        // Greeting metadata must never prevent opening or sending a chat.
        logger.warn('useRomanChat.greetingHistory', err);
      }
      const s = await openOrResumeSession(surface);
      const page = await listMessages(s.id, { limit: PAGE_LIMIT });
      if (!active.current) return;
      sessionRef.current = s;
      setSession(s);
      setIsFirstOpen(noEarlierChats && s.messageCount === 0 && page.messages.length === 0);
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

  const open = useCallback((): Promise<void> => {
    const run = runOpen();
    openingRef.current = run;
    void run.finally(() => {
      if (openingRef.current === run) openingRef.current = null;
    });
    return run;
  }, [runOpen]);

  // The chat this screen holds was erased from the history screens: drop it
  // (transcript and session id) and open a fresh one (B-376-1).
  useEffect(() => {
    const drop = (id: string | null) => {
      if (!active.current) return;
      if (id !== null && id !== sessionRef.current?.id) return;
      sessionRef.current = null;
      setSession(null);
      setMessages([]);
      setNextCursor(null);
      setSendError(null);
      void open();
    };
    const offGone = romanChatsEvents.onGone((e) => drop(e.id));
    const offErased = romanChatsEvents.onErased((e) => drop(e.id));
    return () => {
      offGone();
      offErased();
    };
  }, [open]);

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
    if (trimmed === '' || sendingRef.current) return 'noop';
    let s = sessionRef.current;
    if (!s && openingRef.current) {
      // A fresh chat is opening (the held one was just erased): send there.
      sendingRef.current = true;
      setSending(true);
      await openingRef.current;
      sendingRef.current = false;
      s = sessionRef.current;
      if (!s && active.current) setSending(false);
    }
    if (!s) return 'noop';
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
      logger.warn('useRomanChat.send', err);
      // After an HTTP 200 the backend has stored the user turn before the
      // stream failed (in-stream refusal, ROMAN_UNAVAILABLE, a cut stream).
      // Keep the turn and re-read the thread from the server; never roll it
      // back, or a retry would store it twice (Sol B-326-3, Opus C-326-1).
      const stored =
        (err instanceof RomanApiError && err.turnStored) || err instanceof RomanWireError;
      if (stored) {
        if (active.current) {
          const e = err instanceof RomanApiError ? err : null;
          setSendError({
            kind: e?.kind ?? 'generic',
            message: e?.message ?? 'Roman could not finish this answer.',
            ...(e?.refusal ? { refusal: e.refusal } : {}),
            ...(e?.dailyCap ? { dailyCap: e.dailyCap } : {}),
            turnStored: true,
          });
        }
        try {
          const page = await listMessages(s.id, { limit: PAGE_LIMIT });
          if (active.current) {
            setMessages([...page.messages].reverse());
            setNextCursor(page.nextCursor);
          }
        } catch (refreshErr) {
          // The optimistic turn stays visible; the next reload reconciles it.
          logger.warn('useRomanChat.send.storedRefresh', refreshErr);
        }
        sendingRef.current = false;
        if (active.current) setSending(false);
        return 'stored-no-reply';
      }
      // The SEND failed: the backend did not persist the turn. Roll the
      // optimistic user turn back and surface a retryable send error. The
      // screen preserves the draft so the user can send it again.
      if (active.current) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        const e = err instanceof RomanApiError ? err : null;
        setSendError({
          kind: e?.kind ?? 'generic',
          message: e?.message ?? 'That request did not complete.',
          retryAfterSeconds: e?.retryAfterSeconds,
          ...(e?.refusal ? { refusal: e.refusal } : {}),
          ...(e?.dailyCap ? { dailyCap: e.dailyCap } : {}),
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
