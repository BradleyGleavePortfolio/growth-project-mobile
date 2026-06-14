/**
 * communityChallengesApi — typed client for the v3-1 Community Challenges
 * backend.
 *
 * Backend contract source of truth (do not drift):
 *   growth-project-backend/src/community/challenges/community-challenges.controller.ts
 *   growth-project-backend/src/community/challenges/community-challenges.dto.ts
 *
 * Wire posture mirrors communityApi.ts:
 *   - Every response is validated with Zod at the boundary so a drifted shape
 *     THROWS here (wrapped as a `contract` error) instead of feeding malformed
 *     data into React state.
 *   - Mutations send an Idempotency-Key so a double-tap deduplicates.
 *   - The leaderboard is OFF unless the coach enabled it AND the caller opted
 *     in; the API never returns a non-consenting participant's row.
 *   - List, comments, and leaderboard reads are cursor-paginated: the response
 *     carries `next_cursor` (the id to pass back as `cursor` for the next
 *     page; null on the last page), so the screens page with useInfiniteQuery
 *     and never request an unbounded result set.
 */
import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';
import { generateIdempotencyKey } from '../utils/idempotency';
import { CommunityApiError } from './communityApi';

// ─── Enums (mirror backend) ───────────────────────────────────────────────────

export const COMMUNITY_CHALLENGE_STATUSES = [
  'draft',
  'active',
  'completed',
  'archived',
] as const;
export type CommunityChallengeStatus =
  (typeof COMMUNITY_CHALLENGE_STATUSES)[number];

// ─── Response schemas (mirror backend Zod) ────────────────────────────────────

export const ChallengeSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    cohort_id: z.string().uuid().nullable(),
    created_by_user_id: z.string().uuid(),
    title: z.string(),
    description: z.string().nullable(),
    status: z.enum(COMMUNITY_CHALLENGE_STATUSES),
    starts_at: z.string().datetime().nullable(),
    ends_at: z.string().datetime().nullable(),
    metric_key: z.string().nullable(),
    target_value: z.number().nullable(),
    unit: z.string().nullable(),
    leaderboard_enabled: z.boolean(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    archived: z.boolean(),
  })
  .strict();
export type CommunityChallenge = z.infer<typeof ChallengeSchema>;

export const ParticipationSchema = z
  .object({
    challenge_id: z.string().uuid(),
    user_id: z.string().uuid(),
    progress_value: z.number(),
    target_value: z.number().nullable(),
    progress_fraction: z.number().nullable(),
    completed: z.boolean(),
    completed_at: z.string().datetime().nullable(),
    last_logged_at: z.string().datetime().nullable(),
    leaderboard_opted_in: z.boolean(),
  })
  .strict();
export type CommunityChallengeParticipation = z.infer<
  typeof ParticipationSchema
>;

const ChallengeResponseSchema = z
  .object({
    challenge: ChallengeSchema,
    participation: ParticipationSchema.nullable(),
  })
  .strict();
export type CommunityChallengeDetail = z.infer<typeof ChallengeResponseSchema>;

const ChallengeListResponseSchema = z
  .object({
    challenges: z.array(ChallengeSchema),
    next_cursor: z.string().uuid().nullable(),
  })
  .strict();
export type CommunityChallengeListPage = z.infer<
  typeof ChallengeListResponseSchema
>;

const ParticipationResponseSchema = z
  .object({ participation: ParticipationSchema })
  .strict();

export const LeaderboardRowSchema = z
  .object({
    user_id: z.string().uuid(),
    rank: z.number().int().positive(),
    progress_value: z.number(),
    is_self: z.boolean(),
  })
  .strict();
export type CommunityChallengeLeaderboardRow = z.infer<
  typeof LeaderboardRowSchema
>;

const LeaderboardResponseSchema = z
  .object({
    available: z.boolean(),
    opted_in: z.boolean(),
    rows: z.array(LeaderboardRowSchema),
    next_cursor: z.string().uuid().nullable(),
  })
  .strict();
export type CommunityChallengeLeaderboard = z.infer<
  typeof LeaderboardResponseSchema
>;

export const ChallengeCommentSchema = z
  .object({
    id: z.string().uuid(),
    challenge_id: z.string().uuid(),
    author_user_id: z.string().uuid(),
    body: z.string(),
    created_at: z.string().datetime(),
  })
  .strict();
export type CommunityChallengeComment = z.infer<typeof ChallengeCommentSchema>;

const ChallengeCommentListResponseSchema = z
  .object({
    comments: z.array(ChallengeCommentSchema),
    next_cursor: z.string().uuid().nullable(),
  })
  .strict();
export type CommunityChallengeCommentPage = z.infer<
  typeof ChallengeCommentListResponseSchema
>;

const ChallengeCommentResponseSchema = z
  .object({ comment: ChallengeCommentSchema })
  .strict();

// The comments surface has no backend empty-state payload: its true-empty
// state is a neutral message derived from the comments query itself.

// ─── Transport helper (mirrors communityApi.call) ─────────────────────────────

function classify(status: number): CommunityApiError['kind'] {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 410) return 'gone';
  if (status >= 500) return 'server';
  if (status === 0) return 'network';
  return 'unknown';
}

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
        `community challenge request failed (${status || 'network'})`,
        err,
      );
    }
    throw new CommunityApiError(
      'unknown',
      -1,
      'community challenge request failed',
      err,
    );
  }
  try {
    return schema.parse(res.data);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new CommunityApiError(
        'contract',
        200,
        'challenge response shape drifted from the backend contract',
        err,
      );
    }
    throw err;
  }
}

function idempotentHeaders(): { headers: Record<string, string> } {
  return { headers: { 'Idempotency-Key': generateIdempotencyKey() } };
}

