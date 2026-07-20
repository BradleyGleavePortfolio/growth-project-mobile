/**
 * useReconstructCounts — honest, page-local counts + stable reasons for the
 * v0.3 extension-import review (PR-M4). A cursor-paginated useInfiniteQuery per
 * canonical family, mirroring useClassroomFeed + the foreground-refresh posture
 * of useRosterReviewDelta.
 *
 * Honesty (Rule 18): the only count is DISTINCT entities LOADED SO FAR — never a
 * total/percentage/ETA/completion. Fails closed (DISABLED, no network/listener)
 * when the kill switch is off or no coach id is known. User-scoped (Rule 15):
 * coach id is in the query key, so a second coach never inherits cached pages.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { featureFlags } from '../config/featureFlags';
import { useCurrentUser } from './useCurrentUser';
import { dedupeById } from '../utils/dedupeById';
import { importReviewApi, RECONSTRUCT_PAGE_LIMIT } from '../api/importReviewApi';
import type { CommunityApiError } from '../api/communityApi';
import type { ReconstructFamily, ReconstructReason } from '../types/importReview';

export interface ReconstructFamilyCounts {
  family: ReconstructFamily;
  // Distinct entities LOADED SO FAR across fetched pages — page-local, never a total.
  count: number;
  reasons: ReconstructReason[];
  isLoading: boolean; // first page in flight, nothing yet to show
  isRefreshing: boolean; // background refetch while prior data stays visible
  errorKind: CommunityApiError['kind'] | null; // latest error, or null when healthy
  hasData: boolean; // at least one page resolved
  hasMore: boolean; // an opaque next_cursor remains
  fetchMore: () => void;
  retry: () => void;
}

function useFamilyReconstruct(
  family: ReconstructFamily,
  coachId: string | null,
  enabled: boolean,
): ReconstructFamilyCounts {
  const query = useInfiniteQuery({
    // coach id + page size in the key ⇒ distinct cache per coach; cursor via pageParam.
    queryKey: [
      'import',
      'reconstruct',
      family,
      coachId ?? '∅',
      RECONSTRUCT_PAGE_LIMIT,
    ],
    queryFn: ({ pageParam }) =>
      importReviewApi.listEntities(family, {
        limit: RECONSTRUCT_PAGE_LIMIT,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: enabled && !!coachId,
  });

  const entities = useMemo(
    () => dedupeById((query.data?.pages ?? []).flatMap((p) => p.entities)),
    [query.data],
  );
  const reasons = useMemo(
    () =>
      dedupeById(
        (query.data?.pages ?? []).flatMap((p) => p.reasons),
        (r) => r.code,
      ),
    [query.data],
  );

  const hasData = query.data !== undefined;
  const err = query.error as CommunityApiError | null;
  const errorKind = query.isError
    ? (err && typeof err === 'object' && 'kind' in err ? err.kind : 'unknown')
    : null;

  return {
    family,
    count: entities.length,
    reasons,
    isLoading: query.isLoading,
    isRefreshing: query.isFetching && hasData && !query.isFetchingNextPage,
    errorKind,
    hasData,
    hasMore: query.hasNextPage ?? false,
    fetchMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    retry: () => {
      void query.refetch();
    },
  };
}

export interface ReconstructCounts {
  enabled: boolean; // false when the kill switch is off or no coach id is known
  families: ReconstructFamilyCounts[];
  refresh: () => void;
}

export function useReconstructCounts(): ReconstructCounts {
  const user = useCurrentUser();
  const coachId = user?.id ?? null;
  const enabled = featureFlags.extensionImport && !!coachId;

  // Fixed two-family fan-out — unconditional hooks (Rule 23), never a loop.
  const workouts = useFamilyReconstruct('workouts', coachId, enabled);
  const clientHistory = useFamilyReconstruct('client_history', coachId, enabled);

  const families = useMemo(
    () => [workouts, clientHistory],
    [workouts, clientHistory],
  );

  const refresh = useCallback(() => {
    families.forEach((f) => f.retry());
  }, [families]);

  // Foreground refresh: recompute on resume (mirrors useRosterReviewDelta). The
  // listener is registered once per enabled-change via a ref, so a flag-off
  // build touches no listener and re-renders never churn subscriptions.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') refreshRef.current();
    });
    return () => sub.remove();
  }, [enabled]);

  return { enabled, families, refresh };
}
