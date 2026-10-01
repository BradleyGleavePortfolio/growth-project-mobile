import AsyncStorage from '@react-native-async-storage/async-storage';
import { deviceTimezone, syncDeviceTimezone, TIMEZONE_SYNC_KEY } from '../timezoneSync';
import { notificationsApi } from '../api';

// C05 item 7 — workout reminders use the client's local timezone, so the
// device IANA zone is synced to the backend once per change.

jest.mock('../api', () => ({
  notificationsApi: { updatePreferences: jest.fn() },
}));

const mockUpdate = notificationsApi.updatePreferences as jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('timezoneSync', () => {
  it('reads an IANA zone from the device', () => {
    const tz = deviceTimezone();
    expect(typeof tz).toBe('string');
    expect((tz ?? '').length).toBeGreaterThan(0);
  });

  it('sends the zone once, then only when it changes', async () => {
    mockUpdate.mockResolvedValue({ data: {} });
    const tz = deviceTimezone();
    expect(await syncDeviceTimezone()).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith({ timezone: tz });
    expect(await AsyncStorage.getItem(TIMEZONE_SYNC_KEY)).toBe(tz);
    expect(await syncDeviceTimezone()).toBe(false);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    await AsyncStorage.setItem(TIMEZONE_SYNC_KEY, 'Pacific/Chatham');
    expect(await syncDeviceTimezone()).toBe(true);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed sync, so it retries next time', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('offline'));
    await expect(syncDeviceTimezone()).rejects.toThrow('offline');
    expect(await AsyncStorage.getItem(TIMEZONE_SYNC_KEY)).toBeNull();
  });
});
