/**
 * The local "Fasting window ended" alert for a client's current fast. Both
 * start paths (the Fasting screen and Shortcuts) schedule it with
 * scheduleFastEndAlert, which saves the alert's id under fastingNotifIdKey;
 * scheduleFastingAlert (utils/notifications.ts) schedules nothing while
 * Settings > Fasting alerts is off. Cancelling it here is how ending or
 * removing the fast, or switching Fasting alerts off, stops the alert for a
 * fast that is already running.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { scheduleFastingAlert } from './notifications';

// User-scoped per R15: a shared device must not let user A's scheduled alert
// id be cancelled by user B's session, nor leak across users on logout/login.
export const fastingNotifIdKey = (userId: string) =>
  `fasting:scheduled_notification_id:${userId}`;

export async function scheduleFastEndAlert(userId: string, targetHours: number): Promise<void> {
  const notifId = await scheduleFastingAlert(new Date(Date.now() + targetHours * 60 * 60 * 1000));
  if (!notifId) return;
  try {
    await AsyncStorage.setItem(fastingNotifIdKey(userId), notifId);
  } catch (err) {
    // Best effort: the worst case is one alert at the planned end time.
    console.warn('fastingAlert: failed to persist notification id', err);
  }
}

export async function cancelFastEndAlert(userId: string): Promise<void> {
  try {
    const key = fastingNotifIdKey(userId);
    const notifId = await AsyncStorage.getItem(key);
    if (notifId) {
      await Notifications.cancelScheduledNotificationAsync(notifId);
      await AsyncStorage.removeItem(key);
    }
  } catch (err) {
    // Cancellation is best effort; an orphan alert is annoying, not broken.
    console.warn('fastingAlert: failed to cancel scheduled notification', err);
  }
}
