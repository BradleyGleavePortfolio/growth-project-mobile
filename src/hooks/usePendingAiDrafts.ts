/**
 * usePendingAiDrafts — React Query hook over `GET /coach/ai/drafts/pending`.
 *
 * Follows the same focus-gated polling pattern Stream 1 set up for the
 * AI budget meter (see `src/hooks/useAIBudget.ts`). Polls every 30s
 * WHILE the consuming screen is focused; suspends polling otherwise so
 * the backgrounded app does not waste mobile data or burn API quota.
 *
 * The hook caller is expected to AND `enabled` with `useIsFocused()` —
 * mirror the pattern from `AIBudgetMount` so a screen blur immediately
 * stops polling and a focus immediately resumes it. The hook itself
 * stays focus-agnostic so it remains usable from non-screen contexts
 * (e.g. the invocation sheet, which wants to refresh the inbox after
 * a successful submit even though the inbox screen is not on top).
 *
 * Stale data is acceptable: the worst case is a coach sees a 30s-old
 * pending list. The 30s interval matches the spec's "Refresh on focus"
 * requirement without burning the backend.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { coachAiExecutionApi } from '../api/coachAiExecutionApi';
import type { ListPendingResponse } from '../api/types/coachAiExecution';

/** Query-key prefix. Exported so mutations (approve / reject / invoke)
 *  can invalidate the cache via `queryClient.invalidateQueries`. */
export const COACH_AI_PENDING_DRAFTS_QUERY_KEY = ['coach', 'ai', 'pending-drafts'] as const;

/** Poll interval in ms. 30_000 per spec §5.1. */
export const COACH_AI_PENDING_DRAFTS_REFETCH_MS = 30_000;

/** 2-minute staleTime: a cached list that's fresh enough to render on a
 *  re-mount of the inbox without an extra round-trip. The 30s refetch
 *  keeps it lively in steady state. */
const STALE_MS = 2 * 60_000;

export type UsePendingAiDraftsResult = UseQueryResult<ListPendingResponse, Error>;

export interface UsePendingAiDraftsOptions {
  /**
   * When false the query does not fire and the refetch interval is
   * disabled. The consuming component composes this with
   * `useIsFocused()` so polling is suspended when the inbox is not on
   * top of the navigation stack. Defaults to true.
   */
  enabled?: boolean;
}

export function usePendingAiDrafts(
  options: UsePendingAiDraftsOptions = {},
): UsePendingAiDraftsResult {
  const { enabled = true } = options;
  return useQuery<ListPendingResponse, Error>({
    queryKey: COACH_AI_PENDING_DRAFTS_QUERY_KEY,
    queryFn: () => coachAiExecutionApi.listPending(),
    enabled,
    refetchInterval: enabled ? COACH_AI_PENDING_DRAFTS_REFETCH_MS : false,
    refetchIntervalInBackground: false,
    staleTime: STALE_MS,
    // The endpoint is cheap; one retry on a transient network blip is
    // friendly without producing a thundering herd on a real outage.
    retry: 1,
  });
}
