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
    id: z.string(),
    workspace_id: z.string(),
    cohort_id: z.string().nullable(),
    created_by_user_id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    status: z.enum(COMMUNITY_CHALLENGE_STATUSES),
    starts_at: z.string().nullable(),
    ends_at: z.string().nullable(),
    metric_key: z.string().nullable(),
    target_value: z.number().nullable(),
    unit: z.string().nullable(),
    leaderboard_enabled: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
    archived: z.boolean(),
  })
  .passthrough();
export type CommunityChallenge = z.infer<typeof ChallengeSchema>;

export const ParticipationSchema = z
  .object({
    challenge_id: z.string(),
    user_id: z.string(),
    progress_value: z.number(),
    target_value: z.number().nullable(),
    progress_fraction: z.number().nullable(),
    completed: z.boolean(),
    completed_at: z.string().nullable(),
    last_logged_at: z.string().nullable(),
    leaderboard_opted_in: z.boolean(),
  })
  .passthrough();
export type CommunityChallengeParticipation = z.infer<
  typeof ParticipationSchema
>;

const ChallengeResponseSchema = z
  .object({
    challenge: ChallengeSchema,
    participation: ParticipationSchema.nullable(),
  })
  .passthrough();
export type CommunityChallengeDetail = z.infer<typeof ChallengeResponseSchema>;

const ChallengeListResponseSchema = z
  .object({ challenges: z.array(ChallengeSchema) })
  .passthrough();

const ParticipationResponseSchema = z
  .object({ participation: ParticipationSchema })
  .passthrough();

export const LeaderboardRowSchema = z
  .object({
    user_id: z.string(),
    rank: z.number(),
    progress_value: z.number(),
    is_self: z.boolean(),
  })
  .passthrough();
export type CommunityChallengeLeaderboardRow = z.infer<
  typeof LeaderboardRowSchema
>;

const LeaderboardResponseSchema = z
  .object({
    available: z.boolean(),
    opted_in: z.boolean(),
    rows: z.array(LeaderboardRowSchema),
  })
  .passthrough();
export type CommunityChallengeLeaderboard = z.infer<
  typeof LeaderboardResponseSchema
>;

export const ChallengeCommentSchema = z
  .object({
    id: z.string(),
    challenge_id: z.string(),
    author_user_id: z.string(),
    body: z.string(),
    created_at: z.string(),
  })
  .passthrough();
export type CommunityChallengeComment = z.infer<typeof ChallengeCommentSchema>;

const ChallengeCommentListResponseSchema = z
  .object({ comments: z.array(ChallengeCommentSchema) })
  .passthrough();

const ChallengeCommentResponseSchema = z
  .object({ comment: ChallengeCommentSchema })
  .passthrough();

// ─── Transport helper (mirrors communityApi.call) ─────────────────────────────

function classify(status: number): CommunityApiError['kind'] {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
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

// ─── Endpoints ─────────────────────────────────────────────────────────────────

export const communityChallengesApi = {
  /** GET /community/workspaces/:workspaceId/challenges */
  listChallenges(
    workspaceId: string,
    opts: { cohortId?: string; status?: CommunityChallengeStatus } = {},
  ): Promise<CommunityChallenge[]> {
    const params: Record<string, string> = {};
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
  getLeaderboard(challengeId: string): Promise<CommunityChallengeLeaderboard> {
    return call(LeaderboardResponseSchema, () =>
      api.get<unknown>(`/community/challenges/${challengeId}/leaderboard`),
    );
  },

  /** GET /community/challenges/:challengeId/comments */
  listComments(challengeId: string): Promise<CommunityChallengeComment[]> {
    return call(ChallengeCommentListResponseSchema, () =>
      api.get<unknown>(`/community/challenges/${challengeId}/comments`),
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
