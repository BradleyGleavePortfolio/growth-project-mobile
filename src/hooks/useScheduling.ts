/**
 * useScheduling — React Query hooks over `schedulingApi` (Concierge
 * scheduling foundation, backend PR #142).
 *
 * Query keys:
 *   ['scheduling', 'sessionTypes', coachId]
 *   ['scheduling', 'availability', coachId]
 *   ['scheduling', 'sessions', 'me']
 *   ['scheduling', 'sessions', sessionId]
 *
 * Stale times:
 *   - Session lists: 60s. Bookings move fast (approve/decline/cancel)
 *     and a 60s window keeps the UI responsive without hammering.
 *   - Availability + session types: 5 min. These are coach-edited
 *     rarely; cache aggressively.
 *
 * Invalidations on mutation:
 *   - Mutations affecting a session id invalidate
 *     `['scheduling', 'sessions', 'me']` AND the per-id key, so any
 *     list view and any detail view both refresh.
 *   - Availability mutations invalidate
 *     `['scheduling', 'availability', coachId]`.
 *   - Session-type mutations invalidate
 *     `['scheduling', 'sessionTypes', coachId]`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  schedulingApi,
  type AttachManualVideoLinkInput,
  type AvailabilityWindow,
  type CancelSessionInput,
  type CoachingSession,
  type CompleteSessionInput,
  type CreateSessionTypeInput,
  type RequestSessionInput,
  type RescheduleSessionInput,
  type SessionType,
  type SetAvailabilityInput,
  type UpdateSessionTypeInput,
} from '../api/schedulingApi';

const SIXTY_S_MS = 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;

// ─── Reads ────────────────────────────────────────────────────────────────────

export function useSessionTypes(coachId: string | undefined) {
  return useQuery<SessionType[]>({
    queryKey: ['scheduling', 'sessionTypes', coachId],
    queryFn: () => schedulingApi.listSessionTypes(coachId as string),
    enabled: !!coachId,
    staleTime: FIVE_MIN_MS,
  });
}

export function useCoachAvailability(coachId: string | undefined) {
  return useQuery<AvailabilityWindow[]>({
    queryKey: ['scheduling', 'availability', coachId],
    queryFn: () => schedulingApi.getAvailability(coachId as string),
    enabled: !!coachId,
    staleTime: FIVE_MIN_MS,
  });
}

export function useMyUpcomingSessions(limit = 25) {
  return useQuery<CoachingSession[]>({
    queryKey: ['scheduling', 'sessions', 'me', { limit }],
    queryFn: () => schedulingApi.listMySessions(limit),
    staleTime: SIXTY_S_MS,
  });
}

export function useSession(sessionId: string | undefined) {
  return useQuery<CoachingSession>({
    queryKey: ['scheduling', 'sessions', sessionId],
    queryFn: () => schedulingApi.getSession(sessionId as string),
    enabled: !!sessionId,
    staleTime: SIXTY_S_MS,
  });
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export function useCreateSessionType() {
  const qc = useQueryClient();
  return useMutation<SessionType, Error, CreateSessionTypeInput>({
    mutationFn: (input) => schedulingApi.createSessionType(input),
    onSuccess: (created) => {
      qc.invalidateQueries({
        queryKey: ['scheduling', 'sessionTypes', created.coach_id],
      });
    },
  });
}

export function useUpdateSessionType() {
  const qc = useQueryClient();
  return useMutation<
    SessionType,
    Error,
    { id: string; input: UpdateSessionTypeInput }
  >({
    mutationFn: ({ id, input }) => schedulingApi.updateSessionType(id, input),
    onSuccess: (updated) => {
      qc.invalidateQueries({
        queryKey: ['scheduling', 'sessionTypes', updated.coach_id],
      });
    },
  });
}

export function useSetAvailability(coachId: string) {
  const qc = useQueryClient();
  return useMutation<AvailabilityWindow[], Error, SetAvailabilityInput>({
    mutationFn: (input) => schedulingApi.setAvailability(coachId, input),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ['scheduling', 'availability', coachId],
      });
    },
  });
}

export function useRequestSession() {
  const qc = useQueryClient();
  return useMutation<CoachingSession, Error, RequestSessionInput>({
    mutationFn: (input) => schedulingApi.requestSession(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduling', 'sessions', 'me'] });
    },
  });
}

export function useApproveSession() {
  const qc = useQueryClient();
  return useMutation<CoachingSession, Error, { id: string }>({
    mutationFn: ({ id }) => schedulingApi.approveSession(id),
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: ['scheduling', 'sessions', 'me'] });
      qc.invalidateQueries({
        queryKey: ['scheduling', 'sessions', session.id],
      });
    },
  });
}

export function useDeclineSession() {
  const qc = useQueryClient();
  return useMutation<
    CoachingSession,
    Error,
    { id: string; input?: CancelSessionInput }
  >({
    mutationFn: ({ id, input }) => schedulingApi.declineSession(id, input),
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: ['scheduling', 'sessions', 'me'] });
      qc.invalidateQueries({
        queryKey: ['scheduling', 'sessions', session.id],
      });
    },
  });
}

export function useCancelSession() {
  const qc = useQueryClient();
  return useMutation<
    CoachingSession,
    Error,
    { id: string; input?: CancelSessionInput }
  >({
    mutationFn: ({ id, input }) => schedulingApi.cancelSession(id, input),
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: ['scheduling', 'sessions', 'me'] });
      qc.invalidateQueries({
        queryKey: ['scheduling', 'sessions', session.id],
      });
    },
  });
}

export function useRescheduleSession() {
  const qc = useQueryClient();
  return useMutation<
    CoachingSession,
    Error,
    { id: string; input: RescheduleSessionInput }
  >({
    mutationFn: ({ id, input }) => schedulingApi.rescheduleSession(id, input),
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: ['scheduling', 'sessions', 'me'] });
      qc.invalidateQueries({
        queryKey: ['scheduling', 'sessions', session.id],
      });
    },
  });
}

export function useCompleteSession() {
  const qc = useQueryClient();
  return useMutation<
    CoachingSession,
    Error,
    { id: string; input?: CompleteSessionInput }
  >({
    mutationFn: ({ id, input }) => schedulingApi.completeSession(id, input),
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: ['scheduling', 'sessions', 'me'] });
      qc.invalidateQueries({
        queryKey: ['scheduling', 'sessions', session.id],
      });
    },
  });
}

export function useMarkNoShow() {
  const qc = useQueryClient();
  return useMutation<
    CoachingSession,
    Error,
    { id: string; input?: CancelSessionInput }
  >({
    mutationFn: ({ id, input }) => schedulingApi.markNoShow(id, input),
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: ['scheduling', 'sessions', 'me'] });
      qc.invalidateQueries({
        queryKey: ['scheduling', 'sessions', session.id],
      });
    },
  });
}

export function useAttachManualVideoLink() {
  const qc = useQueryClient();
  return useMutation<
    CoachingSession,
    Error,
    { id: string; input: AttachManualVideoLinkInput }
  >({
    mutationFn: ({ id, input }) =>
      schedulingApi.attachManualVideoLink(id, input),
    onSuccess: (session) => {
      qc.invalidateQueries({
        queryKey: ['scheduling', 'sessions', session.id],
      });
    },
  });
}
