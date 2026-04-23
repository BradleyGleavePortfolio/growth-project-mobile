import AsyncStorage from '@react-native-async-storage/async-storage';
import { signOut, SIGN_OUT_KEYS } from '../authActions';
import { authEvents } from '../../utils/authEvents';

describe('signOut', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('clears all auth + session keys and fires logout event exactly once', async () => {
    for (const key of SIGN_OUT_KEYS) {
      await AsyncStorage.setItem(key, 'seed');
    }
    await AsyncStorage.setItem('unrelated_key', 'should-stay');

    const handler = jest.fn();
    authEvents.on('logout', handler);

    await signOut();

    for (const key of SIGN_OUT_KEYS) {
      expect(await AsyncStorage.getItem(key)).toBeNull();
    }
    expect(await AsyncStorage.getItem('unrelated_key')).toBe('should-stay');
    expect(handler).toHaveBeenCalledTimes(1);

    authEvents.off('logout', handler);
  });
});
