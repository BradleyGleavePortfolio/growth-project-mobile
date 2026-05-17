/**
 * schedulingApi
 *
 * Typed client for the Concierge scheduling endpoints introduced by
 * backend PR #142 (commit a692b203). All calls route through the
 * shared axios instance so auth + 401-refresh are handled.
 *
 * Backend contract source of truth:
 *   - `src/scheduling/scheduling.controller.ts` (`@Controller('scheduling')`)
 *   - `src/scheduling/dto/scheduling.dto.ts`
 *
 * The types mirrored below are intentionally backend-shaped. The
 * existing mobile types in `src/types/sessions.ts` use a different,
 * speculative shape from the pre-backend scaffold; reconciling those
 * with this client is a separate task (see
 * `/home/user/workspace/sprint-scheduling-ui/AUDIT.md` §3).
 *
 * Notably NOT covered by this client today:
 *   - CoachAvailabilityOverride CRUD (the schema/migration includes
 *     the model, but the backend controller does not yet expose
 *     overrides — held back to a backend follow-up).
 *   - Computed open-slots endpoint (`/open-slots`) — does not exist
 *     yet on the backend. Concrete slot rendering is deferred.
 *   - Google OAuth browser flow (the mobile opens the URLs in an
 *     in-app browser; not API client surface).
 */

import api from '../services/api';

// ─── Shared enums (mirror backend) ────────────────────────────────────────────

/**
 * Status the backend persists on a CoachingSession. 7 values; matches
 * `SessionStatus` Prisma enum in growth-project-backend.
 *
 * The mobile shell's `SessionStatus` in `src/types/sessions.ts` uses a
 * different, 9-value union from the pre-backend scaffold. The mapper
 * between the two lives in the screen layer (or, in the next pass,
 * in a thin adapter inside `src/services/sessions/sessionsClient.ts`).
 */
export type SchedulingSessionStatus =
  | 'requested'
  | 'scheduled'
  | 'declined'
  | 'canceled'
  | 'no_show'
  | 'completed'
  | 'pending_provider';

/**
 * Video provider as the backend models it. The mobile shell uses
 * `'manual_link'` for the user-pasted case; the backend uses
 * `'manual'`. Translate at the call site if surfacing into a screen
 * that expects the mobile shape.
 *
 * C9: google_meet and zoom are NOT available for selection. The backend
 * will reject them with 400 if supplied as default_video_provider.
 * Only 'manual' should be offered in any provider picker UI.
 */
export type SchedulingVideoProvider = 'stub' | 'google_meet' | 'zoom' | 'manual';

/**
 * Helper: resolves a raw video_url from a CoachingSession to a
 * displayable URL, or null if no real link is present.
 *
 * The stub adapter used to emit `tgp-stub://session/<key>` URLs which
 * are not openable. Treat them — and any other non-http(s) URL — as
 * "no link yet" so the UI can show the manual-link prompt instead.
 */
export function resolveVideoUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith('tgp-stub://')) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw;
}

/** Shape returned by GET /scheduling/providers */
export interface SchedulingProviders {
  video: string[];
  calendar: string[];
  note: string;
}

// ─── Session types (the coach's offerings, e.g. "30-min check-in") ──────────

