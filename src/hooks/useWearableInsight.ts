/**
 * useWearableInsight — React Query wrappers for the dual-role AI insight
 * surface (PR-HK-5a). Shared by the coach panel (HK-5a) and the client panel
 * (HK-5b); the query keys live in `wearableInsightsApi` so the two never
 * collide and an approve-mutation can invalidate the exact coach read.
 *
 * The mutation surfaces real errors (#36): the HK-6a approve endpoint is live,
 * so `approveDraft` resolves to exactly one success shape (`status: 'ok'`) or
 * THROWS. The hook never swallows — every failure (including a 404 from a
 * deploy/route regression) propagates to the caller's `onError`/error state so
 * the panel can render a generic, recoverable error.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { aiRefusalOf } from '../lib/ai/aiRefusal';
import {
  fetchCoachInsight,
  fetchClientInsight,
  approveDraft,
  insightQueryKeys,
  type CoachInsightResponse,
  type ClientInsightResponse,
  type ApproveResponse,
  type ApproveDraftPayload,
} from '../api/wearableInsightsApi';
import type { WearableMetricBucket } from '../api/wearablesSamplesApi';

// 6h — matches the backend insight cache TTL (controller @Throttle ttl is 1h
// per-call, but the generated insight is cached 6h server-side). Refetching
// sooner only burns LLM budget for an unchanged answer.
const INSIGHT_STALE_MS = 6 * 60 * 60 * 1_000;

/**
 * R2b: a consent / egress refusal is a stable answer, not a transient fault,
 * so it is shown at once instead of after three silent retries. Anything else
 * keeps React Query's default of three retries.
 */
export function retryUnlessAiRefused(failureCount: number, error: unknown): boolean {
  return aiRefusalOf(error) === null && failureCount < 3;
}

export function useCoachInsight(args: {
  clientId: string;
  bucket: WearableMetricBucket;
  enabled?: boolean;
}) {
  return useQuery<CoachInsightResponse, Error>({
    queryKey: insightQueryKeys.coach(args.clientId, args.bucket),
    queryFn: () =>
      fetchCoachInsight({ clientId: args.clientId, bucket: args.bucket }),
    // Guard against an empty clientId firing a doomed request.
    enabled: (args.enabled ?? true) && args.clientId.length > 0,
    staleTime: INSIGHT_STALE_MS,
    retry: retryUnlessAiRefused,
  });
}

export function useClientInsight(args: {
  bucket: WearableMetricBucket;
  enabled?: boolean;
}) {
  return useQuery<ClientInsightResponse, Error>({
    queryKey: insightQueryKeys.client(args.bucket),
    queryFn: () => fetchClientInsight({ bucket: args.bucket }),
    enabled: args.enabled ?? true,
    staleTime: INSIGHT_STALE_MS,
    retry: retryUnlessAiRefused,
  });
}

export function useApproveDraft() {
  const qc = useQueryClient();
  return useMutation<ApproveResponse, Error, ApproveDraftPayload>({
    mutationFn: approveDraft,
    onSuccess: (_res, vars) => {
      // A successful approve materialises server state, so refetch the exact
      // coach read it affected. `onSuccess` only fires for `status: 'ok'`
      // (the sole success shape now HK-6a is live), so there is nothing to
      // branch on — invalidate unconditionally.
      void qc.invalidateQueries({
        queryKey: insightQueryKeys.coach(vars.clientId, vars.bucket),
      });
    },
    // No onError that swallows — errors propagate to the caller's error state.
  });
}
