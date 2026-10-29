/**
 * useCommunity — React Query hooks for the Community tab (v1-5 client surface).
 *
 * Read hooks (useQuery) fetch through communityApi (which Zod-validates the
 * wire shape). Mutation hooks (useMutation) apply OPTIMISTIC updates with
 * rollback on failure per the UX gate: post / comment / send-DM / react all
 * reflect instantly, then reconcile with the server response or roll back.
 *
 * The unread badge (useCommunityBadge) updates LIVE via the Supabase Realtime
 * broadcast subscription — NOT polling. A broadcast ping invalidates the
 * `community/me` query so the authoritative unread counts refetch over REST;
 * the channel payload is never trusted for data (see communityRealtime.ts).
 */

import { useEffect } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  communityApi,
  type CommunityMeResponse,
  type CommunityTodayResponse,
  type CommunityCohortListResponse,
  type CommunityWorkspaceResponse,
  type CommunityPost,
  type CommunityComment,
  type CommunityDmThread,
  type CommunityDmMessage,
  type CommunityReactionEmoji,
} from '../api/communityApi';
import {
  COMMUNITY_BROADCAST_EVENTS,
  subscribeToCommunityUser,
  type CommunityPing,
} from '../api/communityRealtime';
import {
  isCoachRemoved,
  removedRowsApi,
  type RemovableComment,
  type RemovablePost,
} from '../api/communityRemovedRows';
import type { SearchResponse } from '../api/communitySearchApi';
import { refreshVoiceQueries } from './voiceQueryKeys';
import { communitySearchKeys } from './useCommunitySearch';

// ─── Query keys (stable, namespaced) ─────────────────────────────────────────

export const communityKeys = {
  all: ['community'] as const,
  me: () => [...communityKeys.all, 'me'] as const,
  today: () => [...communityKeys.all, 'today'] as const,
  cohorts: () => [...communityKeys.all, 'cohorts'] as const,
  posts: (workspaceId: string) =>
    [...communityKeys.all, 'posts', workspaceId] as const,
  post: (postId: string) => [...communityKeys.all, 'post', postId] as const,
  comments: (postId: string) =>
    [...communityKeys.all, 'comments', postId] as const,
  dmThreads: (workspaceId: string) =>
    [...communityKeys.all, 'dms', workspaceId] as const,
  dmMessages: (workspaceId: string, recipientId: string) =>
    [...communityKeys.all, 'dm', workspaceId, recipientId] as const,
};

// ─── Read hooks ──────────────────────────────────────────────────────────────

