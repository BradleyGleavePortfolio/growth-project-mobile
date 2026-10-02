/**
 * B-312-1: what to say when a Settings > Notifications toggle could not be
 * saved (owner rule 2026-10-01 13:34: say what happened and what to do next;
 * read the status and machine code, never only the message; unknown failures
 * show a short reference and a support path and are reported to Sentry).
 *
 * The toggle is rolled back before this runs, so every message says the
 * setting was left as it was.
 */
import { SUPPORT_EMAIL } from '../../constants/support';
import { reportUnexpected } from '../../lib/consultation/report';
import { shortReference, supportReferenceOf } from '../../utils/correlation';

export type PreferenceSaveFailureKind = 'offline' | 'signed_out' | 'busy' | 'server';

export interface PreferenceSaveFailure {
  kind: PreferenceSaveFailureKind;
  message: string;
  /** Short support reference, only for `server` failures. */
  reference: string | null;
}

/** The endpoint every toggle writes to (src/services/api.ts notificationsApi). */
export const PREFERENCES_ENDPOINT = 'PATCH /notifications/preferences';

function statusOf(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const response = (err as { response?: unknown }).response;
  if (!response || typeof response !== 'object') return null;
  const status = (response as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

function codeOf(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const response = (err as { response?: { data?: unknown } }).response;
  const data = response?.data;
  if (!data || typeof data !== 'object') return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

/** An HTTP client failure that never got a response (offline, timeout, DNS). */
function isTransportFailure(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { isAxiosError?: unknown }).isAxiosError === true;
}

/**
 * Anything that is not an HTTP response with a status we handle (including a
 * failure that is not an HTTP error at all) is unexpected: reference, support
 * path, Sentry.
 *
 * @param err   what `notificationsApi.updatePreferences` rejected with
 * @param noun  the setting in plain words, for example "workout reminder"
 */
export function preferenceSaveFailureOf(err: unknown, noun: string): PreferenceSaveFailure {
  const status = statusOf(err);
  if (status === null && isTransportFailure(err)) {
    return {
      kind: 'offline',
      message: `Your ${noun} setting was not saved because the app could not reach the server, so it was left as it was. Check your connection, then try again.`,
      reference: null,
    };
  }
  if (status === 401) {
    // The API client has already tried to refresh the session and is signing
    // the account out (src/services/api.ts handleRefreshFailure).
    return {
      kind: 'signed_out',
      message: `You were signed out, so your ${noun} setting was not saved. Sign in again, then change it.`,
      reference: null,
    };
  }
  if (status === 429) {
    return {
      kind: 'busy',
      message: `Your ${noun} setting was changed several times in a row, so this change was not saved. Wait a minute, then try again.`,
      reference: null,
    };
  }
  const requestId = supportReferenceOf(err);
  reportUnexpected(PREFERENCES_ENDPOINT, { status, code: codeOf(err), requestId });
  const reference = shortReference(requestId);
  return {
    kind: 'server',
    message: `Your ${noun} setting could not be saved, so it was left as it was. Try again in a moment. If it keeps happening, write to support at ${SUPPORT_EMAIL}${reference ? ` and mention reference ${reference}` : ''}.`,
    reference,
  };
}
