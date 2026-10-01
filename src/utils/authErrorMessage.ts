/**
 * authErrorMessage — quiet-luxury, safe-copy mapper for auth errors.
 *
 * Raw errors from Supabase, Google OAuth, and our backend frequently surface
 * unfriendly strings ("Invalid login credentials", "AuthApiError: Email not
 * confirmed", "access_denied: The user denied the request") that read as
 * mechanical and, in the case of OAuth, leak protocol details. This helper
 * maps any of those to a calm, low-information, user-facing line.
 *
 * It also returns a boolean `cancelled` flag so callers can distinguish "the
 * user backed out of the flow" from "something went wrong" — the former
 * should be silent, the latter should be surfaced.
 */

export type AuthErrorCategory =
  | 'cancelled'
  | 'invalid_credentials'
  | 'email_unconfirmed'
  | 'rate_limited'
  | 'network'
  | 'oauth_denied'
  | 'oauth_misconfigured'
  | 'unknown';

export interface FriendlyAuthError {
  category: AuthErrorCategory;
  cancelled: boolean;
  /** Quiet, safe copy. No protocol jargon, no user-blaming, no exclamation. */
  message: string;
}

const PATTERNS: Array<{
  test: RegExp;
  category: AuthErrorCategory;
  message: string;
}> = [
  // Cancellation paths — these are silent in the UI; callers check `cancelled`.
  {
    test: /sign[- ]?in (?:was )?cancelled|user (?:cancel|denied)|access[_ ]?denied|popup[_ ]?closed/i,
    category: 'cancelled',
    cancelled: true as unknown as never, // placeholder, replaced below
    message: 'Sign-in was cancelled.',
  } as { test: RegExp; category: AuthErrorCategory; message: string },
  {
    test: /invalid login credentials|invalid email or password|wrong password/i,
    category: 'invalid_credentials',
    message: 'That email and password don’t match. Try again.',
  },
  {
    test: /email not confirmed|email[_ ]?verification|verify your email/i,
    category: 'email_unconfirmed',
    message: 'Please confirm your email, then sign in.',
  },
  {
    test: /rate ?limit|too many requests|429/i,
    category: 'rate_limited',
    message: 'Too many attempts. Try again in a moment.',
  },
  {
    test: /network|timeout|fetch failed|enotfound|econnreset|offline/i,
    category: 'network',
    message: 'We couldn’t reach the server. Check your connection and try again.',
  },
  {
    test: /redirect[_ ]?uri|invalid[_ ]?client|invalid[_ ]?request|misconfigured|client[_ ]?not[_ ]?found/i,
    category: 'oauth_misconfigured',
    message: 'Sign-in is unavailable right now. Please try again shortly.',
  },
];

export function toFriendlyAuthError(raw: unknown): FriendlyAuthError {
  const text =
    typeof raw === 'string'
      ? raw
      : raw instanceof Error
        ? raw.message
        : (raw && typeof raw === 'object' && 'message' in raw && typeof (raw as { message: unknown }).message === 'string'
            ? (raw as { message: string }).message
            : '');

  for (const p of PATTERNS) {
    if (p.test.test(text)) {
      return {
        category: p.category,
        cancelled: p.category === 'cancelled',
        message: p.message,
      };
    }
  }

  return {
    category: 'unknown',
    cancelled: false,
    // Deliberately generic — never echoes the raw upstream string back to
    // the user. Operators see the original via Sentry / console.
    message: 'Sign-in didn’t complete. Please try again.',
  };
}

/**
 * Apple-specific friendly copy. Sign in with Apple failures (backend 400/503,
 * contract drift, missing identity token) must never show a raw message or a
 * dead end: tell the user it did not work and offer the email path.
 * Cancellation stays silent (`cancelled: true`).
 */
export const APPLE_SIGN_IN_UNAVAILABLE_MESSAGE =
  'Sign in with Apple didn’t go through. Please try again, or use your email instead.';

export function toFriendlyAppleAuthError(raw: unknown): FriendlyAuthError {
  const base = toFriendlyAuthError(raw);
  if (base.cancelled || base.category === 'network' || base.category === 'rate_limited') {
    return base;
  }
  return { category: base.category, cancelled: false, message: APPLE_SIGN_IN_UNAVAILABLE_MESSAGE };
}