// ─── Pagination (bounded, cursor-paged reads) ────────────────────────────────
//
// The list / leaderboard / comments reads send a bounded `limit` and an
// optional `cursor` (the previous page's `next_cursor`) and parse the cursor
// envelope the backend returns, so the client never requests an unbounded
// result set and older rows stay reachable via fetchNextPage.
export const CHALLENGES_PAGE_LIMIT = 20;
export const CHALLENGE_COMMENTS_PAGE_LIMIT = 20;
export const CHALLENGE_LEADERBOARD_PAGE_LIMIT = 20;

export interface PageParams {
  /** Maximum rows to request for this page. */
  limit?: number;
  /** Opaque forward cursor for the next page (omitted on the first page). */
  cursor?: string;
}

function pageParams(
  defaultLimit: number,
  opts: PageParams,
): Record<string, string> {
  const params: Record<string, string> = {};
  const limit = opts.limit ?? defaultLimit;
  if (Number.isFinite(limit) && limit > 0) params.limit = String(limit);
  if (opts.cursor) params.cursor = opts.cursor;
  return params;
}

// ─── Endpoints ─────────────────────────────────────────────────────────────────

export const communityChallengesApi = {
  /** GET /community/workspaces/:workspaceId/challenges */
  listChallenges(
    workspaceId: string,
    opts: {
      cohortId?: string;
      status?: CommunityChallengeStatus;
    } & PageParams = {},
  ): Promise<CommunityChallengeListPage> {
    const params: Record<string, string> = pageParams(
      CHALLENGES_PAGE_LIMIT,
      opts,
    );
    if (opts.cohortId) params.cohort_id = opts.cohortId;
    if (opts.status) params.status = opts.status;
    return call(ChallengeListResponseSchema, () =>
      api.get<unknown>(`/community/workspaces/${workspaceId}/challenges`, {
        params,
      }),
    );
  },

  /** GET /community/challenges/:challengeId — definition + caller's own row. */
  getChallenge(challengeId: string): Promise<CommunityChallengeDetail> {
    return call(ChallengeResponseSchema, () =>
      api.get<unknown>(`/community/challenges/${challengeId}`),
    );
  },

  /** POST /community/challenges/:challengeId/join — idempotent join. */
  join(challengeId: string): Promise<CommunityChallengeParticipation> {
    return call(ParticipationResponseSchema, () =>
      api.post<unknown>(
        `/community/challenges/${challengeId}/join`,
        {},
        idempotentHeaders(),
      ),
    ).then((r) => r.participation);
  },

  /** PUT /community/challenges/:challengeId/progress — log progress (monotonic). */
  updateProgress(
    challengeId: string,
    progressValue: number,
  ): Promise<CommunityChallengeParticipation> {
    return call(ParticipationResponseSchema, () =>
      api.put<unknown>(
        `/community/challenges/${challengeId}/progress`,
        { progress_value: progressValue },
        idempotentHeaders(),
      ),
    ).then((r) => r.participation);
  },

  /** PUT /community/challenges/:challengeId/leaderboard-opt-in — opt in/out. */
  setLeaderboardOptIn(
    challengeId: string,
    optedIn: boolean,
  ): Promise<CommunityChallengeParticipation> {
    return call(ParticipationResponseSchema, () =>
      api.put<unknown>(
        `/community/challenges/${challengeId}/leaderboard-opt-in`,
        { opted_in: optedIn },
        idempotentHeaders(),
      ),
    ).then((r) => r.participation);
  },

  /** GET /community/challenges/:challengeId/leaderboard — opt-in gated. */
  getLeaderboard(
    challengeId: string,
    opts: PageParams = {},
  ): Promise<CommunityChallengeLeaderboard> {
    const params = pageParams(CHALLENGE_LEADERBOARD_PAGE_LIMIT, opts);
    return call(LeaderboardResponseSchema, () =>
      api.get<unknown>(`/community/challenges/${challengeId}/leaderboard`, {
        params,
      }),
    );
  },

  /** GET /community/challenges/:challengeId/comments */
  listComments(
    challengeId: string,
    opts: PageParams = {},
  ): Promise<CommunityChallengeCommentPage> {
    const params = pageParams(CHALLENGE_COMMENTS_PAGE_LIMIT, opts);
    return call(ChallengeCommentListResponseSchema, () =>
      api.get<unknown>(`/community/challenges/${challengeId}/comments`, {
        params,
      }),
    );
  },

  /** POST /community/challenges/:challengeId/comments — encouragement. */
  addComment(
    challengeId: string,
    body: string,
  ): Promise<CommunityChallengeComment> {
    return call(ChallengeCommentResponseSchema, () =>
      api.post<unknown>(
        `/community/challenges/${challengeId}/comments`,
        { body },
        idempotentHeaders(),
      ),
    ).then((r) => r.comment);
  },

  // There is no challenge-leave route on the backend; the only reversible
  // participation toggle is leaderboard opt-out via setLeaderboardOptIn(false).

  /**
   * POST /community/challenges/:challengeId/comments/:commentId/report
   *
   * `idempotencyKey` lets the caller pass ONE stable key per report intent so a
   * double-tap / retry of the same report deduplicates server-side. When
   * omitted a fresh key is generated.
   */
  reportComment(
    challengeId: string,
    commentId: string,
    reason: string,
    notes?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    const headers = idempotencyKey
      ? { headers: { 'Idempotency-Key': idempotencyKey } }
      : idempotentHeaders();
    return call(z.unknown(), () =>
      api.post<unknown>(
        `/community/challenges/${challengeId}/comments/${commentId}/report`,
        { target_type: 'comment', target_id: commentId, reason, notes },
        headers,
      ),
    ).then(() => undefined);
  },
};

export type CommunityChallengesApi = typeof communityChallengesApi;
