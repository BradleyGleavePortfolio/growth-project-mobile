/**
 * useCalendar — S-SCHED client Calendar and coach scheduling-settings hooks.
 *
 * Builds on useScheduling.ts (same query-key namespace) so the existing
 * mutations' invalidations keep these lists fresh:
 *   ['scheduling', 'myCoaches']
 *   ['scheduling', 'openSlots', coachId, sessionTypeId, durationMinutes, from]
 *   ['scheduling', 'sessions', 'me', { limit }]
 *   ['scheduling', 'sessions', 'me', 'past']
 *   ['scheduling', 'sessionTypes', coachId]            (bookable, active only)
 *   ['scheduling', 'sessionTypes', coachId, 'all']     (owning coach, with archived)
 *   ['scheduling', 'overrides']
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  schedulingApi,
  type SchedulingSessionStatus,
  type AvailabilityOverride,
  type BookableCoach,
  type CoachingSession,
  type CreateAvailabilityOverrideInput,
  type OpenSlotsPayload,
  type SessionType,
} from '../api/schedulingApi';

const THIRTY_S_MS = 30 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
/** The backend caps an open-slots range at 14 days. */
export const OPEN_SLOTS_RANGE_DAYS = 14;

export function useMyCoaches(enabled = true) {
  return useQuery<BookableCoach[]>({
    queryKey: ['scheduling', 'myCoaches'],
    queryFn: () => schedulingApi.listMyCoaches(),
    enabled,
    staleTime: FIVE_MIN_MS,
  });
}

