import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { Colors } from '../constants/colors';

// NOTE: foreground notification behavior is owned exclusively by
// installForegroundHandler() in src/services/pushNotifications.ts, which
// App.tsx calls once during initApp. Do NOT register a module-load
// setNotificationHandler here — that previously raced with the service
// module and silently won, killing the in-app banner store. (Hunt P0-4)

// Module-local set of scheduled water-reminder IDs. scheduleWaterReminder
// cancels only IDs it owns so coach session reminders (T-24h/T-1h/T-10m)
// scheduled elsewhere are not nuked. (Hunt P3-2)
const scheduledWaterIds = new Set<string>();

export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: Colors.primary,
      });
      await Notifications.setNotificationChannelAsync('water', {
        name: 'Water Reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 100],
        lightColor: Colors.primaryLight,
      });
      await Notifications.setNotificationChannelAsync('fasting', {
        name: 'Fasting Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: Colors.primary,
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    return finalStatus === 'granted';
  } catch (err) {
    return false;
  }
}

export async function scheduleWaterReminder(intervalHours = 2): Promise<string | null> {
  try {
    // Cancel ONLY previously scheduled water reminders — not coach session
    // reminders or fasting alerts.
    for (const id of scheduledWaterIds) {
      try {
        await Notifications.cancelScheduledNotificationAsync(id);
      } catch {
        // Already fired or removed by the OS — fine to ignore.
      }
    }
    scheduledWaterIds.clear();

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Time to Hydrate',
        body: 'Stay on track with your water goals. Drink a glass of water now.',
        sound: true,
        data: { type: 'water_reminder' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: intervalHours * 60 * 60,
        repeats: true,
      },
    });
    scheduledWaterIds.add(id);
    return id;
  } catch (err) {
    return null;
  }
}

export async function cancelWaterReminders(): Promise<void> {
  for (const id of scheduledWaterIds) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // ignore
    }
  }
  scheduledWaterIds.clear();
}

export async function scheduleFastingAlert(fastEndTime: Date): Promise<string | null> {
  try {
    const now = new Date();
    if (fastEndTime <= now) return null;

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Fast Complete',
        body: 'Fasting goal reached.',
        sound: true,
        data: { type: 'fasting_complete' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fastEndTime,
      },
    });
    return id;
  } catch (err) {
    return null;
  }
}

export async function sendCalorieReminderNotification(
  remaining: number,
  snacks: string[]
): Promise<string | null> {
  try {
    const snackSuggestion =
      snacks.length > 0
        ? `Try: ${snacks.slice(0, 2).join(' or ')}`
        : 'Consider a protein snack to hit your goals.';

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'You Have Calories Remaining',
        body: `${remaining} kcal left for today. ${snackSuggestion}`,
        sound: true,
        data: { type: 'calorie_reminder', remaining },
      },
      trigger: null,
    });
    return id;
  } catch (err) {
    return null;
  }
}

export async function sendMotivationNotification(message: string): Promise<string | null> {
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'The Growth Project',
        body: message,
        sound: true,
        data: { type: 'motivation' },
      },
      trigger: null,
    });
    return id;
  } catch (err) {
    return null;
  }
}

export async function cancelAllNotifications(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    scheduledWaterIds.clear();
  } catch (err) {
    // Not user-facing — failing to cancel notifications shouldn't break
    // sign-out or any flow that calls this; surface via console for telemetry.
    console.error('notifications: cancelAllNotifications failed', err);
  }
}
