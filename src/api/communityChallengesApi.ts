/**
 * communityChallengesApi — typed client for the v3-1 Community Challenges
 * backend.
 *
 * Backend contract source of truth (binding — do NOT drift):
 *   growth-project-backend/src/community/challenges/community-challenges.controller.ts
 *   growth-project-backend/src/community/challenges/community-challenges.dto.ts
 *
 * Wire posture mirrors communityApi.ts:
 *   - Every response is validated with Zod at the boundary so a drifted shape
 *     THROWS here (wrapped as a `contract` error) instead of feeding malformed
 *     data into React state.
 *   - Mutations send an Idempotency-Key (R19) so a double-tap deduplicates.
 *   - Behavioral framing (design Part III): the leaderboard is OFF unless the
 *     coach enabled it AND the caller opted in; the API never returns a
 *     non-consenting participant's row and never a "you are losing" signal.
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
  .object({ challenges: z.array(ChallengeSchema) })
  .strict();

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
  .object({ comments: z.array(ChallengeCommentSchema) })
  .strict();

const ChallengeCommentResponseSchema = z
  .object({ comment: ChallengeCommentSchema })
  .strict();

// NOTE (F1 correction): there is NO backend empty-state payload endpoint for the
// challenge *comments* surface. The binding backend branch (PR #390 head,
// community-challenges.controller.ts) exposes no `comments/empty-state` route,
// and no `challenge_comments_empty` surface key exists anywhere in the Roman
// voice-policy (voice-policy.constants.ts) — that policy only covers the ten P2
// notification surfaces and the five COACH_COMMUNITY_SURFACE_KEYS, none of which
// is participant-facing challenge comments. A prior revision invented a
// `getCommentsEmptyState` method + `challenge_comments_empty` enum + a
// `/comments/empty-state` route; that fabricated a contract the backend does not
// serve and is removed here (brief: "mirror the dto AS IT STANDS"). The honest
// true-empty surface is therefore a NEUTRAL, non-Roman-voiced state derived from
// the comments query itself (no local `romanVoice.ts` Roman copy — that local
// Roman copy was the original P0 — and no invented backend payload). See
// CommunityChallengeDetailScreen's commentsFooter.

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

// ─── Pagination defaults (Category 3 — no unbounded fetches) ─────────────────
//
// The list / leaderboard / comments surfaces send a bounded `limit` (and an
// optional opaque `cursor` for the next page) on the request so the client
// never asks the server for an unbounded result set. These are REQUEST-only
// parameters: the backend contract (PR #390 community-challenges.dto.ts) does
// not yet expose a cursor envelope, so the RESPONSE schemas are deliberately
// left unchanged (still `.strict()` arrays). Inventing a `next_cursor` response
// field here would drift from the binding backend and trip the F2 drift suite,
// so we cap the request and let React Query key on the page parameters without
// asserting a response envelope the backend does not serve.
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
  ): Promise<CommunityChallenge[]> {
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
    ).then((r) => r.challenges);
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
  ): Promise<CommunityChallengeComment[]> {
    const params = pageParams(CHALLENGE_COMMENTS_PAGE_LIMIT, opts);
    return call(ChallengeCommentListResponseSchema, () =>
      api.get<unknown>(`/community/challenges/${challengeId}/comments`, {
        params,
      }),
    ).then((r) => r.comments);
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

  // ── Challenge LEAVE / WITHDRAW ──────────────────────────────────────────────
  //
  // OPERATOR DECISION (R2): NO challenge-leave method is added.
  //
  // The binding backend (PR #390 head, community-challenges.controller.ts)
  // exposes exactly twelve routes: create, patch, archive, list, getOne,
  // leaderboard, comments(list), join, progress, leaderboard-opt-in,
  // comments(post), and report. There is NO `DELETE join`, no `/leave`, and no
  // `/withdraw` route, and `community-challenges.dto.ts` defines no leave DTO.
  // Adding a client `leaveChallenge` method here would FABRICATE a contract the
  // backend does not serve — the exact failure this client already corrected
  // once (the invented `getCommentsEmptyState` endpoint, see the F1 note above)
  // — and would violate the zero-drift posture (R69 / the F2 drift suite owns
  // the contract).
  //
  // What the participant CAN reversibly undo on this surface is their
  // leaderboard participation: `setLeaderboardOptIn(challengeId, false)` (the
  // "Stop sharing my progress" affordance in the detail screen) withdraws them
  // from the cohort leaderboard. Full challenge withdrawal requires a backend
  // route first; that is flagged for operator/product capture in the R2 report.

  /** POST /community/challenges/:challengeId/comments/:commentId/report */
  reportComment(
    challengeId: string,
    commentId: string,
    reason: string,
    notes?: string,
  ): Promise<void> {
    return call(z.unknown(), () =>
      api.post<unknown>(
        `/community/challenges/${challengeId}/comments/${commentId}/report`,
        { target_type: 'comment', target_id: commentId, reason, notes },
        idempotentHeaders(),
      ),
    ).then(() => undefined);
  },
};

export type CommunityChallengesApi = typeof communityChallengesApi;
