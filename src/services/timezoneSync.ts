// C05 item 7 — keep the backend's copy of the device timezone current.
//
// Workout reminders go out at the client's preferred training time in their
// own timezone (backend NotificationPreferences.timezone). This sends the
// device IANA zone once per change (cached locally), best-effort: a failure
// never blocks boot and is retried on the next auth change / cold start.

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

/** Returns true when a PATCH was sent and accepted. */
export async function syncDeviceTimezone(): Promise<boolean> {
  const tz = deviceTimezone();
  if (!tz) return false;
  let last: string | null = null;
  try {
    last = await AsyncStorage.getItem(TIMEZONE_SYNC_KEY);
  } catch {
    last = null;
  }
  if (last === tz) return false;
  await notificationsApi.updatePreferences({ timezone: tz });
  try {
    await AsyncStorage.setItem(TIMEZONE_SYNC_KEY, tz);
  } catch {
    // Non-fatal: we simply sync again next time.
  }
  return true;
}
