import { schedulingErrorCode, schedulingErrorStatus } from '../api/schedulingApi';
import { captureError } from '../services/sentry';

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

/** Error diagnostics contain no payload, URL, token, user text or raw axios error. */
export function calendarErrorMessage(err: unknown, operation: string): string {
  const status = schedulingErrorStatus(err);
  const code = schedulingErrorCode(err);
  if (code === 'SLOT_TAKEN' || code === 'SLOT_UNAVAILABLE') {
    return 'That time is taken or no longer open. Refresh open times and pick another time.';
  }
  if (code === 'SESSION_IN_PAST') {
    return 'That time is too close or has passed. Refresh open times and choose a later time.';
  }
  if (code === 'COACH_NOT_ASSIGNED') {
    return 'You are not matched with a coach yet. Ask your coach for an invite code, then open Accept invite in Profile and more.';
  }
  if (status === 401) return `Your login expired before we could ${operation}. Log in again, then check Calendar.`;
  if (status === 402) return `Your coaching plan does not allow this scheduling action. Open Membership in Profile and more, or message your coach.`;
  if (status === 403) return `You do not have access to this scheduling action. Open Calendar for your assigned coach, or contact support.`;
  if (status === 404) return `This coach, appointment type or session is no longer available. Open Calendar again, or message your coach.`;
  if (status === 400 || status === 422) return `The scheduling details were not accepted. Refresh Calendar and check the time or form fields before trying again.`;
  if (status === 409) return 'The schedule changed while you were using it. Refresh Calendar and choose an available time.';
  if (status === 429) return 'Too many scheduling actions were sent. Wait a minute, then refresh Calendar before trying again.';
  const networkCode = (err as { code?: unknown } | null)?.code;
  if (
    networkCode === 'ERR_NETWORK' ||
    networkCode === 'ECONNABORTED' ||
    networkCode === 'ETIMEDOUT' ||
    (err instanceof Error && err.message === 'Network Error')
  ) {
    return `The connection dropped before we could ${operation}. Reconnect and check Calendar before sending another booking.`;
  }
  const ref = referenceFor(err);
  if (!err || typeof err !== 'object' || !reported.has(err)) {
    captureError(new Error(`Calendar could not ${operation}`), {
      area: 'calendar',
      status,
      code,
      request_id: ref,
    });
    if (err && typeof err === 'object') reported.add(err);
  }
  return `We could not ${operation}. Check Calendar before sending another booking. If it remains unavailable, contact support at Bradley@Bradleytgpcoaching.com with reference ${ref}.`;
}

export function bookingOutcomeUncertain(err: unknown): boolean {
  const status = schedulingErrorStatus(err);
  return status === null || status >= 500;
}
