/**
 * useRegimes — TanStack Query v5 hooks for the F2 named-regimes +
 * partial-refund decision surfaces.
 *
 * Thin wrappers over `regimesApi` / `refundDecisionsApi` (src/services/api.ts)
 * so auth headers, refresh-token mutex, and retry policy keep living in one
 * place. Query-key conventions mirror useApi.ts:
 *   ['regimes']                          → regime list
 *   ['regimes', id, 'revisions']         → one regime's revision history
 *   ['refund-decisions', 'pending']      → pending partial-refund decisions
 *
 * Mutations invalidate the broadest reasonable prefix so the list + any open
 * detail refetch after a write.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { regimesApi, refundDecisionsApi } from '../services/api';
import type {
  RegimeListItem,
  RegimeRevisionItem,
  PendingRefundDecision,
} from '../types/regimes';

const REGIMES_KEY = ['regimes'] as const;
const PENDING_DECISIONS_KEY = ['refund-decisions', 'pending'] as const;

/** List the coach's active named regimes. */
export function useRegimes() {
  return useQuery<RegimeListItem[]>({
    queryKey: REGIMES_KEY,
    queryFn: async () => (await regimesApi.list()).data,
  });
}

/** Read-only revision history for one regime (the "last 3 versions" drawer). */
export function useRegime(id: string) {
  return useQuery<RegimeRevisionItem[]>({
    queryKey: ['regimes', id, 'revisions'],
    queryFn: async () => (await regimesApi.getRevisions(id)).data,
    enabled: !!id,
  });
}

/** Promote an existing workout program to a named regime. */
export function usePromoteToRegime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { programId: string; regime_display_name?: string }) =>
      regimesApi
        .promoteFromProgram(args.programId, {
          regime_display_name: args.regime_display_name,
        })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: REGIMES_KEY });
    },
  });
}

/** Update a regime's display name. */
export function useUpdateRegime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; regime_display_name: string }) =>
      regimesApi
        .update(args.id, { regime_display_name: args.regime_display_name })
        .then((r) => r.data),
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: REGIMES_KEY });
      qc.invalidateQueries({ queryKey: ['regimes', args.id, 'revisions'] });
    },
  });
}

/** Archive a regime (active clients continue, new attachments blocked). */
export function useArchiveRegime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => regimesApi.archive(id).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: REGIMES_KEY });
    },
  });
}

/**
 * Push the current regime content to a package's existing buyers via F1's
 * endpoint. 404s until F1 (PR #326) merges — acceptable since the F2 flag is
 * OFF in production.
 */
export function usePushRegimeToExisting() {
  return useMutation({
    mutationFn: (args: { packageId: string; contentId: string }) =>
      regimesApi
        .pushToExisting(args.packageId, args.contentId)
        .then((r) => r.data),
  });
}

/** List pending partial-refund decisions awaiting the coach. */
export function usePartialRefundDecisions() {
  return useQuery<PendingRefundDecision[]>({
    queryKey: PENDING_DECISIONS_KEY,
    queryFn: async () => (await refundDecisionsApi.listPending()).data,
  });
}

/** Apply a coach decision to a pending partial-refund. */
export function useDecideRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      refundId: string;
      decision: 'keep_drops' | 'unassign_drops';
    }) =>
      refundDecisionsApi
        .decide(args.refundId, { decision: args.decision })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PENDING_DECISIONS_KEY });
    },
  });
}
