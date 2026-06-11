/**
 * coachCommunityApi — typed client for the v1-6 Community COACH backend
 * (growth-project-backend@2fa6b57e, three controllers:
 * `community-cohort-write`, `community-cohort-members`, `community-coach-inbox`).
 *
 * This is a NEW file dedicated to the coach-only v1-6 surface. It does NOT
 * touch `communityApi.ts` (the client-side API). The two clients share the
 * same axios instance (`services/api`), the same Zod-at-the-boundary doctrine,
 * and the same idempotency contract, but their endpoint sets are disjoint.
 *
 * Backend contract source of truth (binding — do NOT drift):
 *   growth-project-backend/src/community/coach-inbox/community-coach-inbox.controller.ts
 *   growth-project-backend/src/community/cohorts/community-cohort-write.controller.ts
 *   growth-project-backend/src/community/cohorts/community-cohort-members.controller.ts
 *   growth-project-backend/src/community/moderation/community-moderation.controller.ts
 *
 * Auth posture (hard gate §2.3 / AGENT_RULES):
 *   - Every request carries the caller's JWT via the shared axios instance's
 *     request interceptor (services/api). The backend derives the acting coach
 *     from that token. This client NEVER accepts or sends a `coachId` param —
 *     a coach can only ever read or mutate their OWN tenant-scoped resources.
 *     Passing a foreign coachId is structurally impossible through this API.
 *   - Mutations send an `Idempotency-Key` header (R19) so a double-tap or
 *     retry from the same logical action deduplicates server-side. Optimistic
 *     update + rollback lives in the screen hooks, not here.
 *   - Every response is Zod-validated at the wire boundary; a shape that drifts
 *     from the backend DTO throws a `contract` CoachCommunityApiError here
 *     instead of feeding malformed data into React state.
 */

import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';
import { generateIdempotencyKey } from '../utils/idempotency';

// ─── Shared enums (mirror backend) ───────────────────────────────────────────

/** Moderation surface targets a post or a message. */
export const COACH_MOD_TARGET_TYPES = ['post', 'message'] as const;
export type CoachModTargetType = (typeof COACH_MOD_TARGET_TYPES)[number];

/** Cohort membership role enum (mirrors the client API role language). */
export const COACH_COHORT_MEMBER_ROLES = ['client', 'coach', 'owner'] as const;
export type CoachCohortMemberRole =
  (typeof COACH_COHORT_MEMBER_ROLES)[number];

// ─── Response schemas (mirror backend Zod DTOs) ──────────────────────────────

/**
 * GET /community/coach/dashboard — composed coach landing envelope. The
 * backend aggregates the inbox unread count, the active cohort count, and the
 * count of moderation items flagged today so the home surface needs exactly
 * one round-trip on cold start.
 */
export const CoachDashboardSchema = z
  .object({
    unread_inbox_count: z.number().int().nonnegative(),
    active_cohort_count: z.number().int().nonnegative(),
    flagged_today_count: z.number().int().nonnegative(),
  })
  .passthrough();
export type CoachDashboard = z.infer<typeof CoachDashboardSchema>;

/**
 * A single aggregated inbox item — an unanswered client signal surfaced across
 * all of the coach's cohorts. `avatar_url` is nullable so the row falls back to
 * a monogram badge built from `client_name`.
 */
export const CoachInboxItemSchema = z
  .object({
    id: z.string().uuid(),
    cohort_id: z.string().uuid(),
    cohort_name: z.string(),
    client_user_id: z.string().uuid(),
    client_name: z.string(),
    avatar_url: z.string().nullable(),
    snippet: z.string(),
    /** ISO timestamp of the unanswered item; the row renders a relative age. */
    created_at: z.string(),
    acknowledged: z.boolean(),
  })
  .passthrough();
export type CoachInboxItem = z.infer<typeof CoachInboxItemSchema>;

/** GET /community/coach/inbox — one keyset page of aggregated inbox items. */
export const CoachInboxPageSchema = z
  .object({
    items: z.array(CoachInboxItemSchema),
    /** Opaque cursor for the next older page, or null at the end. */
    next_before: z.string().nullable(),
  })
  .passthrough();
export type CoachInboxPage = z.infer<typeof CoachInboxPageSchema>;

/** A cohort summary as seen by its owning coach. */
export const CoachCohortSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    member_count: z.number().int().nonnegative(),
    /** Count of unanswered inbox items routed from this cohort. */
    unread_count: z.number().int().nonnegative(),
    created_at: z.string(),
  })
  .passthrough();
