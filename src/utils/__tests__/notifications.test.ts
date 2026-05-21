// Hunt P0-4 / P3-2 regression tests.
//
// 1. Loading `utils/notifications` must NOT call setNotificationHandler at
//    module load — the foreground handler is owned exclusively by
//    `services/pushNotifications.installForegroundHandler`.
// 2. scheduleWaterReminder cancels only previously scheduled water IDs, not
//    every scheduled notification (which would nuke coach session reminders).

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DATE: 'date' },
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2 },
}));

import * as Notifications from 'expo-notifications';

describe('utils/notifications — Hunt P0-4 / P3-2', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does NOT register a foreground handler at module load (P0-4)', () => {
    jest.isolateModules(() => {
      require('../notifications');
    });
    expect(Notifications.setNotificationHandler).not.toHaveBeenCalled();
  });

  it('scheduleWaterReminder cancels only previously scheduled water IDs (P3-2)', async () => {
    (Notifications.scheduleNotificationAsync as jest.Mock)
      .mockResolvedValueOnce('water-id-1')
      .mockResolvedValueOnce('water-id-2');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { scheduleWaterReminder } = require('../notifications');

    const first = await scheduleWaterReminder(2);
    expect(first).toBe('water-id-1');
    // First call: nothing to cancel yet — must NOT use cancelAll.
    expect(Notifications.cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();

    const second = await scheduleWaterReminder(3);
    expect(second).toBe('water-id-2');
    // Second call: cancels only the prior water ID — not cancelAll.
    expect(Notifications.cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('water-id-1');
  });
});
