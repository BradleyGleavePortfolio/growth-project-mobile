/**
 * communityApi — typed client for the v1-4 Community backend (merged at
 * backend@5f6bedf). This is the mobile client surface for PR v1-5.
 *
 * Backend contract source of truth (binding — do NOT drift):
 *   growth-project-backend/src/community/community.controller.ts
 *   growth-project-backend/src/community/posts/community-posts.controller.ts
 *   growth-project-backend/src/community/dms/community-dms.controller.ts
 *   growth-project-backend/src/community/messages/community-messages.controller.ts
 *   growth-project-backend/src/community/reactions/community-reactions.controller.ts
 *   growth-project-backend/src/community/dto/*.dto.ts
 *   growth-project-backend/src/community/community-events.ts (realtime + telemetry names)
 *   growth-project-backend/src/community/realtime/community-realtime.types.ts
 *
 * Wire posture (mirrors the backend doctrine in community-events.ts):
 *   - Realtime broadcast carries IDs / timestamps / enum state values ONLY —
 *     never user-authored text. The mobile client receives a ping and refetches
 *     the authenticated, tenant-scoped REST payload. See communityRealtime.ts.
 *   - Every response is validated with Zod at the wire boundary so a shape that
 *     drifts from the backend DTO THROWS here instead of feeding malformed data
 *     into React state.
 *   - Mutations (create post / send DM / react) send an `Idempotency-Key`
 *     header (R19) so a double-tap or retry from the same logical action
 *     deduplicates. Optimistic-update rollback lives in the screen hooks.
 *
 * Role language (UX gate §6 + backend gap G14): the API role enum is
 * `client | coach | owner`. The UI says "client" for the calling user's role —
 * never "user", never bare "member".
 */

import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';
import { generateIdempotencyKey } from '../utils/idempotency';

// ─── Shared enums (mirror backend) ───────────────────────────────────────────

export const COMMUNITY_MEMBER_ROLES = ['client', 'coach', 'owner'] as const;
export type CommunityMemberRole = (typeof COMMUNITY_MEMBER_ROLES)[number];

export const COMMUNITY_NOTIFY_LEVELS = ['live', 'digest', 'quiet'] as const;
export type CommunityNotifyLevel = (typeof COMMUNITY_NOTIFY_LEVELS)[number];

export const COMMUNITY_POST_SCOPES = ['hall', 'cohort'] as const;
export type CommunityPostScope = (typeof COMMUNITY_POST_SCOPES)[number];

export const COMMUNITY_POST_TYPES = [
  'text',
  'lesson',
  'replay',
  'poll',
  'win',
] as const;
export type CommunityPostType = (typeof COMMUNITY_POST_TYPES)[number];

/**
 * Canonical reaction emoji allowlist. Mirrors backend
 * community-emoji.allowlist.ts (CommunityReactionEmoji). The @IsIn guard on the
 * backend rejects anything outside this set with a 400, so the client must only
 * ever send one of these.
 */
export const COMMUNITY_REACTION_EMOJI = [
  '👍',
  '🔥',
  '💪',
  '🎯',
  '👀',
  '❤️',
  '👏',
  '🙌',
] as const;
export type CommunityReactionEmoji = (typeof COMMUNITY_REACTION_EMOJI)[number];

// ─── Response schemas (mirror backend Zod DTOs) ──────────────────────────────

const FlagState = z.enum(['enabled', 'disabled']);

export const CommunityMeResponseSchema = z
  .object({
    feature_flag_state: FlagState,
    workspace_id: z.string().uuid().nullable(),
    membership: z
      .object({
        id: z.string().uuid(),
        role: z.enum(COMMUNITY_MEMBER_ROLES),
        notify_level: z.enum(COMMUNITY_NOTIFY_LEVELS),
        dm_enabled_effective: z.boolean(),
        last_read_message_at: z.string().nullable(),
        joined_at: z.string(),
      })
      .nullable(),
    unread: z.object({
      cohort_messages: z.number().int().nonnegative(),
      dm_messages: z.number().int().nonnegative(),
      mentions: z.number().int().nonnegative(),
    }),
    flags: z.object({
      community_api: z.boolean(),
      community_dm: z.boolean(),
      community_realtime: z.boolean(),
      community_push: z.boolean(),
      community_telemetry: z.boolean(),
    }),
  })
  .passthrough();