export type CoachCohort = z.infer<typeof CoachCohortSchema>;

/** GET /community/coach/cohorts — the coach's cohorts (tenant-scoped). */
export const CoachCohortListSchema = z
  .object({ cohorts: z.array(CoachCohortSchema) })
  .passthrough();
export type CoachCohortList = z.infer<typeof CoachCohortListSchema>;

/** A single cohort member as seen on the detail screen. */
export const CoachCohortMemberSchema = z
  .object({
    user_id: z.string().uuid(),
    name: z.string(),
    email: z.string().nullable(),
    avatar_url: z.string().nullable(),
    role: z.enum(COACH_COHORT_MEMBER_ROLES),
    joined_at: z.string(),
  })
  .passthrough();
export type CoachCohortMember = z.infer<typeof CoachCohortMemberSchema>;

/** GET /community/coach/cohorts/:id — cohort header + full member list. */
export const CoachCohortDetailSchema = z
  .object({
    cohort: CoachCohortSchema,
    members: z.array(CoachCohortMemberSchema),
  })
  .passthrough();
export type CoachCohortDetail = z.infer<typeof CoachCohortDetailSchema>;

/** A single flagged-content item awaiting a moderation decision. */
export const CoachFlaggedItemSchema = z
  .object({
    id: z.string().uuid(),
    target_type: z.enum(COACH_MOD_TARGET_TYPES),
    /** The post id or message id the decision will act on. */
    target_id: z.string().uuid(),
    /** The offending content body, surfaced verbatim for the reviewer. */
    content: z.string(),
    author_name: z.string(),
    cohort_name: z.string().nullable(),
    /** Coarse reason label from the report pipeline (never a raw message). */
    reason: z.string(),
    created_at: z.string(),
  })
  .passthrough();
export type CoachFlaggedItem = z.infer<typeof CoachFlaggedItemSchema>;

/** GET /community/moderation/flagged — the flagged-content review queue. */
export const CoachFlaggedListSchema = z
  .object({ items: z.array(CoachFlaggedItemSchema) })
  .passthrough();
export type CoachFlaggedList = z.infer<typeof CoachFlaggedListSchema>;

// ─── Roman empty-state payload (operator-locked face+voice contract) ─────────

/**
 * Avatar crop for a Roman-voiced surface. Mirrors the backend
 * voice-policy.constants AVATAR_CROPS. `monogram` is the universal fallback;
 * `neutral`/`smile` are the empty-state crops.
 */
export const CoachAvatarCropSchema = z.enum(['monogram', 'smile', 'neutral']);
export type CoachAvatarCrop = z.infer<typeof CoachAvatarCropSchema>;

/** Which backend copy map a payload was composed from (analytics signal). */
export const CoachVoiceVariantSchema = z.enum(['legacy', 'roman_v2']);
export type CoachVoiceVariant = z.infer<typeof CoachVoiceVariantSchema>;

/**
 * The five v1-6 coach-community empty-state surfaces. Mirrors the backend
 * SURFACE_KEYS exactly (the coach lab surface was removed from v1-6 — it had
 * no backend write — so there is no `coach_community_lab_empty`).
 */
export const CoachEmptyStateSurfaceKeySchema = z.enum([
  'coach_community_home_empty',
  'coach_community_inbox_empty',
  'coach_community_cohorts_empty',
  'coach_community_cohort_members_empty',
  'coach_community_moderation_empty',
]);
export type CoachEmptyStateSurfaceKey = z.infer<
  typeof CoachEmptyStateSurfaceKeySchema
>;

export const COACH_EMPTY_STATE_SURFACE_KEYS =
  CoachEmptyStateSurfaceKeySchema.options;

/**
 * The composed Roman copy payload for a single surface. `passthrough()` so a
 * future additive backend field (e.g. an `avatar_url`) does not fail the
 * boundary parse; the four contract fields are required and typed.
 */
export const RomanCopyPayloadSchema = z
  .object({
    text: z.string().min(1),
    avatar_crop: CoachAvatarCropSchema,
    surface_key: CoachEmptyStateSurfaceKeySchema,
    voice_variant: CoachVoiceVariantSchema,
  })
  .passthrough();
export type RomanCopyPayload = z.infer<typeof RomanCopyPayloadSchema>;

/** GET /community/coach/empty-states — every surface keyed by surface_key. */
export const CoachEmptyStatesResponseSchema = z.record(
  CoachEmptyStateSurfaceKeySchema,
  RomanCopyPayloadSchema,
);
export type CoachEmptyStatesResponse = z.infer<
  typeof CoachEmptyStatesResponseSchema
