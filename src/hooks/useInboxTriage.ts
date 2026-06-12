/**
 * useInboxTriage — React Query wrapper for the v2-4 community AI inbox-triage
 * read (GET /community/ai-triage). Consumed by the coach inbox screen's
 * AiTriageCard, gated by `featureFlags.communityAiTriage`.
 *
 * The query NEVER swallows: a byte-identical 404 (server kill-switch off), any
 * HTTP failure, or a Zod drift propagates to the hook's `isError`/`error` so
 * the card renders a calm, typed error rather than a fabricated "all clear".
 * The card is purely a READ surface — there is no mutation here, mirroring the
 * backend's structural no-send guarantee.
 */

import { useQuery } from '@tanstack/react-query';
import {
  fetchInboxTriage,
  triageQueryKeys,
  type TriageResponse,
} from '../api/communityAiTriageApi';

// 5 minutes — matches the backend in-process triage cache TTL
// (growth-project-backend/src/community/ai-triage/triage-cache.service.ts:21,
// TRIAGE_CACHE_TTL_MS). Refetching sooner only burns LLM budget for an answer
// the server would serve from its own cache anyway.
const TRIAGE_STALE_MS = 5 * 60 * 1_000;

export function useInboxTriage(args?: { enabled?: boolean }) {
  return useQuery<TriageResponse, Error>({
    queryKey: triageQueryKeys.inbox(),
    queryFn: fetchInboxTriage,
    enabled: args?.enabled ?? true,
    staleTime: TRIAGE_STALE_MS,
    // A 404 (server flag off) or 403 (not a coach) is a stable answer, not a
    // transient fault — do not hammer the endpoint with retries.
    retry: false,
  });
}
