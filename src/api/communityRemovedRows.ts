/**
 * communityRemovedRows (REMOVED-BY-M3, backend #1176 CONTRACT 6450153770): Hall posts and comments a coach removed.
 *
 * These reads send the opt-in header, so the server keeps a coach-removed post or comment in place as a placeholder
 * (title and body null, no reactions, plus removed_at and removed_by) instead of leaving it out, and a removed post's
 * own page answers 200 with that placeholder and no comments instead of 404. A server without #1176 ignores the header
 * and answers as today: no removed keys, so nothing changes on screen.
 *
 * The reads live here because src/api/communityApi.ts is held by another open PR (m#879); they reuse its schemas. The
 * schemas are built on first use, not at import, so a test that stubs communityApi still loads this file.
 */
import { z } from 'zod';
import api from '../services/api';
import { call } from './apiCall';
import {
  CommunityCommentSchema,
  CommunityPostSchema,
  type CommunityComment,
  type CommunityPost,
} from './communityApi';

/** Contract section 1: without it, coach-removed rows are left out (today's answer). */
export const REMOVED_ROWS_HEADERS = { 'X-Client-Removed-Rows': '1' } as const;

/** The coach who removed it, as on voice notes (exactly these three keys). */
export const RemovedBySchema = z
  .object({ role: z.literal('coach'), user_id: z.string(), name: z.string() })
  .strict();
export type RemovedBy = z.infer<typeof RemovedBySchema>;

/** Present only on a coach-removed row; absent on live rows, author deletes and header-less answers. */
export type RemovedMark = { removed_at?: string; removed_by?: RemovedBy };
export type RemovablePost = CommunityPost & RemovedMark;
export type RemovableComment = Omit<CommunityComment, 'body'> & { body: string | null } & RemovedMark;
export type RemovablePostPage = { posts: RemovablePost[]; next_before: string | null };

/** True when the server marked the row as a coach's removal. */
export function isCoachRemoved(row: RemovedMark | null | undefined): boolean {
  return !!row && (!!row.removed_at || !!row.removed_by);
}

const mark = () => ({ removed_at: z.string().optional(), removed_by: RemovedBySchema.optional() });
let built: { page: z.ZodType<RemovablePostPage>; one: z.ZodType<{ post: RemovablePost }>; comments: z.ZodType<{ comments: RemovableComment[] }> } | null = null;
function schemas() {
  if (built) return built;
  const post = CommunityPostSchema.extend(mark());
  // A removed comment's body is null (contract section 4); a live one is the same string as today.
  const comment = CommunityCommentSchema.extend({ ...mark(), body: z.string().nullable() });
  built = {
    page: z.object({ posts: z.array(post), next_before: z.string().nullable() }).passthrough() as unknown as z.ZodType<RemovablePostPage>,
    one: z.object({ post }).passthrough() as unknown as z.ZodType<{ post: RemovablePost }>,
    comments: z.object({ comments: z.array(comment) }).passthrough() as unknown as z.ZodType<{ comments: RemovableComment[] }>,
  };
  return built;
}

export const removedRowsApi = {
  /** GET /community/workspaces/:workspaceId/posts — the Hall or space list, removed posts kept as placeholders. */
  listPosts(workspaceId: string): Promise<RemovablePostPage> {
    return call(schemas().page, () =>
      api.get<unknown>(`/community/workspaces/${workspaceId}/posts`, { headers: REMOVED_ROWS_HEADERS }),
    );
  },

  /** GET /community/posts/:postId — a removed post answers its placeholder (200), not 404. */
  getPost(postId: string): Promise<RemovablePost> {
    return call(schemas().one, () =>
      api.get<unknown>(`/community/posts/${postId}`, { headers: REMOVED_ROWS_HEADERS }),
    ).then((r) => r.post);
  },

  /** GET /community/posts/:postId/comments — removed replies kept as placeholders; a removed post answers []. */
  listComments(postId: string): Promise<RemovableComment[]> {
    return call(schemas().comments, () =>
      api.get<unknown>(`/community/posts/${postId}/comments`, { headers: REMOVED_ROWS_HEADERS }),
    ).then((r) => r.comments);
  },
};