export type CommunityMeResponse = z.infer<typeof CommunityMeResponseSchema>;

export const CommunityTodayResponseSchema = z
  .object({
    feature_flag_state: FlagState,
    cohort: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        member_count: z.number().int().nonnegative(),
      })
      .nullable(),
    event: z
      .object({
        id: z.string().uuid(),
        title: z.string(),
        starts_at: z.string(),
        live_url: z.string().nullable(),
      })
      .nullable(),
    pinned_post: z
      .object({
        id: z.string().uuid(),
        title: z.string(),
        author_user_id: z.string().uuid(),
      })
      .nullable(),
    challenge: z
      .object({
        id: z.string().uuid(),
        title: z.string(),
        ends_at: z.string(),
      })
      .nullable(),
    empty_reason: z
      .enum(['no_membership', 'no_today_content'])
      .nullable(),
  })
  .passthrough();
export type CommunityTodayResponse = z.infer<
  typeof CommunityTodayResponseSchema
>;

export const CommunityCohortSummarySchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    name: z.string(),
    is_default: z.boolean(),
    member_count: z.number().int().nonnegative(),
    my_role: z.enum(COMMUNITY_MEMBER_ROLES),
  })
  .passthrough();
export type CommunityCohortSummary = z.infer<
  typeof CommunityCohortSummarySchema
>;

export const CommunityCohortListResponseSchema = z
  .object({
    feature_flag_state: FlagState,
    cohorts: z.array(CommunityCohortSummarySchema),
  })
  .passthrough();
export type CommunityCohortListResponse = z.infer<
  typeof CommunityCohortListResponseSchema
>;

export const CommunityPostSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    cohort_id: z.string().uuid().nullable(),
    author_user_id: z.string().uuid(),
    title: z.string().nullable(),
    body: z.string().nullable(),
    scope: z.enum(COMMUNITY_POST_SCOPES),
    type: z.enum(COMMUNITY_POST_TYPES),
    pinned: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
    deleted: z.boolean(),
  })
  .passthrough();
export type CommunityPost = z.infer<typeof CommunityPostSchema>;

export const CommunityPostListResponseSchema = z
  .object({
    posts: z.array(CommunityPostSchema),
    next_before: z.string().nullable(),
  })
  .passthrough();
export type CommunityPostListResponse = z.infer<
  typeof CommunityPostListResponseSchema
>;

export const CommunityPostResponseSchema = z
  .object({ post: CommunityPostSchema })
  .passthrough();

export const CommunityCommentSchema = z
  .object({
    id: z.string().uuid(),
    post_id: z.string().uuid(),
    author_user_id: z.string().uuid(),
    body: z.string(),
    created_at: z.string(),
  })
  .passthrough();
export type CommunityComment = z.infer<typeof CommunityCommentSchema>;

export const CommunityCommentListResponseSchema = z
  .object({ comments: z.array(CommunityCommentSchema) })
  .passthrough();

export const CommunityCommentResponseSchema = z
  .object({ comment: CommunityCommentSchema })
  .passthrough();

export const CommunityReactionSummarySchema = z
  .object({
    emoji: z.string(),
    count: z.number().int().nonnegative(),
    reacted_by_me: z.boolean(),
  })
  .passthrough();
export type CommunityReactionSummary = z.infer<
  typeof CommunityReactionSummarySchema
>;

export const CommunityReactionStateSchema = z
  .object({
    target_type: z.enum(['message', 'post', 'comment']),
    target_id: z.string(),
    reactions: z.array(CommunityReactionSummarySchema),
  })
  .passthrough();
export type CommunityReactionState = z.infer<
  typeof CommunityReactionStateSchema
>;

export const CommunityDmThreadSchema = z
  .object({
    thread_id: z.string(),
    workspace_id: z.string().uuid(),
    other_user_id: z.string().uuid(),
    created_at: z.string().nullable(),
    last_message_at: z.string().nullable(),
  })
  .passthrough();
export type CommunityDmThread = z.infer<typeof CommunityDmThreadSchema>;

export const CommunityDmThreadListResponseSchema = z
  .object({ threads: z.array(CommunityDmThreadSchema) })
  .passthrough();

export const CommunityDmThreadResponseSchema = z
  .object({ thread: CommunityDmThreadSchema })
  .passthrough();

