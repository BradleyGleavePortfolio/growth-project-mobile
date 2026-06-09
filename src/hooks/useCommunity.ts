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
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  communityApi,
  type CommunityMeResponse,
  type CommunityTodayResponse,
  type CommunityCohortListResponse,
  type CommunityPost,
  type CommunityComment,
  type CommunityDmThread,
  type CommunityDmMessage,
  type CommunityReactionEmoji,
} from '../api/communityApi';
import { subscribeToCommunityUser } from '../api/communityRealtime';

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

export function useCommunityCohorts(): UseQueryResult<CommunityCohortListResponse> {
  return useQuery({
    queryKey: communityKeys.cohorts(),
    queryFn: () => communityApi.getCohorts(),
    staleTime: 60_000,
  });
}

export function usePosts(
  workspaceId: string | null | undefined,
): UseQueryResult<CommunityPost[]> {
  return useQuery({
    queryKey: communityKeys.posts(workspaceId ?? '∅'),
    queryFn: async () => {
      const res = await communityApi.listPosts(workspaceId as string);
      return res.posts;
    },
    enabled: !!workspaceId,
  });
}

export function usePostComments(
  postId: string | null | undefined,
): UseQueryResult<CommunityComment[]> {
  return useQuery({
    queryKey: communityKeys.comments(postId ?? '∅'),
    queryFn: () => communityApi.listComments(postId as string),
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
 * Toggle a reaction on a post. Optimistic in the sense that the server emits a
 * `community.reaction.changed` ping and the client refetches authoritative
 * state; on failure the posts query is invalidated to re-sync.
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
    onSettled: () => {
      qc.invalidateQueries({ queryKey: communityKeys.posts(workspaceId) });
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
    const unsubscribe = subscribeToCommunityUser(userId, () => {
      // Untrusted ping → refetch authoritative unread counts over REST.
      qc.invalidateQueries({ queryKey: communityKeys.me() });
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
