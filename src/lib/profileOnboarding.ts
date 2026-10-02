/**
 * Whether the server says this student has finished onboarding.
 *
 * The backend field is `UserProfile.onboardingCompleted` (camelCase, see the
 * backend `prisma/schema.prisma`). `GET /profile` and `GET /auth/me` return
 * the profile row as it is stored, so the key on the wire is
 * `onboardingCompleted`. `PUT /profile` accepts both `onboardingCompleted`
 * and the older `onboarding_completed` (backend #606) and stores either one
 * in the same column.
 *
 * The app used to read only `onboarding_completed`, which the server never
 * sends. On a fresh install, or after signing in on a new phone, a student
 * who had already finished onboarding was sent through it again.
 * `onboarding_completed` is still read so older cached payloads and
 * fixtures keep working.
 */
export const BACKEND_ONBOARDING_FIELD = "onboardingCompleted" as const;

export interface ProfileOnboardingFlags {
  onboardingCompleted?: boolean | null;
  onboarding_completed?: boolean | null;
}

export function profileOnboardingCompleted(
  profile: ProfileOnboardingFlags | null | undefined,
): boolean {
  if (!profile) return false;
  return (
    profile.onboardingCompleted === true ||
    profile.onboarding_completed === true
  );
}
