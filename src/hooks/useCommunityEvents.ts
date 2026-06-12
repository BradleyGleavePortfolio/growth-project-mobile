/**
 * useCommunityEvents — @tanstack/react-query hooks for the v2-3 Community
 * EVENTS surface (client RSVP + coach create / edit / transition / replay /
 * reflect).
 *
 * Read hooks (useQuery) fetch through communityEventsApi (which Zod-validates
 * the wire shape). Mutation hooks (useMutation) apply OPTIMISTIC updates with
 * rollback on failure, mirroring useCommunity.ts / useCoachCommunity.ts:
 *   - RSVP reflects instantly on the event detail (and the count it moves),
 *     then reconciles with the server RSVP row or rolls back.
 *   - Coach create inserts a provisional event at the top of the list.
 *   - Coach edit / transition / replay / reflect reconcile via invalidation.
 *
 * NO NATIVE LIVE ROOM (Step 0): events carry an external, host-allowlisted
 * `external_url` only. Nothing here implies an in-app room.
 */
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseInfiniteQueryResult,
  type InfiniteData,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  communityEventsApi,
  type CommunityEvent,
  type CommunityEventListResponse,
  type CommunityRsvp,
  type CommunityClientRsvpStatus,
  type CommunityEventState,
  type CreateEventInput,
  type UpdateEventInput,
  type ListEventsOptions,
} from '../api/communityEventsApi';

// ─── Query keys (stable, namespaced) ─────────────────────────────────────────

export const communityEventsKeys = {
  all: ['communityEvents'] as const,
  /**
   * The list key includes EVERY request-shaping option (state, cohort, limit)
   * so two callers with different page sizes or filters never collide on one
   * cache entry. The keyset cursor (`before`) is intentionally NOT part of the
   * key: the infinite query keeps every page under a single key and threads the
   * cursor through `pageParam` instead, so each page does not fragment the
   * cache.
   */
  list: (workspaceId: string, opts: ListEventsOptions = {}) =>
    [
      ...communityEventsKeys.all,
      'list',
      workspaceId,
      opts.state ?? '∅',
      opts.cohort_id ?? '∅',
      opts.limit ?? '∅',
    ] as const,
  detail: (eventId: string) =>
    [...communityEventsKeys.all, 'detail', eventId] as const,
};

const OPTIMISTIC_PREFIX = 'optimistic:';

/** True when an id is a provisional, not-yet-server-reconciled event. */
export function isOptimisticEventId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_PREFIX);
}

