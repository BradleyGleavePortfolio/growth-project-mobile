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
 *
 * S-SCHED-2 (backend lifecycle slice): `GET /scheduling/my-coaches` (head
 * coach + sub-coach, timezone, persistent welcome marker), open slots per
 * appointment type (`session_type_id`), past sessions (`scope=past`),
 * archived-type listing for the owning coach (`include_archived=true`),
 * per-type default meeting link and a server SessionView (`meeting_link_status`,
 * `cancellable`, `reschedulable`, type summary, both names). Every new field
 * is optional here so an older backend still renders; the legacy coach
 * identity endpoint is the fallback when my-coaches is not deployed yet.
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
  | 'pending_provider'
  // S-SCHED-5 (backend auto-expiry): the coach did not answer the request by
  // its clear time; it is closed and the time is open again.
  | 'expired';

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
 * A call link the app can act on: an https video link (Join) or a phone
 * number (Call). Mirrors the backend contract (`MEETING_LINK_PATTERN`,
 * scheduling.types.ts): `https://` up to 500 characters, or `tel:` with 3-30
 * digits, spaces, parentheses, dots or dashes and an optional leading +.
 * Everything else (stub markers, http, javascript:, other schemes, links with
 * a user name or password) is "no link yet".
 */
export type CallLink =
  | { kind: 'video'; url: string }
  | { kind: 'phone'; url: string; display: string };

const TEL_LINK = /^tel:(\+?[0-9 ().-]{3,30})$/i;
const HTTPS_LINK = /^https:\/\/[^\s<>"']{3,490}$/i;

export function resolveCallLink(raw: string | null | undefined): CallLink | null {
  if (!raw) return null;
  const value = raw.trim();
  const tel = TEL_LINK.exec(value);
  if (tel) {
    const display = tel[1].trim();
    const digits = display.replace(/[^0-9]/g, '');
    if (digits.length < 3) return null;
    return { kind: 'phone', url: `tel:${display.startsWith('+') ? '+' : ''}${digits}`, display };
  }
  if (!HTTPS_LINK.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return null;
  } catch {
    return null;
  }
  return { kind: 'video', url: value };
}

/** The https video link, or null (phone numbers resolve via resolveCallLink). */
export function resolveVideoUrl(raw: string | null | undefined): string | null {
  const link = resolveCallLink(raw);
  return link?.kind === 'video' ? link.url : null;
}

/**
 * Coach entry for a session call link: an https link, or a phone number
 * (with or without `tel:`), normalised to what the server accepts.
 */
export function normalizeCallLinkInput(
  input: string,
): { ok: true; url: string } | { ok: false; message: string } {
  const value = input.trim();
  const phone = /^(tel:)?\s*(\+?[0-9 ().-]{3,30})$/i.exec(value);
  const candidate = phone ? `tel:${phone[2].trim()}` : value;
  const link = resolveCallLink(candidate);
  if (link) return { ok: true, url: link.url };
  return {
    ok: false,
    message:
      'Enter a complete https call link without a password, or a phone number such as +1 425 555 0100, then tap Save call link.',
  };
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
  /** S-SCHED-2: the coach's welcome call type (at most one active per coach). */
  is_welcome?: boolean;
  /**
   * S-SCHED-2: https link used when a session of this type has no other call
   * link. Only the owning coach receives it; clients read null.
   */
  default_meeting_url?: string | null;
}

export interface CreateSessionTypeInput {
  name: string;
  description?: string;
  duration_minutes: number;
  auto_approve?: boolean;
  default_video_provider?: SchedulingVideoProvider;
  is_welcome?: boolean;
  /** https only; empty string or null clears it. */
  default_meeting_url?: string | null;
}

export interface UpdateSessionTypeInput {
  name?: string;
  description?: string;
  duration_minutes?: number;
  auto_approve?: boolean;
  default_video_provider?: SchedulingVideoProvider;
  archived?: boolean;
  is_welcome?: boolean;
  default_meeting_url?: string | null;
}

/** The client's welcome call state with one coach (persistent marker). */
export interface WelcomeCallInfo {
  session_type_id: string;
  name: string;
  duration_minutes: number;
  /** Upcoming welcome booking, if any. */
  active_session_id: string | null;
  active_session_status: SchedulingSessionStatus | null;
  active_session_start_at: string | null;
  /** When the most recent welcome call was completed, else null. */
  completed_at: string | null;
}

/** A coach the client may book (GET /scheduling/my-coaches). */
export interface BookableCoach {
  coach_id: string;
  name: string;
  /** Coach zone. Null only on the legacy identity fallback. */
  timezone: string | null;
  avatar_url?: string | null;
  relationship?: 'head_coach' | 'sub_coach';
  bookable_type_count?: number;
  /** Null when the coach has no welcome type; undefined on the legacy fallback. */
  welcome?: WelcomeCallInfo | null;
}

/** GET /scheduling/coaches/:coachId/open-slots */
export interface OpenSlotsPayload {
  coach_id: string;
  timezone: string;
  generated_at: string;
  slots: { start_at: string; end_at: string }[];
  /** S-SCHED-2: echoed when slots were computed for one appointment type. */
  session_type_id?: string | null;
  duration_minutes?: number;
}

/** Server-derived call link state on a session (S-SCHED-2 SessionView). */
export type MeetingLinkStatus = 'ready' | 'pending' | 'awaiting_approval' | 'none';

/** Session list scope for GET /scheduling/sessions. */
export type SessionListScope = 'upcoming' | 'past';

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
  // S-SCHED-5: while requested, the clear time the coach must answer by
  // (ISO 8601 UTC). Optional so older backends still render.
  request_expires_at?: string | null;
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
  // S-SCHED-2 SessionView (optional so older backends still render).
  reschedulable?: boolean;
  meeting_link_status?: MeetingLinkStatus;
  session_type?: {
    id: string;
    name: string;
    duration_minutes: number;
    auto_approve: boolean;
    is_welcome: boolean;
    archived: boolean;
  } | null;
  coach_name?: string | null;
  client_name?: string | null;
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
  /** Start time the actor saw; a moved session answers SESSION_MOVED. */
  expected_start_at?: string;
}

