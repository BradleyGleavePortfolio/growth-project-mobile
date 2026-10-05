/**
 * Copy for Roman approve-to-adjust cards (Quiet Luxury: plain warm words, no
 * exclamation marks, no emojis, no "we/us").
 *
 * Errors: the backend sends `{ code, message }` for every known refusal and
 * the card shows that message. Each known code also has a local fallback so
 * an old server or a stripped body still gets specific copy. Anything else
 * (network, contract drift, an unknown code) says what happened, gives the
 * next step, a short reference and the support address, and is reported to
 * Sentry without personal data.
 *
 * A change request (approve, edit, undo) that gets no readable answer may
 * still have been applied: the reply can be lost after the server saved it.
 * Those cases never say the workouts are unchanged; they say the result is
 * not confirmed and reload the list so the card shows the server's state.
 */
import { z } from 'zod';
import { captureError } from '../../../services/sentry';
import { SUPPORT_EMAIL } from '../../../constants/support';
import type { RomanAdjustChange, RomanAdjustSignal } from '../../../api/romanAdjustApi';

/** Seconds a decision waits on the card, undoable, before it is sent. */
export const ADJUST_CLIENT_UNDO_SECONDS = 5;

export type AdjustAction = 'load' | 'approve' | 'edit' | 'dismiss' | 'undo';

export const ADJUST_ERROR_FALLBACKS: Record<string, string> = {
  ADJUSTMENT_NOT_FOUND: 'This suggestion is no longer available. Pull to refresh to see the current ones.',
  ADJUSTMENT_ALREADY_DECIDED:
    'This suggestion has already been handled, possibly from another device. Pull to refresh to see where it stands.',
  ADJUSTMENT_WORKOUT_STARTED:
    'Your client has already started or finished this workout, so it was left as it is. Any change now belongs in your next programming.',
  ADJUSTMENT_WORKOUT_CHANGED:
    'This workout was edited after Roman made the suggestion, so it was not applied. Open the workout to review it.',
  ADJUSTMENT_CONSENT_WITHDRAWN:
    'Your client has turned off AI features for their data, so Roman can no longer make or apply this suggestion. You can still edit the workout yourself.',
  ADJUSTMENT_UNDO_EXPIRED: 'The undo window has closed. You can still change the sets in the workout builder.',
  ADJUSTMENT_UNDO_BLOCKED:
    'The workout has changed since this suggestion was applied, so undo would overwrite newer edits. Open the workout to adjust it directly.',
  ADJUSTMENT_EDIT_INVALID:
    'Each exercise needs between 1 and 20 sets, and the change has to match the exercises in this workout. Check the numbers and try again.',
  ADJUSTMENTS_UNAVAILABLE: `Roman's suggestions could not be loaded just now. Try again in a minute; if it keeps happening, contact ${SUPPORT_EMAIL}.`,
};

const WHAT: Record<AdjustAction, string> = {
  load: "load Roman's suggestions",
  approve: 'apply the change',
  edit: 'apply your change',
  dismiss: 'dismiss the suggestion',
  undo: 'undo the change',
};

function field(obj: unknown, key: string): unknown {
  return typeof obj === 'object' && obj !== null ? Reflect.get(obj, key) : undefined;
}

