// Pure functions that translate session state into UI display props.
// Kept free of React so screens can compose and tests can assert directly.

import type {
  CoachingSession,
  SessionStatus,
  VideoProvider,
} from '../types/sessions';
import { sessionsFlags } from '../config/sessionsFlags';

export type StatusTone = 'neutral' | 'positive' | 'attention' | 'muted';

const STATUS_TONES: Record<SessionStatus, StatusTone> = {
  requested: 'neutral',
  pending_coach_review: 'neutral',
  confirmed: 'positive',
  rescheduled: 'attention',
  cancelled_by_client: 'muted',
  cancelled_by_coach: 'attention',
  completed: 'muted',
  no_show_client: 'attention',
  no_show_coach: 'attention',
};

export function statusTone(status: SessionStatus): StatusTone {
  return STATUS_TONES[status];
}

// Whether a session can be cancelled by the given actor right now.
export function canCancel(
  session: CoachingSession,
  actor: 'client' | 'coach',
): boolean {
  if (actor === 'client') {
    return (
      session.status === 'requested' ||
      session.status === 'pending_coach_review' ||
      session.status === 'confirmed' ||
      session.status === 'rescheduled'
    );
  }
  // Coach can always cancel until the call is in a terminal state.
  return (
    session.status !== 'completed' &&
    session.status !== 'cancelled_by_client' &&
    session.status !== 'cancelled_by_coach' &&
    session.status !== 'no_show_client' &&
    session.status !== 'no_show_coach'
  );
}

// Whether a session can be rescheduled (request a different time) by the
// client. The coach reschedule flow is a separate proposal action.
export function canClientReschedule(session: CoachingSession): boolean {
  return session.status === 'confirmed' || session.status === 'rescheduled';
}

// Whether the actor can mark complete / no-show. Coach-only.
export function canMarkComplete(session: CoachingSession): boolean {
  return session.status === 'confirmed' || session.status === 'rescheduled';
}

// Decide whether to show a real join URL or a "link coming from your coach"
// placeholder. We never show a synthetic URL — if the backend hasn't given
// us one we say so. This is the single source of truth for that decision
// and is exercised by the no-fake-providers test.
export type JoinDisplay =
  | { kind: 'real'; url: string; provider: VideoProvider }
  | { kind: 'pending'; provider: VideoProvider }
  | { kind: 'phone' }
  | { kind: 'feature_disabled' };

export function joinDisplay(session: CoachingSession): JoinDisplay {
  if (!sessionsFlags.SESSIONS_VIDEO_PROVIDER_ENABLED) {
    return { kind: 'feature_disabled' };
  }
  if (session.videoProvider === 'phone_call') {
    return { kind: 'phone' };
  }
  if (
    typeof session.videoJoinUrl === 'string' &&
    isLikelyJoinUrl(session.videoJoinUrl) &&
    (session.videoProvider === 'google_meet' ||
      session.videoProvider === 'zoom' ||
      session.videoProvider === 'manual_link')
  ) {
    return {
      kind: 'real',
      url: session.videoJoinUrl,
      provider: session.videoProvider,
    };
  }
  return { kind: 'pending', provider: session.videoProvider };
}

// Restrictive check — adapters could still pass garbage through. We refuse
// to render anything that doesn't look like an https URL with a meet / zoom
// / generic host. The mobile side never invents URLs.
export function isLikelyJoinUrl(value: string): boolean {
  if (!value.startsWith('https://')) return false;
  // Reject obviously synthetic strings.
  if (value.includes('example.com')) return false;
  if (value.includes('PLACEHOLDER')) return false;
  return true;
}

// Compute join window state. Backend supplies isJoinable on the aggregate;
// this helper exists for tests and for screens that have a session but no
// pre-computed view.
export function joinWindowOpen(
  session: CoachingSession,
  now: Date = new Date(),
  earlyMinutes = 10,
  lateMinutes = 30,
): boolean {
  const start = Date.parse(session.startsAt);
  const end = Date.parse(session.endsAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  const open = start - earlyMinutes * 60_000;
  const close = end + lateMinutes * 60_000;
  const t = now.getTime();
  return t >= open && t <= close;
}
