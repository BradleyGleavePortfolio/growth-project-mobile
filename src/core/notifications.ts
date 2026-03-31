import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Configure how notifications are handled when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#2D6A4F',
      });
      await Notifications.setNotificationChannelAsync('water', {
        name: 'Water Reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 100],
        lightColor: '#52B788',
      });
      await Notifications.setNotificationChannelAsync('fasting', {
        name: 'Fasting Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#2D6A4F',
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
    await Notifications.cancelAllScheduledNotificationsAsync();
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: '💧 Time to Hydrate!',
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
    return id;
  } catch (err) {
    return null;
  }
}

export async function scheduleFastingAlert(fastEndTime: Date): Promise<string | null> {
  try {
    const now = new Date();
    if (fastEndTime <= now) return null;

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: '🎉 Fast Complete!',
        body: 'You\'ve reached your fasting goal! Great job staying committed to your health journey.',
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
        title: '🍽️ You Have Calories Remaining',
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
        title: '💪 The Growth Project',
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
  } catch (err) {
  }
}
