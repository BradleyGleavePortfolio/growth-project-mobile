/**
 * Coach signup attempts whose outcome was never proven (#306 fix round 3).
 *
 * A coach signup can reach the server and commit while its response is lost
 * (network drop, timeout, 5xx after commit). The app then says the outcome is
 * unconfirmed and that a retry with the same sign-in is safe. When the retry
 * answers "existing account, not a coach", that account may well be the one
 * the lost attempt created (for example the kill switch made it a client), so
 * "this account already existed" would be untrue. This marker lets the retry
 * say "coach sign-up was not applied" instead.
 *
 * Scope: one marker, bound to the sign-in method (and the email for email
 * signups) and short-lived, so a later person on a shared device does not
 * inherit it. Cleared once any coach attempt gets a server answer, and on
 * sign-out (services/authActions).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const COACH_SIGNUP_UNCONFIRMED_KEY = 'signup_coach_unconfirmed';
export const COACH_SIGNUP_UNCONFIRMED_TTL_MS = 30 * 60 * 1000;

export type CoachSignupMethod = 'email' | 'apple' | 'google';

interface Marker {
  method: CoachSignupMethod;
  email?: string;
  at: number;
}

function normaliseEmail(email: string | undefined): string | undefined {
  const e = email?.trim().toLowerCase();
  return e ? e : undefined;
}

export async function rememberUnconfirmedCoachSignup(
  method: CoachSignupMethod,
  email?: string,
  now: number = Date.now(),
): Promise<void> {
  const marker: Marker = { method, at: now, ...(method === 'email' ? { email: normaliseEmail(email) } : {}) };
  try {
    await AsyncStorage.setItem(COACH_SIGNUP_UNCONFIRMED_KEY, JSON.stringify(marker));
  } catch {
    // Best effort: without the marker the retry falls back to the generic notice.
  }
}

/** True when an unconfirmed coach attempt with the same method (and email) is recent. */
export async function hasUnconfirmedCoachSignup(
  method: CoachSignupMethod,
  email?: string,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(COACH_SIGNUP_UNCONFIRMED_KEY);
    if (!raw) return false;
    const m = JSON.parse(raw) as Partial<Marker>;
    if (m.method !== method || typeof m.at !== 'number') return false;
    if (now - m.at > COACH_SIGNUP_UNCONFIRMED_TTL_MS || now < m.at) return false;
    if (method === 'email' && m.email !== normaliseEmail(email)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function clearUnconfirmedCoachSignup(): Promise<void> {
  try {
    await AsyncStorage.removeItem(COACH_SIGNUP_UNCONFIRMED_KEY);
  } catch {
    // ignore
  }
}
