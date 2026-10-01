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
  const text = Array.isArray(m) ? m.join(' ') : typeof m === 'string' ? m : '';
  return /intended_role/.test(text);
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

/** Server-confirmed role for routing. Only 'coach' changes the destination. */
export function isServerCoach(user: { role?: unknown } | null | undefined): boolean {
  return user?.role === 'coach';
}

/** Copy for the CreateAccount error box when a coach signup was refused. */
export const COACH_SIGNUP_UNAVAILABLE_MESSAGE =
  'Coach sign-up is not available right now. No account was created. You can try again later, or choose "I\'m here to train" to create a client account.';
