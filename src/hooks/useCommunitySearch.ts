/**
 * useCommunitySearch — React Query hook for the v3-4 community search surface.
 *
 * Cursor-paginated via useInfiniteQuery (TanStack Query v5): each page carries
 * an opaque `nextCursor`; the hook stops when it is null. The query is DISABLED
 * until the workspace id is present AND the trimmed term is non-empty, so the
 * screen never fires an unbounded "match everything" request and an empty input
 * shows the empty state rather than a network call.
 *
 * The communitySearchApi Zod-validates every page; a drifted shape throws a
 * `contract` CommunityApiError that React Query surfaces as the query error.
 */
import {
  useInfiniteQuery,
  type UseInfiniteQueryResult,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  communitySearchApi,
  type CommunitySearchKind,
  type SearchResponse,
} from '../api/communitySearchApi';

// ─── Query keys (stable, namespaced) ─────────────────────────────────────────

export const communitySearchKeys = {
  all: ['community', 'search'] as const,
  query: (
    workspaceId: string,
    term: string,
    kind?: CommunitySearchKind,
    cohortId?: string,
  ) =>
    [
      ...communitySearchKeys.all,
      workspaceId,
      term,
      kind ?? '∅',
      cohortId ?? '∅',
    ] as const,
};

export interface UseCommunitySearchOptions {
  workspaceId?: string;
  /** The user-entered term; the hook trims and gates on non-empty. */
  term: string;
  kind?: CommunitySearchKind;
  cohortId?: string;
  /**
   * Caller-supplied gate (mirrors useWearablePrompts.enabled): the screen
   * passes its resolved runtime flag here so the query never fires before the
   * server flag is known ON. ANDed with the hook's own workspace + term floors;
   * when omitted it defaults to true so other callers keep id/term-only gating.
   */
  enabled?: boolean;
}

/**
 * Paginated search results. `data.pages` is an array of SearchResponse; the
 * screen flattens `pages.flatMap(p => p.results)` and calls `fetchNextPage`
 * when `hasNextPage` is true.
 */
export function useCommunitySearch(
  opts: UseCommunitySearchOptions,
): UseInfiniteQueryResult<InfiniteData<SearchResponse>, Error> {
  const trimmed = opts.term.trim();
  const callerEnabled = opts.enabled ?? true;
  const enabled =
    callerEnabled && Boolean(opts.workspaceId) && trimmed.length > 0;

  return useInfiniteQuery({
    queryKey: communitySearchKeys.query(
      opts.workspaceId ?? '∅',
      trimmed,
      opts.kind,
      opts.cohortId,
    ),
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      communitySearchApi.search(opts.workspaceId as string, {
        q: trimmed,
        kind: opts.kind,
        cohortId: opts.cohortId,
        cursor: pageParam,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}
