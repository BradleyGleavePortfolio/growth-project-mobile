/**
 * What auth, signup and role screens show when a request fails (#306 r5,
 * owner rules 13:28 and 13:34).
 *
 * Every failure says what happened and offers a working next action. Known
 * statuses and backend codes are mapped (utils/authErrorMessage). An unknown
 * failure shows a short reference and a support path, and is reported to
 * Sentry under the same reference so support can find it. "Please try
 * again" is never the whole message.
 *
 * This is deliberately small so the app-wide error mapper (S-ERRORS lane) can
 * extend it: add kinds to `AuthFailureKind`, keep the shape.
 *
 * Privacy: the error object is never sent to Sentry as-is. An axios error
 * carries the request config (the signup body includes the password, and the
 * headers carry the bearer token), so only a synthetic error with the flow,
 * status, backend code and reference is reported.
 */
import { toAuthErrorDetail } from './authErrorDetail';
import { randomUuid } from './idempotency';
import { captureError } from '../services/sentry';
import {
  toFriendlyAuthError,
  toFriendlyAppleAuthError,
  toFriendlySignupError,
  type SignupErrorKind,
} from './authErrorMessage';

export type AuthFlow = 'sign_in' | 'sign_up' | 'verify' | 'role_selection';
export type AuthProviderName = 'email' | 'apple' | 'google';

export type AuthFailureKind =
  | SignupErrorKind
  | 'cancelled'
  | 'invalid_credentials'
  | 'email_unconfirmed'
  | 'provider_unavailable';

export interface AuthFailure {
  kind: AuthFailureKind;
  message: string;
  /** The screen offers Contact support next to the message. */
  support: boolean;
  /** Short reference shown to the user and attached to the Sentry event (unknown failures only). */
  reference: string | null;
  cancelled: boolean;
}

/**
 * Reference for an unknown failure: the server's `request_id` (body or
 * `x-request-id` header) when present, else the id this app sent with the
 * request, else a fresh local id. Shown shortened (8 characters). Works on a
 * raw request error and on the detail a provider helper returned (r6).
 */
export function failureReference(err: unknown): { full: string; short: string } {
  let full = toAuthErrorDetail(err).requestId;
  if (!full) {
    try {
      full = randomUuid();
    } catch {
      full = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    }
  }
  const short = full.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || 'UNKNOWN';
  return { full, short };
}

function statusOf(err: unknown): number | null {
  return toAuthErrorDetail(err).status;
}

function codeOf(err: unknown): string | null {
  return toAuthErrorDetail(err).code;
}

/**
 * Report a failure to Sentry under its reference (sanitised: fixed event
 * name, flow, provider, status, machine code, reference; never the body,
 * headers, tokens or email). Returns the reference shown to the user.
 */
export function reportAuthFailure(
  err: unknown,
  flow: AuthFlow,
  provider: AuthProviderName = 'email',
  outcome: 'failed' | 'unconfirmed' = 'failed',
): { full: string; short: string } {
  const ref = failureReference(err);
  captureError(new Error(`auth_${flow}_${outcome}`), {
    flow,
    provider,
    status: statusOf(err),
    code: codeOf(err),
    reference: ref.full,
  });
  return ref;
}

const UNKNOWN_LEAD: Record<AuthFlow, string> = {
  sign_in: 'Sign-in did not complete because of a server problem.',
  sign_up: 'Account creation could not be confirmed because of a server problem.',
  verify: 'Sign-in after verification did not complete because of a server problem.',
  role_selection: 'Account setup did not finish because of a server problem.',
};

/** Unknown failure: reference, support path, Sentry event (sanitised). */
export function unknownAuthFailure(
  err: unknown,
  flow: AuthFlow,
  provider: AuthProviderName = 'email',
): AuthFailure {
  const ref = reportAuthFailure(err, flow, provider);
  const lead =
    provider === 'apple'
      ? 'Sign in with Apple didn’t go through.'
      : provider === 'google'
        ? 'Sign in with Google didn’t go through.'
        : UNKNOWN_LEAD[flow];
  const next =
    provider === 'email'
      ? `You can try again, or contact support and quote reference ${ref.short}.`
      : `You can use your email instead, or contact support and quote reference ${ref.short}.`;
  return {
    kind: 'unknown',
    message: `${lead} ${next}`,
    support: true,
    reference: ref.short,
    cancelled: false,
  };
}

/**
 * No response reached the app (offline, DNS, timeout before an answer). Pure
 * check: never reports to Sentry, so callers can branch on it first.
 */
export function isNetworkFailure(err: unknown): boolean {
  if (statusOf(err) !== null) return false;
  const raw = messageOf(err);
  return toFriendlyAuthError(raw).category === 'network' || /cannot reach server/i.test(raw);
}

