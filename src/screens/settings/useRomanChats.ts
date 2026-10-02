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
 * - Bound to the signed-in account. Every request remembers the account it
 *   was made for; a sign-out or a sign-in as someone else clears the list and
 *   drops any answer that arrives for the previous account. A delete is never
 *   sent unless the account that loaded the list is still the one signed in.
 * - Nothing is stored on the device. Message text never enters this hook.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  romanChatsApi as defaultApi,
  type RomanChatsApi,
  type RomanChatsFailure,
  type RomanChatSummary,
} from '../../api/romanChatsApi';
import { authEvents } from '../../utils/authEvents';
import { readUserCacheSync } from '../../lib/userCache';
import { reportUnexpected } from '../../lib/consultation/report';
import { romanChatsEvents } from './romanChatsEvents';
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
  reload: () => void;
  loadMore: () => void;
  deleteOne: (chat: RomanChatSummary) => void;
  deleteAll: () => void;
  /** Drop a chat that the transcript screen erased or found gone. */
  forget: (id: string, text?: string) => void;
  clearNotice: () => void;
}

export interface UseRomanChatsOptions {
  api?: RomanChatsApi;
  /** The signed-in user right now. */
  sessionUserId?: () => string | null;
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
  }
  return view;
}

export function useRomanChats({
  api = defaultApi,
  sessionUserId = defaultSessionUserId,
}: UseRomanChatsOptions = {}): UseRomanChatsResult {
  const [phase, setPhase] = useState<RomanChatsPhase>('loading');
  const [loadFailure, setLoadFailure] = useState<RomanChatsFailureView | null>(null);
  const [chats, setChats] = useState<RomanChatSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [notice, setNotice] = useState<RomanChatsNotice | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const mounted = useRef(true);
  /** The account the list was loaded for. */
  const ownerRef = useRef<string | null>(null);
  /** Bumped on every account change: answers for an older account are dropped. */
  const accountGen = useRef(0);
  /** Bumped on every (re)load: a superseded page is dropped. */
  const loadSeq = useRef(0);
  /** Chats with a delete in flight: never shown, even by a reload. */
  const pending = useRef<Set<string>>(new Set());
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

  /** Forget everything about the previous account. */
  const resetAccount = useCallback((uid: string | null) => {
    accountGen.current += 1;
    loadSeq.current += 1;
    ownerRef.current = uid;
    pending.current = new Set();
    loadingMoreRef.current = false;
    deletingAllRef.current = false;
    setPendingCount(0);
    setOwnerId(uid);
    setChats([]);
    setCursor(null);
    setLoadingMore(false);
    setDeletingAll(false);
    setNotice(null);
    setLoadFailure(null);
    setPhase(uid ? 'loading' : 'signed_out');
  }, []);

  const load = useCallback(
    async (opts: { keepNotice?: boolean } = {}) => {
      const uid = sessionUserId();
      if (uid !== ownerRef.current || !uid) resetAccount(uid);
      if (!uid) return;
      const gen = accountGen.current;
      const seq = ++loadSeq.current;
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setPhase('loading');
      setLoadFailure(null);
      if (!opts.keepNotice) setNotice(null);
      const out = await api.list({});
      if (!mounted.current || gen !== accountGen.current || seq !== loadSeq.current) return;
      if (sessionUserId() !== uid) {
        resetAccount(sessionUserId());
        return;
      }
      if (!out.ok) {
        setLoadFailure(viewAndReport('load', out.failure));
        setPhase('error');
        return;
      }
      setChats(out.value.sessions.filter((c) => !pending.current.has(c.id)));
      setCursor(out.value.nextCursor);
      setPhase('ready');
    },
    [api, resetAccount, sessionUserId],
  );

  const reload = useCallback(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  // Sign-out clears the list at once; a sign-in (same or another account)
  // reads the list again for whoever is signed in now.
  useEffect(() => {
    const onLogout = () => {
      if (mounted.current) resetAccount(null);
    };
    const onLogin = () => {
      if (mounted.current) void load();
    };
    authEvents.on('logout', onLogout);
    authEvents.on('login', onLogin);
    return () => {
      authEvents.off('logout', onLogout);
      authEvents.off('login', onLogin);
    };
  }, [load, resetAccount]);

  /** True when the account that owns the list is still the one signed in. */
  const stillOwner = useCallback((): boolean => {
    const uid = sessionUserId();
    if (uid && uid === ownerRef.current) return true;
    resetAccount(uid);
    if (uid) void load();
    return false;
  }, [load, resetAccount, sessionUserId]);

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (!cursor || loadingMoreRef.current || deletingAllRef.current) return;
    if (!stillOwner()) return;
    const gen = accountGen.current;
    const seq = loadSeq.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    void (async () => {
      const out = await api.list({ cursor });
      if (!mounted.current || gen !== accountGen.current || seq !== loadSeq.current) return;
      loadingMoreRef.current = false;
      setLoadingMore(false);
      if (!out.ok) {
        const view = viewAndReport('load_more', out.failure);
        if (out.failure.reason === 'cursor_invalid') {
          // The list moved under us: read it again from the top, and say so.
          setNotice({ text: view.message });
          void load({ keepNotice: true });
          return;
        }
        setNotice({ text: view.message, failure: view, retry: () => loadMoreRef.current() });
        return;
      }
      setChats((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        const add = out.value.sessions.filter((c) => !seen.has(c.id) && !pending.current.has(c.id));
        return [...prev, ...add];
      });
      setCursor(out.value.nextCursor);
    })();
  }, [api, load, stillOwner]);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  const deleteOne = useCallback(
    (chat: RomanChatSummary) => {
      if (pending.current.has(chat.id) || deletingAllRef.current) return;
      if (!stillOwner()) return;
      const gen = accountGen.current;
      pending.current.add(chat.id);
      setPendingCount(pending.current.size);
      setNotice(null);
      setChats((prev) => prev.filter((c) => c.id !== chat.id));
      void (async () => {
        const out = await api.deleteOne(chat.id);
        if (!mounted.current || gen !== accountGen.current) return;
        pending.current.delete(chat.id);
        setPendingCount(pending.current.size);
        if (out.ok) {
          setNotice({ text: ROMAN_CHATS_COPY.deletedOne });
          return;
        }
        if (out.failure.reason === 'not_found') {
          // Already gone for this account: the outcome the person asked for.
          setNotice({ text: ROMAN_CHATS_COPY.alreadyGone });
          return;
        }
        // Roll back: the chat returns to its place.
        setChats((prev) => (prev.some((c) => c.id === chat.id) ? prev : [...prev, chat].sort(compareChats)));
        const view = viewAndReport('delete_one', out.failure);
        setNotice({
          text: view.message,
          failure: view,
          retry: view.action === 'retry' || view.action === 'retry_support' ? () => deleteOneRef.current(chat) : undefined,
        });
      })();
    },
    [api, stillOwner],
  );
  const deleteOneRef = useRef(deleteOne);
  deleteOneRef.current = deleteOne;

  const deleteAll = useCallback(() => {
    if (deletingAllRef.current || pending.current.size > 0) return;
    if (!stillOwner()) return;
    const gen = accountGen.current;
    // Invalidate any page in flight: it would re-add erased chats.
    loadSeq.current += 1;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    deletingAllRef.current = true;
    setDeletingAll(true);
    setNotice(null);
    const before = chatsRef.current;
    const beforeCursor = cursorRef.current;
    setChats([]);
    setCursor(null);
    void (async () => {
      const out = await api.deleteAll();
      if (!mounted.current || gen !== accountGen.current) return;
      deletingAllRef.current = false;
      setDeletingAll(false);
      if (out.ok) {
        setPhase('ready');
        setNotice({ text: ROMAN_CHATS_COPY.deletedAll });
        return;
      }
      const view = viewAndReport('delete_all', out.failure);
      const notice: RomanChatsNotice = {
        text: view.message,
        failure: view,
        retry: view.action === 'retry' || view.action === 'retry_support' ? () => deleteAllRef.current() : undefined,
      };
      // Roll back to the list as it was.
      setChats(before);
      setCursor(beforeCursor);
      setNotice(notice);
      // The server may have erased part of it: show exactly what is left.
      if (out.failure.reason === 'erase_incomplete' || out.failure.reason === 'unexpected') {
        void load({ keepNotice: true });
      }
    })();
  }, [api, load, stillOwner]);
  const deleteAllRef = useRef(deleteAll);
  deleteAllRef.current = deleteAll;

  const forget = useCallback((id: string, text?: string) => {
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (text) setNotice({ text });
  }, []);

  // The transcript screen erased (or found gone) a chat of this account.
  useEffect(
    () =>
      romanChatsEvents.onGone((e) => {
        if (!mounted.current || e.ownerId !== ownerRef.current) return;
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
    reload,
    loadMore,
    deleteOne,
    deleteAll,
    forget,
    clearNotice,
  };
}
