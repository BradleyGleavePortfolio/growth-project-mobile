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
 * `GET /scheduling/my-coaches`, and `scope=upcoming|past` on the session
 * list. All are covered below.
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
 * "America/New_York"). Sent on every requestSession / rescheduleSession
 * call so the backend can disambiguate cross-TZ bookings. Falls back to
 * 'UTC' on the rare runtime where Intl is unavailable; the backend
 * treats this as a hard error response signal rather than silently
 * accepting client wall-clock.
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
  /** S-SCHED: the coach's welcome call type (at most one active per coach). */
  is_welcome?: boolean;
  /**
   * S-SCHED: https link attached to a session of this type when it is
   * confirmed and has no link yet. Coach-only; clients always get null.
   */
  default_meeting_url?: string | null;
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
  is_welcome?: boolean;
  default_meeting_url?: string;
}

export interface UpdateSessionTypeInput {
  name?: string;
  description?: string;
  duration_minutes?: number;
  auto_approve?: boolean;
  default_video_provider?: SchedulingVideoProvider;
  archived?: boolean;
  is_welcome?: boolean;
  /** null clears the link. */
  default_meeting_url?: string | null;
}

/** GET /scheduling/my-coaches — the coaches this client can book with. */
export interface BookableCoach {
  coach_id: string;
  name: string;
  /** Coach IANA time zone; null when the coach never set one (server uses UTC). */
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

export type SessionListScope = 'upcoming' | 'past';

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
  // V-4: optional free-text the client wants their coach to read before
  // the session. The backend stores this on the CoachingSession row; an
  // older backend that does not yet accept the field ignores it without
  // error (extra-keys-whitelisted).
  notes?: string;
  // V-5 / P1-6: the IANA timezone the start_at/end_at were composed in.
  // The backend uses this to disambiguate when the client's device TZ
  // does not match the coach's `CoachProfile.timezone` — the booking
  // must resolve to the coach's wall clock, not the client's.
  //
  // Required at runtime: `schedulingApi.requestSession` force-resolves
  // a value via `resolveClientTimezone()` when callers omit it or pass
  // undefined, so a payload that reaches the wire ALWAYS carries this
  // field. The TS type is still ?-optional during the rollout window
  // to keep older internal call sites compiling without a coordinated
  // edit; treat omission as a programmer error.
  client_timezone?: string;
}

export interface RescheduleSessionInput {
  start_at: string;
  end_at: string;
  reason?: string;
  // V-5 / P1-6 (see RequestSessionInput) — required at runtime; force-
  // resolved inside `rescheduleSession`.
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
    const res = await api.get<BookableCoach[]>('/scheduling/my-coaches');
    return res.data;
  },

  // Session types
  listSessionTypes: async (
    coachId: string,
    opts: { includeArchived?: boolean } = {},
  ): Promise<SessionType[]> => {
    const res = await api.get<SessionType[]>(
      `/scheduling/coaches/${encodeURIComponent(coachId)}/session-types`,
      opts.includeArchived ? { params: { include_archived: 'true' } } : undefined,
    );
    return res.data;
  },

  // Open slots (server-computed; max 14-day range)
  getOpenSlots: async (
    coachId: string,
    args: { from: string; to: string; sessionTypeId?: string },
  ): Promise<OpenSlotsPayload> => {
    const params: Record<string, string> = { from: args.from, to: args.to };
    if (args.sessionTypeId) params.session_type_id = args.sessionTypeId;
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
    scope?: SessionListScope,
  ): Promise<CoachingSession[]> => {
    const p: Record<string, string> = {};
    if (limit !== undefined) p.limit = String(limit);
    if (scope) p.scope = scope;
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
    // P1-6: client_timezone is required on the contract; force-resolve
    // here so an older call site that passes an empty string (or that
    // bypasses the type — e.g. through `as`) cannot ship an unset TZ.
    const payload: RequestSessionInput = {
      ...input,
      client_timezone: input.client_timezone || resolveClientTimezone(),
    };
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
    // P1-6: see requestSession.
    const payload: RescheduleSessionInput = {
      ...input,
      client_timezone: input.client_timezone || resolveClientTimezone(),
    };
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