export function useCommunityMe(): UseQueryResult<CommunityMeResponse> {
  return useQuery({
    queryKey: communityKeys.me(),
    queryFn: () => communityApi.getMe(),
    // REST poll floor (60s) is the best-effort fallback below realtime — the
    // backend doctrine forbids removing it just because realtime exists.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useCommunityToday(): UseQueryResult<CommunityTodayResponse> {
  return useQuery({
    queryKey: communityKeys.today(),
    queryFn: () => communityApi.getToday(),
    staleTime: 30_000,
  });
}

export function useCommunityCohorts(enabled = true): UseQueryResult<CommunityCohortListResponse> {
  return useQuery({
    queryKey: communityKeys.cohorts(),
    queryFn: () => communityApi.getCohorts(),
    staleTime: 60_000,
    enabled,
  });
}

/** The community's name for the Home masthead; idle until the workspace id is known. */
export function useCommunityWorkspace(workspaceId: string | null): UseQueryResult<CommunityWorkspaceResponse> {
  return useQuery({
    queryKey: [...communityKeys.all, 'workspace', workspaceId] as const,
    queryFn: () => communityApi.getWorkspace(workspaceId as string),
    enabled: workspaceId != null,
    staleTime: 300_000,
  });
}

/** REMOVED-BY-M3: the list keeps a coach-removed post as its placeholder (communityRemovedRows). */
export function usePosts(
  workspaceId: string | null | undefined,
): UseQueryResult<RemovablePost[]> {
  return useQuery({
    queryKey: communityKeys.posts(workspaceId ?? '∅'),
    queryFn: async ({ client: qc }) => {
      const res = await removedRowsApi.listPosts(workspaceId as string);
      res.posts.forEach((row) => settleRemovedPost(qc, row));
      return res.posts;
    },
    enabled: !!workspaceId,
  });
}

/** REMOVED-BY-M3: a coach-removed reply stays as its placeholder (body null); a removed post answers []. */
export function usePostComments(
  postId: string | null | undefined,
): UseQueryResult<RemovableComment[]> {
  return useQuery({
    queryKey: communityKeys.comments(postId ?? '∅'),
    queryFn: () => removedRowsApi.listComments(postId as string),
    enabled: !!postId,
  });
}

export function useDmThreads(
  workspaceId: string | null | undefined,
): UseQueryResult<CommunityDmThread[]> {
  return useQuery({
    queryKey: communityKeys.dmThreads(workspaceId ?? '∅'),
    queryFn: () => communityApi.listDmThreads(workspaceId as string),
    enabled: !!workspaceId,
  });
}

export function useDmMessages(
  workspaceId: string | null | undefined,
  recipientId: string | null | undefined,
): UseQueryResult<CommunityDmMessage[]> {
  return useQuery({
    queryKey: communityKeys.dmMessages(workspaceId ?? '∅', recipientId ?? '∅'),
    queryFn: () =>
      communityApi.listDmMessages(workspaceId as string, recipientId as string),
    enabled: !!workspaceId && !!recipientId,
  });
}

// ─── Mutation hooks (optimistic + rollback) ──────────────────────────────────

const OPTIMISTIC_PREFIX = 'optimistic:';

function tempId(): string {
  return `${OPTIMISTIC_PREFIX}${Date.now()}-${Math.floor(
    // Display-only temp key; never sent to the server. Not a security value.
    // eslint-disable-next-line no-restricted-properties
    Math.random() * 1e6,
  )}`;
}

export function isOptimisticId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_PREFIX);
}

/**
 * Create a Hall/Lab post with an optimistic insert at the top of the feed,
 * rolling back the snapshot if the server rejects.
 */
export function useCreatePost(workspaceId: string, authorUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; body: string }) =>
      communityApi.createPost(workspaceId, input),
    onMutate: async (input) => {
      const key = communityKeys.posts(workspaceId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CommunityPost[]>(key) ?? [];
      const optimistic: CommunityPost = {
        id: tempId(),
        workspace_id: workspaceId,
        cohort_id: null,
        author_user_id: authorUserId,
        title: input.title,
        body: input.body,
        scope: 'hall',
        type: 'text',
        pinned: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted: false,
      };
      qc.setQueryData<CommunityPost[]>(key, [optimistic, ...prev]);
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(communityKeys.posts(workspaceId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: communityKeys.posts(workspaceId) });
    },
  });
}

/** Add a comment to a post with an optimistic append + rollback. */
export function useAddComment(postId: string, authorUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => communityApi.addComment(postId, body),
    onMutate: async (body) => {
      const key = communityKeys.comments(postId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CommunityComment[]>(key) ?? [];
      const optimistic: CommunityComment = {
        id: tempId(),
        post_id: postId,
        author_user_id: authorUserId,
        body,
        created_at: new Date().toISOString(),
      };
      qc.setQueryData<CommunityComment[]>(key, [...prev, optimistic]);
      return { prev };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.prev) qc.setQueryData(communityKeys.comments(postId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: communityKeys.comments(postId) });
    },
  });
}