export interface ApproveSessionInput {
  expected_start_at?: string;
}

export interface SessionListOptions {
  scope?: SessionListScope;
  before?: string;
  beforeId?: string;
  after?: string;
  afterId?: string;
  status?: readonly SchedulingSessionStatus[];
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

  // Bookable coaches (client): head coach first, then an assigned sub-coach.
  listMyCoaches: async (): Promise<BookableCoach[]> => {
    try {
      const res = await api.get<BookableCoach[]>('/scheduling/my-coaches');
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      // Older backend without the route: a bare 404 (no scheduling code).
      // Fall back to the legacy identity endpoint so Calendar still works.
      if (schedulingErrorStatus(err) !== 404 || schedulingErrorCode(err) !== null) throw err;
    }
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

  // Session types. Archived types are listed only for the owning coach.
  listSessionTypes: async (
    coachId: string,
    opts: { includeArchived?: boolean } = {},
  ): Promise<SessionType[]> => {
    const url = `/scheduling/coaches/${encodeURIComponent(coachId)}/session-types`;
    const res = opts.includeArchived
      ? await api.get<SessionType[]>(url, { params: { include_archived: 'true' } })
      : await api.get<SessionType[]>(url);
    return res.data;
  },

  // Open slots (server-computed; max 14-day range). With a session type the
  // server sizes slots to that type and honours type-scoped hours; the
  // duration is still sent for older backends that ignore session_type_id.
  getOpenSlots: async (
    coachId: string,
    args: { from: string; to: string; durationMinutes: number; sessionTypeId?: string },
  ): Promise<OpenSlotsPayload> => {
    const params: Record<string, string> = { from: args.from, to: args.to };
    params.duration_minutes = String(args.durationMinutes);
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

  // Sessions. scope=upcoming (default): not ended, soonest first; page with
  // after/after_id = the last row's start_at and id. scope=past: ended,
  // newest first; page with before/before_id. The id breaks ties between
  // sessions that share a start time (S-SCHED-3, backend B-634-4). `status`
  // filters on the server (e.g. the coach inbox asks for requests only).
  listMySessions: async (
    limit?: number,
    opts: SessionListOptions = {},
  ): Promise<CoachingSession[]> => {
    const p: Record<string, string> = {};
    if (limit !== undefined) p.limit = String(limit);
    if (opts.scope === 'past') p.scope = 'past';
    if (opts.before) p.before = opts.before;
    if (opts.before && opts.beforeId) p.before_id = opts.beforeId;
    if (opts.after) p.after = opts.after;
    if (opts.after && opts.afterId) p.after_id = opts.afterId;
    if (opts.status && opts.status.length > 0) p.status = opts.status.join(',');
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

  // expected_start_at: the start time the coach was looking at. If the client
  // moved the request meanwhile, the server answers SESSION_MOVED instead of
  // confirming a time the coach never saw.
  approveSession: async (
    id: string,
    input: ApproveSessionInput = {},
  ): Promise<CoachingSession> => {
    const res = await api.post<CoachingSession>(
      `/scheduling/sessions/${encodeURIComponent(id)}/approve`,
      input,
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
