/**
 * useRomanChats: state for "Your conversations with Roman".
 *
 * - Lists every chat of the signed-in user, newest first, one backend page at
 *   a time (keyset cursor, GET /roman/sessions).
 * - Delete one: the row leaves the list at once (optimistic) and comes back in
 *   its place if the server does not confirm. A repeat delete of an erased
 *   chat is a quiet 204 on the server (#635 C-635-2); a 404 means the chat is
 *   already gone for this account, which is the state the person asked for.
 * - Delete all: the list empties at once; on failure the previous list comes
 *   back, and when the server may have erased part of it the list is re-read
 *   so it shows exactly what is left.
 * - Bound to one account and sign-in (mobile #331 Sol A-331-4). The list is
 *   loaded under an AccountBinding (services/accountBinding.ts) and every
 *   request, read or delete, carries it: the API client sends it only with
 *   that account's credential, and any auth change (sign-out, sign-in, even
 *   the same account signing in again) aborts it, clears the list at once and
 *   reads it again for whoever is signed in now. A delete runs only for the
 *   binding the person confirmed it under (`deleteOne(chat, binding)`), so a
 *   confirm sheet or retry left over from another sign-in does nothing.
 * - Erased chats stay erased on screen (Sol B-331-5): a chat the server
 *   confirmed deleted (or already gone) is remembered for this binding and
 *   never re-added by a page that was read before the erase settled, and a
 *   page read before Delete all settled is dropped and read again.
 *   Reloads asked for while Delete all runs wait for it to settle.
 * - Nothing is stored on the device. Message text never enters this hook.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  romanChatsApi as defaultApi,
  type RomanChatsApi,
  type RomanChatsFailure,
  type RomanChatSummary,
} from '../../api/romanChatsApi';
import {
  bindingIsCurrent,
  captureAccountBinding,
  onAuthEpochChange,
  type AccountBinding,
} from '../../services/accountBinding';
import { readUserCacheSync } from '../../lib/userCache';
import { reportUnexpected } from '../../lib/consultation/report';
import { romanChatsEvents } from './romanChatsEvents';
import { erasesSettled, trackErase } from './romanEraseTracker';
import { failureView, ROMAN_CHATS_COPY, type RomanChatsFailureView, type RomanChatsOp } from './romanChatsCopy';

export type RomanChatsPhase = 'loading' | 'ready' | 'error' | 'signed_out';

export interface RomanChatsNotice {
  /** What the person reads (a live region announces it). */
  text: string;
  /** Present for failures: the action to offer and the reference shown. */
  failure?: RomanChatsFailureView;
  /** Runs the failed operation again, when that is the right next step. */
  retry?: () => void;
}

export interface UseRomanChatsResult {
  phase: RomanChatsPhase;
  /** Set when phase is 'error'. */
  loadFailure: RomanChatsFailureView | null;
  chats: RomanChatSummary[];
  hasMore: boolean;
  loadingMore: boolean;
  deletingAll: boolean;
  /** Single deletes still waiting for the server (Delete all waits for them). */
  pendingCount: number;
  notice: RomanChatsNotice | null;
  /** The account the list belongs to (null while signed out). */
  ownerId: string | null;
  /**
   * The account and sign-in the list was loaded under (null while signed out
   * or loading for a new sign-in). A confirm sheet records it when it opens
   * and passes it back to deleteOne / deleteAll.
   */
  binding: AccountBinding | null;
  reload: () => void;
  loadMore: () => void;
  /** Deletes one chat, only if `binding` is still the list's binding. */
  deleteOne: (chat: RomanChatSummary, binding: AccountBinding | null) => void;
  /** Deletes every chat, only if `binding` is still the list's binding. */
  deleteAll: (binding: AccountBinding | null) => void;
  /** Drop a chat that the transcript screen erased or found gone. */
  forget: (id: string, text?: string) => void;
  clearNotice: () => void;
}

export interface UseRomanChatsOptions {
  api?: RomanChatsApi;
  /** The signed-in user right now. */
  sessionUserId?: () => string | null;
  /** Who is signed in right now, as a binding (tests may replace it). */
  captureBinding?: () => Promise<AccountBinding | null>;
}

const defaultSessionUserId = () => readUserCacheSync()?.id ?? null;

