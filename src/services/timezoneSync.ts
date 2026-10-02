// C05 item 7 — keep the backend's copy of the device timezone current.
//
// Workout reminders go out at the client's preferred training time in their
// own timezone (backend NotificationPreferences.timezone). This sends the
// device IANA zone once per change and per signed-in account (cached
// locally), best-effort: a failure never blocks boot and is retried on the
// next auth change / cold start.
//
// The cache stamp is "<account>|<zone>", so a second account signing in on
// the same device always syncs its own row. When the account cannot be read
// from the session token, the zone is sent every time and nothing is cached.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { notificationsApi } from './api';

export const TIMEZONE_SYNC_KEY = 'gp_synced_timezone';

export function deviceTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.length > 0 && tz.length <= 64 ? tz : null;
  } catch {
    return null;
  }
}

/**
 * The `sub` of the session token (unverified decode, used only to scope the
 * local cache to the signed-in account; the server verifies the token).
 */
export function sessionSubject(token: string | null | undefined): string | null {
  if (typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const decode = (globalThis as { atob?: (s: string) => string }).atob;
    if (typeof decode !== 'function') return null;
    const payload: unknown = JSON.parse(decode(padded));
    if (!payload || typeof payload !== 'object') return null;
    const sub = (payload as { sub?: unknown }).sub;
    return typeof sub === 'string' && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}

/** Returns true when a PATCH was sent and accepted. */
export async function syncDeviceTimezone(sessionToken?: string | null): Promise<boolean> {
  const tz = deviceTimezone();
  if (!tz) return false;
  const account = sessionSubject(sessionToken);
  const stamp = account ? `${account}|${tz}` : null;
  if (stamp) {
    let last: string | null = null;
    try {
      last = await AsyncStorage.getItem(TIMEZONE_SYNC_KEY);
    } catch {
      last = null;
    }
    if (last === stamp) return false;
  }
  await notificationsApi.updatePreferences({ timezone: tz });
  if (stamp) {
    try {
      await AsyncStorage.setItem(TIMEZONE_SYNC_KEY, stamp);
    } catch {
      // Non-fatal: we simply sync again next time.
    }
  }
  return true;
}