function tempEventId(): string {
  return `${OPTIMISTIC_PREFIX}${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

// ─── Read hooks ──────────────────────────────────────────────────────────────

/**
 * List events for a workspace. Disabled until a workspace id is known so the
 * query never fires with an empty path segment.
 *
 * `opts` is narrowed to `Omit<ListEventsOptions, 'before'>`: the single-query
 * hook intentionally cannot pass the keyset `before` cursor, because the list
 * key omits `before` and two different cursor requests would otherwise collide
 * on one cache entry. Keyset pagination belongs to `useCommunityEventsInfiniteList`,
 * which threads the cursor through `pageParam` under a single key.
 */
export function useCommunityEventsList(
  workspaceId: string | undefined,
  opts: Omit<ListEventsOptions, 'before'> = {},
): UseQueryResult<CommunityEventListResponse> {
  return useQuery({
    queryKey: communityEventsKeys.list(workspaceId ?? '∅', opts),
    queryFn: () => communityEventsApi.list(workspaceId as string, opts),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });
}

/**
 * List events for a workspace with keyset (`before`) pagination. The mobile
 * list surfaces (coach + client) use THIS so older events stay reachable once
 * the backend returns a page with `next_before`: `getNextPageParam` reads that
 * cursor and `fetchNextPage` requests the following, older page.
 *
 * The `limit` is part of the query key (so a different page size is a distinct
 * cache entry), while the cursor is threaded through `pageParam` (so every
 * page lives under one key). `enabled` mirrors the single query — it never
 * fires with an empty workspace path segment.
 */
export function useCommunityEventsInfiniteList(
  workspaceId: string | undefined,
  opts: Omit<ListEventsOptions, 'before'> = {},
): UseInfiniteQueryResult<InfiniteData<CommunityEventListResponse>> {
  return useInfiniteQuery({
    queryKey: communityEventsKeys.list(workspaceId ?? '∅', opts),
    queryFn: ({ pageParam }) =>
      communityEventsApi.list(workspaceId as string, {
        ...opts,
        ...(pageParam ? { before: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_before ?? undefined,
    enabled: !!workspaceId,
    staleTime: 30_000,
  });
}

/** Single event detail. Disabled until an event id is known. */
export function useCommunityEvent(
  eventId: string | undefined,
): UseQueryResult<CommunityEvent> {
  return useQuery({
    queryKey: communityEventsKeys.detail(eventId ?? '∅'),
    queryFn: () => communityEventsApi.getOne(eventId as string),
    enabled: !!eventId,
    staleTime: 30_000,
  });
}

// ─── Mutation hooks (optimistic + rollback) ──────────────────────────────────

/**
 * Apply a client RSVP to the cached event detail: set `viewer_rsvp_status`,
 * decrement the previous client-status count, and increment the next one. Only
 * the three client statuses (going / maybe / declined) move counts here; the
 * server remains the source of truth on settle.
 */
function applyOptimisticRsvp(
  event: CommunityEvent,
  next: CommunityClientRsvpStatus,
): CommunityEvent {
  const counts = { ...event.rsvp_counts };
  const prev = event.viewer_rsvp_status;
  if (prev === 'going' || prev === 'maybe' || prev === 'declined') {
    counts[prev] = Math.max(0, counts[prev] - 1);
  }
  counts[next] = counts[next] + 1;
  return { ...event, viewer_rsvp_status: next, rsvp_counts: counts };
}

/**
 * Set / update the caller's RSVP on an event with an optimistic detail update
 * and rollback. Invalidates the detail (and any workspace list) on settle so
 * the authoritative counts reconcile.
 */
export function useRsvpEvent(
  eventId: string,
  workspaceId?: string,
): UseMutationResult<CommunityRsvp, unknown, CommunityClientRsvpStatus> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: CommunityClientRsvpStatus) =>
      communityEventsApi.rsvp(eventId, status),
    onMutate: async (status) => {
      const key = communityEventsKeys.detail(eventId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CommunityEvent>(key);
      if (prev) {
        qc.setQueryData<CommunityEvent>(key, applyOptimisticRsvp(prev, status));
      }
      return { prev };
    },
    onError: (_err, _status, ctx) => {
      const c = ctx as { prev?: CommunityEvent } | undefined;
      if (c?.prev) {
        qc.setQueryData(communityEventsKeys.detail(eventId), c.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: communityEventsKeys.detail(eventId) });
      if (workspaceId) {
        qc.invalidateQueries({
          queryKey: [...communityEventsKeys.all, 'list', workspaceId],
        });
      }
    },
  });
}

/**
 * Coach: create an event. Optimistically inserts a provisional event at the top
 * of the (unfiltered) workspace list; reconciles with the server row on success
 * and rolls back on failure.
 */
export function useCreateEvent(
  workspaceId: string,
  createdByUserId: string,
): UseMutationResult<CommunityEvent, unknown, CreateEventInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInput) =>
      communityEventsApi.create(workspaceId, input),
    onMutate: async (input) => {
      const key = communityEventsKeys.list(workspaceId);
      await qc.cancelQueries({ queryKey: key });
      // The list surfaces read through useInfiniteQuery, so the cached shape is
      // InfiniteData<CommunityEventListResponse>. Insert the provisional event
      // at the top of the FIRST page (newest), mirroring the server ordering.
      const prev =
        qc.getQueryData<InfiniteData<CommunityEventListResponse>>(key);
      const now = new Date().toISOString();
      const optimistic: CommunityEvent = {
        id: tempEventId(),
        workspace_id: workspaceId,
        cohort_id: input.cohort_id ?? null,
        created_by_user_id: createdByUserId,
        title: input.title,
        description: input.description ?? null,
        state: 'scheduled',
        starts_at: input.starts_at,
        ends_at: input.ends_at ?? null,
        external_url: input.live_url ?? null,
        reflected_at: null,
        canceled: false,
        rsvp_counts: {
          going: 0,
          maybe: 0,
          declined: 0,
          attended: 0,
          missed: 0,
        },
        viewer_rsvp_status: null,
        created_at: now,
        updated_at: now,
      };
      const firstPage: CommunityEventListResponse = prev?.pages[0] ?? {
        events: [],
        next_before: null,
      };
      const nextFirstPage: CommunityEventListResponse = {
        events: [optimistic, ...firstPage.events],
        next_before: firstPage.next_before,
      };
      const next: InfiniteData<CommunityEventListResponse> = prev
        ? { ...prev, pages: [nextFirstPage, ...prev.pages.slice(1)] }
        : { pages: [nextFirstPage], pageParams: [undefined] };
      qc.setQueryData<InfiniteData<CommunityEventListResponse>>(key, next);
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      const c = ctx as
        | { prev?: InfiniteData<CommunityEventListResponse> }
        | undefined;
      if (c?.prev) {
        qc.setQueryData(communityEventsKeys.list(workspaceId), c.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({
        queryKey: [...communityEventsKeys.all, 'list', workspaceId],
      });
    },
  });
}

/**
 * Coach: edit fields and/or advance the lifecycle state of an event. Reconciles
 * the detail + workspace list via invalidation (a state transition can change
 * which list filter the event belongs to, so a targeted optimistic patch would
 * be misleading — invalidate and refetch instead).
 */
export function useUpdateEvent(
  eventId: string,
  workspaceId?: string,
): UseMutationResult<CommunityEvent, unknown, UpdateEventInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateEventInput) =>
      communityEventsApi.update(eventId, input),
    onSuccess: (event) => {
      qc.setQueryData<CommunityEvent>(
        communityEventsKeys.detail(eventId),
        event,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: communityEventsKeys.detail(eventId) });
      if (workspaceId) {
        qc.invalidateQueries({
          queryKey: [...communityEventsKeys.all, 'list', workspaceId],
        });
      }
    },
  });
}

/**
 * Coach: advance only the lifecycle state. A first-class mutation whose
 * variable is the target `state`, so call sites read `transition.mutate('live')`
 * rather than threading a full UpdateEventInput. Mirrors useUpdateEvent's
 * reconciliation posture (a transition can move the event between list
 * filters, so invalidate-and-refetch rather than an optimistic patch).
 */
export function useTransitionEvent(
  eventId: string,
  workspaceId?: string,
): UseMutationResult<CommunityEvent, unknown, CommunityEventState> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (state: CommunityEventState) =>
      communityEventsApi.update(eventId, { state }),
    onSuccess: (event) => {
      qc.setQueryData<CommunityEvent>(
        communityEventsKeys.detail(eventId),
        event,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: communityEventsKeys.detail(eventId) });
      if (workspaceId) {
        qc.invalidateQueries({
          queryKey: [...communityEventsKeys.all, 'list', workspaceId],
        });
      }
    },
  });
}

/** Coach: attach an EXTERNAL replay link. Reconciles detail + list on settle. */
export function useAttachReplay(
  eventId: string,
  workspaceId?: string,
): UseMutationResult<CommunityEvent, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (replayUrl: string) =>
      communityEventsApi.attachReplay(eventId, replayUrl),
    onSuccess: (event) => {
      qc.setQueryData<CommunityEvent>(
        communityEventsKeys.detail(eventId),
        event,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: communityEventsKeys.detail(eventId) });
      if (workspaceId) {
        qc.invalidateQueries({
          queryKey: [...communityEventsKeys.all, 'list', workspaceId],
        });
      }
    },
  });
}

/** Coach: move the event to `reflected`. Reconciles detail + list on settle. */
export function useReflectEvent(
  eventId: string,
  workspaceId?: string,
): UseMutationResult<CommunityEvent, unknown, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => communityEventsApi.reflect(eventId),
    onSuccess: (event) => {
      qc.setQueryData<CommunityEvent>(
        communityEventsKeys.detail(eventId),
        event,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: communityEventsKeys.detail(eventId) });
      if (workspaceId) {
        qc.invalidateQueries({
          queryKey: [...communityEventsKeys.all, 'list', workspaceId],
        });
      }
    },
  });
}