export const CommunityDmMessageSchema = z
  .object({
    id: z.string().uuid(),
    thread_id: z.string(),
    sender_user_id: z.string().uuid(),
    recipient_user_id: z.string().uuid(),
    body: z.string().nullable(),
    created_at: z.string(),
    deleted: z.boolean(),
  })
  .passthrough();
export type CommunityDmMessage = z.infer<typeof CommunityDmMessageSchema>;

export const CommunityDmMessageListResponseSchema = z
  .object({ messages: z.array(CommunityDmMessageSchema) })
  .passthrough();

export const CommunityDmMessageResponseSchema = z
  .object({ message: CommunityDmMessageSchema })
  .passthrough();

// ─── Typed error ─────────────────────────────────────────────────────────────

/**
 * Transport / contract error surfaced to the screen hooks. `.status` lets the
 * UI branch on 401 (auth), 403 (forbidden — e.g. DM gate), 410 (gone), and 5xx
 * (server) without re-parsing the axios error. `kind` is a coarse, bounded
 * label (never a raw server message) for telemetry / logging.
 */
export class CommunityApiError extends Error {
  constructor(
    public readonly kind:
      | 'unauthorized'
      | 'forbidden'
      | 'gone'
      | 'conflict'
      | 'server'
      | 'network'
      | 'contract'
      | 'unknown',
    public readonly status: number,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CommunityApiError';
    Object.setPrototypeOf(this, CommunityApiError.prototype);
  }
}

function classify(status: number): CommunityApiError['kind'] {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 410) return 'gone';
  if (status >= 500) return 'server';
  if (status === 0) return 'network';
  return 'unknown';
}

/**
 * Run an axios call and normalise failures into a CommunityApiError. ZodErrors
 * (contract drift) are re-wrapped as `contract` so a screen can show a calm
 * "we could not load this" state instead of crashing on a parse throw.
 */
async function call<T>(
  schema: z.ZodType<T>,
  fn: () => Promise<{ data: unknown }>,
): Promise<T> {
  let res: { data: unknown };
  try {
    res = await fn();
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? 0;
      throw new CommunityApiError(
        classify(status),
        status,
        `community request failed (${status || 'network'})`,
        err,
      );
    }
    throw new CommunityApiError('unknown', -1, 'community request failed', err);
  }
  try {
    return schema.parse(res.data);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new CommunityApiError(
        'contract',
        200,
        'community response shape drifted from the backend contract',
        err,
      );
    }
    throw err;
  }
}

function idempotentHeaders(): { headers: Record<string, string> } {
  // R19 — client-generated key so a retried mutation deduplicates server-side.
  return { headers: { 'Idempotency-Key': generateIdempotencyKey() } };
}

// ─── Endpoint hooks (read-only first, then mutations) ────────────────────────

