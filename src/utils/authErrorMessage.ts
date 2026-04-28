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
        : ((raw as any)?.message ?? '');

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
