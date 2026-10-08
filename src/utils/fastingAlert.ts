/**
 * The local "Fasting window ended" alert for a client's current fast. The
 * Fasting screen saves the scheduled alert's id under fastingNotifIdKey;
 * cancelling it here is how Settings > Fasting alerts (switched off) stops
 * the alert for a fast that is already running.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

// User-scoped per R15: a shared device must not let user A's scheduled alert
// id be cancelled by user B's session, nor leak across users on logout/login.
export const fastingNotifIdKey = (userId: string) =>
  `fasting:scheduled_notification_id:${userId}`;

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
