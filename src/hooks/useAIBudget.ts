/**
 * useAIBudget — TanStack Query hook over `GET /coach/ai/budget`.
 *
 * Polls every 60s WHILE the consuming screen is focused (Coach Home).
 * Background polling is suppressed via React Query's
 * `refetchIntervalInBackground: false` so a backgrounded app does not waste
 * mobile data or burn API quota.
 *
 * Stale data is acceptable for the meter chip: the worst case is a coach
 * sees a 10-second-old reading. We do NOT block render on the first fetch —
 * the meter renders nothing while loading (surface = 'hidden'), so the
 * Coach Home layout never shifts.
 *
 * Errors are surfaced to the caller via `query.error`. The mount logic in
 * Coach Home wraps the meter in an `ErrorBoundary` so a runtime exception in
 * a child render does not bring down the whole screen.
 *
 * Backend DTO contract: see `src/api/types/coachAIBudget.ts` and
 * `canonical_docs/STREAM_1_AI_CREDITS_SPEC.md` §5.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { coachAiBudgetApi } from '../api/coachAiBudgetApi';
import type { CoachAIBudgetResponse } from '../api/types/coachAIBudget';

/** TanStack Query key prefix. Exported so cache invalidation from the
 *  checkout success path can target the same key. */
export const COACH_AI_BUDGET_QUERY_KEY = ['coach', 'ai', 'budget'] as const;

/** Poll interval in ms. 60_000 matches the spec ("Refetch every 60s"). */
export const COACH_AI_BUDGET_REFETCH_MS = 60_000;

/**
 * 5-minute staleTime: a fresh budget fetched 4 minutes ago is still good
 * enough to compute the surface state without an extra round-trip on a
 * navigation back to Coach Home. The 60s refetch keeps it lively in steady
 * state.
 */
const STALE_MS = 5 * 60_000;

export type UseAIBudgetResult = UseQueryResult<CoachAIBudgetResponse, Error>;

export interface UseAIBudgetOptions {
  /**
   * When false, the query does not fire (and the refetch interval is
   * disabled). Use this to suspend polling when the user is signed out
   * or not on the Coach Home screen. Defaults to `true`.
   */
  enabled?: boolean;
}

export function useAIBudget(options: UseAIBudgetOptions = {}): UseAIBudgetResult {
  const { enabled = true } = options;
  return useQuery<CoachAIBudgetResponse, Error>({
    queryKey: COACH_AI_BUDGET_QUERY_KEY,
    queryFn: async () => {
      const res = await coachAiBudgetApi.getBudget();
      return res.data;
    },
    enabled,
    refetchInterval: enabled ? COACH_AI_BUDGET_REFETCH_MS : false,
    refetchIntervalInBackground: false,
    staleTime: STALE_MS,
    // The budget endpoint is cheap; one retry on a transient network blip
    // is friendly without producing a thundering herd on a real outage.
    retry: 1,
  });
}
