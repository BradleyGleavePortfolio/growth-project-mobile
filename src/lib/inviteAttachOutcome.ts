/**
 * Reads the invite-attach outcome the backend returns from signup
 * (`/auth/signup-with-code`, `/auth/apple`, `/auth/google`):
 *
 *   { invite_attached: boolean, invite_attach_error?: string }
 *
 * `invite_attached:false` means the account was created but the client is
 * NOT connected to a coach. Older backends omit both fields; that is treated
 * as "unknown" (not a failure) so we never invent an error.
 *
 * `inviteAttachErrorMessage` turns the server reason (a code such as
 * `expired` / `coach_inactive`, or a sentence) into calm user copy. It never
 * echoes the raw server string, per the no-raw-errors rule.
 */

import { joinOutcomeOf } from './joinPackage';

export interface InviteAttachOutcome {
  /** true / false when the server reported it; null when it did not. */
  attached: boolean | null;
  /** Raw server reason, kept for analytics/logging only. */
  reason: string | null;
}

export function readInviteAttachOutcome(data: unknown): InviteAttachOutcome {
  if (!data || typeof data !== 'object') return { attached: null, reason: null };
  const d = data as { invite_attached?: unknown; invite_attach_error?: unknown };
  // B-PACKAGE-135: a join means the code was accepted, even when a paid
  // package still has to be paid on the package screen before the attach.
  const attached = joinOutcomeOf(data) ? true : typeof d.invite_attached === 'boolean' ? d.invite_attached : null;
  let reason: string | null = null;
  if (typeof d.invite_attach_error === 'string' && d.invite_attach_error.trim()) {
    reason = d.invite_attach_error.trim().slice(0, 120);
  } else if (d.invite_attach_error && typeof d.invite_attach_error === 'object') {
    const code = (d.invite_attach_error as { code?: unknown; reason?: unknown }).code ??
      (d.invite_attach_error as { reason?: unknown }).reason;
    if (typeof code === 'string' && code.trim()) reason = code.trim().slice(0, 120);
  }
  return { attached, reason };
}

/** True only when the server explicitly said the attach failed. */
export function inviteAttachFailed(data: unknown): boolean {
  return readInviteAttachOutcome(data).attached === false;
}

const MESSAGES: Array<{ test: RegExp; message: string }> = [
  {
    // invite_intended_email_mismatch: an emailed (bulk) invite only works for
    // the address it was sent to, e.g. not for a Sign in with Apple hidden
    // email (AUDIT-17-125). Retrying the same code can never work.
    test: /email_mismatch|intended_email/i,
    message:
      'That invite was sent to a different email address. Sign up with the email the invite was sent to, or ask your coach for their coach code and enter it below.',
  },
  {
    // code_revoked: the coach turned the code off (revoke, or a rotation with no grace period).
    test: /revoked|turned_off/i,
    message:
      'That invite code was turned off by your coach. Ask your coach for their current code and enter it below.',
  },
  {
    test: /expired|inactive_code|code_inactive|disabled/i,
    message: 'That invite code has expired. Ask your coach for a new one and enter it below.',
  },
  {
    test: /max_?uses|use_?limit|capacity|exhausted|used_up/i,
    message: 'That invite code has already been used up. Ask your coach for a new one.',
  },
  {
    test: /coach_(?:inactive|unavailable|lapsed)|subscription|not_accepting|seat/i,
    message:
      'Your coach is not accepting new clients through the app right now. Let them know, then try your code again.',
  },
  {
    test: /already|different_coach|reparent|has_coach/i,
    message:
      'Your account is already connected to a different coach. Contact support if you need to switch.',
  },
  {
    test: /invalid|not_found|unknown|no_such|bad_code/i,
    message: 'That invite code was not found. Check it with your coach and enter it below.',
  },
];

export const DEFAULT_INVITE_ATTACH_MESSAGE =
  'Your account is ready, but it is not connected to your coach yet. Enter your invite code to try again.';

export function inviteAttachErrorMessage(reason: string | null | undefined): string {
  if (!reason) return DEFAULT_INVITE_ATTACH_MESSAGE;
  for (const m of MESSAGES) if (m.test.test(reason)) return m.message;
  return DEFAULT_INVITE_ATTACH_MESSAGE;
}