export const communityApi = {
  /** GET /community/me — caller's community state envelope (always reachable). */
  getMe(): Promise<CommunityMeResponse> {
    return call(CommunityMeResponseSchema, () =>
      api.get<unknown>('/community/me'),
    );
  },

  /** GET /community/today — bounded Today envelope (always reachable). */
  getToday(): Promise<CommunityTodayResponse> {
    return call(CommunityTodayResponseSchema, () =>
      api.get<unknown>('/community/today'),
    );
  },

  /** GET /community/cohorts — caller's cohort summaries (server-scoped). */
  getCohorts(): Promise<CommunityCohortListResponse> {
    return call(CommunityCohortListResponseSchema, () =>
      api.get<unknown>('/community/cohorts'),
    );
  },

  /**
   * GET /community/workspaces/:workspaceId/posts?before=&limit= — keyset page.
   * `before` is the opaque cursor returned as `next_before`.
   */
  listPosts(
    workspaceId: string,
    opts: { before?: string; limit?: number } = {},
  ): Promise<CommunityPostListResponse> {
    const params: Record<string, string> = {};
    if (opts.before) params.before = opts.before;
    if (opts.limit != null) params.limit = String(opts.limit);
    return call(CommunityPostListResponseSchema, () =>
      api.get<unknown>(`/community/workspaces/${workspaceId}/posts`, { params }),
    );
  },

  /** GET /community/posts/:postId/comments — thread (comments) on a post. */
  listComments(postId: string): Promise<CommunityComment[]> {
    return call(CommunityCommentListResponseSchema, () =>
      api.get<unknown>(`/community/posts/${postId}/comments`),
    ).then((r) => r.comments);
  },

  /** GET /community/posts/:postId — single post detail. */
  getPost(postId: string): Promise<CommunityPost> {
    return call(CommunityPostResponseSchema, () =>
      api.get<unknown>(`/community/posts/${postId}`),
    ).then((r) => r.post);
  },

  /**
   * POST /community/workspaces/:workspaceId/posts — create a Lab/Hall post.
   * Idempotent (R19). Optimistic insert + rollback lives in the screen hook.
   */
  createPost(
    workspaceId: string,
    input: { title: string; body: string },
  ): Promise<CommunityPost> {
    return call(CommunityPostResponseSchema, () =>
      api.post<unknown>(
        `/community/workspaces/${workspaceId}/posts`,
        input,
        idempotentHeaders(),
      ),
    ).then((r) => r.post);
  },

  /** POST /community/posts/:postId/comments — add a top-level comment. */
  addComment(postId: string, body: string): Promise<CommunityComment> {
    return call(CommunityCommentResponseSchema, () =>
      api.post<unknown>(
        `/community/posts/${postId}/comments`,
        { body },
        idempotentHeaders(),
      ),
    ).then((r) => r.comment);
  },

  /**
   * POST /community/posts/:postId/reactions — react with one allowlisted emoji.
   * The backend broadcasts `community.reaction.changed` (a delta ping only);
   * the client refetches the aggregated state via getReactionState below.
   */
  reactToPost(postId: string, emoji: CommunityReactionEmoji): Promise<void> {
    return call(z.unknown(), () =>
      api.post<unknown>(`/community/posts/${postId}/reactions`, { emoji }),
    ).then(() => undefined);
  },

  /** DELETE /community/posts/:postId/reactions — remove the caller's reaction. */
  unreactToPost(postId: string, emoji: CommunityReactionEmoji): Promise<void> {
    return call(z.unknown(), () =>
      api.delete<unknown>(`/community/posts/${postId}/reactions`, {
        data: { emoji },
      }),
    ).then(() => undefined);
  },

  /** GET /community/workspaces/:workspaceId/dms — DM inbox (thread list). */
  listDmThreads(workspaceId: string): Promise<CommunityDmThread[]> {
    return call(CommunityDmThreadListResponseSchema, () =>
      api.get<unknown>(`/community/workspaces/${workspaceId}/dms`),
    ).then((r) => r.threads);
  },

  /**
   * GET /community/workspaces/:workspaceId/dms/:recipientId/messages — a single
   * DM conversation, newest-first keyset paginated by `before`.
   */
  listDmMessages(
    workspaceId: string,
    recipientId: string,
    opts: { before?: string; limit?: number } = {},
  ): Promise<CommunityDmMessage[]> {
    const params: Record<string, string> = {};
    if (opts.before) params.before = opts.before;
    if (opts.limit != null) params.limit = String(opts.limit);
    return call(CommunityDmMessageListResponseSchema, () =>
      api.get<unknown>(
        `/community/workspaces/${workspaceId}/dms/${recipientId}/messages`,
        { params },
      ),
    ).then((r) => r.messages);
  },

  /**
   * POST /community/workspaces/:workspaceId/dms/:recipientId/messages — send a
   * DM. Idempotent (R19). Optimistic append + rollback lives in the screen hook.
   */
  sendDm(
    workspaceId: string,
    recipientId: string,
    body: string,
  ): Promise<CommunityDmMessage> {
    return call(CommunityDmMessageResponseSchema, () =>
      api.post<unknown>(
        `/community/workspaces/${workspaceId}/dms/${recipientId}/messages`,
        { body },
        idempotentHeaders(),
      ),
    ).then((r) => r.message);
  },

  /** POST /community/workspaces/:workspaceId/dms — open (or fetch) a 1:1 thread. */
  openDmThread(
    workspaceId: string,
    recipientUserId: string,
  ): Promise<CommunityDmThread> {
    return call(CommunityDmThreadResponseSchema, () =>
      api.post<unknown>(
        `/community/workspaces/${workspaceId}/dms`,
        { recipient_user_id: recipientUserId },
        idempotentHeaders(),
      ),
    ).then((r) => r.thread);
  },
};

export type CommunityApi = typeof communityApi;
