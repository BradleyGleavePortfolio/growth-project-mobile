/**
 * Shared invite-token validator.
 *
 * Backend invite tokens are URL-safe single-use strings. We accept a
 * conservative alphanumeric + hyphen/underscore + dot character set with a
 * tight max length. Path separators, whitespace, and other punctuation are
 * rejected so a crafted deep link cannot smuggle a probe through to the
 * public accept endpoint.
 */
const INVITE_TOKEN_RE = /^[A-Za-z0-9._-]+$/;
const INVITE_TOKEN_MAX = 128;
const INVITE_TOKEN_MIN = 4;

export function isValidInviteToken(token: string | undefined | null): boolean {
  if (!token || typeof token !== 'string') return false;
  if (token.length < INVITE_TOKEN_MIN || token.length > INVITE_TOKEN_MAX) {
    return false;
  }
  return INVITE_TOKEN_RE.test(token);
}

export const __test = { INVITE_TOKEN_MAX, INVITE_TOKEN_MIN };
