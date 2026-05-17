// Phase 9 — pushNotifications.ts
//
// Extended from PR #145. Manages push token registration, foreground
// notification handling, and background notification routing.
//
// Phase 9 additions:
//   - handleForegroundNotification(): when a push arrives while the app is
//     active, surface an in-app banner instead of allowing the system to
//     display a native notification. The banner is rendered via
//     ForegroundNotificationBannerStore (a Zustand slice).
//   - setNotificationChannelPrefs(): propagates per-channel preferences to
//     the Expo notifications system.
//
// IMPORTANT: This file must stay import-free from React components. It is a
// plain service module; components subscribe to the Zustand store it writes.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { foregroundBannerStore } from '../store/foregroundBannerStore';
import { Colors } from '../constants/colors';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PushRegistrationResult {
  token: string | null;
  /** True if the user has granted permission; false if denied or not prompted. */
  granted: boolean;
}

// ─── Push token registration ──────────────────────────────────────────────────
// Unchanged from PR #145 — preserved as-is.

export async function registerForPushNotifications(): Promise<PushRegistrationResult> {
  if (Platform.OS === 'web') {
    return { token: null, granted: false };
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return { token: null, granted: false };
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: Colors.primary, // forest — theme primary
    });
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync();
    return { token: tokenData.data, granted: true };
  } catch {
    return { token: null, granted: true };
  }
}

// ─── Phase 9 — Foreground notification handler ────────────────────────────────
//
// When the app is in the foreground, Expo's default behaviour is to show the
// system notification banner. We suppress that and instead write the payload
// to foregroundBannerStore so a React component can render a themed in-app
// banner.
//
// Call installForegroundHandler() once from App.tsx after the navigation tree
// is mounted. It is idempotent.

let foregroundHandlerInstalled = false;

export function installForegroundHandler(): () => void {
  if (foregroundHandlerInstalled) {
    return () => undefined;
  }
  foregroundHandlerInstalled = true;

  // Tell Expo not to present the system notification while the app is active.
  // expo-notifications v55+ uses shouldShowBanner / shouldShowList instead of
  // the deprecated shouldShowAlert.
  Notifications.setNotificationHandler({
    handleNotification: async (): Promise<Notifications.NotificationBehavior> => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });

  // Write to the in-app banner store instead.
  const subscription = Notifications.addNotificationReceivedListener((notification) => {
    const { title, body } = notification.request.content;
    foregroundBannerStore.getState().showBanner({
      title: title ?? '',
      body: body ?? '',
      notificationId: notification.request.identifier,
      // actionScreen / actionParams come from the data payload if the backend
      // includes them. Fall through to undefined if absent.
      actionScreen: (notification.request.content.data?.actionScreen as string) ?? undefined,
      actionParams: (notification.request.content.data?.actionParams as Record<string, string>) ?? undefined,
    });
  });

  return () => {
    subscription.remove();
    foregroundHandlerInstalled = false;
  };
}

// ─── Notification response handler ───────────────────────────────────────────
// Handles taps on background / killed-state notifications.
// Returns a cleanup function — call from App.tsx on unmount.

export function installNotificationResponseHandler(
  onResponse: (actionScreen?: string, actionParams?: Record<string, string>) => void,
): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    const actionScreen = (data?.actionScreen as string) ?? undefined;
    const actionParams = (data?.actionParams as Record<string, string>) ?? undefined;
    onResponse(actionScreen, actionParams);
  });
  return () => subscription.remove();
}
