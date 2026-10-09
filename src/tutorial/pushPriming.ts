/**
 * pushPriming — the single push ask after the tour (prototype 61-62).
 *
 * After "Got it" on the completion card, the overlay shows one priming card
 * only when the OS can still ask and this account has not answered the Home
 * push card before. Only "Turn on notifications" fires the OS dialog; "Not
 * now" goes straight to Home. Either answer is stored under the same per-user
 * key as Home's PushPermissionCard, so the client is asked once, not twice.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { registerForPushNotifications } from '../services/pushNotifications';
import { usersApi } from '../services/api';
import { prefsStorage } from '../storage/mmkv';
import { pushPrimerDismissedKey } from '../components/home/PushPermissionCard';
import { logger } from '../utils/logger';

export async function shouldOfferPushPriming(userId: string | null): Promise<boolean> {
  if (!userId || Platform.OS === 'web') return false;
  try {
    if (await prefsStorage.getStringAsync(pushPrimerDismissedKey(userId))) return false;
    const perm = await Notifications.getPermissionsAsync();
    return perm.status !== 'granted' && perm.canAskAgain !== false;
  } catch (e) {
    // No card when the OS cannot be read; Home's own card covers it later.
    logger.warn('pushPriming.offer', e);
    return false;
  }
}

/** Record the answer; with a yes, show the OS dialog and register the token. */
export async function answerPushPriming(userId: string | null, accept: boolean): Promise<void> {
  if (!userId) return;
  try {
    if (accept) {
      const result = await registerForPushNotifications({ requestPermission: true });
      if (result.token) await usersApi.updatePushToken(result.token);
    }
  } catch (e) {
    // The card closes either way, so the client is never nagged.
    logger.warn('pushPriming.register', e);
  }
  try {
    await prefsStorage.set(pushPrimerDismissedKey(userId), 'true');
  } catch (e) {
    logger.warn('pushPriming.remember', e);
  }
}