/** Newest first: started_at desc, then id desc (the server order). */
export function compareChats(a: RomanChatSummary, b: RomanChatSummary): number {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

const WHERE: Record<RomanChatsOp, string> = {
  load: 'GET /roman/sessions',
  load_more: 'GET /roman/sessions (next page)',
  delete_one: 'DELETE /roman/sessions/:id',
  delete_all: 'DELETE /roman/sessions',
  read: 'GET /roman/sessions/:id/messages',
};

/** The view for a failure; unknown failures go to Sentry (no content, no ids). */
export function viewAndReport(op: RomanChatsOp, f: RomanChatsFailure): RomanChatsFailureView {
  const view = failureView(op, f);
  if (view.report && f.reason === 'unexpected') {
    reportUnexpected(`roman-chats ${WHERE[op]}`, { status: f.status, code: f.code, requestId: f.requestId });
  } else if (view.report && f.reason === 'query_invalid') {
    reportUnexpected(`roman-chats ${WHERE[op]}`, { status: 400, code: 'ROMAN_SESSIONS_QUERY_INVALID', requestId: f.requestId });
  }
  return view;
}

export function useRomanChats({
  api = defaultApi,
  sessionUserId = defaultSessionUserId,
  captureBinding = captureAccountBinding,
}: UseRomanChatsOptions = {}): UseRomanChatsResult {
  const [phase, setPhase] = useState<RomanChatsPhase>('loading');
  const [loadFailure, setLoadFailure] = useState<RomanChatsFailureView | null>(null);
  const [chats, setChats] = useState<RomanChatSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [notice, setNotice] = useState<RomanChatsNotice | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [binding, setBinding] = useState<AccountBinding | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const mounted = useRef(true);
  /** The account the list was loaded for. */
  const ownerRef = useRef<string | null>(null);
  /** The account and sign-in the list was loaded under; every request carries it. */
  const bindingRef = useRef<AccountBinding | null>(null);
  /** Bumped on every account change: answers for an older account are dropped. */
  const accountGen = useRef(0);
  /** Bumped on every (re)load: a superseded page is dropped. */
  const loadSeq = useRef(0);
  /**
   * Bumped when Delete all starts and when it succeeds: a page read before
   * either point may hold erased chats, so it is dropped and read again.
   */
  const readFence = useRef(0);
  /** Chats with a delete in flight: never shown, even by a reload. */
  const pending = useRef<Set<string>>(new Set());
  /** Chats the server confirmed erased (or already gone) under this binding. */
  const erased = useRef<Set<string>>(new Set());
  /** A reload asked for while Delete all was running; runs once it settles. */
  const reloadWanted = useRef(false);
  const loadingMoreRef = useRef(false);
  const deletingAllRef = useRef(false);
  const cursorRef = useRef<string | null>(null);
  /** The rows on screen right now (the snapshot Delete all rolls back to). */
  const chatsRef = useRef<RomanChatSummary[]>([]);
  chatsRef.current = chats;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setCursor = (c: string | null) => {
    cursorRef.current = c;
    setNextCursor(c);
  };

  /** Rows that may be shown: never one being deleted or already erased. */
  const visible = useCallback(
    (rows: RomanChatSummary[]) => rows.filter((c) => !pending.current.has(c.id) && !erased.current.has(c.id)),
    [],
  );

  /** Forget everything about the previous account and sign-in. */
  const resetAccount = useCallback(() => {
    accountGen.current += 1;
    loadSeq.current += 1;
    readFence.current += 1;
    ownerRef.current = null;
    bindingRef.current = null;
    pending.current = new Set();
    erased.current = new Set();
    reloadWanted.current = false;
    loadingMoreRef.current = false;
    deletingAllRef.current = false;
    setPendingCount(0);
    setOwnerId(null);
    setBinding(null);
    setChats([]);
    setCursor(null);
    setLoadingMore(false);
    setDeletingAll(false);
    setNotice(null);
    setLoadFailure(null);
    setPhase('loading');
  }, []);

  const loadRef = useRef<(opts?: { keepNotice?: boolean }) => Promise<void>>(async () => undefined);

  /** The account changed under a request: start over for whoever is signed in. */
  const restart = useCallback(() => {
    resetAccount();
    void loadRef.current();
  }, [resetAccount]);

  const load = useCallback(
    async (opts: { keepNotice?: boolean } = {}) => {
      // Sol B-331-5: a page read while Delete all runs could show chats it
      // is erasing. Wait for it; it reads again when it settles.
      if (deletingAllRef.current) {
        reloadWanted.current = true;
        return;
      }
      const gen = accountGen.current;
      const seq = ++loadSeq.current;
      const fence = readFence.current;
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setPhase('loading');
      setLoadFailure(null);
      if (!opts.keepNotice) setNotice(null);
      let b = bindingRef.current;
      if (!bindingIsCurrent(b) || sessionUserId() !== ownerRef.current) {
        if (b) {
          // A binding from an older sign-in: nothing of it may stay.
          resetAccount();
          void loadRef.current(opts);
          return;
        }
        b = await captureBinding();
        if (!mounted.current || gen !== accountGen.current || seq !== loadSeq.current) return;
        const uid = sessionUserId();
        if (!b || !bindingIsCurrent(b) || !uid) {
          setPhase('signed_out');
          return;
        }
        bindingRef.current = b;
        ownerRef.current = uid;
        setBinding(b);
        setOwnerId(uid);
      }
      // Sol B-331-5: an erase of this account still in flight (from this
      // sign-in or the one before) settles first, so this read cannot be
      // answered from before it.
      await erasesSettled(b.subject);
      if (!mounted.current || gen !== accountGen.current || seq !== loadSeq.current) return;
      const out = await api.list(b, {});
      if (!mounted.current || gen !== accountGen.current || seq !== loadSeq.current) return;
      if (!out.ok && out.failure.reason === 'account_changed') {
        restart();
        return;
      }
      if (fence !== readFence.current) {
        // Read before an erase settled: it may hold erased chats.
        void loadRef.current({ keepNotice: true });
        return;
      }
      if (!out.ok) {
        setLoadFailure(viewAndReport('load', out.failure));
        setPhase('error');
        return;
      }
      setChats(visible(out.value.sessions));
      setCursor(out.value.nextCursor);
      setPhase('ready');
    },
    [api, captureBinding, resetAccount, restart, sessionUserId, visible],
  );
  loadRef.current = load;

  const reload = useCallback(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any auth change (sign-out, sign-in, the same account signing in again)
  // is a new sign-in: the list, every sheet built on it and every request in
  // flight for it are dropped at once, and the list is read again for
  // whoever is signed in now (or shows the signed-out state).
  useEffect(
    () =>
      onAuthEpochChange(() => {
        if (mounted.current) restart();
      }),
    [restart],
  );

  /**
   * The list's binding, when `intent` is that same binding and it is still
   * the signed-in account and sign-in. Otherwise null (and a stale list is
   * started over).
   */
  const currentBinding = useCallback(
    (intent: AccountBinding | null): AccountBinding | null => {
      const b = bindingRef.current;
      if (!b || intent !== b) return null;
      if (bindingIsCurrent(b) && sessionUserId() === ownerRef.current) return b;
      restart();
      return null;
    },
    [restart, sessionUserId],
  );

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (!cursor || loadingMoreRef.current || deletingAllRef.current) return;
    const b = currentBinding(bindingRef.current);
    if (!b) return;
    const gen = accountGen.current;
    const seq = loadSeq.current;
    const fence = readFence.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    void (async () => {
      const out = await api.list(b, { cursor });
      if (!mounted.current || gen !== accountGen.current || seq !== loadSeq.current) return;
      loadingMoreRef.current = false;
      setLoadingMore(false);
      if (!out.ok && out.failure.reason === 'account_changed') {
        restart();
        return;
      }
      if (fence !== readFence.current) return;
      if (!out.ok) {
        const view = viewAndReport('load_more', out.failure);
        if (out.failure.reason === 'cursor_invalid') {
          // The list moved: read it again from the top, and say so.
          setNotice({ text: view.message });
          void load({ keepNotice: true });
          return;
        }
        setNotice({ text: view.message, failure: view, retry: () => loadMoreRef.current() });
        return;
      }
      setChats((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...visible(out.value.sessions).filter((c) => !seen.has(c.id))];
      });
      setCursor(out.value.nextCursor);
    })();
  }, [api, currentBinding, load, restart, visible]);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  const deleteOne = useCallback(
    (chat: RomanChatSummary, intent: AccountBinding | null) => {
      if (pending.current.has(chat.id) || deletingAllRef.current) return;
      const b = currentBinding(intent);
      if (!b) return;
      const gen = accountGen.current;
      pending.current.add(chat.id);
      setPendingCount(pending.current.size);
      setNotice(null);
      setChats((prev) => prev.filter((c) => c.id !== chat.id));
      void (async () => {
        const out = await trackErase(b.subject, api.deleteOne(b, chat.id));
        if (!mounted.current || gen !== accountGen.current) return;
        if (!out.ok && out.failure.reason === 'account_changed') {
          restart();
          return;
        }
        pending.current.delete(chat.id);
        setPendingCount(pending.current.size);
        if (out.ok || out.failure.reason === 'not_found') {
          // Erased, or already gone for this account (the outcome asked for).
          // Remembered, so a page read before now can never bring it back.
          erased.current.add(chat.id);
          setChats((prev) => prev.filter((c) => c.id !== chat.id));
          setNotice({ text: out.ok ? ROMAN_CHATS_COPY.deletedOne : ROMAN_CHATS_COPY.alreadyGone });
          // The live Roman chat drops it if it holds this chat (B-376-1).
          romanChatsEvents.emitErased({ id: chat.id });
          return;
        }
        // Roll back: the chat returns to its place.
        setChats((prev) => (prev.some((c) => c.id === chat.id) ? prev : [...prev, chat].sort(compareChats)));
        const view = viewAndReport('delete_one', out.failure);
        setNotice({
          text: view.message,
          failure: view,
          retry: view.action === 'retry' || view.action === 'retry_support' ? () => deleteOneRef.current(chat, b) : undefined,
        });
      })();
    },
    [api, currentBinding, restart],
  );
  const deleteOneRef = useRef(deleteOne);
  deleteOneRef.current = deleteOne;

  const deleteAll = useCallback(
    (intent: AccountBinding | null) => {
      if (deletingAllRef.current || pending.current.size > 0) return;
      const b = currentBinding(intent);
      if (!b) return;
      const gen = accountGen.current;
      // Invalidate every page in flight: it would re-add erased chats.
      loadSeq.current += 1;
      readFence.current += 1;
      loadingMoreRef.current = false;
      setLoadingMore(false);
      deletingAllRef.current = true;
      setDeletingAll(true);
      setPhase('ready');
      setLoadFailure(null);
      setNotice(null);
      const before = chatsRef.current;
      const beforeCursor = cursorRef.current;
      setChats([]);
      setCursor(null);
      void (async () => {
        const out = await trackErase(b.subject, api.deleteAll(b));
        if (!mounted.current || gen !== accountGen.current) return;
        if (!out.ok && out.failure.reason === 'account_changed') {
          restart();
          return;
        }
        deletingAllRef.current = false;
        setDeletingAll(false);
        const again = reloadWanted.current;
        reloadWanted.current = false;
        if (out.ok) {
          // Everything read before this point is out of date.
          readFence.current += 1;
          before.forEach((c) => erased.current.add(c.id));
          setPhase('ready');
          setNotice({ text: ROMAN_CHATS_COPY.deletedAll });
          romanChatsEvents.emitErased({ id: null });
          if (again) void load({ keepNotice: true });
          return;
        }
        const view = viewAndReport('delete_all', out.failure);
        const failed: RomanChatsNotice = {
          text: view.message,
          failure: view,
          retry: view.action === 'retry' || view.action === 'retry_support' ? () => deleteAllRef.current(b) : undefined,
        };
        // Roll back to the list as it was.
        setChats(before);
        setCursor(beforeCursor);
        setNotice(failed);
        // The server may have erased part of it: show exactly what is left.
        if (again || out.failure.reason === 'erase_incomplete' || out.failure.reason === 'unexpected') {
          void load({ keepNotice: true });
        }
      })();
    },
    [api, currentBinding, load, restart],
  );
  const deleteAllRef = useRef(deleteAll);
  deleteAllRef.current = deleteAll;

  const forget = useCallback((id: string, text?: string) => {
    erased.current.add(id);
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (text) setNotice({ text });
  }, []);

  // The transcript screen erased (or found gone) a chat of this account and
  // sign-in.
  useEffect(
    () =>
      romanChatsEvents.onGone((e) => {
        const b = bindingRef.current;
        if (!mounted.current || !b || e.ownerId !== ownerRef.current || e.epoch !== b.epoch) return;
        forget(e.id, e.notice);
      }),
    [forget],
  );

  const clearNotice = useCallback(() => setNotice(null), []);

  return {
    phase,
    loadFailure,
    chats,
    hasMore: nextCursor !== null,
    loadingMore,
    deletingAll,
    pendingCount,
    notice,
    ownerId,
    binding,
    reload,
    loadMore,
    deleteOne,
    deleteAll,
    forget,
    clearNotice,
  };
}
