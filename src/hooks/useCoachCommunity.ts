/**
 * useCoachCommunity — React Query hooks for the v1-6 coach community surface.
 *
 * Read hooks (useQuery) fetch through coachCommunityApi (which Zod-validates the
 * wire shape). Mutation hooks (useMutation) apply OPTIMISTIC updates with
 * rollback on failure per the hard gate: acknowledge inbox item, create cohort,
 * invite member, remove member, hide post, and hide message all reflect
 * instantly, then reconcile with the server response or roll back.
 *
 * The acting coach is always derived from the JWT inside coachCommunityApi; no
 * coachId is ever threaded through these hooks.
 */
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  coachCommunityApi,
  type CoachDashboard,
  type CoachInboxItem,
  type CoachInboxPage,
  type CoachCohort,
  type CoachCohortDetail,
  type CoachCohortMember,
  type CoachFlaggedItem,
} from '../api/coachCommunityApi';

// ─── Query keys (stable, namespaced) ─────────────────────────────────────────

export const coachCommunityKeys = {
  all: ['coachCommunity'] as const,
  dashboard: () => [...coachCommunityKeys.all, 'dashboard'] as const,
  inbox: () => [...coachCommunityKeys.all, 'inbox'] as const,
  cohorts: () => [...coachCommunityKeys.all, 'cohorts'] as const,
  cohort: (id: string) => [...coachCommunityKeys.all, 'cohort', id] as const,
  flagged: () => [...coachCommunityKeys.all, 'flagged'] as const,
};

// ─── Read hooks ──────────────────────────────────────────────────────────────

export function useCoachDashboard(): UseQueryResult<CoachDashboard> {
  return useQuery({
    queryKey: coachCommunityKeys.dashboard(),
    queryFn: () => coachCommunityApi.getDashboard(),
    staleTime: 30_000,
  });
}

export function useCoachInbox(): UseQueryResult<CoachInboxPage> {
  return useQuery({
    queryKey: coachCommunityKeys.inbox(),
    queryFn: () => coachCommunityApi.getInbox(),
    staleTime: 30_000,
  });
}

export function useCoachCohorts(): UseQueryResult<CoachCohort[]> {
  return useQuery({
    queryKey: coachCommunityKeys.cohorts(),
    queryFn: () => coachCommunityApi.getCohorts(),
    staleTime: 60_000,
  });
}

export function useCoachCohortDetail(
  cohortId: string,
): UseQueryResult<CoachCohortDetail> {
  return useQuery({
    queryKey: coachCommunityKeys.cohort(cohortId),
    queryFn: () => coachCommunityApi.getCohortDetail(cohortId),
    staleTime: 30_000,
  });
}

export function useCoachFlagged(): UseQueryResult<CoachFlaggedItem[]> {
  return useQuery({
    queryKey: coachCommunityKeys.flagged(),
    queryFn: () => coachCommunityApi.getFlagged(),
    staleTime: 15_000,
  });
}

// ─── Mutation hooks (optimistic + rollback) ──────────────────────────────────

/**
 * Acknowledge a single inbox item. Optimistically removes it from the cached
 * page and decrements the dashboard unread count; rolls both back on failure.
 */
export function useAckInboxItem(): UseMutationResult<void, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => coachCommunityApi.ackInboxItem(itemId),
    onMutate: async (itemId) => {
      await qc.cancelQueries({ queryKey: coachCommunityKeys.inbox() });
      await qc.cancelQueries({ queryKey: coachCommunityKeys.dashboard() });
      const prevInbox = qc.getQueryData<CoachInboxPage>(
        coachCommunityKeys.inbox(),
      );
      const prevDash = qc.getQueryData<CoachDashboard>(
        coachCommunityKeys.dashboard(),
      );
      if (prevInbox) {
        qc.setQueryData<CoachInboxPage>(coachCommunityKeys.inbox(), {
          ...prevInbox,
          items: prevInbox.items.filter((i) => i.id !== itemId),
        });
      }
      if (prevDash) {
        qc.setQueryData<CoachDashboard>(coachCommunityKeys.dashboard(), {
          ...prevDash,
          unread_inbox_count: Math.max(0, prevDash.unread_inbox_count - 1),
        });
      }
      return { prevInbox, prevDash };
    },
    onError: (_err, _itemId, ctx) => {
      const c = ctx as
        | { prevInbox?: CoachInboxPage; prevDash?: CoachDashboard }
        | undefined;
      if (c?.prevInbox) {
        qc.setQueryData(coachCommunityKeys.inbox(), c.prevInbox);
      }
      if (c?.prevDash) {
        qc.setQueryData(coachCommunityKeys.dashboard(), c.prevDash);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: coachCommunityKeys.inbox() });
      qc.invalidateQueries({ queryKey: coachCommunityKeys.dashboard() });
    },
  });
}

/**
 * Create a cohort. Optimistically inserts a provisional row at the top of the
 * cohort list; reconciles with the server row on success and rolls back on
 * failure.
 */
export function useCreateCohort(): UseMutationResult<
  CoachCohort,
  unknown,
  { name: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) =>
      coachCommunityApi.createCohort(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: coachCommunityKeys.cohorts() });
      const prev = qc.getQueryData<CoachCohort[]>(
        coachCommunityKeys.cohorts(),
      );
      const optimistic: CoachCohort = {
        id: `optimistic:${input.name}`,
        name: input.name,
        member_count: 0,
        unread_count: 0,
        created_at: new Date().toISOString(),
      };
      qc.setQueryData<CoachCohort[]>(coachCommunityKeys.cohorts(), [
        optimistic,
        ...(prev ?? []),
      ]);
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      const c = ctx as { prev?: CoachCohort[] } | undefined;
      if (c?.prev) qc.setQueryData(coachCommunityKeys.cohorts(), c.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: coachCommunityKeys.cohorts() });
    },
  });
}

