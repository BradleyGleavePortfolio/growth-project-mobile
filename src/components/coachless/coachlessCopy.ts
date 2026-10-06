/**
 * Copy for the coachless Home code sheet: one specific line per refusal code
 * (what happened and what to do next). No first person, no exclamation
 * marks, never the raw server text. The banner title, the offer line, the
 * featured code and Roman's pitch are NOT here: they come from the owner's
 * featured-coach config on the server.
 */
import type { CoachlessFailure, CoachlessFailureCode } from '../../api/coachlessApi';

const REFUSAL: Record<CoachlessFailureCode, string> = {
  code_invalid: 'That code does not match a coach. Check the spelling, or ask the coach to send it again.',
  code_expired: 'That code has expired. Ask the coach for a new one.',
  code_revoked: 'That code is no longer active. Ask the coach for a current code.',
  code_exhausted: 'That code has reached its limit. Ask the coach for a new one.',
  code_email_mismatch:
    'That code was sent to a different email address. Sign in with that email, or ask the coach for a code of your own.',
  coach_not_accepting:
    'This coach is not taking new clients right now. Enter another coach code, or check back in a few days.',
  already_attached: 'Your account already has a coach. To change coaches, contact support from Settings.',
  role_cannot_redeem: 'Coach codes are for client accounts. Coach and owner accounts cannot join a coach.',
  account_not_found: 'Your account could not be found. Sign out, then sign in again.',
  idempotency_key_required: 'That attempt could not be matched. Tap Join again.',
  idempotency_key_reused: 'That attempt was for a different code. Tap Join again to use this one.',
  redemption_in_progress: 'Your code is still being applied. Wait a few seconds, then tap Join again.',
  redemption_failed: 'The code could not be applied because of a server problem. Tap Join to try again.',
  coachless_disabled: 'Coach code entry is paused right now. Check Home again in a little while.',
  network: 'No connection. Check the internet connection, then tap Join again.',
  rate_limited: 'Too many tries in a short time. Wait a minute, then try again.',
  bad_format: 'Coach codes use letters, numbers and dashes only, for example GP-A1B2C3.',
  unexpected: 'The code could not be applied. Tap Join to try again.',
};

/** The line shown under the code field for a failed check or join. */
export function refusalLine(failure: Pick<CoachlessFailure, 'code' | 'requestId' | 'status'>): string {
  const base = REFUSAL[failure.code];
  const reference =
    failure.code === 'redemption_failed' || failure.code === 'unexpected'
      ? failure.requestId
        ? ` If it keeps happening, contact support with reference ${failure.requestId}.`
        : failure.status
          ? ` If it keeps happening, contact support and mention error ${failure.status}.`
          : ''
      : '';
  return base + reference;
}

/** Keep the same Idempotency-Key for a retry of these (the server may still finish or replay). */
export function keepsIdempotencyKey(code: CoachlessFailureCode): boolean {
  return code !== 'idempotency_key_reused' && code !== 'idempotency_key_required';
}

/**
 * What the code's own plan grant means for the next step: 'active' (created /
 * already_active: the plan is on), 'pending' (pending_consent: the free plan
 * exists and turns on after the onboarding agreement), else null (no grant
 * from the code; the client chooses a plan). Never send a granted client to pay.
 */
export function grantState(status: string | null | undefined): 'active' | 'pending' | null {
  if (status === 'created' || status === 'already_active') return 'active';
  if (status === 'pending_consent') return 'pending';
  return null;
}
