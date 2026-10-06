/**
 * Signup role choice ("I'm here to train" / "I coach clients").
 *
 * Contract (backend #597, C13): the optional body field
 * `intended_role: 'client' | 'coach'` on /auth/register, /auth/apple and
 * /auth/google is honoured only by the code path that inserts a brand-new
 * User row. `GET /auth/signup-policy` advertises it with
 * `role_choice: true` (false when SIGNUP_ROLE_CHOICE_ENABLED is off; absent
 * on the current production backend).
 *
 * Rules the app enforces:
 *  - The field is sent only when the live policy says `roleChoice === true`
 *    (see lib/signupPolicy). Against a backend without the field the app
 *    never sends it, so today's production flow is unchanged.
 *  - An invite / QR code always means client. Requests that carry a code
 *    never send `intended_role` at all (client is the server default and
 *    the server refuses 'coach' with a code).
 *  - A coach request is never downgraded by the app. If a backend that
 *    advertised the field then rejects it (400 "property intended_role
 *    should not exist" from the `forbidNonWhitelisted` ValidationPipe, which
 *    runs before any handler so no account exists), the request fails with
 *    `CoachSignupUnavailableError` and the user is told plainly. Only a
 *    'client' request is retried once without the field, because the
 *    outcome is identical either way.
 *
 * Authorization stays on the server: `intended_role` is a request, not a
 * grant. The app routes to CoachNavigator only when the returned
 * `user.role` is 'coach'.
 */
export type IntendedRole = 'client' | 'coach';

export const COACH_SIGNUP_UNAVAILABLE = 'coach_signup_unavailable' as const;
/**
 * A coach signup reached the server but no answer proves what happened
 * (5xx, network error, timeout, or a response without a `role`). The account
 * may or may not exist; the app must not say either way.
 */
export const COACH_SIGNUP_UNCONFIRMED = 'coach_signup_unconfirmed' as const;

/** Thrown when a coach signup cannot be honoured; no account was created. */
export class CoachSignupUnavailableError extends Error {
  readonly code = COACH_SIGNUP_UNAVAILABLE;
  constructor(message = 'Coach sign-up is not available right now.') {
    super(message);
    this.name = 'CoachSignupUnavailableError';
  }
}

export function isCoachSignupUnavailable(err: unknown): boolean {
  return (
    err instanceof CoachSignupUnavailableError ||
    (err as { code?: unknown } | null)?.code === COACH_SIGNUP_UNAVAILABLE
  );
}

export function isUnknownIntendedRoleError(err: unknown): boolean {
  const r = (err as { response?: { status?: number; data?: { message?: unknown } } } | null)?.response;
  if (!r || r.status !== 400) return false;
  const m = r.data?.message;
  const parts = Array.isArray(m) ? m : typeof m === 'string' ? [m] : [];
  // Only the ValidationPipe's unknown-field refusal (`forbidNonWhitelisted`),
  // which runs before any handler. Any other 400 that merely mentions the
  // field is a business error and says nothing about whether an account
  // exists, so it is not treated as "no account was created".
  return parts.some(
    (p) => typeof p === 'string' && /^property intended_role should not exist$/.test(p.trim()),
  );
}

export async function postWithIntendedRole<B extends object, R>(
  post: (body: B & { intended_role?: IntendedRole }) => Promise<R>,
  body: B,
  intendedRole?: IntendedRole,
): Promise<R> {
  if (!intendedRole) return post(body);
  try {
    return await post({ ...body, intended_role: intendedRole });
  } catch (err) {
    if (!isUnknownIntendedRoleError(err)) throw err;
    // The pipe rejected the body before any handler ran: nothing was created.
    if (intendedRole === 'coach') throw new CoachSignupUnavailableError();
    return post(body);
  }
}

/**
 * Role the app sends. Undefined (field omitted) unless the policy advertises
 * role choice and no invite code is involved.
 */
export function intendedRoleForRequest(
  roleChoiceEnabled: boolean,
  chosen: IntendedRole,
  hasInviteCode: boolean,
): IntendedRole | undefined {
  if (!roleChoiceEnabled || hasInviteCode) return undefined;
  return chosen;
}

/**
 * What a failed coach signup request proves (#306 fix round 3).
 *  - 'refused': the server answered with a refusal that runs before or
 *    instead of account creation (the unknown-field refusal, or a 4xx such as
 *    validation, conflict or rate limit). This request created nothing.
 *  - 'unconfirmed': no answer, a timeout or a 5xx. The server may have
 *    committed before the response was lost, so the app must not say either way.
 */
export type CoachSignupFailure = 'refused' | 'unconfirmed';

export function classifyCoachSignupFailure(err: unknown): CoachSignupFailure {
  if (isCoachSignupUnavailable(err)) return 'refused';
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408) return 'refused';
  return 'unconfirmed';
}

/** HTTP status of an API error, if the server answered. */
export function errorStatus(err: unknown): number | undefined {
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

/** Server-confirmed role for routing. Only 'coach' changes the destination. */
export function isServerCoach(user: { role?: unknown } | null | undefined): boolean {
  return user?.role === 'coach';
}

/** Copy for the CreateAccount error box when a coach signup was refused. */
export const COACH_SIGNUP_UNAVAILABLE_MESSAGE =
  'Coach sign-up is not available right now. No account was created. You can try again later, or choose "I\'m here to train" to create a client account.';


/**
 * Copy for the CreateAccount error box when a coach signup reached the
 * server but its outcome is not proven. Deliberately does not say whether an
 * account exists.
 */
export const COACH_SIGNUP_UNCONFIRMED_MESSAGE =
  'Your coach account could not be confirmed, so you are not signed in. An account may or may not have been created. Try again with the same sign-in; if the account exists, you will be signed in to it.';

/**
 * Email retry after an unconfirmed coach attempt answered "this email is
 * already registered": the earlier attempt may have created that account.
 */
export const COACH_SIGNUP_RETRY_EMAIL_EXISTS_MESSAGE =
  'An account with this email already exists. Your earlier coach sign-up may have created it. Sign in with this email to continue. If it is a client account, contact support to set up coach access.';