/** The existing open-slots response is authoritative for the coach's zone. */
export function useSchedulingTimezone(coachId: string | undefined) {
  return useQuery<string>({
    queryKey: ['scheduling', 'timezone', coachId],
    queryFn: async () => {
      const from = new Date();
      const result = await schedulingApi.getOpenSlots(coachId as string, {
        from: from.toISOString(),
        to: new Date(from.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        durationMinutes: 60,
      });
      // Validate before using a server configuration value in Intl.
      new Intl.DateTimeFormat('en-US', { timeZone: result.timezone }).format(from);
      return result.timezone;
    },
    enabled: !!coachId,
    staleTime: FIVE_MIN_MS,
  });
}

/** Active appointment types a client may book (the server hides archived ones). */
export function useBookableTypes(coachId: string | undefined) {
  return useQuery<SessionType[]>({
    queryKey: ['scheduling', 'sessionTypes', coachId],
    queryFn: () => schedulingApi.listSessionTypes(coachId as string),
    enabled: !!coachId,
    staleTime: FIVE_MIN_MS,
  });
}

/** Every appointment type of the signed-in coach, archived ones included. */
export function useCoachAppointmentTypes(coachId: string | undefined) {
  return useQuery<SessionType[]>({
    queryKey: ['scheduling', 'sessionTypes', coachId, 'all'],
    queryFn: () => schedulingApi.listSessionTypes(coachId as string, { includeArchived: true }),
    enabled: !!coachId,
    staleTime: THIRTY_S_MS,
  });
}

/**
 * Open slots for one appointment type over the next 14 days (from now). The
 * server sizes them to the type and honours type-scoped hours. The `from`
 * key is rounded to the minute so re-renders do not refetch.
 */
export function useOpenSlots(
  coachId: string | undefined,
  type: Pick<SessionType, 'id' | 'duration_minutes'> | null | undefined,
  fromIso: string,
) {
  const sessionTypeId = type?.id;
  const durationMinutes = type?.duration_minutes;
  return useQuery<OpenSlotsPayload>({
    queryKey: ['scheduling', 'openSlots', coachId, sessionTypeId, durationMinutes, fromIso],
    queryFn: () => {
      const from = new Date(fromIso);
      const to = new Date(from.getTime() + OPEN_SLOTS_RANGE_DAYS * 24 * 60 * 60 * 1000);
      return schedulingApi.getOpenSlots(coachId as string, {
        from: from.toISOString(),
        to: to.toISOString(),
        durationMinutes: durationMinutes as number,
        sessionTypeId,
      });
    },
    enabled: !!coachId && !!durationMinutes,
    staleTime: THIRTY_S_MS,
    refetchOnMount: 'always',
    refetchInterval: THIRTY_S_MS,
  });
}

export function useMySessions(limit = 50) {
  return useQuery<CoachingSession[]>({
    queryKey: ['scheduling', 'sessions', 'me', { limit }],
    queryFn: () => schedulingApi.listMySessions(limit),
    staleTime: THIRTY_S_MS,
    refetchOnMount: 'always',
    refetchInterval: THIRTY_S_MS,
  });
}

export const PAST_SESSIONS_PAGE = 20;

/** Keyset cursor: the last row's start time and id (ties break on id). */
export interface SessionCursor {
  start_at: string;
  id: string;
}

function lastCursor(page: CoachingSession[], size: number): SessionCursor | undefined {
  if (page.length < size) return undefined;
  const last = page[page.length - 1];
  return last ? { start_at: last.start_at, id: last.id } : undefined;
}

/**
 * Ended sessions, newest first. Pages on (start_at, id) so sessions that
 * share a start time are neither skipped nor repeated (S-SCHED-3, B-634-4).
 */
export function usePastSessions(enabled = true) {
  return useInfiniteQuery<CoachingSession[], Error, InfiniteData<CoachingSession[]>, readonly unknown[], SessionCursor | null>({
    queryKey: ['scheduling', 'sessions', 'me', 'past'],
    queryFn: ({ pageParam }) =>
      schedulingApi.listMySessions(PAST_SESSIONS_PAGE, {
        scope: 'past',
        before: pageParam?.start_at,
        beforeId: pageParam?.id,
      }),
    initialPageParam: null,
    getNextPageParam: (last) => lastCursor(last, PAST_SESSIONS_PAGE),
    enabled,
    staleTime: FIVE_MIN_MS,
  });
}

export const COACH_INBOX_PAGE = 50;

/**
 * Upcoming sessions in the given statuses, soonest first, filtered and paged
 * by the server (S-SCHED-3 C-325-3): the coach inbox asks for requests, the
 * agenda for confirmed sessions, so neither is cut off by a fixed list size.
 */
export function useUpcomingSessionsByStatus(
  statuses: readonly SchedulingSessionStatus[],
  enabled = true,
) {
  return useInfiniteQuery<CoachingSession[], Error, InfiniteData<CoachingSession[]>, readonly unknown[], SessionCursor | null>({
    queryKey: ['scheduling', 'sessions', 'me', 'upcoming', statuses.join(',')],
    queryFn: ({ pageParam }) =>
      schedulingApi.listMySessions(COACH_INBOX_PAGE, {
        status: statuses,
        after: pageParam?.start_at,
        afterId: pageParam?.id,
      }),
    initialPageParam: null,
    getNextPageParam: (last) => lastCursor(last, COACH_INBOX_PAGE),
    enabled,
    staleTime: THIRTY_S_MS,
    refetchOnMount: 'always',
    refetchInterval: THIRTY_S_MS,
  });
}

export function useMyAvailabilityOverrides(fromDate: string, toDate: string) {
  return useQuery<AvailabilityOverride[]>({
    queryKey: ['scheduling', 'overrides', fromDate, toDate],
    queryFn: () => schedulingApi.listMyAvailabilityOverrides({ from: fromDate, to: toDate }),
    enabled: !!fromDate && !!toDate,
    staleTime: THIRTY_S_MS,
  });
}

export function useCreateAvailabilityOverride() {
  const qc = useQueryClient();
  return useMutation<AvailabilityOverride, Error, CreateAvailabilityOverrideInput>({
    mutationFn: (input) => schedulingApi.createAvailabilityOverride(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduling', 'overrides'] });
      qc.invalidateQueries({ queryKey: ['scheduling', 'openSlots'] });
    },
  });
}

export function useDeleteAvailabilityOverride() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => schedulingApi.deleteAvailabilityOverride(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduling', 'overrides'] });
      qc.invalidateQueries({ queryKey: ['scheduling', 'openSlots'] });
    },
  });
}
