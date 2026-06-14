/**
 * useCoachThreeArcCounts — TanStack Query hook for the ED.2 three-arc router.
 *
 * Reads GET /coach/home/daily-rings (the calling coach's three completion arcs
 * for today). Polled on Coach Home focus; the backend memoises for 30s, so the
 * client mirrors that with a 30s staleTime to avoid hammering the endpoint.
 *
 * The hook is `enabled` only when the caller passes `enabled: true` — the
 * screen gates the mount AND the fetch behind `featureFlags.romanThreeArcRouter`
 * so a flag-OFF build never issues the request.
 *
 * NOTE (TanStack Query v5): consumers that assert on `result.current.data` in a
 * test must `await waitFor(() => expect(result.current.data?.brief).toBe...)`
 * (the L8/L10 RNTL v14 learning) — the resolved value lands on the next
 * microtask flush after the query settles.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  coachDailyRingsApi,
  type DailyRings,
  type DailyRingsApiError,
} from '../api/coachDailyRingsApi';

/** Mirror the backend 30s cache so the client polls no faster than the server. */
export const DAILY_RINGS_STALE_TIME_MS = 30_000;

export const coachThreeArcCountsKeys = {
  all: ['coach', 'home', 'dailyRings'] as const,
};

export interface UseCoachThreeArcCountsOptions {
  /** Gate the fetch — the screen passes featureFlags.romanThreeArcRouter. */
  enabled: boolean;
}

export function useCoachThreeArcCounts(
  opts: UseCoachThreeArcCountsOptions,
): UseQueryResult<DailyRings, DailyRingsApiError> {
  return useQuery<DailyRings, DailyRingsApiError>({
    queryKey: coachThreeArcCountsKeys.all,
    enabled: opts.enabled,
    queryFn: () => coachDailyRingsApi.get(),
    staleTime: DAILY_RINGS_STALE_TIME_MS,
  });
}