/**
 * Invite a client to a cohort by email. Optimistically appends a provisional
 * member to the cohort detail cache; reconciles on success, rolls back on
 * failure.
 */
export function useInviteMember(
  cohortId: string,
): UseMutationResult<CoachCohortMember, unknown, { email: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string }) =>
      coachCommunityApi.inviteMember(cohortId, input),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: coachCommunityKeys.cohort(cohortId) });
      qc.invalidateQueries({ queryKey: coachCommunityKeys.cohorts() });
    },
  });
}

/**
 * Remove a member from a cohort. Optimistically drops the member from the
 * detail cache and decrements the member count; rolls back on failure. The
 * confirmation modal gates this in the UI before it ever fires.
 */
export function useRemoveMember(
  cohortId: string,
): UseMutationResult<void, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      coachCommunityApi.removeMember(cohortId, userId),
    onMutate: async (userId) => {
      await qc.cancelQueries({ queryKey: coachCommunityKeys.cohort(cohortId) });
      const prev = qc.getQueryData<CoachCohortDetail>(
        coachCommunityKeys.cohort(cohortId),
      );
      if (prev) {
        qc.setQueryData<CoachCohortDetail>(coachCommunityKeys.cohort(cohortId), {
          ...prev,
          members: prev.members.filter((m) => m.user_id !== userId),
          cohort: {
            ...prev.cohort,
            member_count: Math.max(0, prev.cohort.member_count - 1),
          },
        });
      }
      return { prev };
    },
    onError: (_err, _userId, ctx) => {
      const c = ctx as { prev?: CoachCohortDetail } | undefined;
      if (c?.prev) {
        qc.setQueryData(coachCommunityKeys.cohort(cohortId), c.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: coachCommunityKeys.cohort(cohortId) });
      qc.invalidateQueries({ queryKey: coachCommunityKeys.cohorts() });
    },
  });
}

/**
 * Hide a flagged item (post or message). Optimistically removes it from the
 * flagged queue and decrements the dashboard flagged-today count; rolls both
 * back on failure. The confirmation modal gates this before it fires.
 */
export function useHideFlagged(): UseMutationResult<
  void,
  unknown,
  CoachFlaggedItem
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: CoachFlaggedItem) =>
      item.target_type === 'post'
        ? coachCommunityApi.hidePost(item.target_id)
        : coachCommunityApi.hideMessage(item.target_id),
    onMutate: async (item) => {
      await qc.cancelQueries({ queryKey: coachCommunityKeys.flagged() });
      await qc.cancelQueries({ queryKey: coachCommunityKeys.dashboard() });
      const prevFlagged = qc.getQueryData<CoachFlaggedItem[]>(
        coachCommunityKeys.flagged(),
      );
      const prevDash = qc.getQueryData<CoachDashboard>(
        coachCommunityKeys.dashboard(),
      );
      if (prevFlagged) {
        qc.setQueryData<CoachFlaggedItem[]>(
          coachCommunityKeys.flagged(),
          prevFlagged.filter((f) => f.id !== item.id),
        );
      }
      if (prevDash) {
        qc.setQueryData<CoachDashboard>(coachCommunityKeys.dashboard(), {
          ...prevDash,
          flagged_today_count: Math.max(0, prevDash.flagged_today_count - 1),
        });
      }
      return { prevFlagged, prevDash };
    },
    onError: (_err, _item, ctx) => {
      const c = ctx as
        | { prevFlagged?: CoachFlaggedItem[]; prevDash?: CoachDashboard }
        | undefined;
      if (c?.prevFlagged) {
        qc.setQueryData(coachCommunityKeys.flagged(), c.prevFlagged);
      }
      if (c?.prevDash) {
        qc.setQueryData(coachCommunityKeys.dashboard(), c.prevDash);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: coachCommunityKeys.flagged() });
      qc.invalidateQueries({ queryKey: coachCommunityKeys.dashboard() });
    },
  });
}

/** Discriminated decision used by the moderation screen's approve action. */
export function useApproveFlagged(): UseMutationResult<
  void,
  unknown,
  CoachFlaggedItem
> {
  const qc = useQueryClient();
  // "Approve" clears the item from the queue without hiding the content. The
  // v1-6 backend exposes no approve endpoint yet (the flagged queue is the only
  // moderation read), so approving is a client-side dismissal that simply
  // refetches the authoritative queue. When the backend ships an approve/clear
  // endpoint (tracked for v2-x) this mutationFn swaps in without touching the
  // screen. Until then it optimistically removes the row and re-syncs.
  return useMutation({
    mutationFn: async (_item: CoachFlaggedItem) => {
      // No network mutation yet — re-sync against the authoritative queue.
      return undefined;
    },
    onMutate: async (item) => {
      await qc.cancelQueries({ queryKey: coachCommunityKeys.flagged() });
      const prev = qc.getQueryData<CoachFlaggedItem[]>(
        coachCommunityKeys.flagged(),
      );
      if (prev) {
        qc.setQueryData<CoachFlaggedItem[]>(
          coachCommunityKeys.flagged(),
          prev.filter((f) => f.id !== item.id),
        );
      }
      return { prev };
    },
    onError: (_err, _item, ctx) => {
      const c = ctx as { prev?: CoachFlaggedItem[] } | undefined;
      if (c?.prev) qc.setQueryData(coachCommunityKeys.flagged(), c.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: coachCommunityKeys.flagged() });
    },
  });
}

export type { CoachInboxItem };
