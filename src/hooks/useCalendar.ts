/**
 * useCalendar — S-SCHED client Calendar and coach scheduling-settings hooks.
 *
 * Builds on useScheduling.ts (same query-key namespace) so the existing
 * mutations' invalidations keep these lists fresh:
 *   ['scheduling', 'myCoaches']
 *   ['scheduling', 'openSlots', coachId, durationMinutes, from]
 *   ['scheduling', 'sessions', 'me', { limit }]
 *   ['scheduling', 'sessionTypes', coachId]
 *   ['scheduling', 'overrides']
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  schedulingApi,
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

/**
 * Open slots for one appointment type over the next 14 days (from now). The
 * `from` key is rounded to the minute so re-renders do not refetch.
 */
export function useOpenSlots(
  coachId: string | undefined,
  durationMinutes: number | undefined,
  fromIso: string,
) {
  return useQuery<OpenSlotsPayload>({
    queryKey: ['scheduling', 'openSlots', coachId, durationMinutes, fromIso],
    queryFn: () => {
      const from = new Date(fromIso);
      const to = new Date(from.getTime() + OPEN_SLOTS_RANGE_DAYS * 24 * 60 * 60 * 1000);
      return schedulingApi.getOpenSlots(coachId as string, {
        from: from.toISOString(),
        to: to.toISOString(),
        durationMinutes: durationMinutes as number,
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
