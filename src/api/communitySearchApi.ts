/**
 * communitySearchApi — typed client for the v3-4 Community Search backend
 * (full-text search across posts / classroom lessons / voice-note transcripts /
 * events, RLS-scoped to the caller's visible cohorts + role).
 *
 * Backend contract source of truth (do not drift):
 *   growth-project-backend/src/community/search/community-search.controller.ts
 *   growth-project-backend/src/community/search/community-search.dto.ts
 *
 * Wire posture mirrors communityVoiceApi.ts:
 *   - Every response is validated with Zod at the boundary so a drifted shape
 *     THROWS here (wrapped as a `contract` error) instead of feeding malformed
 *     data into React state.
 *   - The read is cursor-paginated: the response carries `nextCursor` (an opaque
 *     token to pass back as `cursor` for the next page; null on the last page),
 *     so the screen pages with useInfiniteQuery and never requests an unbounded
 *     result set.
 *   - The result row carries ONLY ids / kind / a PII-stripped, body-free excerpt
 *     / timestamp — NEVER a post body, transcript body, or any wearable value.
 *
 * IMPORTANT: this backend slice uses a CAMELCASE wire shape (`nextCursor`,
 * `targetId`, `cohortId`, `createdAt`, `tookMs`) — unlike the snake_case voice
 * slice — so the schemas below mirror that exactly.
 */
import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';
import { CommunityApiError } from './communityApi';

/** Max search-term length (mirror backend SEARCH_QUERY_MAX_LEN). */
export const SEARCH_QUERY_MAX_LEN = 200;
/** Default page size (mirror backend SEARCH_PAGE_SIZE_DEFAULT). */
export const SEARCH_PAGE_LIMIT = 20;
/** Max page size (mirror backend SEARCH_PAGE_SIZE_MAX). */
export const SEARCH_PAGE_LIMIT_MAX = 50;
/** Every network read carries an AbortSignal.timeout. */
export const SEARCH_REQUEST_TIMEOUT_MS = 15_000;

/** The four searchable object families (mirror backend CommunitySearchKind). */
export const SEARCH_KINDS = [
  'post',
  'classroom_lesson',
  'voice_note_transcript',
  'event',
] as const;
export type CommunitySearchKind = (typeof SEARCH_KINDS)[number];

// ─── Response schemas (mirror backend Zod, CAMELCASE wire shape) ─────────────

export const SearchResultRowSchema = z
  .object({
    id: z.string(),
    kind: z.enum(SEARCH_KINDS),
    targetId: z.string(),
    cohortId: z.string().nullable(),
    authorId: z.string().nullable(),
    excerpt: z.string(),
    createdAt: z.string(),
  })
  .strict();
export type SearchResultRow = z.infer<typeof SearchResultRowSchema>;

export const SearchResponseSchema = z
  .object({
    version: z.literal(1),
    query: z.string(),
    results: z.array(SearchResultRowSchema),
    nextCursor: z.string().nullable(),
    tookMs: z.number(),
  })
  .strict();
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

// ─── Transport helper (mirrors communityVoiceApi.call) ───────────────────────

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
        `community search request failed (${status || 'network'})`,
        err,
      );
    }
    throw new CommunityApiError(
      'unknown',
      -1,
      'community search request failed',
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
        'search response shape drifted from the backend contract',
        err,
      );
    }
    throw err;
  }
}

// ─── Request params ──────────────────────────────────────────────────────────

export interface SearchParams {
  /** The user-entered term (non-empty; trimmed client-side). */
  q: string;
  /** Optional kind filter. */
  kind?: CommunitySearchKind;
  /** Optional cohort scope (a cohort the caller can see). */
  cohortId?: string;
  /** Opaque forward cursor for the next page (omitted on the first page). */
  cursor?: string;
  /** Maximum results to request for this page. */
  limit?: number;
}

function queryParams(opts: SearchParams): Record<string, string> {
  const params: Record<string, string> = { q: opts.q.trim() };
  if (opts.kind) params.kind = opts.kind;
  if (opts.cohortId) params.cohortId = opts.cohortId;
  if (opts.cursor) params.cursor = opts.cursor;
  const limit = opts.limit ?? SEARCH_PAGE_LIMIT;
  if (Number.isFinite(limit) && limit > 0) {
    params.limit = String(Math.min(limit, SEARCH_PAGE_LIMIT_MAX));
  }
  return params;
}

// ─── API ───────────────────────────────────────────────────────────────────

export const communitySearchApi = {
  /**
   * Search a workspace. The membership/cohort/role/soft-delete visibility is
   * enforced server-side; a non-member receives 403 (mapped to `forbidden`).
   */
  async search(workspaceId: string, opts: SearchParams): Promise<SearchResponse> {
    return call(SearchResponseSchema, () =>
      api.get(`/community/workspaces/${workspaceId}/search`, {
        params: queryParams(opts),
        timeout: SEARCH_REQUEST_TIMEOUT_MS,
      }),
    );
  },
};
