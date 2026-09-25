/**
 * useCurrentUser — REAL composition over lib/userCache + AsyncStorage shim
 * (S6 R3). Neither `lib/userCache` nor `storage/mmkv` is mocked; only the
 * AsyncStorage jest mock and Sentry are.
 *
 * Pins: the hook resolves a freshly written identity (R2: it never did on the
 * shim build), the logout event clears it, a hydration still in flight during
 * logout cannot resurrect the signed-out user, and an account switch shows
 * only the new account.
 */
import { act, renderHook, cleanup } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../services/sentry', () => ({ setSentryUser: jest.fn() }));

import { useCurrentUser } from '../useCurrentUser';
import { clearUserCache, setUserCache } from '../../lib/userCache';
import { authEvents } from '../../utils/authEvents';
import { setSentryUser } from '../../services/sentry';

const userA = { id: 'user-A', email: 'a@example.com' };
const userB = { id: 'user-B', email: 'b@example.com' };

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearUserCache();
  (setSentryUser as jest.Mock).mockClear();
  jest.restoreAllMocks();
});
afterEach(async () => {
  await cleanup();
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useCurrentUser — real identity composition', () => {
  it('is null on first render and resolves the identity written by a sign-in', async () => {
    await setUserCache(userA);
    let releaseRead: () => void = () => {
      throw new Error('Expected the user-cache read resolver to be initialized');
    };
    const readReleased = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let readHeld = false;
    const realGet = AsyncStorage.getItem.bind(AsyncStorage);
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key) => {
      if (key === 'prefs:auth.user_data' && !readHeld) {
        readHeld = true;
        await readReleased;
      }
      return realGet(key);
    });
    const { result } = await renderHook(() => useCurrentUser());
    expect(result.current).toBeNull();
    expect(readHeld).toBe(true);
    await act(async () => {
      releaseRead();
      await Promise.resolve();
    });
    await flush();
    expect(result.current).toEqual(userA);
    expect(setSentryUser).toHaveBeenLastCalledWith({ id: 'user-A', email: 'a@example.com' });
  });

  it('resolves the identity after a "restart" (value only on disk, mirror empty)', async () => {
    await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify(userA));
    const { result } = await renderHook(() => useCurrentUser());
    await flush();
    expect(result.current).toEqual(userA);
  });

  it('clears on logout and stays null afterwards', async () => {
    await setUserCache(userA);
    const { result } = await renderHook(() => useCurrentUser());
    await flush();
    expect(result.current).toEqual(userA);
    await act(async () => {
      await clearUserCache();
      authEvents.emit('logout');
    });
    expect(result.current).toBeNull();
    expect(setSentryUser).toHaveBeenLastCalledWith(null);
  });

  it('a hydration still in flight when logout fires cannot resurrect the signed-out user', async () => {
    await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify(userA));
    let release: (() => void) | null = null;
    const realGet = AsyncStorage.getItem.bind(AsyncStorage);
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (k) => {
      if (k === 'prefs:auth.user_data' && release === null) {
        await new Promise<void>((r) => {
          release = r;
        });
      }
      return realGet(k);
    });
    const { result } = await renderHook(() => useCurrentUser());
    await flush();
    expect(result.current).toBeNull(); // read is held open
    await act(async () => {
      authEvents.emit('logout'); // sign-out lands first
    });
    await act(async () => {
      (release as unknown as () => void)();
      await Promise.resolve();
    });
    await flush();
    expect(result.current).toBeNull(); // the stale read was discarded
  });

  it('account switch A → B via login event shows only B', async () => {
    await setUserCache(userA);
    const { result } = await renderHook(() => useCurrentUser());
    await flush();
    expect(result.current?.id).toBe('user-A');
    await act(async () => {
      await clearUserCache();
      authEvents.emit('logout');
    });
    expect(result.current).toBeNull();
    await act(async () => {
      await setUserCache(userB);
      authEvents.emit('login');
    });
    await flush();
    expect(result.current).toEqual(userB);
  });
});