const EMAIL_UNCONFIRMED_CODE = /^(?:email_not_confirmed|email_unconfirmed|email_not_verified|unverified_email)$/i;
const EMAIL_UNCONFIRMED_TEXT =
  /email (?:address )?(?:is )?not (?:yet )?(?:been )?(?:confirmed|verified)|verify your email|confirm your email|email[_ ]?verification/i;

/** Sign-in on Login (email, Apple, Google), and the verify step's sign-in. */
export function describeSignInFailure(
  err: unknown,
  opts: { flow?: 'sign_in' | 'verify'; provider?: AuthProviderName } = {},
): AuthFailure {
  const flow = opts.flow ?? 'sign_in';
  const provider = opts.provider ?? 'email';
  const raw = messageOf(err);
  const base = provider === 'apple' ? toFriendlyAppleAuthError(raw) : toFriendlyAuthError(raw);
  if (base.cancelled) return { kind: 'cancelled', message: '', support: false, reference: null, cancelled: true };
  const status = statusOf(err);
  if (status === 429 || base.category === 'rate_limited') {
    return { kind: 'rate_limited', message: 'Too many attempts. Wait a minute, then sign in again.', support: false, reference: null, cancelled: false };
  }
  if (base.category === 'network' || (status === null && /cannot reach server/i.test(raw))) {
    return {
      kind: 'network',
      message: 'The server could not be reached. Check your connection, then sign in again.',
      support: false,
      reference: null,
      cancelled: false,
    };
  }
  // #306 r6 (Sol B-306-4): the specific meaning wins over the status. The
  // backend answers an unconfirmed email with 401 too ("Email not
  // confirmed..."), so that is checked before any 401 fallback, from the
  // machine code or the message itself; a bare "email" in a message is not
  // evidence (the wrong-password 401 is "Invalid email or password").
  if (EMAIL_UNCONFIRMED_CODE.test(codeOf(err) ?? '') || EMAIL_UNCONFIRMED_TEXT.test(raw)) {
    return {
      kind: 'email_unconfirmed',
      // #306 r7 (Opus C-306-8): for Apple / Google the address belongs to
      // the provider account and we sent no link, so the copy says where to
      // verify it instead.
      message:
        provider === 'google'
          ? 'Your Google account’s email is not verified. Verify it with Google, or sign up with email.'
          : provider === 'apple'
            ? 'The email on your Apple Account is not verified. Verify it with Apple, or sign up with email.'
            : flow === 'verify'
              ? 'Your email is not verified yet. Open the link sent to this address, then tap I verified my email.'
              : 'Your email is not confirmed yet. Open the link in that email, then sign in.',
      support: false,
      reference: null,
      cancelled: false,
    };
  }
  // A 401 means wrong credentials only for an email and password sign-in. A
  // provider 401 (token refused) is not about a password (Opus C-306-6).
  if (base.category === 'invalid_credentials' || (status === 401 && provider === 'email')) {
    return {
      kind: 'invalid_credentials',
      message:
        flow === 'verify'
          ? 'That email and password don’t match an account. Log in with the password you use for this email, or reset it with Forgot password.'
          : 'That email and password don’t match. Check them, or use Forgot password to set a new one.',
      support: false,
      reference: null,
      cancelled: false,
    };
  }
  if (provider !== 'email' && status === null && base.category !== 'unknown') {
    // Provider sheet or configuration problem: say which, offer email. A
    // configuration fault is ours, so it carries a reference and is
    // reported too (#306 r7).
    const ref = reportAuthFailure(err, flow, provider);
    return {
      kind: 'provider_unavailable',
      message:
        provider === 'apple'
          ? `Sign in with Apple is not available right now. You can use your email and password instead, or contact support and quote reference ${ref.short}.`
          : `Sign in with Google is not available right now. You can use your email and password instead, or contact support and quote reference ${ref.short}.`,
      support: true,
      reference: ref.short,
      cancelled: false,
    };
  }
  return unknownAuthFailure(err, flow, provider);
}

/** Create account (email form, and provider signups on CreateAccount). */
export function describeSignupFailure(err: unknown, provider: AuthProviderName = 'email'): AuthFailure {
  // Apple / Google on CreateAccount fail like a sign-in (the provider sheet
  // or the token exchange); the email form has the signup refusals.
  if (provider !== 'email') {
    // #306 r7: a code the provider signup carried can be refused like the
    // email form's; say so instead of a reference.
    const known = toFriendlySignupError(err);
    if (known.kind === 'invite_invalid') {
      return { kind: known.kind, message: known.message, support: false, reference: null, cancelled: false };
    }
    return describeSignInFailure(err, { provider });
  }
  const s = toFriendlySignupError(err);
  if (s.kind === 'unknown') return unknownAuthFailure(err, 'sign_up', provider);
  return { kind: s.kind, message: s.message, support: false, reference: null, cancelled: false };
}

function messageOf(err: unknown): string {
  return toAuthErrorDetail(err).message;
}
