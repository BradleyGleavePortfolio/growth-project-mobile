/**
 * SC-M1 (agent 168): one space's stream. The list is the server's page set (keyset `before`, newest first), keyed by the
 * signed-in user and the space. Rows the viewer sends live here until the server list carries them: sending, waiting
 * (written offline, sent when the phone is back online) or failed (Try again reuses the same Idempotency-Key). They are
 * kept per user and space for the session, so leaving the space and coming back keeps them (owner chat-discard op 1).
 * New rows come from a 10 s poll floor plus a refetch whenever the realtime ping refreshes community/me; the realtime
 * payload is never drawn (the server list already leaves out deleted rows and blocked people either way).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { generateIdempotencyKey } from '../../../utils/idempotency';
import { authEvents } from '../../../utils/authEvents';
import { useCommunityMe } from '../../../hooks/useCommunity';
import { isNotFound, spaceChatApi, type SpaceMessage, type SpaceMessagePage } from './spaceChatApi';

export type PendingState = 'sending' | 'waiting' | 'failed' | 'sent';
export interface PendingRow { localId: string; key: string; body: string; createdAt: string; state: PendingState; serverId?: string }

const pendingStore = new Map<string, PendingRow[]>();
try {
  authEvents.on('logout', () => pendingStore.clear());
  authEvents.on('login', () => pendingStore.clear());
} catch {
  // A test double without named events.
}

export const spaceChatKey = (userId: string, cohortId: string) => ['community', 'space-chat', userId, cohortId] as const;

export function useSpaceChat(cohortId: string, userId: string | null, isOnline: boolean) {
  const qc = useQueryClient();
  const uid = userId ?? '';
  const key = useMemo(() => spaceChatKey(uid, cohortId), [uid, cohortId]);
  const list = useInfiniteQuery({
    queryKey: key,
    enabled: !!userId && !!cohortId,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => spaceChatApi.list(cohortId, pageParam),
    getNextPageParam: (last: SpaceMessagePage) => last.next_before ?? undefined,
    refetchInterval: 10_000,
    retry: (n, err) => !isNotFound(err) && n < 2,
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

  const scope = `${uid}:${cohortId}`;
  const [pending, setPendingState] = useState<PendingRow[]>(() => pendingStore.get(scope) ?? []);
  useEffect(() => setPendingState(pendingStore.get(scope) ?? []), [scope]);
  const setPending = useCallback((fn: (rows: PendingRow[]) => PendingRow[]) => {
    const next = fn(pendingStore.get(scope) ?? []);
    pendingStore.set(scope, next);
    setPendingState(next);
  }, [scope]);
  const patch = useCallback((localId: string, change: Partial<PendingRow>) =>
    setPending((rows) => rows.map((r) => (r.localId === localId ? { ...r, ...change } : r))), [setPending]);

  const deliver = useCallback((row: PendingRow) => {
    patch(row.localId, { state: 'sending' });
    spaceChatApi.send(cohortId, row.body, row.key).then(
      (sent) => {
        patch(row.localId, { state: 'sent', serverId: sent.id });
        void qc.invalidateQueries({ queryKey: key });
      },
      () => patch(row.localId, { state: 'failed' }),
    );
  }, [cohortId, patch, qc, key]);

  const send = useCallback((body: string) => {
    const k = generateIdempotencyKey();
    const row: PendingRow = { localId: k, key: k, body, createdAt: new Date().toISOString(), state: isOnline ? 'sending' : 'waiting' };
    setPending((rows) => [...rows, row]);
    if (isOnline) deliver(row);
  }, [isOnline, deliver, setPending]);

  // Back online: rows written offline go out, oldest first.
  useEffect(() => {
    if (!isOnline) return;
    (pendingStore.get(scope) ?? []).filter((r) => r.state === 'waiting').forEach(deliver);
  }, [isOnline, scope, deliver]);

  const messages: SpaceMessage[] = useMemo(() => {
    const seen = new Set<string>();
    const out: SpaceMessage[] = [];
    for (const page of list.data?.pages ?? []) {
      for (const m of page.messages) if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
    }
    return out;
  }, [list.data]);

  // A sent row leaves the local list once the server list carries it.
  useEffect(() => {
    const ids = new Set(messages.map((m) => m.id));
    if (pending.some((r) => r.serverId && ids.has(r.serverId))) {
      setPending((rows) => rows.filter((r) => !(r.serverId && ids.has(r.serverId))));
    }
  }, [messages, pending, setPending]);

  const removeLocal = useCallback((localId: string) => setPending((rows) => rows.filter((r) => r.localId !== localId)), [setPending]);

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

  const markRead = useCallback((messageId: string) => {
    if (read.isError) return;
    spaceChatApi.markRead(cohortId, messageId).catch(() => undefined);
  }, [cohortId, read.isError]);

  return {
    list,
    messages,
    pending,
    noAccess: list.isError && isNotFound(list.error),
    // Hidden whenever the server has no read route (404) or the read failed.
    readCursor: read.isSuccess ? read.data : null,
    send,
    retry: deliver,
    removeLocal,
    remove,
    dropAuthor,
    markRead,
  };
}
