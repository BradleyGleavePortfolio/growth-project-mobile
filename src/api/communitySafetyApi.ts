/**
 * communitySafetyApi — community UGC safety client (Apple App Review 1.2):
 * report with a reason, block / unblock, the published safety contact, and the
 * 422 content-filter rejection helper.
 *
 * Backend contract (growth-project-backend src/community/safety/ +
 * src/community/moderation/):
 *   POST   /community/moderation/reports  { target_type, target_id, reason, notes? }
 *   GET    /community/blocks              -> { blocks: [{ user_id, name, blocked_at }] }
 *   POST   /community/blocks              { user_id } -> { blocked_user_id, blocked: true }
 *   DELETE /community/blocks/:userId      -> { blocked_user_id, blocked: false }
 *   GET    /community/safety              -> { contact_email, report_reasons, guidelines, response_commitment }
 *   Any community text write may return 422 { code: 'community.content.rejected', message }.
 *
 * Every response is Zod-validated at the boundary (shared `call`), mutations
 * carry an Idempotency-Key (R19).
 */
import { z } from 'zod';
import api from '../services/api';
import { generateIdempotencyKey } from '../utils/idempotency';
import { call } from './apiCall';

/** Report targets accepted by the backend report route. */
export type CommunityReportTargetType = 'post' | 'comment' | 'message';

/**
 * Report reasons. Mirrors backend COMMUNITY_REPORT_REASONS so the sheet works
 * before /community/safety has loaded; the server copy wins when present.
 */
export const COMMUNITY_REPORT_REASONS: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'harassment', label: 'Harassment or bullying' },
  { code: 'hate', label: 'Hate speech or discrimination' },
  { code: 'sexual', label: 'Sexual or explicit content' },
  { code: 'violence', label: 'Threats or violence' },
  { code: 'self_harm', label: 'Self-harm or suicide' },
  { code: 'spam', label: 'Spam or scams' },
  { code: 'misinformation', label: 'Harmful health misinformation' },
  { code: 'other', label: 'Something else' },
];

/** Published fallback when /community/safety cannot be reached. */
export const COMMUNITY_SAFETY_FALLBACK_EMAIL = 'Bradley@Bradleytgpcoaching.com';

export const CONTENT_REJECTED_CODE = 'community.content.rejected';
export const CONTENT_REJECTED_FALLBACK =
  'This was not posted because it appears to contain abusive or explicit language. Please rephrase it.';

export const CommunitySafetyInfoSchema = z
  .object({
    contact_email: z.string(),
    report_reasons: z.array(z.object({ code: z.string(), label: z.string() }).passthrough()),
    guidelines: z.array(z.string()),
    response_commitment: z.string(),
  })
  .passthrough();
export type CommunitySafetyInfo = z.infer<typeof CommunitySafetyInfoSchema>;

export const CommunityBlockSchema = z
  .object({ user_id: z.string(), name: z.string(), blocked_at: z.string() })
  .passthrough();
export type CommunityBlock = z.infer<typeof CommunityBlockSchema>;

const BlockListSchema = z.object({ blocks: z.array(CommunityBlockSchema) }).passthrough();
const BlockResultSchema = z
  .object({ blocked_user_id: z.string(), blocked: z.boolean() })
  .passthrough();

function idempotentHeaders(): { headers: Record<string, string> } {
  return { headers: { 'Idempotency-Key': generateIdempotencyKey() } };
}

export const communitySafetyApi = {
  report(input: {
    target_type: CommunityReportTargetType;
    target_id: string;
    reason: string;
    notes?: string;
  }): Promise<void> {
    return call(
      z.unknown(),
      () => api.post<unknown>('/community/moderation/reports', input, idempotentHeaders()),
      'community report',
    ).then(() => undefined);
  },

  listBlocks(): Promise<CommunityBlock[]> {
    return call(BlockListSchema, () => api.get<unknown>('/community/blocks'), 'community blocks').then(
      (r) => r.blocks,
    );
  },

  block(userId: string): Promise<void> {
    return call(
      BlockResultSchema,
      () => api.post<unknown>('/community/blocks', { user_id: userId }, idempotentHeaders()),
      'community block',
    ).then(() => undefined);
  },

  unblock(userId: string): Promise<void> {
    return call(
      BlockResultSchema,
      () => api.delete<unknown>(`/community/blocks/${userId}`),
      'community unblock',
    ).then(() => undefined);
  },

  getSafetyInfo(): Promise<CommunitySafetyInfo> {
    return call(
      CommunitySafetyInfoSchema,
      () => api.get<unknown>('/community/safety'),
      'community safety',
    );
  },
};

interface ErrorBody {
  code?: unknown;
  message?: unknown;
}

/** Walk an error and its `.cause` chain to the axios response body/status. */
function responseOf(err: unknown): { status?: number; data?: ErrorBody } | null {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i += 1) {
    const e = cur as { response?: { status?: number; data?: unknown }; cause?: unknown };
    if (e.response) {
      const data = e.response.data;
      return {
        status: e.response.status,
        data: data && typeof data === 'object' ? (data as ErrorBody) : undefined,
      };
    }
    cur = e.cause;
  }
  return null;
}

/** Server error code (e.g. `community.content.rejected`) or undefined. */
export function communityErrorCode(err: unknown): string | undefined {
  const code = responseOf(err)?.data?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * When `err` is the backend's 422 content-filter rejection, the user-facing
 * message to show (the draft must be kept). Otherwise null.
 */
export function contentRejectedMessage(err: unknown): string | null {
  const res = responseOf(err);
  if (!res || res.status !== 422) return null;
  if (res.data?.code !== CONTENT_REJECTED_CODE) return null;
  return typeof res.data.message === 'string' && res.data.message
    ? res.data.message
    : CONTENT_REJECTED_FALLBACK;
}

/** Calm copy for a failed block, branching on the server's codes. */
export function blockErrorMessage(err: unknown): string {
  switch (communityErrorCode(err)) {
    case 'community.block.workspace_coach':
      return 'You cannot block your own coach. You can report the content, or contact the team from Community safety.';
    case 'community.block.self':
      return 'You cannot block yourself.';
    case 'community.block.not_found':
      return 'This member could not be found.';
    default:
      return 'Could not block this member. Please try again.';
  }
}
