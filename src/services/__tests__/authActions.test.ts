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

describe('signOut', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    syncEngineMock.deleteWorkoutLogsForUser.mockClear();
    mmkvMock.clearAllStorage.mockClear();
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

  it('wipes per-user pending_food_logs_* keys via prefix enumeration', async () => {
    await AsyncStorage.setItem('pending_food_logs_user-A', '[{"id":"a"}]');
    await AsyncStorage.setItem('pending_food_logs_user-B', '[{"id":"b"}]');
    await AsyncStorage.setItem('pending_food_logs_anonymous', '[]');
    await AsyncStorage.setItem('gp_coach_bio_user-A', 'bio');
    await AsyncStorage.setItem('something_else', 'keep');

    await signOut();

    // The prefix-match drops every per-user pending_food_logs key, not just
    // the signing-out user's — a shared device can't be allowed to keep
    // another user's queued writes either.
    expect(await AsyncStorage.getItem('pending_food_logs_user-A')).toBeNull();
    expect(await AsyncStorage.getItem('pending_food_logs_user-B')).toBeNull();
    expect(await AsyncStorage.getItem('pending_food_logs_anonymous')).toBeNull();
    expect(await AsyncStorage.getItem('gp_coach_bio_user-A')).toBeNull();
    expect(await AsyncStorage.getItem('something_else')).toBe('keep');
  });

  it('wipes per-user active_workout_session:* keys so the next user cannot resume the previous user\'s in-flight workout (R15)', async () => {
    // The active workout persistence layer keys entries as
    // `active_workout_session:<userId>`. Without the prefix sweep, User
    // B signing in on the same device would see User A's "Resume?" prompt
    // and could adopt their working set state.
    await AsyncStorage.setItem('active_workout_session:user-A', '{"v":1}');
    await AsyncStorage.setItem('active_workout_session:user-B', '{"v":1}');
    await AsyncStorage.setItem('active_workout_unrelated', 'keep');

    await signOut();

    expect(
      await AsyncStorage.getItem('active_workout_session:user-A'),
    ).toBeNull();
    expect(
      await AsyncStorage.getItem('active_workout_session:user-B'),
    ).toBeNull();
    // Keys that share the broader stem but not the colon-terminated prefix
    // are left alone — we only target the exact namespace.
    expect(await AsyncStorage.getItem('active_workout_unrelated')).toBe('keep');
  });

  it('wipes the signing-out user\'s offline workout rows but not others\'', async () => {
    await signOut();
    expect(syncEngineMock.deleteWorkoutLogsForUser).toHaveBeenCalledWith('user-A');
    expect(syncEngineMock.deleteWorkoutLogsForUser).toHaveBeenCalledTimes(1);
  });

  it('invokes clearAllStorage to wipe MMKV namespaces', async () => {
    await signOut();
    expect(mmkvMock.clearAllStorage).toHaveBeenCalledTimes(1);
  });

  it('wipes shim-namespaced messages_thread_* and pending_* cache keys (Hunt #2 P0-1)', async () => {
    // The cacheStorage shim stores under `cache:<key>` in AsyncStorage when
    // MMKV native isn't available (Expo Go / Jest). signOut must drop these
    // even if clearAllStorage() is a no-op mock (which it is in this suite).
    await AsyncStorage.setItem(
      'cache:messages_thread_client_user-A',
      '[{"id":"m1"}]',
    );
    await AsyncStorage.setItem(
      'cache:messages_thread_client_user-B',
      '[{"id":"m2"}]',
    );
    await AsyncStorage.setItem('cache:pending_food_logs_user-A', '[]');
    await AsyncStorage.setItem('cache:last_sync_ts', 'keep-me');
    await AsyncStorage.setItem('cache:unrelated', 'keep-me');

    await signOut();

    expect(
      await AsyncStorage.getItem('cache:messages_thread_client_user-A'),
    ).toBeNull();
    expect(
      await AsyncStorage.getItem('cache:messages_thread_client_user-B'),
    ).toBeNull();
    expect(
      await AsyncStorage.getItem('cache:pending_food_logs_user-A'),
    ).toBeNull();
    // Unrelated cache keys are left alone — we only drop the targeted prefixes.
    expect(await AsyncStorage.getItem('cache:last_sync_ts')).toBe('keep-me');
    expect(await AsyncStorage.getItem('cache:unrelated')).toBe('keep-me');
  });

  it('unregisters expo-notifications on signOut (idempotent)', async () => {
    const Notifications = jest.requireMock('expo-notifications') as {
      unregisterForNotificationsAsync: jest.Mock;
    };
    Notifications.unregisterForNotificationsAsync.mockClear();
    await signOut();
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalledTimes(
      1,
    );
  });
});
