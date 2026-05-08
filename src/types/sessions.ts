// TGP Session Scheduling — typed contracts for client/coach mobile surfaces.
//
// Shape mirrors the backend scheduling foundation. All adapters in
// src/services/sessions/* normalize unknown payloads into these shapes so
// screens never see raw provider responses.
//
// Doctrine: this is private coaching access, not a generic booking system.
// Names ("CoachingSession", "CoachAvailability", "SessionBrief") reflect
// concierge framing. Avoid "appointment", "meeting slot", or marketplace
// language in copy that derives from these types.

export type SessionType =
  | 'intro_consult'
  | 'check_in'
  | 'deep_dive'
  | 'plan_review'
  | 'ad_hoc';

export type SessionStatus =
  | 'requested'
  | 'pending_coach_review'
  | 'confirmed'
  | 'rescheduled'
  | 'cancelled_by_client'
  | 'cancelled_by_coach'
  | 'completed'
  | 'no_show_client'
  | 'no_show_coach';

export type VideoProvider =
  | 'google_meet'
  | 'zoom'
  | 'manual_link'
  | 'phone_call'
  | 'unknown';

export type CalendarConnectionStatus =
  | 'not_connected'
  | 'connected'
  | 'expired'
  | 'revoked'
  | 'error';

// A single bookable window the coach has published. Shells render these as
// review-style options, never as a public marketplace grid.
export interface CoachAvailability {
  id: string;
  coachId: string;
  startsAt: string; // ISO-8601
  endsAt: string; // ISO-8601
  sessionTypes: SessionType[];
  isHeld: boolean; // true when a request is in flight against this slot
  capacityRemaining: number; // typically 1 — concierge model
  notes?: string;
}

// A scheduled or proposed coaching session.
export interface CoachingSession {
  id: string;
  clientId: string;
  coachId: string;
  type: SessionType;
  status: SessionStatus;
  // When status === 'requested' both fields may still be the client's preferred
  // window — the coach's confirmation collapses these to the final time.
  startsAt: string; // ISO-8601
  endsAt: string; // ISO-8601
  timezone: string; // IANA (e.g. "America/Los_Angeles")
  videoProvider: VideoProvider;
  // Only present when the provider has actually issued a join URL. Adapters
  // MUST leave this undefined for `manual_link` until a coach pastes one in,
  // and for `unknown` always — copy depends on this to avoid fake claims.
  videoJoinUrl?: string;
  // Free-form note from the client when requesting the session.
  clientRequestNote?: string;
  // Coach-visible only.
  coachInternalNote?: string;
  createdAt: string;
  updatedAt: string;
}

// Pre-session brief shown to the coach. Source-of-truth lives backend-side;
// the mobile shell just displays what the API returns.
export interface SessionBrief {
  sessionId: string;
  clientDisplayName: string;
  // Short bullets the coach can scan in <30s. Authored by backend (rules +
  // optional AI summarization). Never fabricated client-side.
  highlights: string[];
  // Items the client flagged as wanting to discuss.
  clientPrepNotes?: string[];
  generatedAt: string;
  // True iff backend explicitly marked the brief as ready. Shells should
  // treat anything else as "preparing" and show a placeholder.
  isReady: boolean;
}

// Recap state lives separately because it follows a different lifecycle.
export type SessionRecapState =
  | 'not_started'
  | 'awaiting_coach'
  | 'shared_with_client'
  | 'archived';

export interface SessionRecap {
  sessionId: string;
  state: SessionRecapState;
  // Coach-authored markdown; clients only see it once state ===
  // 'shared_with_client'.
  bodyMarkdown?: string;
  sharedAt?: string;
  updatedAt: string;
}

// Prep prompt shown to the client ahead of the call.
export interface SessionPrepPrompt {
  sessionId: string;
  prompts: string[];
  // Whether the client has acknowledged / answered. Drives the "ready" pill
  // on the upcoming card.
  acknowledgedAt?: string;
}

// Aggregate hint surface used by the home nudge / upcoming card to render
// without making N round trips. Adapter-side composition.
export interface UpcomingSessionView {
  session: CoachingSession;
  prep?: SessionPrepPrompt;
  // True if join window is currently open (typically T-10m → T+30m).
  isJoinable: boolean;
}

// Coach-side aggregate for the request queue.
export interface SessionRequestSummary {
  session: CoachingSession;
  // Backend-supplied; UI must not compute its own SLA.
  ageMinutes: number;
  clientDisplayName: string;
}

// Discriminated union for the empty / fail-closed state. Screens render
// based on `kind` so we never invent state when the backend is down.
export type SessionsLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; sessions: UpcomingSessionView[] }
  | { kind: 'empty_no_coach' } // client has no assigned coach yet
  | { kind: 'empty_no_sessions' } // assigned coach, nothing booked
  | { kind: 'feature_disabled' } // flag off — show the calm placeholder
  | { kind: 'error'; message: string };

// Type-guards keep narrowing terse at the screen layer.
export function isReady(
  s: SessionsLoadState,
): s is Extract<SessionsLoadState, { kind: 'ready' }> {
  return s.kind === 'ready';
}

export function isErrorState(
  s: SessionsLoadState,
): s is Extract<SessionsLoadState, { kind: 'error' }> {
  return s.kind === 'error';
}

export const ALL_SESSION_STATUSES: SessionStatus[] = [
  'requested',
  'pending_coach_review',
  'confirmed',
  'rescheduled',
  'cancelled_by_client',
  'cancelled_by_coach',
  'completed',
  'no_show_client',
  'no_show_coach',
];

export const ALL_VIDEO_PROVIDERS: VideoProvider[] = [
  'google_meet',
  'zoom',
  'manual_link',
  'phone_call',
  'unknown',
];

export const ALL_CALENDAR_CONNECTION_STATUSES: CalendarConnectionStatus[] = [
  'not_connected',
  'connected',
  'expired',
  'revoked',
  'error',
];