>;

// ─── Post detail (coach post-detail surface) ─────────────────────────────────

/** A single community post as returned by GET /community/posts/:id. */
export const CoachPostSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    cohort_id: z.string().uuid().nullable(),
    author_user_id: z.string().uuid(),
    title: z.string().nullable(),
    body: z.string().nullable(),
    scope: z.enum(['hall', 'cohort']),
    type: z.enum(['text', 'lesson', 'replay', 'poll', 'win']),
    pinned: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
    deleted: z.boolean(),
  })
  .passthrough();
export type CoachPost = z.infer<typeof CoachPostSchema>;

/** A single reply/comment on a post (GET /community/posts/:id/comments). */
export const CoachPostCommentSchema = z
  .object({
    id: z.string().uuid(),
    // The backend comment view derives post_id from a nullable column and may
    // emit an empty string, so this is a plain string (not a uuid) by design.
    post_id: z.string(),
    author_user_id: z.string().uuid(),
    body: z.string(),
    created_at: z.string(),
  })
  .passthrough();
export type CoachPostComment = z.infer<typeof CoachPostCommentSchema>;

/** Composed post-detail view consumed by CoachCommunityPostDetailScreen. */
export interface CoachPostDetail {
  post: CoachPost;
  comments: CoachPostComment[];
}

// ─── Typed error ─────────────────────────────────────────────────────────────

/**
 * Transport / contract error surfaced to the screen hooks. `.status` lets the
 * UI branch on 401 (auth), 403 (forbidden — e.g. a non-coach role or a foreign
 * tenant), 404/410 (gone), and 5xx (server) without re-parsing the axios
 * error. `kind` is a coarse, bounded label (never a raw server message) for
 * telemetry / logging.
 */
export class CoachCommunityApiError extends Error {
  constructor(
    public readonly kind:
      | 'unauthorized'
      | 'forbidden'
      | 'gone'
      | 'server'
      | 'network'
      | 'contract'
      | 'unknown',
    public readonly status: number,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CoachCommunityApiError';
    Object.setPrototypeOf(this, CoachCommunityApiError.prototype);
  }
}

function classify(status: number): CoachCommunityApiError['kind'] {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404 || status === 410) return 'gone';
  if (status >= 500) return 'server';
  if (status === 0) return 'network';
  return 'unknown';
}

