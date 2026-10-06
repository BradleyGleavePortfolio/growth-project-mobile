import { schedulingErrorCode, schedulingErrorStatus } from '../api/schedulingApi';
import { SUPPORT_EMAIL } from '../constants/support';
import { captureError } from '../services/sentry';

/** Who reads the message: clients book; coaches run the inbox and settings. */
export type CalendarAudience = 'client' | 'coach';

const references = new WeakMap<object, string>();
const reported = new WeakSet<object>();

function referenceFor(err: unknown): string {
  const data = (err as { response?: { data?: { request_id?: unknown } } } | null)?.response?.data;
  const serverId = data?.request_id;
  if (typeof serverId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(serverId)) {
    return serverId.slice(0, 12);
  }
  if (err && typeof err === 'object') {
    const cached = references.get(err);
    if (cached) return cached;
  }
  const ref = `CAL-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  if (err && typeof err === 'object') references.set(err, ref);
  return ref;
}

/**
 * S-SCHED-2 backend scheduling codes -> plain next-step copy. Every entry says
 * what happened and what to do next; the server message is never shown raw.
 */
export const SCHEDULING_CODE_MESSAGES: Readonly<Record<string, string>> = {
  SLOT_TAKEN: 'Someone just booked that time. Refresh open times and pick another time.',
  SLOT_UNAVAILABLE: 'That time is no longer open. Refresh open times and pick another time.',
  SESSION_IN_PAST: 'That time is too close or has passed. Refresh open times and choose a later time.',
  BEYOND_BOOKING_HORIZON: "That time is further ahead than your coach takes bookings. Refresh open times and pick a time from the list.",
  INVALID_TIME: 'That time could not be read. Refresh open times and pick a time from the list.',
  DURATION_MISMATCH: 'That time does not match the length of this appointment type. Refresh open times and pick a time from the list.',
  SESSION_TYPE_REQUIRED: 'Choose an appointment type first, then pick a time.',
  SESSION_TYPE_UNAVAILABLE: 'This appointment type is no longer offered. Go back to Calendar and choose another type.',
  PENDING_REQUEST_LIMIT: 'You already have several requests waiting for your coach. Wait for a reply, or cancel one in Calendar, then request another time.',
  WELCOME_ALREADY_BOOKED: 'Your welcome call is already booked. Open Calendar to see it or move it.',
  CALENDAR_BUSY: "Your coach's calendar is busy with other bookings right now. Wait a few seconds, then pick the time again.",
  SESSION_STATE_CHANGED: 'This session changed a moment ago. Refresh Calendar to see where it stands now.',
  SESSION_NOT_ACTIVE: 'This session is no longer active. Refresh Calendar to see your current sessions.',
  SESSION_STARTED: 'This session has already started, so it can no longer be changed here. Message your coach if you need help.',
  COACH_NOT_BOOKABLE: 'You can book only with the coach you are matched with. Open Calendar to see your coach.',
  COACH_NOT_FOUND: 'This coach is not available for booking. Open Calendar to see your coach.',
  SESSION_NOT_FOUND: 'This session is not available to you. Open Calendar to find your sessions.',
  NOT_SESSION_PARTICIPANT: 'You can no longer change this session from here. Message your coach to change it.',
  INVALID_MEETING_LINK: 'Enter a complete https call link or a phone number, then save it again.',
  SESSION_MOVED: 'This session was moved to a new time a moment ago. Refresh Calendar to see the new time.',
  INVALID_LIST_QUERY: 'Calendar could not load more sessions from where you were. Refresh Calendar to start the list again.',
  COACH_NOT_ASSIGNED: 'You are not matched with a coach yet. Ask your coach for an invite code, then open Accept invite in Profile and more.',
};

/**
 * Coach-facing copy for the codes a coach can meet in the booking inbox,
 * appointment types, time off and weekly hours (S-SCHED-3 B-325-2). Codes not
 * listed here read the same for both audiences.
 */
export const COACH_CODE_MESSAGES: Readonly<Record<string, string>> = {
  SESSION_STARTED: 'This session has already started, so it can no longer be changed here. Refresh the inbox to see where it stands now.',
  SESSION_TYPE_UNAVAILABLE: 'This appointment type is archived or was removed. Open Appointment types to restore it or choose another type.',
  SESSION_STATE_CHANGED: 'This changed a moment ago, on another device or by your client. Refresh this screen to see where it stands now.',
  SESSION_MOVED: 'Your client moved this request to a new time a moment ago. Refresh the inbox, check the new time, then confirm or decline it.',
  NOT_SESSION_PARTICIPANT: 'This session belongs to another coach, so you cannot change it here. Refresh the inbox to see your own sessions.',
  COACH_NOT_BOOKABLE: 'This client is not matched with you, so the session cannot be booked with you. Check the client in your roster.',
  SESSION_NOT_FOUND: 'This session is no longer in your schedule. Refresh the inbox to see your current sessions.',
  SESSION_NOT_ACTIVE: 'This session is no longer active. Refresh the inbox to see your current sessions.',
  SLOT_TAKEN: 'Another session already uses that time. Refresh and choose a different time.',
  CALENDAR_BUSY: 'Your calendar is busy saving other changes right now. Wait a few seconds, then try again.',
  INVALID_LIST_QUERY: 'The inbox could not load more sessions from where you were. Refresh the inbox to start the list again.',
  BEYOND_BOOKING_HORIZON: 'That time is too far ahead to schedule. Pick an earlier date.',
  INVALID_BOOKING_OPTIONS: 'One of the booking options is outside its allowed range. Check the values shown under each option, then save again.',
};

/**
 * What the coach was doing when the error came back (S-SCHED-4 B-325-2).
 * The same machine code can need a different next step: SESSION_STARTED on
 * Confirm means the requested time passed, and the only action the request
 * card offers that works is Decline (backend approvalTooLate; a requested
 * session cannot be completed or marked no-show).
 */
export type CoachSchedulingIntent = 'approve' | 'decline' | 'cancel' | 'save_link';

export const COACH_INTENT_CODE_MESSAGES: Readonly<
  Partial<Record<CoachSchedulingIntent, Readonly<Record<string, string>>>>
> = {
  approve: {
    SESSION_STARTED:
      'The requested time has already passed, so it can no longer be confirmed. Tap Decline on this request so your client can choose another time.',
  },
};

function audienceWords(audience: CalendarAudience): { home: string; ask: string } {
  return audience === 'coach'
    ? { home: 'your schedule', ask: 'contact support' }
    : { home: 'Calendar', ask: 'message your coach' };
}

/** Error diagnostics contain no payload, URL, token, user text or raw axios error. */
export function calendarErrorMessage(
  err: unknown,
  operation: string,
  audience: CalendarAudience = 'client',
  intent?: CoachSchedulingIntent,
): string {
  const status = schedulingErrorStatus(err);
  const code = schedulingErrorCode(err);
  const intentMessages = audience === 'coach' && intent ? COACH_INTENT_CODE_MESSAGES[intent] : undefined;
  if (intentMessages && code && Object.prototype.hasOwnProperty.call(intentMessages, code)) {
    return intentMessages[code];
  }
  if (audience === 'coach' && code && Object.prototype.hasOwnProperty.call(COACH_CODE_MESSAGES, code)) {
    return COACH_CODE_MESSAGES[code];
  }
  if (code && Object.prototype.hasOwnProperty.call(SCHEDULING_CODE_MESSAGES, code)) {
    return SCHEDULING_CODE_MESSAGES[code];
  }
  const w = audienceWords(audience);
  if (status === 401) return `Your login expired before the app could ${operation}. Log in again, then check ${w.home}.`;
  if (status === 402) {
    return audience === 'coach'
      ? 'Your plan does not include this scheduling action. Open Membership in Profile and more, or contact support.'
      : 'Your coaching plan does not allow this scheduling action. Open Membership in Profile and more, or message your coach.';
  }
  if (status === 403) {
    return audience === 'coach'
      ? 'You do not have access to this scheduling action. Refresh your schedule, or contact support.'
      : 'You do not have access to this scheduling action. Open Calendar for your assigned coach, or contact support.';
  }
  if (status === 404) {
    return audience === 'coach'
      ? 'This client, appointment type or session is no longer available. Refresh your schedule.'
      : 'This coach, appointment type or session is no longer available. Open Calendar again, or message your coach.';
  }
  if (status === 400 || status === 422) return `The scheduling details were not accepted. Refresh ${w.home} and check the time or form fields before trying again.`;
  if (status === 409) {
    return audience === 'coach'
      ? 'The schedule changed while you were using it. Refresh your schedule and try again.'
      : 'The schedule changed while you were using it. Refresh Calendar and choose an available time.';
  }
  if (status === 429) return `Too many scheduling actions were sent. Wait a minute, then refresh ${w.home} before trying again.`;
  const networkCode = (err as { code?: unknown } | null)?.code;
  if (
    networkCode === 'ERR_NETWORK' ||
    networkCode === 'ECONNABORTED' ||
    networkCode === 'ETIMEDOUT' ||
    (err instanceof Error && err.message === 'Network Error')
  ) {
    return audience === 'coach'
      ? `The connection dropped before the app could ${operation}. Reconnect and refresh your schedule before trying again.`
      : `The connection dropped before the app could ${operation}. Reconnect and check Calendar before sending another booking.`;
  }
  const ref = referenceFor(err);
  if (!err || typeof err !== 'object' || !reported.has(err)) {
    captureError(new Error(`Calendar could not ${operation}`), {
      area: 'calendar',
      audience,
      status,
      code,
      request_id: ref,
    });
    if (err && typeof err === 'object') reported.add(err);
  }
  return audience === 'coach'
    ? `The app could not ${operation}. Refresh your schedule and try again. If it keeps failing, contact support at ${SUPPORT_EMAIL} with reference ${ref}.`
    : `The app could not ${operation}. Check Calendar before sending another booking. If it remains unavailable, contact support at ${SUPPORT_EMAIL} with reference ${ref}.`;
}

export function bookingOutcomeUncertain(err: unknown): boolean {
  const status = schedulingErrorStatus(err);
  // CALENDAR_BUSY (503) is a definite "not booked": the lock wait timed out
  // before anything was written.
  if (schedulingErrorCode(err) === 'CALENDAR_BUSY') return false;
  return status === null || status >= 500;
}

/** Codes after which the open-times list should be refreshed. */
export function shouldRefreshSlots(err: unknown): boolean {
  const code = schedulingErrorCode(err);
  if (code === 'SLOT_TAKEN' || code === 'SLOT_UNAVAILABLE' || code === 'SESSION_IN_PAST' || code === 'DURATION_MISMATCH' || code === 'INVALID_TIME') return true;
  return schedulingErrorStatus(err) === 409;
}
