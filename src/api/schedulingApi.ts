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
 * S-SCHED (2026-10-01): the backend now exposes computed open slots
 * (`GET /scheduling/coaches/:coachId/open-slots`, honours time off,
 * booked sessions, the appointment type length and the coach time zone),
 * coach time-off overrides (`/scheduling/coach/availability-overrides`),
 * coach identity via the existing `/v1/clients/me/coach` endpoint.
 * Native scheduling uses only existing contracts; archived-type listing,
 * history and persistent welcome markers require a separate backend slice.
 *
 * Not covered: the Google OAuth browser flow (Google Calendar sync stays
 * off and is not a dependency of native scheduling).
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

/**
 * Resolve the IANA timezone the device is currently in (e.g.
 * "America/New_York"). Used for display; booking payloads use the server's
 * absolute ISO instants. Falls back to UTC when Intl is unavailable.
 */
export function resolveClientTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === 'string') return tz;
  } catch {
    // ignore — fall through to UTC
  }
  return 'UTC';
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

/** Assigned coach identity adapted from GET /v1/clients/me/coach. */
export interface BookableCoach {
  coach_id: string;
  name: string;
  /** Identity endpoint omits the zone; open-slots supplies the authoritative zone. */
  timezone: string | null;
}

/** GET /scheduling/coaches/:coachId/open-slots */
export interface OpenSlotsPayload {
  coach_id: string;
  timezone: string;
  generated_at: string;
  slots: { start_at: string; end_at: string }[];
}

export type AvailabilityOverrideKind = 'holiday' | 'block' | 'extra';

/** A date-keyed exception to the weekly hours, in the coach's time zone. */
export interface AvailabilityOverride {
  id: string;
  coach_id: string;
  /** Calendar date; the backend returns an ISO string, use the first 10 chars. */
  date: string;
  start_minute: number | null;
  end_minute: number | null;
  kind: AvailabilityOverrideKind;
  note: string | null;
}

export interface CreateAvailabilityOverrideInput {
  /** YYYY-MM-DD in the coach's time zone. */
  date: string;
  kind: AvailabilityOverrideKind;
  /** HH:MM, coach-local. Omit both for a full day off. */
  start_time?: string;
  end_time?: string;
  note?: string;
}

/**
 * Backend error code (e.g. SLOT_TAKEN, SLOT_UNAVAILABLE) from an axios-style
 * error. Scheduling exceptions put the code in `error`; the global filter
 * also forwards an optional `code`.
 */
export function schedulingErrorCode(err: unknown): string | null {
  const data = (err as { response?: { data?: { code?: unknown; error?: unknown } } } | null)
    ?.response?.data;
  if (data && typeof data.code === 'string') return data.code;
  if (data && typeof data.error === 'string' && /^[A-Z_]+$/.test(data.error)) return data.error;
  return null;
}

/** HTTP status from an axios-style error, or null for network failures. */
export function schedulingErrorStatus(err: unknown): number | null {
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' ? status : null;
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
  // Server-authoritative cancellation flag (R16). When the backend
  // includes this, clients must prefer it over any device-clock check
  // because a user with a backdated device clock could otherwise cancel
  // inside the lockout window. Optional during the rollout window where
  // older backend builds may omit it; the client falls back to the
  // device-clock lockout only when this is undefined.
  cancellable?: boolean;
}

export interface RequestSessionInput {
  coach_id: string;
  session_type_id?: string;
  title: string;
  start_at: string; // ISO 8601
  end_at: string; // ISO 8601
  // Deprecated scaffold metadata; the current server DTO does not accept
  // this field. Native Calendar does not collect it; send a coach message.
  notes?: string;
  // Deprecated display metadata, excluded from the current strict DTO.
  client_timezone?: string;
}

export interface RescheduleSessionInput {
  start_at: string;
  end_at: string;
  reason?: string;
  // Deprecated display metadata, excluded from the current strict DTO.
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

  // Bookable coaches (client)
  listMyCoaches: async (): Promise<BookableCoach[]> => {
    try {
      const res = await api.get<{ id: string; name: string }>('/v1/clients/me/coach');
      return [{ coach_id: res.data.id, name: res.data.name, timezone: null }];
    } catch (err) {
      if (schedulingErrorStatus(err) === 404 && schedulingErrorCode(err) === 'COACH_NOT_ASSIGNED') {
        return [];
      }
      throw err;
    }
  },

  // Session types
  listSessionTypes: async (
    coachId: string,
  ): Promise<SessionType[]> => {
    const res = await api.get<SessionType[]>(
      `/scheduling/coaches/${encodeURIComponent(coachId)}/session-types`,
    );
    return res.data;
  },

  // Open slots (server-computed; max 14-day range)
  getOpenSlots: async (
    coachId: string,
    args: { from: string; to: string; durationMinutes: number },
  ): Promise<OpenSlotsPayload> => {
    const params: Record<string, string> = { from: args.from, to: args.to };
    params.duration_minutes = String(args.durationMinutes);
    const res = await api.get<OpenSlotsPayload>(
      `/scheduling/coaches/${encodeURIComponent(coachId)}/open-slots`,
      { params },
    );
    return res.data;
  },

  // Coach time off
  listMyAvailabilityOverrides: async (
    args: { from?: string; to?: string } = {},
  ): Promise<AvailabilityOverride[]> => {
    const res = await api.get<AvailabilityOverride[]>(
      '/scheduling/coach/availability-overrides',
      { params: args },
    );
    return res.data;
  },

  createAvailabilityOverride: async (
    input: CreateAvailabilityOverrideInput,
  ): Promise<AvailabilityOverride> => {
    const res = await api.post<AvailabilityOverride>(
      '/scheduling/coach/availability-overrides',
      input,
    );
    return res.data;
  },

  deleteAvailabilityOverride: async (id: string): Promise<void> => {
    await api.delete(`/scheduling/coach/availability-overrides/${encodeURIComponent(id)}`);
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
  listMySessions: async (
    limit?: number,
  ): Promise<CoachingSession[]> => {
    const p: Record<string, string> = {};
    if (limit !== undefined) p.limit = String(limit);
    const params = Object.keys(p).length > 0 ? p : undefined;
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
    // Main's strict DTO accepts neither notes nor client_timezone.
    // Slots already contain absolute ISO instants, so do not send civil-time
    // metadata that the current server rejects with forbidNonWhitelisted.
    const { notes: _notes, client_timezone: _timezone, ...payload } = input;
    const res = await api.post<CoachingSession>(
      '/scheduling/sessions',
      payload,
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
    const { client_timezone: _timezone, ...payload } = input;
    const res = await api.post<CoachingSession>(
      `/scheduling/sessions/${encodeURIComponent(id)}/reschedule`,
      payload,
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