/**
 * Run an axios call and normalise failures into a CoachCommunityApiError.
 * ZodErrors (contract drift) are re-wrapped as `contract` so a screen can show
 * a calm "we could not load this" state instead of crashing on a parse throw.
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
      throw new CoachCommunityApiError(
        classify(status),
        status,
        `coach community request failed (${status || 'network'})`,
        err,
      );
    }
    throw new CoachCommunityApiError(
      'unknown',
      -1,
      'coach community request failed',
      err,
    );
  }
  try {
    return schema.parse(res.data);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new CoachCommunityApiError(
        'contract',
        200,
        'coach community response shape drifted from the backend contract',
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

// ─── Endpoint hooks ──────────────────────────────────────────────────────────

export const coachCommunityApi = {
  /**
   * GET /community/coach/dashboard — composed coach landing envelope (unread
   * inbox, active cohort count, items flagged today). The acting coach is
   * derived from the JWT; no coachId is sent.
   */
  getDashboard(): Promise<CoachDashboard> {
    return call(CoachDashboardSchema, () =>
      api.get<unknown>('/community/coach/dashboard'),
    );
  },

  /**
   * GET /community/coach/inbox?before=&limit= — one keyset page of aggregated
   * unanswered items across the coach's cohorts. `before` is the opaque cursor
   * returned as `next_before`.
   */
  getInbox(
    opts: { before?: string; limit?: number } = {},
  ): Promise<CoachInboxPage> {
    const params: Record<string, string> = {};
    if (opts.before) params.before = opts.before;
    if (opts.limit != null) params.limit = String(opts.limit);
    return call(CoachInboxPageSchema, () =>
      api.get<unknown>('/community/coach/inbox', { params }),
    );
  },

  /**
   * POST /community/coach/inbox/:id/ack — acknowledge a single inbox item.
   * Idempotent (R19). Optimistic removal + rollback lives in the screen hook.
   */
  ackInboxItem(itemId: string): Promise<void> {
    return call(z.unknown(), () =>
      api.post<unknown>(
        `/community/coach/inbox/${itemId}/ack`,
        {},
        idempotentHeaders(),
      ),
    ).then(() => undefined);
  },

  /** GET /community/coach/cohorts — the coach's cohorts (tenant-scoped). */
  getCohorts(): Promise<CoachCohort[]> {
    return call(CoachCohortListSchema, () =>
      api.get<unknown>('/community/coach/cohorts'),
    ).then((r) => r.cohorts);
  },

  /**
   * POST /community/coach/cohorts — create a cohort. Idempotent (R19).
   * Optimistic insert + rollback lives in the screen hook.
   */
  createCohort(input: { name: string }): Promise<CoachCohort> {
    return call(
      z.object({ cohort: CoachCohortSchema }).passthrough(),
      () =>
        api.post<unknown>('/community/coach/cohorts', input, idempotentHeaders()),
    ).then((r) => r.cohort);
  },

  /** GET /community/coach/cohorts/:id — cohort header + member list. */
  getCohortDetail(cohortId: string): Promise<CoachCohortDetail> {
    return call(CoachCohortDetailSchema, () =>
      api.get<unknown>(`/community/coach/cohorts/${cohortId}`),
    );
  },

  /**
   * POST /community/coach/cohorts/:id/members — invite a client by email.
   * Idempotent (R19). Returns the newly added member row.
   */
  inviteMember(
    cohortId: string,
    input: { email: string },
  ): Promise<CoachCohortMember> {
    return call(
      z.object({ member: CoachCohortMemberSchema }).passthrough(),
      () =>
        api.post<unknown>(
          `/community/coach/cohorts/${cohortId}/members`,
          input,
          idempotentHeaders(),
        ),
    ).then((r) => r.member);
  },

  /**
   * DELETE /community/coach/cohorts/:id/members/:userId — remove a member.
   * Always confirmed in the UI before this fires (hard gate §2.3).
   */
  removeMember(cohortId: string, userId: string): Promise<void> {
    return call(z.unknown(), () =>
      api.delete<unknown>(
        `/community/coach/cohorts/${cohortId}/members/${userId}`,
      ),
    ).then(() => undefined);
  },

  /** GET /community/moderation/flagged — the flagged-content review queue. */
  getFlagged(): Promise<CoachFlaggedItem[]> {
    return call(CoachFlaggedListSchema, () =>
      api.get<unknown>('/community/moderation/flagged'),
    ).then((r) => r.items);
  },

  /**
   * GET /community/coach/empty-states — the operator-locked Roman copy payload
   * for every v1-6 coach-community empty-state surface, keyed by surface_key.
   * Validated at the wire boundary; a missing surface key throws a `contract`
   * error (caught here as a Zod drift) so the client never silently falls back
   * to constants on a successful 200.
   */
  getCoachEmptyStates(): Promise<CoachEmptyStatesResponse> {
    return call(CoachEmptyStatesResponseSchema, () =>
      api.get<unknown>('/community/coach/empty-states'),
    );
  },

  /**
   * GET /community/posts/:id (+ /comments) — the post-detail view for the
   * coach post-detail surface. The coach role can read any post in their
   * tenant via the existing posts controller (Roles: coach). Two reads are
   * composed into one CoachPostDetail; both are Zod-validated.
   */
  async getCoachPostDetail(postId: string): Promise<CoachPostDetail> {
    const post = await call(
      z.object({ post: CoachPostSchema }).passthrough(),
      () => api.get<unknown>(`/community/posts/${postId}`),
    ).then((r) => r.post);
    const comments = await call(
      z.object({ comments: z.array(CoachPostCommentSchema) }).passthrough(),
      () => api.get<unknown>(`/community/posts/${postId}/comments`),
    ).then((r) => r.comments);
    return { post, comments };
  },

  /**
   * POST /community/posts/:id/hide — hide a flagged post. Destructive; always
   * confirmed in the UI before this fires (hard gate §2.3). Idempotent (R19).
   */
  hidePost(postId: string): Promise<void> {
    return call(z.unknown(), () =>
      api.post<unknown>(
        `/community/posts/${postId}/hide`,
        {},
        idempotentHeaders(),
      ),
    ).then(() => undefined);
  },

  /**
   * POST /community/messages/:id/hide — hide a flagged message. Destructive;
   * always confirmed in the UI before this fires. Idempotent (R19).
   */
  hideMessage(messageId: string): Promise<void> {
    return call(z.unknown(), () =>
      api.post<unknown>(
        `/community/messages/${messageId}/hide`,
        {},
        idempotentHeaders(),
      ),
    ).then(() => undefined);
  },
};

export type CoachCommunityApi = typeof coachCommunityApi;
