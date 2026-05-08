// Sessions-specific feature flags.
//
// Kept in its own module (not src/config/featureFlags.ts) to avoid merge
// conflicts with parallel work on bloodwork (#103) and wave-11 (#100) that
// also touch the central flags file. When those land we can fold these in.
//
// All flags default OFF. Flip via EXPO_PUBLIC_* build env; do not enable
// in runtime config without a backend scheduling stack deployed — the
// shells will render feature-disabled placeholders otherwise.

function envFlag(name: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (process.env as any)[name];
  if (typeof raw !== 'string') return false;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export const sessionsFlags = {
  // Master switch — shells render calm placeholder when false.
  SESSIONS_ENABLED: envFlag('EXPO_PUBLIC_SESSIONS_ENABLED'),
  // Client can request a session window. Safe to enable without provider
  // OAuth — requests queue for coach review.
  SESSIONS_CLIENT_REQUESTS_ENABLED: envFlag(
    'EXPO_PUBLIC_SESSIONS_CLIENT_REQUESTS_ENABLED',
  ),
  // Coach availability editor. Requires backend availability endpoints.
  SESSIONS_COACH_AVAILABILITY_ENABLED: envFlag(
    'EXPO_PUBLIC_SESSIONS_COACH_AVAILABILITY_ENABLED',
  ),
  // Video provider join URL display. OFF means we show "link coming from
  // your coach" rather than ever fabricating or guessing one.
  SESSIONS_VIDEO_PROVIDER_ENABLED: envFlag(
    'EXPO_PUBLIC_SESSIONS_VIDEO_PROVIDER_ENABLED',
  ),
  // Pre-session prep prompts.
  SESSIONS_PREP_ENABLED: envFlag('EXPO_PUBLIC_SESSIONS_PREP_ENABLED'),
  // Coach-facing brief surface.
  SESSIONS_BRIEF_ENABLED: envFlag('EXPO_PUBLIC_SESSIONS_BRIEF_ENABLED'),
};

export type SessionsFlag = keyof typeof sessionsFlags;

export function isSessionsFeatureEnabled(flag: SessionsFlag): boolean {
  // Master switch gates everything; sub-flags must ALSO be on.
  if (!sessionsFlags.SESSIONS_ENABLED) return false;
  return sessionsFlags[flag];
}