/**
 * Signup (create account) errors, read from the HTTP status and the
 * backend's structured `code` / `message`, not only from regexes over text
 * (#306 r5, owner 13:28). Known refusals get their own plain copy and, where
 * there is something to do, an action kind the screen renders as buttons:
 *  - 'email_exists': 409 "Email already registered" (Log in, Reset password).
 *  - 'signup_pending': 409 `{ code: 'signup_pending' }` from backend #597: an
 *    unconfirmed sign-up for this address exists that this request could not
 *    prove it owns (Reset password, Back). No resend endpoint exists, so no
 *    resend action is offered.
 *  - 'password_rule': 400 password rule; the backend's own rule text is shown.
 *  - 'invalid_email': 400 invalid address.
 *  - 'invite_invalid': 400 invalid / expired invite code.
 *  - 'rate_limited' / 'network': the shared copy above.
 * Anything else says sign-up did not complete; it never says "Sign-in".
 */
export type SignupErrorKind =
  | 'email_exists'
  | 'signup_pending'
  | 'password_rule'
  | 'invalid_email'
  | 'invite_invalid'
  | 'rate_limited'
  | 'network'
  | 'unknown';

export interface FriendlySignupError {
  kind: SignupErrorKind;
  message: string;
}

export const SIGNUP_EMAIL_EXISTS_MESSAGE = 'An account with this email already exists.';
export const SIGNUP_PENDING_MESSAGE = 'Check your email to finish signing up, or reset your password.';
export const SIGNUP_INVITE_INVALID_MESSAGE =
  'That invite code is not valid. Check it with your coach, or clear the field to sign up without one.';
export const SIGNUP_INVALID_EMAIL_MESSAGE = 'Enter a valid email address.';
export const SIGNUP_PASSWORD_RULE_FALLBACK =
  'Password must be at least 8 characters with one uppercase letter, one number, and one special character.';
export const SIGNUP_UNKNOWN_MESSAGE = 'We could not create your account. Please try again.';

function signupErrorParts(err: unknown): { status?: number; code?: string; messages: string[] } {
  const r = (err as { response?: { status?: unknown; data?: unknown } } | null | undefined)?.response;
  const status = typeof r?.status === 'number' ? r.status : undefined;
  const data = r?.data;
  const messages: string[] = [];
  let code: string | undefined;
  if (data && typeof data === 'object') {
    const d = data as { code?: unknown; error?: unknown; message?: unknown };
    if (typeof d.code === 'string') code = d.code;
    const m = d.message;
    if (typeof m === 'string') messages.push(m);
    else if (Array.isArray(m)) for (const x of m) if (typeof x === 'string') messages.push(x);
    if (typeof d.error === 'string') messages.push(d.error);
  } else if (typeof data === 'string') {
    messages.push(data);
  }
  return { status, code, messages };
}

/** A rule text from the server is shown only when it reads as one plain sentence about the password. */
function plainPasswordRule(messages: string[]): string | null {
  for (const m of messages) {
    const t = m.trim();
    if (/^password\b/i.test(t) && t.length <= 200 && !/[<>{}]|https?:/i.test(t)) {
      const plain = t.replace(/!+/g, '.');
      return /[.?]$/.test(plain) ? plain : `${plain}.`;
    }
  }
  return null;
}

export function toFriendlySignupError(err: unknown): FriendlySignupError {
  const { status, code, messages } = signupErrorParts(err);
  const text = messages.join(' ');
  if (status === 409) {
    if (code === 'signup_pending') return { kind: 'signup_pending', message: SIGNUP_PENDING_MESSAGE };
    return { kind: 'email_exists', message: SIGNUP_EMAIL_EXISTS_MESSAGE };
  }
  if (status === 429) return { kind: 'rate_limited', message: 'Too many attempts. Try again in a moment.' };
  if (status === 400 || status === 422) {
    if (/invite code|invite_code|coach code/i.test(text)) {
      return { kind: 'invite_invalid', message: SIGNUP_INVITE_INVALID_MESSAGE };
    }
    const rule = plainPasswordRule(messages);
    if (rule) return { kind: 'password_rule', message: rule };
    if (/password/i.test(text)) return { kind: 'password_rule', message: SIGNUP_PASSWORD_RULE_FALLBACK };
    if (/email/i.test(text) && /invalid|valid|format/i.test(text)) {
      return { kind: 'invalid_email', message: SIGNUP_INVALID_EMAIL_MESSAGE };
    }
  }
  const raw = messages[0] ?? (err instanceof Error ? err.message : typeof err === 'string' ? err : '');
  const base = toFriendlyAuthError(raw);
  // No response at all (the API client rewrites the message to "Cannot reach
  // server ...") is a connection problem, not a refusal.
  if (base.category === 'network' || (status === undefined && /cannot reach server/i.test(raw))) {
    return { kind: 'network', message: 'We couldn’t reach the server. Check your connection and try again.' };
  }
  if (base.category === 'rate_limited') return { kind: 'rate_limited', message: base.message };
  return { kind: 'unknown', message: SIGNUP_UNKNOWN_MESSAGE };
}
