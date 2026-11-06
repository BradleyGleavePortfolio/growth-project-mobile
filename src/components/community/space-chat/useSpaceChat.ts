/**
 * SC-M1 (agent 168), FX-871 (agent 169): one space's stream. The list is the server's page set (keyset `before`, newest
 * first), keyed by the signed-in user and the space. Rows the viewer sends live in the outbox (spaceChatOutbox: kept on
 * the device, sent one at a time) until the server list carries them. New rows come from a 10 s poll floor while the page
 * is in front (`focused`) plus a refetch whenever the realtime ping refreshes community/me; the realtime payload is never
 * drawn. The server list leaves out blocked people and an author's own deletes; a row the coach removed comes back as a
 * removal (deleted with removed_by) and keeps its place (REMOVED-BY-M2).
 * FR-909 (LS-909 B1-B3, LO-909 B1): reply mode and the press-and-hold sheet live here, next to the list and the outbox,
 * so every copy of a message's words follows it when it goes: removed or deleted here, its author blocked, the server
 * quoting it as gone or leaving it out of the loaded stretch, or the space closed. Reply mode ends, the sheet closes,
 * quotes read as removed and a waiting reply keeps only the id. A message older than the loaded page is never taken as
 * gone for that alone.
 * FR-909R2 (LO-909R2 B1, LS-909R2B B1): a read that answered this visit with no older page holds the whole space, so a
 * message it leaves out is gone, the first one and the last one included. While the read is loading, failed or has an
 * older page, a message it does not hold stays unknown.
 * FR-909R2 (LS-909R2B B2, LO-909R2 C1, C2): a Block finds its member's messages by id, from every row of this person's
 * spaces the phone has held this visit (SafetyMenu reads the spaces again before it tells the screen). A quote of a
 * message the phone never held carries no author id: only there it goes by the name it carries.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { communityKeys, useCommunityMe } from '../../../hooks/useCommunity';
import { coachCommunityKeys } from '../../../hooks/useCoachCommunity';
import { communityVoiceApi } from '../../../api/communityVoiceApi';
import { isNoAccess, spaceChatApi, type SpaceMessage, type SpaceMessagePage } from './spaceChatApi';
import {
  setSpaceOutboxOnline, spaceOutbox, startSpaceOutbox, useSpaceOutbox, type PendingRow, type SpaceReplyTarget,
} from './spaceChatOutbox';

export type { PendingRow, PendingState } from './spaceChatOutbox';

export const spaceChatKey = (userId: string, cohortId: string) => ['community', 'space-chat', userId, cohortId] as const;

export function useSpaceChat(cohortId: string, userId: string | null, isOnline: boolean, focused = true) {
  const qc = useQueryClient();
  const uid = userId ?? '';
  const key = useMemo(() => spaceChatKey(uid, cohortId), [uid, cohortId]);
  const list = useInfiniteQuery({
    queryKey: key,
    enabled: !!userId && !!cohortId,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => spaceChatApi.list(cohortId, pageParam),
    getNextPageParam: (last: SpaceMessagePage) => last.next_before ?? undefined,
    refetchInterval: focused ? 10_000 : false,
    retry: (n, err) => !isNoAccess(err) && n < 2,
  });
  // SC-BE2 read cursor, read once when the space opens (the New messages line stays where it was while you read).
  const read = useQuery({
    queryKey: ['community', 'space-chat-read', uid, cohortId],
    enabled: !!userId && !!cohortId,
    queryFn: () => spaceChatApi.getRead(cohortId),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  // FR-909R2: who wrote each message held in any of this person's spaces this visit (kept across reads), and the space
  // whose own read answered since it opened (a write on the phone is not a read).
  const authors = useRef(new Map<string, { authorId: string; name?: string }>());
  const [reads, setReads] = useState<ReadonlySet<string>>(() => new Set());
  const here = `${uid}\n${cohortId}`;
  useEffect(() => {
    authors.current = new Map();
    const note = (data?: InfiniteData<SpaceMessagePage>) => data?.pages?.forEach((p) => p.messages?.forEach((m) => {
      if (m.sender_user_id) authors.current.set(m.id, { authorId: m.sender_user_id, name: m.sender?.name });
    }));
    for (const [, data] of qc.getQueriesData<InfiniteData<SpaceMessagePage>>({ queryKey: ['community', 'space-chat', uid] })) note(data);
    return qc.getQueryCache().subscribe((e) => {
      const k = e.query.queryKey;
      if (k[0] !== 'community' || k[1] !== 'space-chat' || k[2] !== uid) return;
      note(e.query.state.data as InfiniteData<SpaceMessagePage> | undefined);
      if (e.type !== 'updated' || e.action.type !== 'success' || e.action.manual) return;
      const read = `${uid}\n${String(k[3])}`;
      setReads((r) => (r.has(read) ? r : new Set(r).add(read)));
    });
  }, [qc, uid]);

  const me = useCommunityMe();
  const lastPing = useRef(me.dataUpdatedAt);
  useEffect(() => {
    if (me.dataUpdatedAt === lastPing.current) return;
    lastPing.current = me.dataUpdatedAt;
    void qc.invalidateQueries({ queryKey: key });
  }, [me.dataUpdatedAt, qc, key]);

  useEffect(() => startSpaceOutbox(userId), [userId]);
  useEffect(() => setSpaceOutboxOnline(isOnline), [isOnline]);
  useEffect(() => spaceOutbox.onSent((id) => { void qc.invalidateQueries({ queryKey: spaceChatKey(uid, id) }); }), [qc, uid]);
  // FR-871R6 (Opus B3): a send refused with 403 / 404 closes this space for the visit, like a refused read.
  const [refusedIn, setRefusedIn] = useState<string | null>(null);
  useEffect(() => spaceOutbox.onRefused((id) => {
    if (id !== cohortId) return;
    setRefusedIn(id);
    void qc.invalidateQueries({ queryKey: spaceChatKey(uid, id) });
  }), [qc, uid, cohortId]);
  const outbox = useSpaceOutbox(cohortId);
  // FR-909 (LS-909 B3): a reply's 403 / 404 is Not sent; once that is drawn the space is read again at once, and a
  // refused read closes it.
  const unsure = outbox.filter((r) => r.state === 'failed' && r.reason === 'closed' && r.reply).map((r) => r.localId).join();
  useEffect(() => { if (unsure) void qc.invalidateQueries({ queryKey: key }); }, [unsure, qc, key]);
  const send = useCallback((body: string, reply?: SpaceReplyTarget) => spaceOutbox.add(cohortId, body, reply), [cohortId]);

  const messages: SpaceMessage[] = useMemo(() => {
    const seen = new Set<string>();
    const out: SpaceMessage[] = [];
    for (const page of list.data?.pages ?? []) {
      for (const m of page.messages) if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
    }
    return out;
  }, [list.data]);

  // A sent row leaves the outbox once the server list carries it.
  useEffect(() => spaceOutbox.settle(new Set(messages.map((m) => m.id))), [messages]);

  const noAccess = refusedIn === cohortId || (list.isError && isNoAccess(list.error));
  // FR-909: the message a reply answers (reply mode) and the row whose sheet is open, for this space only.
  const [reply, setReply] = useState<SpaceReplyTarget | null>(null);
  const [heldId, setHeld] = useState<string | null>(null);
  useEffect(() => { setReply(null); setHeld(null); }, [cohortId]);
  const isGone = useMemo(() => {
    const gone = new Set<string>();
    const shown = new Set<string>();
    let oldest = '';
    for (const m of messages) {
      shown.add(m.id);
      if (m.deleted) gone.add(m.id);
      if (m.parent?.gone) gone.add(m.parent.id);
      if (!oldest || m.created_at < oldest) oldest = m.created_at;
    }
    const whole = reads.has(here) && list.isSuccess && !list.hasNextPage;
    return (t: SpaceReplyTarget) => noAccess || !!t.gone || gone.has(t.id)
      || (!shown.has(t.id) && (whole || (!!t.at && !!oldest && t.at > oldest)));
  }, [messages, noAccess, reads, here, list.isSuccess, list.hasNextPage]);
  const pending = useMemo(() => outbox.map((r) => (r.reply && !r.reply.gone && isGone(r.reply)
    ? { ...r, reply: { id: r.reply.id, body: '', authorLabel: '', gone: true } } : r)), [outbox, isGone]);
  useEffect(() => spaceOutbox.forget((r) => r.cohortId === cohortId && !!r.reply && isGone(r.reply)), [outbox, isGone, cohortId]);
  const replying = reply && !isGone(reply) ? reply : null;
  const held = heldId && !noAccess ? messages.find((m) => m.id === heldId && !m.deleted) : undefined;
  useEffect(() => { if (reply && !replying) setReply(null); }, [reply, replying]);
  useEffect(() => { if (heldId && !held) setHeld(null); }, [heldId, held]);
  // Copy and Reply run from the sheet after it closes on iOS: they read the message as it is then, not when held.
  const now = useRef<(id: string) => SpaceMessage | undefined>(() => undefined);
  now.current = (id) => (noAccess ? undefined : messages.find((m) => m.id === id && !m.deleted));
  const readable = useCallback((id: string) => now.current(id), []);

  /** A removal, a delete or a block, at once: `keep` changes or drops the rows; their quotes, a waiting reply's words,
   *  reply mode and the open sheet go with them, in every space of this person's kept lists. A block also takes the
   *  quotes of the person's messages the phone never held, by the name the quote carries (`names`; the next read
   *  settles); a message held this visit goes by who wrote it, so someone else of the same name keeps theirs. */
  const retire = useCallback((ids: ReadonlySet<string>, keep: (m: SpaceMessage) => SpaceMessage | null, authorId?: string,
    names?: ReadonlySet<string>) => {
    const unheld = (id: string) => !authors.current.has(id);
    const went = (q: SpaceMessage['parent']) => !!q && !q.gone && (ids.has(q.id)
      || (!!names && !!q.sender_name && unheld(q.id) && names.has(q.sender_name)));
    qc.setQueriesData<InfiniteData<SpaceMessagePage>>({ queryKey: ['community', 'space-chat', uid] }, (data) => data && {
      ...data,
      pages: data.pages.map((p) => ({ ...p, messages: p.messages.flatMap((m) => {
        const k = keep(m);
        if (!k) return [];
        return [k.parent && went(k.parent) ? { ...k, parent: { id: k.parent.id, gone: true } } : k];
      }) })),
    });
    const hit = (t?: SpaceReplyTarget | null) => !!t && (ids.has(t.id) || (!!authorId && t.authorId === authorId)
      || (!!names && !t.authorId && unheld(t.id) && names.has(t.authorLabel)));
    spaceOutbox.forget((r) => hit(r.reply));
    setReply((t) => (hit(t) ? null : t));
    setHeld((h) => (h && ids.has(h) ? null : h));
  }, [qc, uid]);

  // A voice note is deleted through the voice route (m#848's communityVoiceApi.remove: the server retracts the note
  // and its chat row); a text message through the space's own (FR-871, m#879 Opus B1 / Sol B2).
  const remove = useCallback(async (id: string, voiceNoteId?: string) => {
    await (voiceNoteId ? communityVoiceApi.remove(voiceNoteId) : spaceChatApi.remove(id));
    retire(new Set([id]), (m) => (m.id === id ? null : m));
  }, [retire]);

  // FR-871R6 (m#887 Opus B1 / Sol B887-1, owner #174-4): the space's coach removes someone else's message or voice note
  // for everyone, through the same routes (the server lets the author, the workspace's coach or the platform owner
  // delete). Unlike an own delete the row keeps its place: it turns into the removal at once (no words, no player; the
  // coach reads "You removed this ...") and the list is read again for the server's copy.
  const removeForEveryone = useCallback(async (id: string, voiceNoteId?: string) => {
    await (voiceNoteId ? communityVoiceApi.remove(voiceNoteId) : spaceChatApi.remove(id));
    const removedAt = new Date().toISOString();
    retire(new Set([id]), (m) => (m.id !== id ? m : {
      ...m, body: null, voice_note: null, deleted: true, removed_at: removedAt, removed_by: { role: 'coach', user_id: uid, name: '' },
    }));
    void qc.invalidateQueries({ queryKey: key });
  }, [qc, key, uid, retire]);

  // Block: the blocked person's rows and every quote of them leave the stream and the cache at once (the server list
  // leaves them out after, and quotes their older messages as gone). FR-909R2 (LS-909R2B B2): their messages come from
  // every row held this visit, not the lists as they are now (SafetyMenu has read them again, without the person).
  const dropAuthor = useCallback((authorId: string) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const [id, a] of authors.current) {
      if (a.authorId !== authorId) continue;
      ids.add(id);
      if (a.name) names.add(a.name);
    }
    retire(ids, (m) => (m.sender_user_id === authorId ? null : m), authorId, names);
  }, [retire]);

  /** Resolves false when the mark did not land, so the page tries again with the next row seen (FR-871 Sol B1 C). */
  const markRead = useCallback(async (messageId: string): Promise<boolean> => {
    if (read.isError) return true;
    // m#871 Sol B5: a mark that moved the line refreshes the space badges and the community's unread total.
    return spaceChatApi.markRead(cohortId, messageId).then(() => {
      void qc.invalidateQueries({ queryKey: communityKeys.cohorts() });
      void qc.invalidateQueries({ queryKey: communityKeys.me() });
      // FR-871R6 (Sol B879-6): the coach's space list reads its own cache; its count drops with the read too.
      void qc.invalidateQueries({ queryKey: coachCommunityKeys.cohorts() });
      return true;
    }, () => false);
  }, [cohortId, read.isError, qc]);

  return {
    list,
    messages,
    pending,
    noAccess,
    /** FR-909: reply mode and the open sheet, only while what they hold is still readable here. */
    reply: replying,
    setReply,
    held,
    setHeld,
    readable,
    // Hidden whenever the server has no read route (404) or the read failed.
    readCursor: read.isSuccess ? read.data : null,
    /** The read cursor answered or failed: the opening position and read marks wait for it. */
    readSettled: !read.isLoading,
    send,
    retry: (r: PendingRow) => spaceOutbox.retry(r.localId),
    removeLocal: (localId: string) => spaceOutbox.discard(localId),
    remove,
    removeForEveryone,
    dropAuthor,
    markRead,
  };
}
