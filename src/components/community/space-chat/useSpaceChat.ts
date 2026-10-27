/**
 * SC-M1 (agent 168), FX-871 (agent 169): one space's stream. The list is the server's page set (keyset `before`, newest
 * first), keyed by the signed-in user and the space. Rows the viewer sends live in the outbox (spaceChatOutbox: kept on
 * the device, sent one at a time) until the server list carries them. New rows come from a 10 s poll floor while the page
 * is in front (`focused`) plus a refetch whenever the realtime ping refreshes community/me; the realtime payload is never
 * drawn (the server list already leaves out deleted rows and blocked people either way).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCommunityMe } from '../../../hooks/useCommunity';
import { isNoAccess, spaceChatApi, type SpaceMessage, type SpaceMessagePage } from './spaceChatApi';
import { setSpaceOutboxOnline, spaceOutbox, startSpaceOutbox, useSpaceOutbox, type PendingRow } from './spaceChatOutbox';

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
  const pending = useSpaceOutbox(cohortId);
  const send = useCallback((body: string) => spaceOutbox.add(cohortId, body), [cohortId]);

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

  const dropFromCache = useCallback((keep: (m: SpaceMessage) => boolean) => {
    qc.setQueryData<InfiniteData<SpaceMessagePage>>(key, (data) => data && {
      ...data,
      pages: data.pages.map((p) => ({ ...p, messages: p.messages.filter(keep) })),
    });
  }, [qc, key]);

  const remove = useCallback(async (id: string) => {
    await spaceChatApi.remove(id);
    dropFromCache((m) => m.id !== id);
  }, [dropFromCache]);

  // Block: the blocked person's rows leave the stream and the cache at once (the server list leaves them out after).
  const dropAuthor = useCallback((authorId: string) => dropFromCache((m) => m.sender_user_id !== authorId), [dropFromCache]);

  /** Resolves false when the mark did not land, so the page tries again with the next row seen (FR-871 Sol B1 C). */
  const markRead = useCallback(async (messageId: string): Promise<boolean> => {
    if (read.isError) return true;
    return spaceChatApi.markRead(cohortId, messageId).then(() => true, () => false);
  }, [cohortId, read.isError]);

  return {
    list,
    messages,
    pending,
    noAccess: refusedIn === cohortId || (list.isError && isNoAccess(list.error)),
    // Hidden whenever the server has no read route (404) or the read failed.
    readCursor: read.isSuccess ? read.data : null,
    /** The read cursor answered or failed: the opening position and read marks wait for it. */
    readSettled: !read.isLoading,
    send,
    retry: (r: PendingRow) => spaceOutbox.retry(r.localId),
    removeLocal: (localId: string) => spaceOutbox.discard(localId),
    remove,
    dropAuthor,
    markRead,
  };
}
