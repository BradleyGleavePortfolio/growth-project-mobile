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
import { extractRequestId, REQUEST_ID_HEADER } from './correlation';
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

function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (k.toLowerCase() === name.toLowerCase() && typeof v === 'string' && v) return v;
  }
  return null;
}

/**
 * Reference for an unknown failure: the server's `request_id` (body or
 * `x-request-id` header) when present, else the id this app sent with the
 * request, else a fresh local id. Shown shortened (8 characters).
 */
export function failureReference(err: unknown): { full: string; short: string } {
  const sent = headerValue((err as { config?: { headers?: unknown } } | null)?.config?.headers, REQUEST_ID_HEADER);
  let full = extractRequestId(err) ?? sent;
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
  const s = (err as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof s === 'number' ? s : null;
}

function codeOf(err: unknown): string | null {
  const d = (err as { response?: { data?: unknown } } | null)?.response?.data;
  if (!d || typeof d !== 'object') return null;
  const c = (d as { code?: unknown; error?: unknown }).code ?? (d as { error?: unknown }).error;
  return typeof c === 'string' ? c.slice(0, 80) : null;
}

const UNKNOWN_LEAD: Record<AuthFlow, string> = {
  sign_in: 'Sign-in did not complete because of a problem on our side.',
  sign_up: 'We could not create your account because of a problem on our side.',
  verify: 'We could not sign you in after verification because of a problem on our side.',
  role_selection: 'We could not finish setting up your account because of a problem on our side.',
};

/** Unknown failure: reference, support path, Sentry event (sanitised). */
export function unknownAuthFailure(
  err: unknown,
  flow: AuthFlow,
  provider: AuthProviderName = 'email',
): AuthFailure {
  const ref = failureReference(err);
  captureError(new Error(`auth_${flow}_failed`), {
    flow,
    provider,
    status: statusOf(err),
    code: codeOf(err),
    reference: ref.full,
  });
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
      message: 'We couldn’t reach the server. Check your connection, then sign in again.',
      support: false,
      reference: null,
      cancelled: false,
    };
  }
  if (base.category === 'invalid_credentials' || status === 401) {
    return {
      kind: 'invalid_credentials',
      message: 'That email and password don’t match. Check them, or use Forgot password to set a new one.',
      support: false,
      reference: null,
      cancelled: false,
    };
  }
  if (base.category === 'email_unconfirmed') {
    return {
      kind: 'email_unconfirmed',
      message: 'Your email is not confirmed yet. Open the link we sent, then sign in.',
      support: false,
      reference: null,
      cancelled: false,
    };
  }
  if (provider !== 'email' && status === null && base.category !== 'unknown') {
    // Provider sheet or configuration problem: say which, offer email.
    return {
      kind: 'provider_unavailable',
      message:
        provider === 'apple'
          ? 'Sign in with Apple is not available right now. You can use your email and password instead, or contact support.'
          : 'Sign in with Google is not available right now. You can use your email and password instead, or contact support.',
      support: true,
      reference: null,
      cancelled: false,
    };
  }
  return unknownAuthFailure(err, flow, provider);
}

/** Create account (email form, and provider signups on CreateAccount). */
export function describeSignupFailure(err: unknown, provider: AuthProviderName = 'email'): AuthFailure {
  // Apple / Google on CreateAccount fail like a sign-in (the provider sheet
  // or the token exchange); the email form has the signup refusals.
  if (provider !== 'email') return describeSignInFailure(err, { provider });
  const s = toFriendlySignupError(err);
  if (s.kind === 'unknown') return unknownAuthFailure(err, 'sign_up', provider);
  return { kind: s.kind, message: s.message, support: false, reference: null, cancelled: false };
}

function messageOf(err: unknown): string {
  if (typeof err === 'string') return err;
  const d = (err as { response?: { data?: unknown } } | null)?.response?.data;
  if (d && typeof d === 'object') {
    const m = (d as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  if (err instanceof Error) return err.message;
  const m = (err as { message?: unknown } | null)?.message;
  return typeof m === 'string' ? m : '';
}
