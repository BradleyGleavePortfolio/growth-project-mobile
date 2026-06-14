/**
 * communityClassroomApi — typed client for the v3-2 Community Classroom Posts
 * backend (media-backed lessons).
 *
 * Backend contract source of truth (do not drift):
 *   growth-project-backend/src/community/classroom/community-classroom.controller.ts
 *   growth-project-backend/src/community/classroom/community-classroom.dto.ts
 *
 * Wire posture mirrors communityChallengesApi.ts / communityApi.ts:
 *   - Every response is validated with Zod at the boundary so a drifted shape
 *     THROWS here (wrapped as a `contract` error) instead of feeding malformed
 *     data into React state.
 *   - The feed read is cursor-paginated: the response carries `next_cursor`
 *     (the lesson id to pass back as `cursor` for the next page; null on the
 *     last page), so the screen pages with useInfiniteQuery and never requests
 *     an unbounded result set.
 *   - Media download URLs are time-limited signed GETs minted server-side at
 *     read time; `url` is nullable so a lesson whose storage is unconfigured
 *     degrades to a disabled tile rather than a broken link.
 *   - `release_locked` is derived server-side (published but release_at in the
 *     future) so the client never compares clocks; a locked lesson renders the
 *     LessonReleaseLockBadge and suppresses media playback.
 *
 * The MOBILE surface is READ-ONLY (student feed + detail). Coach authoring
 * (create/edit/publish/attach-media/archive) is a separate coach surface and is
 * NOT part of this client binding; only the two GET routes are bound here.
 */
import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';
import { CommunityApiError } from './communityApi';

// ─── Enums (mirror backend dto) ───────────────────────────────────────────────

export const CLASSROOM_POST_STATUSES = [
  'draft',
  'scheduled',
  'published',
  'archived',
] as const;
export type ClassroomPostStatus = (typeof CLASSROOM_POST_STATUSES)[number];

export const CLASSROOM_MEDIA_KINDS = [
  'video',
  'audio',
  'pdf',
  'image',
] as const;
export type ClassroomMediaKind = (typeof CLASSROOM_MEDIA_KINDS)[number];

// ─── Response schemas (mirror backend Zod, snake_case wire shape) ─────────────

export const ClassroomMediaSchema = z
  .object({
    id: z.string().uuid(),
    post_id: z.string().uuid(),
    kind: z.enum(CLASSROOM_MEDIA_KINDS),
    /**
     * Time-limited signed GET URL for the object, or null when signing is
     * unavailable (storage not configured / release-locked). The client renders
     * a disabled tile rather than a broken link when null.
     */
    url: z.string().nullable(),
    duration_sec: z.number().int().nullable(),
    bytes: z.number().int().nullable(),
    mime_type: z.string().nullable(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    created_at: z.string().datetime(),
  })
  .strict();
export type ClassroomMedia = z.infer<typeof ClassroomMediaSchema>;

export const ClassroomPostSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    cohort_id: z.string().uuid().nullable(),
    coach_id: z.string().uuid(),
    title: z.string(),
    body_markdown: z.string(),
    status: z.enum(CLASSROOM_POST_STATUSES),
    pinned: z.boolean(),
    pinned_order: z.number().int().nullable(),
    release_at: z.string().datetime().nullable(),
    /**
     * True when the lesson is published but release_at is still in the future.
     * Derived server-side so the client never compares clocks; drives the
     * LessonReleaseLockBadge + media-playback suppression.
     */
    release_locked: z.boolean(),
    published_at: z.string().datetime().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    media: z.array(ClassroomMediaSchema),
  })
  .strict();
export type ClassroomPost = z.infer<typeof ClassroomPostSchema>;

const ClassroomFeedResponseSchema = z
  .object({
    posts: z.array(ClassroomPostSchema),
    /** Page cursor: id of the last lesson when more remain, else null. */
    next_cursor: z.string().uuid().nullable(),
  })
  .strict();
export type ClassroomFeedPage = z.infer<typeof ClassroomFeedResponseSchema>;

const ClassroomPostDetailResponseSchema = z
  .object({ post: ClassroomPostSchema })
  .strict();
export type ClassroomPostDetail = z.infer<
  typeof ClassroomPostDetailResponseSchema
>;

// ─── Transport helper (mirrors communityChallengesApi.call) ───────────────────

function classify(status: number): CommunityApiError['kind'] {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 410) return 'gone';
  if (status >= 500) return 'server';
  if (status === 0) return 'network';
  return 'unknown';
}

/** External-fetch timeout (brief: AbortSignal.timeout on every network read). */
export const CLASSROOM_REQUEST_TIMEOUT_MS = 15_000;

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
        `community classroom request failed (${status || 'network'})`,
        err,
      );
    }
    throw new CommunityApiError(
      'unknown',
      -1,
      'community classroom request failed',
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
        'classroom response shape drifted from the backend contract',
        err,
      );
    }
    throw err;
  }
}

// ─── Pagination (bounded, cursor-paged feed) ─────────────────────────────────

export const CLASSROOM_PAGE_LIMIT = 20;

export interface ClassroomPageParams {
  /** Maximum lessons to request for this page. */
  limit?: number;
  /** Opaque forward cursor for the next page (omitted on the first page). */
  cursor?: string;
  /** Optional cohort scope; omitted reads the workspace-wide feed. */
  cohortId?: string;
}

function feedParams(opts: ClassroomPageParams): Record<string, string> {
  const params: Record<string, string> = {};
  const limit = opts.limit ?? CLASSROOM_PAGE_LIMIT;
  if (Number.isFinite(limit) && limit > 0) params.limit = String(limit);
  if (opts.cursor) params.cursor = opts.cursor;
  if (opts.cohortId) params.cohort_id = opts.cohortId;
  return params;
}

// ─── Endpoints (read-only student surface) ───────────────────────────────────

export const communityClassroomApi = {
  /**
   * GET /community/workspaces/:workspaceId/classroom
   *
   * The student feed: published + released lessons the caller can see, pinned
   * first then newest. Release-locked and draft/archived lessons are filtered
   * server-side (and by RLS), so the client renders exactly what it receives.
   */
  listFeed(
    workspaceId: string,
    opts: ClassroomPageParams = {},
  ): Promise<ClassroomFeedPage> {
    return call(ClassroomFeedResponseSchema, () =>
      api.get<unknown>(`/community/workspaces/${workspaceId}/classroom`, {
        params: feedParams(opts),
        signal: AbortSignal.timeout(CLASSROOM_REQUEST_TIMEOUT_MS),
      }),
    );
  },

  /**
   * GET /community/classroom/:postId
   *
   * A single lesson with its media (signed download URLs). A release-locked or
   * non-visible lesson is a 404 server-side (existence never leaks), surfaced
   * here as a typed CommunityApiError the screen renders as a calm not-found.
   */
  getLesson(postId: string): Promise<ClassroomPost> {
    return call(ClassroomPostDetailResponseSchema, () =>
      api.get<unknown>(`/community/classroom/${postId}`, {
        signal: AbortSignal.timeout(CLASSROOM_REQUEST_TIMEOUT_MS),
      }),
    ).then((r) => r.post);
  },
};

export type CommunityClassroomApi = typeof communityClassroomApi;
