import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { secureStorage } from '../secureStorage';

describe('secureStorage adapter', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    // Reset in-memory SecureStore mock.
    (SecureStore as any).__store?.clear?.();
    jest.clearAllMocks();
  });

  it('stores values via SecureStore on native', async () => {
    await secureStorage.setItem('supabase_token', 'abc');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('supabase_token', 'abc');
    const read = await secureStorage.getItem('supabase_token');
    expect(read).toBe('abc');
  });

  it('migrates a token from legacy AsyncStorage into SecureStore on first read', async () => {
    await AsyncStorage.setItem('supabase_token', 'legacy-token');

    const value = await secureStorage.getItem('supabase_token');

    expect(value).toBe('legacy-token');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('supabase_token', 'legacy-token');
    // Legacy copy is removed so a later read doesn't resurrect it.
    expect(await AsyncStorage.getItem('supabase_token')).toBeNull();

    // Second read should NOT re-migrate — it already lives in SecureStore.
    (SecureStore.setItemAsync as jest.Mock).mockClear();
    const second = await secureStorage.getItem('supabase_token');
    expect(second).toBe('legacy-token');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('removeItem clears both SecureStore and any leftover AsyncStorage copy', async () => {
    await AsyncStorage.setItem('supabase_token', 'stale-legacy');
    await secureStorage.setItem('supabase_token', 'fresh');

    await secureStorage.removeItem('supabase_token');

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('supabase_token');
    expect(await AsyncStorage.getItem('supabase_token')).toBeNull();
  });
});
