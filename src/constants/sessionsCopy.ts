// Copy constants for TGP Session Scheduling.
//
// Doctrine: this is private coaching access. Every string here is reviewed
// for tone — calm, concierge, no breathless booking language.
//
// Banned vocabulary (do not introduce these in this file or any sessions
// screen): "book now", "appointment", "schedule a meeting", "available
// slots", "marketplace", "calendar invite blast". These read as generic
// SaaS booking and break the trust posture the product depends on.
//
// Allowed framing: "request a call", "review request", "your coach will
// confirm", "next call with <coach>", "prepare for your call".

import type {
  SessionStatus,
  SessionType,
  VideoProvider,
  CalendarConnectionStatus,
} from '../types/sessions';

export const SESSIONS_DISABLED_PLACEHOLDER = {
  title: 'Calls with your coach',
  body:
    'Direct call access with your coach is being prepared. We will surface ' +
    'it here when your coach turns it on — nothing for you to do in the ' +
    'meantime.',
};

export const SESSIONS_EMPTY_NO_COACH = {
  title: 'No coach assigned yet',
  body:
    'Once you are matched with a coach, your call cadence and any ' +
    'requested calls will appear here.',
};

export const SESSIONS_EMPTY_NO_SESSIONS_CLIENT = {
  title: 'No upcoming calls',
  body:
    'When you and your coach agree on a time, the next call will live ' +
    'here. Use the request button below to propose a window.',
};

export const SESSIONS_EMPTY_NO_SESSIONS_COACH = {
  title: 'No upcoming calls',
  body:
    'When a client requests a call you will see it in the request queue. ' +
    'Confirmed calls will land here.',
};

export const SESSIONS_FAIL_CLOSED_ERROR = {
  title: 'We could not load your calls',
  body:
    'This is a connection issue, not a missed call. Pull to retry, or ' +
    'check back in a moment. Your coach can still reach you directly.',
};

export const SESSION_REQUEST_FORM = {
  title: 'Request a call',
  intro:
    'Pick a window that works for you. Your coach will review and ' +
    'confirm before anything is set.',
  noteLabel: 'What would you like to focus on?',
  notePlaceholder: 'A short note helps your coach prepare.',
  submit: 'Send request to coach',
  submittedTitle: 'Request sent',
  submittedBody:
    'Your coach has been notified. You will see this call here once they ' +
    'confirm a time.',
};

export const SESSION_PREPARE = {
  title: 'Prepare for your call',
  intro:
    'A few prompts to make the most of your time. Nothing is shared until ' +
    'you tap done.',
  acknowledge: 'I am ready',
  acknowledged: 'You are set for this call.',
};

export const SESSION_RESCHEDULE_CANCEL = {
  rescheduleAction: 'Request a different time',
  cancelAction: 'Cancel this call',
  cancelConfirmTitle: 'Cancel this call?',
  cancelConfirmBody:
    'Your coach will be notified. You can request another window any time.',
  cancelConfirmAccept: 'Yes, cancel',
  cancelConfirmDismiss: 'Keep the call',
};

export const SESSION_JOIN = {
  // Used when we have a real provider URL.
  joinAction: 'Join the call',
  // Used when video flag is off, provider is 'manual_link', or we just don't
  // have a URL yet. NEVER claim a link exists when it doesn't.
  joinPendingTitle: 'Link coming from your coach',
  joinPendingBody:
    'Your coach will share the join link before the call. Check messages ' +
    'or this screen as the time approaches.',
  joinPhoneTitle: 'Phone call',
  joinPhoneBody: 'Your coach will call you at the agreed time.',
};

export const COACH_AVAILABILITY = {
  title: 'When you are open to calls',
  intro:
    'Set the windows you are willing to take calls. Clients see these as ' +
    'options to request — never as a public booking grid.',
  emptyTitle: 'No windows set',
  emptyBody:
    'Add a window when you want to open call access. Without windows ' +
    'clients can still request ad hoc times.',
  notConnectedCalendarTitle: 'Calendar not connected',
  notConnectedCalendarBody:
    'Connect Google or Outlook to keep your availability honest. You can ' +
    'still set windows manually.',
  expiredCalendarTitle: 'Calendar connection expired',
  expiredCalendarBody:
    'Sign in again to keep your availability synced.',
};

export const COACH_REQUEST_QUEUE = {
  title: 'Call requests',
  emptyTitle: 'No open requests',
  emptyBody: 'New client call requests will appear here.',
  approveAction: 'Confirm time',
  declineAction: 'Decline',
  proposeAction: 'Propose another time',
};

export const COACH_UPCOMING_CALLS = {
  title: 'Upcoming calls',
  markCompleteAction: 'Mark complete',
  markNoShowClientAction: 'Mark no-show (client)',
  markNoShowCoachAction: 'Mark no-show (me)',
};

export const COACH_BRIEF = {
  title: 'Pre-call brief',
  preparingTitle: 'Brief is preparing',
  preparingBody:
    'Highlights from this client appear here a few minutes before the ' +
    'call. Nothing is fabricated — only what the system has actually seen.',
  noBriefTitle: 'No brief available',
  noBriefBody:
    'A brief will be generated automatically once there is enough recent ' +
    'activity to summarize.',
};

const STATUS_LABELS_CLIENT: Record<SessionStatus, string> = {
  requested: 'Requested — waiting for your coach',
  pending_coach_review: 'Your coach is reviewing this',
  confirmed: 'Confirmed',
  rescheduled: 'Rescheduled — please review',
  cancelled_by_client: 'You cancelled this call',
  cancelled_by_coach: 'Your coach cancelled — they will reach out',
  completed: 'Completed',
  no_show_client: 'Marked as missed',
  no_show_coach: 'Coach was not available — they will follow up',
};

const STATUS_LABELS_COACH: Record<SessionStatus, string> = {
  requested: 'New request',
  pending_coach_review: 'Awaiting your review',
  confirmed: 'Confirmed',
  rescheduled: 'Rescheduled — review with client',
  cancelled_by_client: 'Cancelled by client',
  cancelled_by_coach: 'You cancelled this',
  completed: 'Completed',
  no_show_client: 'Client did not join',
  no_show_coach: 'You did not join',
};

export function statusLabelFor(
  status: SessionStatus,
  actor: 'client' | 'coach',
): string {
  return actor === 'coach'
    ? STATUS_LABELS_COACH[status]
    : STATUS_LABELS_CLIENT[status];
}

const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  intro_consult: 'Intro consult',
  check_in: 'Check-in',
  deep_dive: 'Deep dive',
  plan_review: 'Plan review',
  ad_hoc: 'Ad hoc call',
};

export function sessionTypeLabel(type: SessionType): string {
  return SESSION_TYPE_LABELS[type];
}

const VIDEO_PROVIDER_LABELS: Record<VideoProvider, string> = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
  manual_link: 'Link from your coach',
  phone_call: 'Phone call',
  unknown: 'Details from your coach',
};

export function videoProviderLabel(provider: VideoProvider): string {
  return VIDEO_PROVIDER_LABELS[provider];
}

const CAL_CONN_LABELS: Record<CalendarConnectionStatus, string> = {
  not_connected: 'Not connected',
  connected: 'Connected',
  expired: 'Reconnect needed',
  revoked: 'Reconnect needed',
  error: 'Connection issue',
};

export function calendarConnectionLabel(
  status: CalendarConnectionStatus,
): string {
  return CAL_CONN_LABELS[status];
}
