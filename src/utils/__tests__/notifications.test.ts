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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSettings } from '../../hooks/useSettings';

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

// CF-SETTINGS-128: Settings > Fasting alerts is the switch for the end-of-fast
// alert. The real useSettings hook writes it; scheduleFastingAlert reads it.
describe('scheduleFastingAlert follows Settings > Fasting alerts', () => {
  const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);
  const savedFastingAlerts = async () =>
    JSON.parse((await AsyncStorage.getItem('gp_client_settings')) ?? '{}').fastingAlerts;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('schedules the alert when nothing is saved on this phone (on by default)', async () => {
    (Notifications.scheduleNotificationAsync as jest.Mock).mockResolvedValueOnce('fast-id-1');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { scheduleFastingAlert } = require('../notifications');
    await expect(scheduleFastingAlert(inAnHour())).resolves.toBe('fast-id-1');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('schedules nothing while the switch is off, and schedules again once it is back on', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { scheduleFastingAlert } = require('../notifications');
    const { result } = await renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { result.current.updateSetting('fastingAlerts', false); });
    await waitFor(async () => expect(await savedFastingAlerts()).toBe(false));
    await expect(scheduleFastingAlert(inAnHour())).resolves.toBeNull();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();

    (Notifications.scheduleNotificationAsync as jest.Mock).mockResolvedValueOnce('fast-id-2');
    await act(async () => { result.current.updateSetting('fastingAlerts', true); });
    await waitFor(async () => expect(await savedFastingAlerts()).toBe(true));
    await expect(scheduleFastingAlert(inAnHour())).resolves.toBe('fast-id-2');
  });
});
