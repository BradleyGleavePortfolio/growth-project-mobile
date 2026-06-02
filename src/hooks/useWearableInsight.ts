/**
 * useWearableInsight — React Query wrappers for the dual-role AI insight
 * surface (PR-HK-5a). Shared by the coach panel (HK-5a) and the client panel
 * (HK-5b); the query keys live in `wearableInsightsApi` so the two never
 * collide and an approve-mutation can invalidate the exact coach read.
 *
 * The mutation surfaces real errors (#36): a thrown error propagates to the
 * caller's `onError`/error state; the pre-HK-6 404 is already coerced to a
 * typed `not_implemented` ApproveResponse inside `approveDraft`, so the panel
 * can render a calm, recoverable CTA without the hook swallowing anything.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
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
  });
}

export function useApproveDraft() {
  const qc = useQueryClient();
  return useMutation<ApproveResponse, Error, ApproveDraftPayload>({
    mutationFn: approveDraft,
    onSuccess: (res, vars) => {
      // Only a materialised approve (post-HK-6) changes server state worth
      // refetching. A typed `not_implemented` MUST NOT invalidate — there is
      // nothing new to read and a refetch would only churn LLM budget.
      if (res.status === 'ok') {
        void qc.invalidateQueries({
          queryKey: insightQueryKeys.coach(vars.clientId, vars.bucket),
        });
      }
    },
    // No onError that swallows — errors propagate to the caller's error state.
  });
}