export interface SessionType {
  id: string;
  coach_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  auto_approve: boolean;
  default_video_provider: SchedulingVideoProvider;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSessionTypeInput {
  name: string;
  description?: string;
  duration_minutes: number;
  auto_approve?: boolean;
  default_video_provider?: SchedulingVideoProvider;
}

export interface UpdateSessionTypeInput {
  name?: string;
  description?: string;
  duration_minutes?: number;
  auto_approve?: boolean;
  default_video_provider?: SchedulingVideoProvider;
  archived?: boolean;
}

// ─── Availability (recurring weekly windows) ────────────────────────────────

/**
 * One recurring availability window. The pair `(day_of_week,
 * start_minute, end_minute)` is interpreted relative to the coach's
 * timezone (read from CoachProfile.timezone on the backend). Stored
 * as minute-of-day so DST transitions do not shift the window.
 */
export interface AvailabilityWindow {
  id: string;
  coach_id: string;
  day_of_week: number; // 0 = Sunday, 6 = Saturday
  start_minute: number; // 0..1439
  end_minute: number; // 1..1440
  session_type_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertAvailabilityWindowInput {
  day_of_week: number;
  start_minute: number;
  end_minute: number;
  session_type_id?: string;
}

export interface SetAvailabilityInput {
  /** Full new set; the backend replaces all existing windows atomically. */
  windows: UpsertAvailabilityWindowInput[];
}

// ─── CoachingSession (the booking row) ───────────────────────────────────────

export interface CoachingSession {
  id: string;
  coach_id: string;
  client_id: string | null;
  session_type_id: string | null;
  status: SchedulingSessionStatus;
  start_at: string; // ISO 8601 UTC
  end_at: string; // ISO 8601 UTC
  title: string;
  coach_notes_md: string | null;
  client_recap_md: string | null;
  video_provider: SchedulingVideoProvider;
  video_url: string | null;
  video_meeting_id: string | null;
  calendar_provider: 'stub' | 'google_calendar';
  calendar_event_id: string | null;
  approved_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface RequestSessionInput {
  coach_id: string;
  session_type_id?: string;
  title: string;
  start_at: string; // ISO 8601
  end_at: string; // ISO 8601
  // V-4: optional free-text the client wants their coach to read before
  // the session. The backend stores this on the CoachingSession row; an
  // older backend that does not yet accept the field ignores it without
  // error (extra-keys-whitelisted).
  notes?: string;
  // V-5: the IANA timezone the start_at/end_at were composed in. The
  // backend uses this to disambiguate when the client's device TZ does
  // not match the coach's `CoachProfile.timezone` — the booking should
  // resolve to the coach's wall clock, not the client's. Backwards
  // compatible: omitting it keeps the old behaviour.
  client_timezone?: string;
}

export interface RescheduleSessionInput {
  start_at: string;
  end_at: string;
  reason?: string;
  // V-5 (see RequestSessionInput).
  client_timezone?: string;
}

export interface CancelSessionInput {
  reason?: string;
}

export interface CompleteSessionInput {
  reason?: string;
  coach_notes_md?: string;
}

export interface AttachManualVideoLinkInput {
  video_url: string;
}

// ─── Client methods ─────────────────────────────────────────────────────────

export const schedulingApi = {
  // Provider capabilities
  // C9: Returns manual-only until real adapters ship. Use this to
  // populate any provider picker so UI always reflects backend state.
  getProviders: async (): Promise<SchedulingProviders> => {
    const res = await api.get<SchedulingProviders>('/scheduling/providers');
    return res.data;
  },

  // Session types
  listSessionTypes: async (coachId: string): Promise<SessionType[]> => {
    const res = await api.get<SessionType[]>(
      `/scheduling/coaches/${encodeURIComponent(coachId)}/session-types`,
    );
    return res.data;
  },

  createSessionType: async (
    input: CreateSessionTypeInput,
  ): Promise<SessionType> => {
    const res = await api.post<SessionType>('/scheduling/session-types', input);
    return res.data;
  },

  updateSessionType: async (
    id: string,
    input: UpdateSessionTypeInput,
  ): Promise<SessionType> => {
    const res = await api.patch<SessionType>(
      `/scheduling/session-types/${encodeURIComponent(id)}`,
      input,
    );
    return res.data;
  },

  // Availability
  getAvailability: async (coachId: string): Promise<AvailabilityWindow[]> => {
    const res = await api.get<AvailabilityWindow[]>(
      `/scheduling/coaches/${encodeURIComponent(coachId)}/availability`,
    );
    return res.data;
  },

  setAvailability: async (
    coachId: string,
    input: SetAvailabilityInput,
  ): Promise<AvailabilityWindow[]> => {
    const res = await api.post<AvailabilityWindow[]>(
      `/scheduling/coaches/${encodeURIComponent(coachId)}/availability`,
      input,
    );
    return res.data;
  },

  // Sessions
  listMySessions: async (limit?: number): Promise<CoachingSession[]> => {
    const params = limit !== undefined ? { limit: String(limit) } : undefined;
    const res = await api.get<CoachingSession[]>('/scheduling/sessions', {
      params,
    });
    return res.data;
  },

  getSession: async (id: string): Promise<CoachingSession> => {
    const res = await api.get<CoachingSession>(
      `/scheduling/sessions/${encodeURIComponent(id)}`,
    );
    return res.data;
  },

  requestSession: async (
    input: RequestSessionInput,
  ): Promise<CoachingSession> => {
    const res = await api.post<CoachingSession>(
      '/scheduling/sessions',
      input,
    );
    return res.data;
  },

  approveSession: async (id: string): Promise<CoachingSession> => {
    const res = await api.post<CoachingSession>(
      `/scheduling/sessions/${encodeURIComponent(id)}/approve`,
    );
    return res.data;
  },

  declineSession: async (
    id: string,
    input: CancelSessionInput = {},
  ): Promise<CoachingSession> => {
    const res = await api.post<CoachingSession>(
      `/scheduling/sessions/${encodeURIComponent(id)}/decline`,
      input,
    );
    return res.data;
  },

  rescheduleSession: async (
    id: string,
    input: RescheduleSessionInput,
  ): Promise<CoachingSession> => {
    const res = await api.post<CoachingSession>(
      `/scheduling/sessions/${encodeURIComponent(id)}/reschedule`,
      input,
    );
    return res.data;
  },

  cancelSession: async (
    id: string,
    input: CancelSessionInput = {},
  ): Promise<CoachingSession> => {
    const res = await api.post<CoachingSession>(
      `/scheduling/sessions/${encodeURIComponent(id)}/cancel`,
      input,
    );
    return res.data;
  },

  completeSession: async (
    id: string,
    input: CompleteSessionInput = {},
  ): Promise<CoachingSession> => {
    const res = await api.post<CoachingSession>(
      `/scheduling/sessions/${encodeURIComponent(id)}/complete`,
      input,
    );
    return res.data;
  },

  markNoShow: async (
    id: string,
    input: CancelSessionInput = {},
  ): Promise<CoachingSession> => {
    const res = await api.post<CoachingSession>(
      `/scheduling/sessions/${encodeURIComponent(id)}/no-show`,
      input,
    );
    return res.data;
  },

  attachManualVideoLink: async (
    id: string,
    input: AttachManualVideoLinkInput,
  ): Promise<CoachingSession> => {
    const res = await api.post<CoachingSession>(
      `/scheduling/sessions/${encodeURIComponent(id)}/manual-video-link`,
      input,
    );
    return res.data;
  },
};

export type SchedulingApi = typeof schedulingApi;
