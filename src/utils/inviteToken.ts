/**
 * Shared invite-token validator.
 *
 * Mirrors the backend invite-code contract exactly: letters, digits, and
 * hyphens only, length 3–32. Anything outside this set (dots, underscores,
 * path separators, whitespace, oversized strings) is rejected before the
 * public accept endpoint is ever called, so a crafted deep link cannot
 * smuggle a probe through.
 *
 * Backend reference: `INVITE_CODE_PATTERN = /^[A-Za-z0-9-]+$/`,
 * `INVITE_CODE_MIN_LENGTH = 3`, `INVITE_CODE_MAX_LENGTH = 32`
 * (`src/invite-codes/invite-codes.service.ts`).
 */
const INVITE_TOKEN_RE = /^[A-Za-z0-9-]+$/;
const INVITE_TOKEN_MAX = 32;
const INVITE_TOKEN_MIN = 3;

export function isValidInviteToken(token: string | undefined | null): boolean {
  if (!token || typeof token !== 'string') return false;
  if (token.length < INVITE_TOKEN_MIN || token.length > INVITE_TOKEN_MAX) {
    return false;
  }
  return INVITE_TOKEN_RE.test(token);
}

export const __test = { INVITE_TOKEN_MAX, INVITE_TOKEN_MIN };