function reference(err: unknown): string | null {
  const res = field(err, 'response');
  const id = [field(field(res, 'data'), 'request_id'), field(field(res, 'headers'), 'x-request-id')].find(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  return id ? id.replace(/-/g, '').slice(0, 8) : null;
}

export interface AdjustErrorView {
  code: string | null;
  message: string;
  /** The suggestion is gone or settled: refresh the list rather than retry. */
  refresh: boolean;
}

/** Requests that change a client's workout: an unanswered one may have been applied. */
const CHANGES = new Set<AdjustAction>(['approve', 'edit', 'undo']);

const UNCONFIRMED_LEAD: Record<'approve' | 'edit' | 'undo', string> = {
  approve: 'so it is not certain whether the change was applied',
  edit: 'so it is not certain whether your change was applied',
  undo: 'so it is not certain whether the change was undone',
};

function unconfirmed(action: AdjustAction, why: string, tail: string): AdjustErrorView {
  const lead = UNCONFIRMED_LEAD[action as 'approve' | 'edit' | 'undo'];
  return {
    code: null,
    message: `${why}, ${lead}. The suggestions have been reloaded from the server; check this client's card before deciding again.${tail}`,
    refresh: true,
  };
}

/** Only a plain upper-case code goes to Sentry; anything else could carry response text. */
function safeCode(code: unknown): string | undefined {
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : undefined;
}

const SETTLED = new Set([
  'ADJUSTMENT_NOT_FOUND',
  'ADJUSTMENT_ALREADY_DECIDED',
  'ADJUSTMENT_WORKOUT_STARTED',
  'ADJUSTMENT_WORKOUT_CHANGED',
  'ADJUSTMENT_CONSENT_WITHDRAWN',
]);

export function adjustErrorView(err: unknown, action: AdjustAction): AdjustErrorView {
  const res = field(err, 'response');
  const status = field(res, 'status');
  const data = field(res, 'data');
  const code = field(data, 'code');
  const serverMessage = field(data, 'message');
  // Loading changes nothing, and right after an unconfirmed change "unchanged" would read as a false answer.
  const unchanged = action === 'load' ? '' : ' Your workouts are unchanged.';
  if (typeof code === 'string' && code in ADJUST_ERROR_FALLBACKS) {
    return {
      code,
      message: typeof serverMessage === 'string' && serverMessage.length > 0 ? serverMessage : ADJUST_ERROR_FALLBACKS[code],
      refresh: SETTLED.has(code),
    };
  }
  if (typeof status !== 'number') {
    if (err instanceof z.ZodError) {
      // A fresh error: the ZodError text quotes the received values.
      captureError(new Error('roman_adjust reply did not match the contract'), { where: `roman_adjust.${action}`, kind: 'contract' });
      if (CHANGES.has(action)) {
        return unconfirmed(action, 'The app could not read the reply from the server', ` If it keeps happening, update the app or contact ${SUPPORT_EMAIL}.`);
      }
      return {
        code: null,
        message: `The app could not read the reply while trying to ${WHAT[action]}.${unchanged} Update the app, then try again; if it keeps happening, contact ${SUPPORT_EMAIL}.`,
        refresh: false,
      };
    }
    if (CHANGES.has(action)) {
      return unconfirmed(action, 'The connection dropped before the server replied', '');
    }
    return {
      code: null,
      message: `The server could not be reached to ${WHAT[action]}.${unchanged} Check your connection, then try again.`,
      refresh: false,
    };
  }
  if (status === 401) {
    return { code: null, message: 'Your sign-in on this phone has ended. Sign out, sign in again, then come back here.', refresh: false };
  }
  if (status === 403) {
    return { code: null, message: 'This account cannot change client workouts. Sign in with your coach account to use Roman suggestions.', refresh: false };
  }
  if (status === 429) {
    return { code: null, message: 'Too many changes in a short time. Wait a minute, then try again.', refresh: false };
  }
  const ref = reference(err);
  captureError(new Error(`roman_adjust HTTP ${status}`), { where: `roman_adjust.${action}`, status, code: safeCode(code) });
  const contact = `contact ${SUPPORT_EMAIL}${ref ? ` and quote reference ${ref}` : ''}`;
  if (status >= 500 && CHANGES.has(action)) {
    return unconfirmed(action, 'The server ran into a problem before it could confirm the result', ` If it keeps happening, ${contact}.`);
  }
  return {
    code: null,
    message: `Roman could not ${WHAT[action]} just now.${unchanged} Try again in a minute; if it keeps happening, ${contact}.`,
    refresh: false,
  };
}

// ─── card copy ──────────────────────────────────────────────────────────────

export function signalLabel(s: RomanAdjustSignal): string {
  switch (s.key) {
    case 'hrv_drop':
      return `HRV ${s.value}% below usual`;
    case 'rhr_rise':
      return `Resting HR up ${s.value} bpm`;
    case 'short_sleep':
      return `Sleep ${s.value} h a night`;
    case 'low_readiness':
      return `Readiness ${s.value}`;
    case 'load_spike':
      return `Load ${s.value}x usual`;
    case 'high_effort':
      return `Effort ${s.value} of 10`;
  }
}

export function changeSummary(c: RomanAdjustChange): string {
  return `${c.sets_before} to ${c.sets_after} sets, ${c.volume_pct}% less volume`;
}

export function pendingLine(kind: 'approve' | 'edit' | 'dismiss', seconds: number): string {
  const what = kind === 'dismiss' ? 'Dismissing' : 'Applying';
  return `${what} in ${seconds} s.`;
}

export function appliedLine(c: RomanAdjustChange | null, firstName: string): string {
  if (!c) return 'Applied.';
  return `Applied. ${firstName || 'Your client'} will see ${c.sets_after} sets instead of ${c.sets_before}.`;
}

export const DISMISS_REASONS: Array<{ value: 'not_now' | 'disagree' | 'client_feels_fine' | 'other'; label: string }> = [
  { value: 'client_feels_fine', label: 'Client feels fine' },
  { value: 'disagree', label: 'Not the right call' },
  { value: 'not_now', label: 'Not now' },
  { value: 'other', label: 'Other reason' },
];
