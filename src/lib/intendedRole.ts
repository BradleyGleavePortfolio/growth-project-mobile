/**
 * Signup role choice ("I'm here to train" / "I coach clients").
 *
 * The choice is sent to the backend as `intended_role: 'client' | 'coach'`
 * on /auth/register, /auth/signup-with-code (always 'client'), /auth/apple
 * and /auth/google. The backend slice that reads it (C13) is being built in
 * parallel. Today's backend runs a `forbidNonWhitelisted` ValidationPipe, so
 * it answers 400 "property intended_role should not exist". In that case
 * the request is retried once WITHOUT the field. The pipe rejects before any
 * handler runs, so the retry cannot double-create an account. The app then
 * falls back to the existing RoleSelection step.
 *
 * Users who arrive with an invite / QR code are always clients and never see
 * the choice.
 *
 * Authorization stays on the server: `intended_role` is a request, not a
 * grant. The app routes to CoachNavigator only when the returned
 * `user.role` is 'coach'.
 */
export type IntendedRole = 'client' | 'coach';

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
    if (isUnknownIntendedRoleError(err)) return post(body);
    throw err;
  }
}

/** Server-confirmed role for routing. Only 'coach' changes the destination. */
export function isServerCoach(user: { role?: unknown } | null | undefined): boolean {
  return user?.role === 'coach';
}
