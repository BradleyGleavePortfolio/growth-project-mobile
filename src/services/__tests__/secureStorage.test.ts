// async-storage v3's bundled jest mock is a real in-memory impl, not jest.fn()
// spies. This file checks `(AsyncStorage.removeItem as jest.Mock).mock.calls`,
// so we override the global mock with stateful jest.fn() shims backed by a
// local Map. Pattern mirrors queryClient.persister.test.ts (owned by PR #200)
// plus the in-memory semantics the original test relied on.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
      setItem: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      removeItem: jest.fn(async (k: string) => {
        store.delete(k);
      }),
      clear: jest.fn(async () => {
        store.clear();
      }),
      getAllKeys: jest.fn(async () => Array.from(store.keys())),
      removeMany: jest.fn(async (keys: string[]) => {
        for (const k of keys) store.delete(k);
      }),
    },
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { secureStorage, __resetSecureStorageForTests } from '../secureStorage';

describe('secureStorage adapter', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    // Reset in-memory SecureStore mock.
    (SecureStore as { __store?: { clear?: () => void } }).__store?.clear?.();
    __resetSecureStorageForTests();
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

  // P1-4: cold-start parallel reads used to race on
  // SecureStore.setItemAsync + AsyncStorage.removeItem. With the single-flight
  // migration in place, 10 parallel getItem calls for the same key must
  // execute the legacy copy exactly once and return identical values.
  it('single-flights the migration when N parallel getItem calls race on the same key', async () => {
    await AsyncStorage.setItem('supabase_token', 'legacy-cold-start');
    // SecureStore must not contain it yet — verify the fixture.
    expect(await SecureStore.getItemAsync('supabase_token')).toBeNull();

    // Fan out 10 parallel reads — all racing into the migration path.
    const reads = await Promise.all(
      Array.from({ length: 10 }, () => secureStorage.getItem('supabase_token')),
    );

    // Every caller got the same value.
    expect(reads).toEqual(Array.from({ length: 10 }, () => 'legacy-cold-start'));
    // The legacy copy was written into SecureStore exactly once, even though
    // 10 callers entered the migration path.
    const setCalls = (SecureStore.setItemAsync as jest.Mock).mock.calls.filter(
      (c) => c[0] === 'supabase_token',
    );
    expect(setCalls).toHaveLength(1);
    // And AsyncStorage was cleared exactly once.
    const removeCalls = (AsyncStorage.removeItem as jest.Mock).mock.calls.filter(
      (c) => c[0] === 'supabase_token',
    );
    expect(removeCalls).toHaveLength(1);
    // Final state: SecureStore has the value, AsyncStorage doesn't — no
    // window where a parallel reader could have seen "cleared AsyncStorage
    // and not-yet-written SecureStore".
    expect(await SecureStore.getItemAsync('supabase_token')).toBe('legacy-cold-start');
    expect(await AsyncStorage.getItem('supabase_token')).toBeNull();
  });
});
