/**
 * useHolisticInsights — React Query hook over holisticInsightsApi.
 *
 * The backend caches successful envelopes for 24 hours and
 * `finance_unavailable` envelopes for 5 minutes (Sprint B v2.1 audit
 * fix). We mirror those numbers on the client with a 24-hour staleTime
 * for fresh data so a navigation back to the home screen does not
 * refetch.
 *
 * The endpoint returns 200 on every status (`ok`, `insufficient_data`,
 * `finance_unavailable`) — branching is by `envelope.status`, not by
 * HTTP code. The hook surfaces the envelope as-is.
 *
 * Query key: `['holistic-insights', windowDays?]`.
 */

import { useQuery } from '@tanstack/react-query';
import {
  holisticInsightsApi,
  type HolisticInsightsEnvelope,
  type HolisticInsightsParams,
} from '../api/holisticInsightsApi';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function useHolisticInsights(params: HolisticInsightsParams = {}) {
  return useQuery<HolisticInsightsEnvelope>({
    queryKey: ['holistic-insights', params.windowDays ?? null],
    queryFn: () => holisticInsightsApi.get(params).then((r) => r.data),
    staleTime: TWENTY_FOUR_HOURS_MS,
  });
}
