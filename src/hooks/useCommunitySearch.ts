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
 *
 * Voice (LO-848R4 B5): a page that can carry voice-note transcript rows (all kinds, or voice only) is
 * never saved to the phone (`meta.persist: false`, like the voice feed), so a restart cannot replay a
 * transcript excerpt of a note that was deleted, reported or blocked since. A voice-bearing page an
 * older build saved is refused: the hook drops it before it can render, online or offline.
 */
import { useState } from 'react';
import {
  useInfiniteQuery,
  useQueryClient,
  type QueryClient,
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

/** All kinds, or voice only: the pages can carry voice-note transcript rows. */
export function searchCarriesVoice(kind?: CommunitySearchKind): boolean {
  return kind === undefined || kind === 'voice_note_transcript';
}

/**
 * Drops every cached search page that can carry voice rows and is not marked unsaved. This hook marks
 * each voice-bearing page `persist: false`, so only a restore from the phone can leave one here.
 * Returns how many it dropped.
 */
export function purgeSavedVoiceSearches(qc: QueryClient): number {
  const cache = qc.getQueryCache();
  const saved = cache.findAll({ queryKey: communitySearchKeys.all }).filter((q) => {
    if (q.meta?.persist === false) return false;
    const kind = q.queryKey[communitySearchKeys.all.length + 2];
    const pages = (q.state.data as InfiniteData<SearchResponse> | undefined)?.pages ?? [];
    return (
      kind === '∅' ||
      kind === 'voice_note_transcript' ||
      pages.some((p) => p?.results?.some((r) => r.kind === 'voice_note_transcript'))
    );
  });
  saved.forEach((q) => cache.remove(q));
  return saved.length;
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
  const qc = useQueryClient();
  // Once per mount, before the query below is built: refuse voice pages a restore put back.
  useState(() => purgeSavedVoiceSearches(qc));

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
    meta: searchCarriesVoice(opts.kind) ? { persist: false } : undefined,
  });
}
