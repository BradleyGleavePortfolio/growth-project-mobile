import AsyncStorage from '@react-native-async-storage/async-storage';
import { signOut, SIGN_OUT_KEYS } from '../authActions';
import { authEvents } from '../../utils/authEvents';

jest.mock('../api', () => ({
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
}));

jest.mock('../sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ reset: jest.fn() }));

jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'user-A' })),
}));

jest.mock('../../offline/sync/sync-engine', () => ({
  deleteWorkoutLogsForUser: jest.fn(async () => 0),
}));

jest.mock('../../storage/mmkv', () => ({
  clearAllStorage: jest.fn(async () => undefined),
  // The real module re-exports these instances too. Tests don't read them
  // here so a bare set of getters is enough.
  prefsStorage: { getString: () => undefined },
  cacheStorage: { getString: () => undefined },
  secureStorage: { getString: () => undefined },
}));

const syncEngineMock = jest.requireMock(
  '../../offline/sync/sync-engine',
) as { deleteWorkoutLogsForUser: jest.Mock };
const mmkvMock = jest.requireMock('../../storage/mmkv') as {
  clearAllStorage: jest.Mock;
};
const userCacheMock = jest.requireMock('../../lib/userCache') as {
  readUserCacheSync: jest.Mock;
};

const SIGNING_OUT_USER = 'user-123';
const BYSTANDER_USER = 'user-456';

describe('signOut', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    syncEngineMock.deleteWorkoutLogsForUser.mockClear();
    mmkvMock.clearAllStorage.mockClear();
    userCacheMock.readUserCacheSync.mockReset();
    userCacheMock.readUserCacheSync.mockReturnValue({ id: 'user-A' });
    const Notifications = jest.requireMock('expo-notifications') as {
      unregisterForNotificationsAsync: jest.Mock;
      cancelScheduledNotificationAsync: jest.Mock;
    };
    Notifications.unregisterForNotificationsAsync.mockClear();
    Notifications.cancelScheduledNotificationAsync.mockClear();
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

  // R15 — Every variant of pending_invite_code is user-scoped (or
  // `:anonymous` for unauthenticated cold-start) and signOut must wipe
  // them all. Round-4 audit P1-A regression guard.
  it('sweeps every pending_invite_code:<scope> variant on sign-out so a second user cannot read the prior session\'s code', async () => {
    await AsyncStorage.setItem('pending_invite_code:userA', 'codeA');
    await AsyncStorage.setItem('pending_invite_code:userB', 'codeB');
    await AsyncStorage.setItem('pending_invite_code:anonymous', 'codeAnon');
    // Legacy unscoped variant — if any older build wrote it, signOut
    // must still wipe it.
    await AsyncStorage.setItem('pending_invite_code', 'legacy');
    // Sentinel — must NOT be wiped.
    await AsyncStorage.setItem('pending_invite_codex_unrelated', 'keep');

    await signOut();

    expect(await AsyncStorage.getItem('pending_invite_code:userA')).toBeNull();
    expect(await AsyncStorage.getItem('pending_invite_code:userB')).toBeNull();
    expect(
      await AsyncStorage.getItem('pending_invite_code:anonymous'),
    ).toBeNull();
    expect(await AsyncStorage.getItem('pending_invite_code')).toBeNull();
    // Prefix sweep must not bleed into similarly-named unrelated keys.
    expect(
      await AsyncStorage.getItem('pending_invite_codex_unrelated'),
    ).toBe('keep');
  });

  it('cross-user isolation: after userA signs out, a userB session on the same device cannot read userA\'s pending_invite_code', async () => {
    // userA signs in, deep-link writes their scoped pending code.
    await AsyncStorage.setItem('pending_invite_code:userA', 'A-only-code');
    // userA signs out.
    await signOut();
    // userB now signs in on the same device — reading userA's scoped key
    // (or any pending_invite_code:* key) must yield null.
    expect(await AsyncStorage.getItem('pending_invite_code:userA')).toBeNull();
    const allKeys = await AsyncStorage.getAllKeys();
    expect(
      allKeys.some((k) => k.startsWith('pending_invite_code')),
    ).toBe(false);
  });
});
