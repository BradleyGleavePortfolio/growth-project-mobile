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

  it('wipes the legacy global @activeWorkoutSession/v1 key so it cannot migrate to the next user on the same device (R15)', async () => {
    // Pre-R15 builds wrote a single global key. If a user upgrades while a
    // session is in flight and then signs out, that payload must not survive
    // — loadActiveWorkoutSession() on the next user would otherwise migrate
    // it into their namespace and surface someone else's working set.
    await AsyncStorage.setItem('@activeWorkoutSession/v1', '{"v":1}');

    await signOut();

    expect(await AsyncStorage.getItem('@activeWorkoutSession/v1')).toBeNull();
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

  it('wipes ONLY the signing-out user fasting notification id and leaves bystander user keys intact', async () => {
    // R15: signOut must only touch the signing-out user's per-user keys.
    // A different user's `fasting:scheduled_notification_id:<otherUser>` must
    // survive — otherwise a shared device leaks state between accounts.
    await AsyncStorage.setItem(
      `fasting:scheduled_notification_id:${SIGNING_OUT_USER}`,
      'notif-abc',
    );
    await AsyncStorage.setItem(
      `fasting:scheduled_notification_id:${BYSTANDER_USER}`,
      'notif-def',
    );
    await AsyncStorage.setItem(
      `fasting:something_else:${SIGNING_OUT_USER}`,
      'should-stay',
    );

    await signOut(SIGNING_OUT_USER);

    expect(
      await AsyncStorage.getItem(`fasting:scheduled_notification_id:${SIGNING_OUT_USER}`),
    ).toBeNull();
    // The bystander user's notification id MUST survive — this is the R15
    // cross-user isolation assertion.
    expect(
      await AsyncStorage.getItem(`fasting:scheduled_notification_id:${BYSTANDER_USER}`),
    ).toBe('notif-def');
    expect(
      await AsyncStorage.getItem(`fasting:something_else:${SIGNING_OUT_USER}`),
    ).toBe('should-stay');

    const Notifications = jest.requireMock('expo-notifications') as {
      cancelScheduledNotificationAsync: jest.Mock;
    };
    // Only the signing-out user's stored id is passed to the notifications API.
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notif-abc');
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('notif-def');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('wipes ONLY the signing-out user macro target cache and leaves bystander user keys intact', async () => {
    // useMacroTargets writes macro_targets:${userId}. The signing-out user's
    // cache must be wiped, but a bystander user's macros on the same device
    // must remain so they aren't logged into a cleared profile next launch.
    await AsyncStorage.setItem(
      `macro_targets:${SIGNING_OUT_USER}`,
      JSON.stringify({ kcal: 2200 }),
    );
    await AsyncStorage.setItem(
      `macro_targets:${BYSTANDER_USER}`,
      JSON.stringify({ kcal: 1800 }),
    );
    await AsyncStorage.setItem(
      `macro_target_other:${SIGNING_OUT_USER}`,
      'should-stay',
    );

    await signOut(SIGNING_OUT_USER);

    expect(await AsyncStorage.getItem(`macro_targets:${SIGNING_OUT_USER}`)).toBeNull();
    // The bystander user's macros MUST survive.
    expect(await AsyncStorage.getItem(`macro_targets:${BYSTANDER_USER}`)).toBe(
      JSON.stringify({ kcal: 1800 }),
    );
    expect(await AsyncStorage.getItem(`macro_target_other:${SIGNING_OUT_USER}`)).toBe(
      'should-stay',
    );
  });

  it('resolves the signing-out userId from cached user when no argument is passed', async () => {
    // Callers like SettingsScreen invoke signOut() with no arguments. The
    // helper must still scope correctly by falling back to the cached user.
    userCacheMock.readUserCacheSync.mockReturnValue({ id: SIGNING_OUT_USER });
    await AsyncStorage.setItem(
      `fasting:scheduled_notification_id:${SIGNING_OUT_USER}`,
      'notif-abc',
    );
    await AsyncStorage.setItem(
      `fasting:scheduled_notification_id:${BYSTANDER_USER}`,
      'notif-def',
    );
    await AsyncStorage.setItem(
      `macro_targets:${SIGNING_OUT_USER}`,
      JSON.stringify({ kcal: 2200 }),
    );
    await AsyncStorage.setItem(
      `macro_targets:${BYSTANDER_USER}`,
      JSON.stringify({ kcal: 1800 }),
    );

    await signOut();

    expect(
      await AsyncStorage.getItem(`fasting:scheduled_notification_id:${SIGNING_OUT_USER}`),
    ).toBeNull();
    expect(await AsyncStorage.getItem(`macro_targets:${SIGNING_OUT_USER}`)).toBeNull();
    expect(
      await AsyncStorage.getItem(`fasting:scheduled_notification_id:${BYSTANDER_USER}`),
    ).toBe('notif-def');
    expect(await AsyncStorage.getItem(`macro_targets:${BYSTANDER_USER}`)).toBe(
      JSON.stringify({ kcal: 1800 }),
    );

    const Notifications = jest.requireMock('expo-notifications') as {
      cancelScheduledNotificationAsync: jest.Mock;
    };
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notif-abc');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('skips per-user wipe when no userId is resolvable (no cache, no argument)', async () => {
    // If there's no signing-out user (no cache, no arg), the helper must not
    // fall back to a global prefix sweep — bystander users' per-user keys
    // (for these prefixes) must survive.
    userCacheMock.readUserCacheSync.mockReturnValue(null);
    await AsyncStorage.setItem(
      `fasting:scheduled_notification_id:${BYSTANDER_USER}`,
      'notif-def',
    );
    await AsyncStorage.setItem(
      `macro_targets:${BYSTANDER_USER}`,
      JSON.stringify({ kcal: 1800 }),
    );

    await signOut();

    expect(
      await AsyncStorage.getItem(`fasting:scheduled_notification_id:${BYSTANDER_USER}`),
    ).toBe('notif-def');
    expect(await AsyncStorage.getItem(`macro_targets:${BYSTANDER_USER}`)).toBe(
      JSON.stringify({ kcal: 1800 }),
    );

    const Notifications = jest.requireMock('expo-notifications') as {
      cancelScheduledNotificationAsync: jest.Mock;
    };
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });
});
