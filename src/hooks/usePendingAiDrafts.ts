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

import { useCallback } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { coachAiExecutionApi } from '../api/coachAiExecutionApi';
import type { AiActionDraftRow, ListPendingResponse } from '../api/types/coachAiExecution';
import { useBlockedUsersStore } from '../store/blockedUsersStore';

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

// The drafts with words for the client (backend ai-approval.service.ts keepOnRoster `words`): a Roman message or a nudge.
const WORDS_CAPABILITIES: ReadonlySet<string> = new Set(['draft.coach_message', 'draft.coach_wearable_message', 'draft.send_notification']);
// The payload keys that name a client (backend ai-approval.service.ts PAYLOAD_CLIENT_ID_KEYS).
const PAYLOAD_CLIENT_ID_KEYS = ['clientId', 'client_id', 'target_client_id'] as const;

/** The clients a draft acts on: its subject and every client its payload names. */
export function draftClientIds(d: Pick<AiActionDraftRow, 'subject_user_id' | 'payload'>): string[] {
  const ids = new Set<string>();
  if (d.subject_user_id) ids.add(d.subject_user_id);
  const p: unknown = d.payload;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    for (const key of PAYLOAD_CLIENT_ID_KEYS) {
      const v = (p as Record<string, unknown>)[key];
      if (typeof v === 'string' && v.length > 0) ids.add(v);
    }
  }
  return [...ids];
}

/**
 * KT-2 (LS-952 B2): the one rule for which drafts a coach sees and counts (Messages card, drafts screen, Home). It is
 * the server's queue rule (backend ai-approval.service.ts keepOnRoster) kept on the phone between reads: a draft with
 * words for a client this coach blocked leaves at once, from the block store blockSync fills, with no new read. A
 * workout or meal plan draft stays, as the server keeps it. Their block, a move to another coach and a draft quoting a
 * blocked person's chat message (withoutBlockedSources) are known only from the server, whose next answer leaves them out.
 */
export function visibleDrafts(drafts: readonly AiActionDraftRow[], blocked: ReadonlySet<string>): AiActionDraftRow[] {
  if (blocked.size === 0) return [...drafts];
  return drafts.filter((d) => !(WORDS_CAPABILITIES.has(d.capability) && draftClientIds(d).some((id) => blocked.has(id))));
}

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
  const blocked = useBlockedUsersStore((st) => st.blocked);
  const select = useCallback((res: ListPendingResponse): ListPendingResponse => {
    if (!res || !Array.isArray(res.drafts) || blocked.length === 0) return res;
    const drafts = visibleDrafts(res.drafts, new Set(blocked.map((b) => b.id)));
    return drafts.length === res.drafts.length ? res : { ...res, drafts };
  }, [blocked]);
  return useQuery<ListPendingResponse, Error>({
    queryKey: COACH_AI_PENDING_DRAFTS_QUERY_KEY,
    queryFn: () => coachAiExecutionApi.listPending(),
    select,
    enabled,
    refetchInterval: enabled ? COACH_AI_PENDING_DRAFTS_REFETCH_MS : false,
    refetchIntervalInBackground: false,
    staleTime: STALE_MS,
    // The endpoint is cheap; one retry on a transient network blip is
    // friendly without producing a thundering herd on a real outage.
    retry: 1,
  });
}
