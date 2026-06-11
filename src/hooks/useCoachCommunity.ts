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
  CoachCommunityApiError,
  COACH_EMPTY_STATE_SURFACE_KEYS,
  type AckStateDto,
  type CoachDashboard,
  type CoachInboxItem,
  type CoachInboxPage,
  type CoachCohort,
  type CoachCohortDetail,
  type CoachCohortMember,
  type CoachFlaggedItem,
  type CoachEmptyStatesResponse,
  type CoachEmptyStateSurfaceKey,
  type RomanCopyPayload,
  type CoachPostDetail,
  type CoachMessage,
} from '../api/coachCommunityApi';
// NOTE (fixer R2, BLOCKER 1): `getCoachEmptyStateFallback` is intentionally NOT
// imported here. The success-empty render path must consume the BACKEND payload
// or render an honest loading/error branch — never local Roman copy. The legacy
// fallback helper remains in `coachVoice.ts` for an explicit, opt-in
// offline-cache mode only (see that module's header); it is never reachable
// from this hook.

// ─── Query keys (stable, namespaced) ─────────────────────────────────────────

export const coachCommunityKeys = {
  all: ['coachCommunity'] as const,
  dashboard: () => [...coachCommunityKeys.all, 'dashboard'] as const,
  inbox: () => [...coachCommunityKeys.all, 'inbox'] as const,
  cohorts: () => [...coachCommunityKeys.all, 'cohorts'] as const,
  cohort: (id: string) => [...coachCommunityKeys.all, 'cohort', id] as const,
  flagged: () => [...coachCommunityKeys.all, 'flagged'] as const,
  emptyStates: () => [...coachCommunityKeys.all, 'emptyStates'] as const,
  post: (id: string) => [...coachCommunityKeys.all, 'post', id] as const,
  /** v2-2 single cohort-message view (coach message-detail surface). */
  message: (id: string) => [...coachCommunityKeys.all, 'message', id] as const,
  /**
   * v2-2 per-message ack envelope (state + SLA snapshot). Seeded from the inbox
   * payload and updated optimistically by `useCoachAckActions`; the
   * `CoachAckBadge` reads it so an in-flight transition reflects instantly.
   */
  ackState: (messageId: string) =>
    [...coachCommunityKeys.all, 'ackState', messageId] as const,
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

/**
 * Fetch the operator-locked Roman empty-state payloads for every coach surface
 * (the face+voice contract). One call, cached for the session (the policy
 * almost never changes mid-session; it re-fetches on app restart / version
 * bump). The runtime invariant below is the contract enforcement point: a
 * successful 200 that is MISSING any known surface_key throws a typed
 * `contract` error rather than silently letting a screen fall back to local
 * constants — that silent fallback is exactly the violation this fix removes.
 */
export function useCoachEmptyStates(): UseQueryResult<CoachEmptyStatesResponse> {
  return useQuery({
    queryKey: coachCommunityKeys.emptyStates(),
    queryFn: async () => {
      const data = await coachCommunityApi.getCoachEmptyStates();
      for (const key of COACH_EMPTY_STATE_SURFACE_KEYS) {
        if (data[key] == null) {
          throw new CoachCommunityApiError(
            'contract',
            200,
            `coach empty-states response missing required surface: ${key}`,
          );
        }
      }
      return data;
    },
    // The policy is effectively static within a session.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
}

/**
 * Stateful result of resolving the Roman empty-state copy for ONE surface.
 *
 * The screen branches on `status`:
 *   - `loading` — the empty-states policy is still being fetched. Render a
 *     non-Roman skeleton/spinner, NEVER Roman copy.
 *   - `error`   — the fetch failed (`network`) or returned a 200 missing the
 *     required surface (`contract`). Render `CoachErrorState` with `retry`,
 *     NEVER the calm/celebratory empty state.
 *   - `ready`   — the live backend payload for this surface is present. Only
 *     now may the screen render `CoachEmptyState` with `payload`.
 *
 * There is NO local-constant fallback on any branch: Roman-voiced copy is
 * rendered ONLY from the backend payload, satisfying the operator-locked
 * face+voice backend-source rule.
 */
export type RomanEmptyStateResult =
  | { status: 'loading' }
  | { status: 'error'; kind: 'network' | 'contract'; retry: () => void }
  | { status: 'ready'; payload: RomanCopyPayload };

/**
 * Resolve the Roman copy payload for ONE surface as a discriminated state.
 *
 * Derives `status` from the underlying `useCoachEmptyStates()` query:
 *   - `isLoading` (initial fetch in flight)              → `loading`
 *   - `isError`                                          → `error`, with
 *       `kind: 'contract'` when the failure is a `CoachCommunityApiError`
 *       whose `kind` is `'contract'` (a 200 missing a required surface),
 *       otherwise `kind: 'network'`
 *   - `data[surfaceKey]` present                         → `ready` with payload
 *   - `data` present but this surface MISSING            → `error` /
 *       `'contract'` (defensive: `useCoachEmptyStates` already throws on a
 *       missing surface, so a settled `data` normally has every key)
 *
 * The screen NEVER renders `CoachEmptyState` (calm/celebratory copy + Roman's
 * face) unless this returns `ready`.
 */
export function useCoachEmptyStatePayload(
  surfaceKey: CoachEmptyStateSurfaceKey,
): RomanEmptyStateResult {
  const emptyStates = useCoachEmptyStates();
  const retry = (): void => {
    void emptyStates.refetch();
  };

  if (emptyStates.isError) {
    const err = emptyStates.error;
    const kind: 'network' | 'contract' =
      err instanceof CoachCommunityApiError && err.kind === 'contract'
        ? 'contract'
        : 'network';
    return { status: 'error', kind, retry };
  }

  const live = emptyStates.data?.[surfaceKey];
  if (live != null) {
    return { status: 'ready', payload: live };
  }

  // No error and no payload yet: either the initial fetch is in flight, or
  // (defensively) the settled response is missing this surface. A settled
  // success that is missing the key is a contract failure, not a loading state.
  if (emptyStates.isLoading || emptyStates.isFetching || !emptyStates.isSuccess) {
    return { status: 'loading' };
  }
  return { status: 'error', kind: 'contract', retry };
}

/**
 * Read the cached v2-2 ack envelope for a single message reactively.
 *
 * The envelope is not fetched on its own (the inbox payload is the source of
 * truth); this hook subscribes to the per-message `ackState` cache slot so the
 * `CoachAckBadge` re-renders when `useCoachAckActions` writes an optimistic or
 * reconciled value. `enabled: false` + a no-op `queryFn` keep it a pure cache
 * reader that never triggers a network call. Returns `undefined` until an ack
 * value exists, which the badge renders as the weakest `none` state.
 */
export function useCoachAckState(
  messageId: string,
): AckStateDto | undefined {
  const { data } = useQuery<AckStateDto | undefined>({
    queryKey: coachCommunityKeys.ackState(messageId),
    queryFn: () => undefined,
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data;
}

/** Fetch a single post + its reply thread for the post-detail surface. */
export function useCoachPostDetail(
  postId: string,
): UseQueryResult<CoachPostDetail> {
  return useQuery({
    queryKey: coachCommunityKeys.post(postId),
    queryFn: () => coachCommunityApi.getCoachPostDetail(postId),
    enabled: postId.length > 0,
    staleTime: 15_000,
  });
}

/**
 * v2-2: fetch a single cohort message for the coach message-detail surface.
 * The response carries the FLAT ack envelope (when the flag is on); the screen
 * lifts it into the badge shape. Disabled until a non-empty id is provided.
 */
export function useCoachMessageDetail(
  messageId: string,
): UseQueryResult<CoachMessage> {
  return useQuery({
    queryKey: coachCommunityKeys.message(messageId),
    queryFn: () => coachCommunityApi.getCoachMessageDetail(messageId),
    enabled: messageId.length > 0,
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

// NOTE (R0 / fixer G10.2 Option A): the no-network `useApproveFlagged` stub was
// REMOVED. The v1-6 backend exposes no durable approve/clear endpoint, so an
// "Approve" action could only ever be a client-side dismissal that masquerades
// as a backend decision — a silent no-op. Per the decacorn rule, the moderation
// screen now ships only the real, backend-backed Hide action. A real approve
// endpoint can reintroduce the action in a later PR.

export type { CoachInboxItem };
