import * as fs from 'fs';
import * as path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { cancelFastEndAlert, fastingNotifIdKey } from '../fastingAlert';

// Settings > Fasting alerts switched off cancels the alert the Fasting screen
// already set for the running fast (CF-SETTINGS-128).
describe('cancelFastEndAlert', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it("cancels only this account's saved alert and forgets its id", async () => {
    await AsyncStorage.setItem(fastingNotifIdKey('client-a'), 'alert-a');
    await AsyncStorage.setItem(fastingNotifIdKey('client-b'), 'alert-b');
    await cancelFastEndAlert('client-a');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('alert-a');
    expect(await AsyncStorage.getItem(fastingNotifIdKey('client-a'))).toBeNull();
    expect(await AsyncStorage.getItem(fastingNotifIdKey('client-b'))).toBe('alert-b');
  });

  it('does nothing when no alert is saved for this account', async () => {
    await cancelFastEndAlert('client-a');
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('settles quietly when the phone refuses the cancel', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockRejectedValueOnce(new Error('denied'));
    await AsyncStorage.setItem(fastingNotifIdKey('client-a'), 'alert-a');
    await expect(cancelFastEndAlert('client-a')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('uses the key the Fasting screen saves the alert id under', () => {
    expect(fastingNotifIdKey('client-a')).toBe('fasting:scheduled_notification_id:client-a');
    const fasting = fs.readFileSync(path.join(__dirname, '../../screens/client/FastingScreen.tsx'), 'utf8');
    // The screen either builds the same key itself or imports this one.
    expect(fasting.includes('`fasting:scheduled_notification_id:${userId}`')
      || fasting.includes("from '../../utils/fastingAlert'")).toBe(true);
  });
});