/** Send a DM with an optimistic append + rollback. */
export function useSendDm(
  workspaceId: string,
  recipientId: string,
  senderUserId: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      communityApi.sendDm(workspaceId, recipientId, body),
    onMutate: async (body) => {
      const key = communityKeys.dmMessages(workspaceId, recipientId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CommunityDmMessage[]>(key) ?? [];
      const optimistic: CommunityDmMessage = {
        id: tempId(),
        thread_id: `${OPTIMISTIC_PREFIX}thread`,
        sender_user_id: senderUserId,
        recipient_user_id: recipientId,
        body,
        created_at: new Date().toISOString(),
        deleted: false,
      };
      qc.setQueryData<CommunityDmMessage[]>(key, [optimistic, ...prev]);
      return { prev };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(
          communityKeys.dmMessages(workspaceId, recipientId),
          ctx.prev,
        );
      }
    },
    onSettled: () => {
      qc.invalidateQueries({
        queryKey: communityKeys.dmMessages(workspaceId, recipientId),
      });
    },
  });
}

/**
 * Toggle a reaction on a post. The server answers with the post's whole
 * reaction summary, which is written into the cached post at once (the thread
 * also reads it from the mutation's data when the post itself carries none);
 * the post and the feed are then refetched.
 */
export function useReactToPost(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      postId,
      emoji,
      active,
    }: {
      postId: string;
      emoji: CommunityReactionEmoji;
      active: boolean;
    }) =>
      active
        ? communityApi.unreactToPost(postId, emoji)
        : communityApi.reactToPost(postId, emoji),
    onSuccess: (state, { postId }) => {
      if (!state) return;
      qc.setQueryData<CommunityPost>(communityKeys.post(postId), (prev) =>
        prev ? { ...prev, reactions: state.reactions } : prev,
      );
    },
    onSettled: (_state, _err, { postId }) => {
      qc.invalidateQueries({ queryKey: communityKeys.posts(workspaceId) });
      qc.invalidateQueries({ queryKey: communityKeys.post(postId) });
    },
  });
}

/**
 * Delete the caller's own post. It leaves the cached feed at once; the feed and
 * Today refetch, and the cached post is marked stale (not refetched while the
 * thread that deleted it is closing) so any later visit reloads it.
 */
export function useDeletePost(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => communityApi.deletePost(postId),
    onSuccess: (_res, postId) => {
      qc.setQueryData<CommunityPost[]>(communityKeys.posts(workspaceId), (prev) =>
        prev?.filter((p) => p.id !== postId),
      );
      qc.invalidateQueries({
        queryKey: communityKeys.post(postId),
        refetchType: 'none',
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: communityKeys.posts(workspaceId) });
      qc.invalidateQueries({ queryKey: communityKeys.today() });
    },
  });
}

// ─── Live unread badge (WebSocket subscription, NOT polling) ─────────────────

export interface CommunityBadgeState {
  /** Total unread across cohort messages + DMs + mentions. */
  total: number;
  cohortMessages: number;
  dmMessages: number;
  mentions: number;
}

const POST_QUERY_KINDS: readonly unknown[] = ['posts', 'post', 'comments', 'today'];

/** A Find search whose pages can hold a post: all kinds ('∅') or posts only. */
function isPostSearchKey(key: readonly unknown[]): boolean {
  const root = communitySearchKeys.all;
  if (key[0] !== root[0] || key[1] !== root[1]) return false;
  const kind = key[root.length + 2];
  return kind === '∅' || kind === 'post';
}

/**
 * REMOVED-BY-M3: re-read over REST the post lists, post pages, replies, Today and open Find searches
 * that can hold a post, so a removed post or reply turns into its placeholder (or leaves Find and
 * Today) with no tap. A closed such search is dropped, as for voice, so reopening it cannot show the
 * removed words first.
 */
export function refreshPostQueries(qc: QueryClient): Promise<void> {
  qc.removeQueries({ type: 'inactive', predicate: (q) => isPostSearchKey(q.queryKey) });
  return qc.invalidateQueries({
    predicate: (q) =>
      (q.queryKey[0] === 'community' && POST_QUERY_KINDS.includes(q.queryKey[1])) || isPostSearchKey(q.queryKey),
  });
}

