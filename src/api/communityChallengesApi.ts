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

// ─── Roman empty-state payload (operator-locked face+voice contract) ──────────
//
// The challenge comments empty surface renders OPERATOR-LOCKED Roman copy that
// is composed on the BACKEND (the VoicePolicy maps) and delivered as a payload —
// it is NOT sourced from a local `romanVoice.ts` constant on the client (gate 9
// / FACE+VOICE: local empty-state copy is a P0). The four contract fields mirror
// the backend RomanCopyPayload exactly (see
// growth-project-backend coach-empty-states.dto.ts: `text`, `avatar_crop`,
// `surface_key`, `voice_variant`). The `surface_key` for this surface is
// `challenge_comments_empty`. The payload is validated strictly at the boundary;
// a missing/drifted payload throws a `contract` error so the screen can fall to
// an HONEST loading/error state rather than a local copy fallback.

export const ChallengeAvatarCropSchema = z.enum(['monogram', 'smile', 'neutral']);
export type ChallengeAvatarCrop = z.infer<typeof ChallengeAvatarCropSchema>;

export const ChallengeVoiceVariantSchema = z.enum(['legacy', 'roman_v2']);
export type ChallengeVoiceVariant = z.infer<typeof ChallengeVoiceVariantSchema>;

export const ChallengeEmptyStateSurfaceKeySchema = z.enum([
  'challenge_comments_empty',
]);
export type ChallengeEmptyStateSurfaceKey = z.infer<
  typeof ChallengeEmptyStateSurfaceKeySchema
>;

export const ChallengeEmptyStatePayloadSchema = z
  .object({
    text: z.string().min(1),
    avatar_crop: ChallengeAvatarCropSchema,
    surface_key: ChallengeEmptyStateSurfaceKeySchema,
    voice_variant: ChallengeVoiceVariantSchema,
  })
  .strict();
export type ChallengeEmptyStatePayload = z.infer<
  typeof ChallengeEmptyStatePayloadSchema
>;

const ChallengeCommentsEmptyStateResponseSchema = z
  .object({ empty_state: ChallengeEmptyStatePayloadSchema })
  .strict();

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

  /**
   * GET /community/challenges/:challengeId/comments/empty-state — the
   * operator-locked Roman copy payload for the challenge comments empty surface.
   * Strictly validated; a drifted/absent payload throws `contract` so the screen
   * renders an honest error state and NEVER falls back to local copy.
   */
  getCommentsEmptyState(
    challengeId: string,
  ): Promise<ChallengeEmptyStatePayload> {
    return call(ChallengeCommentsEmptyStateResponseSchema, () =>
      api.get<unknown>(
        `/community/challenges/${challengeId}/comments/empty-state`,
      ),
    ).then((r) => r.empty_state);
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
