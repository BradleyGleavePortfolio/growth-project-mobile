/**
 * useClassroomFeed — the read-only classroom feed query for the v3-2 student
 * surface. Wraps `communityClassroomApi.listFeed` in a cursor-paginated
 * `useInfiniteQuery` so older lessons stay reachable without an unbounded
 * fetch, mirroring the v3-1 challenges feed wiring.
 *
 * Posture:
 *   - The query is ENABLED only when a non-null workspace id exists AND the
 *     `communityClassroom` flag is on. With the flag off the route is not even
 *     registered (see CommunityNavigator), so this is belt-and-suspenders: no
 *     classroom request is ever issued in a flag-off build.
 *   - Pages are deduped by id by the caller (dedupeById) before they reach a
 *     FlatList; here we only thread the cursor (`next_cursor` -> pageParam).
 *   - No data is mutated and nothing is cached beyond React Query's defaults;
 *     this is a pure read.
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import type {
  UseInfiniteQueryResult,
  InfiniteData,
} from '@tanstack/react-query';
import { featureFlags } from '../config/featureFlags';
import {
  communityClassroomApi,
  CLASSROOM_PAGE_LIMIT,
  type ClassroomFeedPage,
} from '../api/communityClassroomApi';

export interface UseClassroomFeedOptions {
  /**
   * Workspace id — classroom posts are workspace-scoped on the backend. A null
   * id means the prerequisite (`useCommunityMe`) has not resolved yet; the
   * query stays disabled rather than firing with a bogus id.
   */
  workspaceId: string | null;
  /** Optional cohort scope; omitted reads the workspace-wide feed. */
  cohortId?: string;
}

export type ClassroomFeedQuery = UseInfiniteQueryResult<
  InfiniteData<ClassroomFeedPage>,
  Error
>;

export function useClassroomFeed({
  workspaceId,
  cohortId,
}: UseClassroomFeedOptions): ClassroomFeedQuery {
  return useInfiniteQuery({
    // The page limit + cohort scope are part of the key so a different page
    // size or scope is a distinct cache entry; the cursor threads through
    // pageParam under the one key.
    queryKey: [
      'community',
      'classroom',
      'feed',
      workspaceId ?? '∅',
      cohortId ?? 'all',
      CLASSROOM_PAGE_LIMIT,
    ],
    queryFn: ({ pageParam }) => {
      // Unreachable at runtime: the query is `enabled` only when workspaceId is
      // non-null. The guard narrows `string | null` -> `string` without a cast.
      if (!workspaceId) throw new Error('workspaceId is required');
      return communityClassroomApi.listFeed(workspaceId, {
        limit: CLASSROOM_PAGE_LIMIT,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(cohortId ? { cohortId } : {}),
      });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !!workspaceId && featureFlags.communityClassroom,
  });
}
