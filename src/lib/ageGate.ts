/**
 * AGEGATE16 (owner ruling #C8-UNDER18-B, 2026-10-14: "16+ gets treated like
 * any other client - if they dont agree theyre over 16 they dont get in the
 * app"). A client confirms 16 or older with the date of birth on their
 * profile: the consultation's B2 answer, or the same question asked once by
 * AgeCheckScreen for a client who reached the app without one. The server
 * refuses client routes with 403 AGE_CONFIRMATION_REQUIRED until then
 * (backend JwtAuthGuard), and services/api reports that refusal here so
 * RootNavigator can open the age step. No other age data is kept.
 */
import { screenById } from './consultation/definitions';

export const AGE_CONFIRMATION_REQUIRED = 'AGE_CONFIRMATION_REQUIRED';

/** The consultation's own B2 minimum, so the app and the question agree. */
export const MIN_CLIENT_AGE = screenById('B2')?.validation?.ageRange?.min ?? 16;

/**
 * True when a stored date of birth (YYYY-MM-DD...) shows MIN_CLIENT_AGE or
 * older on `now`, in whole UTC years: the same arithmetic as the server, so
 * the app never opens what the server refuses.
 */
export function confirmsMinClientAge(dob: unknown, now: Date = new Date()): boolean {
  const m = typeof dob === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(dob) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const month = now.getUTCMonth() + 1;
  const age = now.getUTCFullYear() - y - (month < mo || (month === mo && now.getUTCDate() < d) ? 1 : 0);
  return age >= MIN_CLIENT_AGE;
}

type CachedProfile = { date_of_birth?: unknown; dob?: unknown } | null | undefined;

/**
 * May this client enter the app? Yes when the cached profile already shows
 * 16 or older. Otherwise the server's profile decides once (and the date is
 * cached so it is not asked again). No answer from the server opens the app
 * as before: the server still refuses client routes, which brings the age
 * step back through reportAgeConfirmationRequired.
 */
export async function clientAgeConfirmed(
  profile: CachedProfile,
  readMe: () => Promise<{ data?: unknown }>,
  saveDob: (dob: string) => Promise<void>,
): Promise<boolean> {
  if (confirmsMinClientAge(profile?.date_of_birth) || confirmsMinClientAge(profile?.dob)) return true;
  let data: unknown;
  try {
    data = (await readMe())?.data;
  } catch {
    return true;
  }
  if (!data || typeof data !== 'object' || !('profile' in data)) return true;
  const dob = (data as { profile?: { date_of_birth?: unknown } | null }).profile?.date_of_birth;
  if (!confirmsMinClientAge(dob)) return false;
  try {
    await saveDob(String(dob));
  } catch {
    // The server check simply runs again on the next open.
  }
  return true;
}

const listeners = new Set<() => void>();

/** RootNavigator listens; returns the unsubscribe. */
export function onAgeConfirmationRequired(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** services/api calls this on a 403 AGE_CONFIRMATION_REQUIRED. */
export function reportAgeConfirmationRequired(): void {
  for (const listener of [...listeners]) listener();
}