/**
 * FR-RBM3 (class-first): once one read that came back shows a post as removed by a coach, every
 * other copy of it on the phone follows at once, even when its own re-read failed or is still out:
 * a post list row and an open post page turn into the placeholder, and Today's pinned slot and Find
 * let it go (the server leaves a removed post out of both). Copies that already match are left alone.
 */
export function settleRemovedPost(qc: QueryClient, post: RemovablePost): void {
  if (!isCoachRemoved(post)) return;
  const isStale = (row: { id: string }) => row.id === post.id && !isCoachRemoved(row);
  qc.setQueriesData<RemovablePost[]>({ queryKey: [...communityKeys.all, 'posts'] }, (rows) =>
    rows?.some(isStale) ? rows.map((row) => (isStale(row) ? post : row)) : undefined);
  qc.setQueryData<RemovablePost>(communityKeys.post(post.id), (old) => (old && isStale(old) ? post : undefined));
  qc.setQueryData<CommunityTodayResponse>(communityKeys.today(), (today) =>
    today?.pinned_post?.id === post.id ? { ...today, pinned_post: null } : undefined);
  const isHit = (r: SearchResponse['results'][number]) => r.kind === 'post' && r.targetId === post.id;
  qc.setQueriesData<InfiniteData<SearchResponse>>({ predicate: (q) => isPostSearchKey(q.queryKey) }, (found) =>
    found?.pages.some((page) => page.results.some(isHit))
      ? { ...found, pages: found.pages.map((page) => ({ ...page, results: page.results.filter((r) => !isHit(r)) })) }
      : undefined);
}

/**
 * Returns the live unread badge state for the Community tab and wires the
 * Supabase Realtime subscription so the count updates without polling: each
 * broadcast ping invalidates `community/me`, which refetches the authoritative
 * counts over the authenticated REST endpoint.
 *
 * @param userId the calling client's user id (from useCurrentUser).
 */
export function useCommunityBadge(
  userId: string | null | undefined,
): CommunityBadgeState {
  const qc = useQueryClient();
  const me = useCommunityMe();

  useEffect(() => {
    if (!userId) return undefined;
    const unsubscribe = subscribeToCommunityUser(userId, (ping?: CommunityPing) => {
      // Untrusted ping → refetch authoritative unread counts over REST.
      qc.invalidateQueries({ queryKey: communityKeys.me() });
      // A coach's removal arrives as message.updated (backend #1165): re-read the voice feeds, voice
      // note pages and open voice-bearing Find searches too, so a removed note turns into its
      // placeholder, or leaves Find, with no tap. Only the event name is read; a missing or unknown
      // one re-reads them as well. Other known events re-read none of them.
      const event: unknown = ping?.event;
      const known: readonly unknown[] = Object.values(COMMUNITY_BROADCAST_EVENTS);
      if (event === COMMUNITY_BROADCAST_EVENTS.messageUpdated || !known.includes(event)) {
        void refreshVoiceQueries(qc);
      }
      // REMOVED-BY-M3: a coach's removal of a post, or of a reply under it, arrives as post.updated
      // (backend #1176, ids only), as an edit does. Only that event re-reads the posts: an odd ping
      // already re-reads the voice queries and all-kinds searches above, and lists re-read on open.
      if (event === COMMUNITY_BROADCAST_EVENTS.postUpdated) {
        void refreshPostQueries(qc);
      }
    });
    return unsubscribe;
  }, [userId, qc]);

  const unread = me.data?.unread;
  const cohortMessages = unread?.cohort_messages ?? 0;
  const dmMessages = unread?.dm_messages ?? 0;
  const mentions = unread?.mentions ?? 0;
  return {
    cohortMessages,
    dmMessages,
    mentions,
    total: cohortMessages + dmMessages + mentions,
  };
}
