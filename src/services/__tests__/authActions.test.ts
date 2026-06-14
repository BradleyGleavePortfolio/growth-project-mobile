import AsyncStorage from '@react-native-async-storage/async-storage';
import { signOut, SIGN_OUT_KEYS, clearUserScopedKeys } from '../authActions';
import { authEvents } from '../../utils/authEvents';
import { prefsStorage, cacheStorage } from '../../storage/mmkv';
import {
  AUTOSAVE_MIRROR_KEY_PREFIX,
  autosaveMirrorKey,
} from '../../storage/autosaveMirror';

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

jest.mock('../../storage/mmkv', () => {
  // In-memory storage shim implementing StorageInstance (src/storage/mmkv.ts).
  // The R15 tests below seed real values via prefsStorage.set() /
  // cacheStorage.set() and assert they're gone after signOut(), so the mock
  // has to actually persist between calls. Defined inside the factory so
  // jest.mock's hoisting can't trip over an out-of-scope reference.
  const makeMockStorage = () => {
    const store = new Map<string, string>();
    return {
      getString: (key: string) => store.get(key),
      getStringAsync: async (key: string) => store.get(key),
      set: async (key: string, value: string) => { store.set(key, value); },
      delete: async (key: string) => { store.delete(key); },
      getAllKeys: async () => Array.from(store.keys()),
      contains: (key: string) => store.has(key),
      clearAll: () => { store.clear(); },
    };
  };
  return {
    clearAllStorage: jest.fn(async () => undefined),
    prefsStorage: makeMockStorage(),
    cacheStorage: makeMockStorage(),
    secureStorage: makeMockStorage(),
  };
});

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

  // MWB-4 #237 R11 (P2) — the workout-builder autosave offline mirror is keyed
  // as `mwb_autosave_mirror:<planId>` in raw AsyncStorage and holds a coach's
  // unsent plan ops/metadata. autosaveMirror.ts documents it as swept on
  // sign-out, but the prefix was missing from ASYNC_SIGN_OUT_PREFIXES, leaving
  // a previous user's draft edits readable by the next user on the same device.
  // This guards that the prefix is now swept — without bleeding into a
  // similarly-named unrelated key.
  it('sweeps the workout-builder autosave mirror (mwb_autosave_mirror:<planId>) on sign-out', async () => {
    const seededKey = autosaveMirrorKey('plan-1');
    // The key the source actually sweeps is built from the exported constant;
    // assert the seeded key really carries that prefix (parity, not a literal).
    expect(seededKey.startsWith(AUTOSAVE_MIRROR_KEY_PREFIX)).toBe(true);
    await AsyncStorage.setItem(seededKey, JSON.stringify({ ops: [] }));
    await AsyncStorage.setItem(
      autosaveMirrorKey('plan-2'),
      JSON.stringify({ ops: [] }),
    );
    // Sentinel: a similarly-named but unrelated key must survive the prefix
    // sweep (the prefix ends in a colon, so this never matches).
    await AsyncStorage.setItem('mwb_autosave_mirrorx_unrelated', 'keep');

    await signOut();

    expect(await AsyncStorage.getItem(seededKey)).toBeNull();
    expect(await AsyncStorage.getItem(autosaveMirrorKey('plan-2'))).toBeNull();
    expect(await AsyncStorage.getItem('mwb_autosave_mirrorx_unrelated')).toBe(
      'keep',
    );
  });

  // R15 — Audit #2 P1-5 regression coverage. The previous implementation only
  // swept raw AsyncStorage keys, so MMKV-shim namespaced keys (`prefs:foo`,
  // `cache:foo`) and native MMKV keys both survived sign-out. The test seeds
  // every new R15 prefix via the actual storage wrappers, then asserts they
  // are gone after sign-out.
  it('wipes all user-scoped MMKV keys for new R15 surfaces on sign-out', async () => {
    const userId = 'user-abc-123';
    const subCoachId = 'sub-coach-xyz';

    // Seed every new R15 prefix through the typed storage wrappers. This
    // exercises whichever backend `makeStorage()` picked at module load time
    // — native MMKV in release, AsyncStorage-shim in Jest. In either case,
    // the value must be unreadable after signOut().
    await prefsStorage.set(
      `onboarding.package_prompt_dismissed_at:${userId}`,
      new Date().toISOString(),
    );
    await prefsStorage.set(`coach.stripe_banner_dismissed:${userId}`, 'true');
    await prefsStorage.set(`coach.stripe_was_unconfigured:${userId}`, 'true');
    await prefsStorage.set(`home.coach_intro_banner_dismissed:${userId}`, 'true');
    await prefsStorage.set(`home.waiting_banner_dismissed:${userId}`, 'true');
    await prefsStorage.set(`coach.onboarding.is_complete:${userId}`, 'true');
    await prefsStorage.set(`coach.revenue_sharing_${subCoachId}:${userId}`, 'true');
    await prefsStorage.set(
      `onboarding.lean_q5_draft:${userId}`,
      JSON.stringify({ feet: 5, inches: 9 }),
    );
    await prefsStorage.set(
      `onboarding.lean_q6_draft:${userId}`,
      JSON.stringify({ weight: 170 }),
    );
    await prefsStorage.set(`coach.wizard.step_2_invite_code:${userId}`, 'ABC123');
    await cacheStorage.set(
      `messages_thread_client:${userId}`,
      JSON.stringify([{ id: 'm1', text: 'hi' }]),
    );

    // The intentionally unscoped nudge key must survive — proves we're not
    // over-clearing.
    await prefsStorage.set('coach.first_client_payment_nudge_shown', 'true');

    // Sanity: writes landed.
    expect(
      await prefsStorage.getStringAsync(`coach.stripe_banner_dismissed:${userId}`),
    ).toBe('true');
    expect(
      await cacheStorage.getStringAsync(`messages_thread_client:${userId}`),
    ).toBeTruthy();

    await signOut();

    // Every R15 user-scoped key must be gone.
    expect(
      await prefsStorage.getStringAsync(
        `onboarding.package_prompt_dismissed_at:${userId}`,
      ),
    ).toBeUndefined();
    expect(
      await prefsStorage.getStringAsync(`coach.stripe_banner_dismissed:${userId}`),
    ).toBeUndefined();
    expect(
      await prefsStorage.getStringAsync(`coach.stripe_was_unconfigured:${userId}`),
    ).toBeUndefined();
    expect(
      await prefsStorage.getStringAsync(`home.coach_intro_banner_dismissed:${userId}`),
    ).toBeUndefined();
    expect(
      await prefsStorage.getStringAsync(`home.waiting_banner_dismissed:${userId}`),
    ).toBeUndefined();
    expect(
      await prefsStorage.getStringAsync(`coach.onboarding.is_complete:${userId}`),
    ).toBeUndefined();
    expect(
      await prefsStorage.getStringAsync(
        `coach.revenue_sharing_${subCoachId}:${userId}`,
      ),
    ).toBeUndefined();
    expect(
      await prefsStorage.getStringAsync(`onboarding.lean_q5_draft:${userId}`),
    ).toBeUndefined();
    expect(
      await prefsStorage.getStringAsync(`onboarding.lean_q6_draft:${userId}`),
    ).toBeUndefined();
    expect(
      await prefsStorage.getStringAsync(`coach.wizard.step_2_invite_code:${userId}`),
    ).toBeUndefined();
    expect(
      await cacheStorage.getStringAsync(`messages_thread_client:${userId}`),
    ).toBeUndefined();

    // Intentionally unscoped key must remain.
    expect(
      await prefsStorage.getStringAsync('coach.first_client_payment_nudge_shown'),
    ).toBe('true');
  });

  // Covers the AsyncStorage-shim path explicitly: in Jest the shim is what
  // backs prefsStorage/cacheStorage, and previously the sign-out sweep only
  // matched bare prefixes — never the shim's `prefs:` / `cache:` namespace.
  // This test seeds the namespaced AsyncStorage keys directly to lock that
  // regression in place even if the wrappers are later swapped out.
  it('clearUserScopedKeys removes namespaced AsyncStorage shim keys', async () => {
    const userId = 'shim-test-user';

    await AsyncStorage.setItem(
      `prefs:onboarding.lean_q5_draft:${userId}`,
      'shim-seeded',
    );
    await AsyncStorage.setItem(
      `prefs:coach.stripe_banner_dismissed:${userId}`,
      'shim-seeded',
    );
    await AsyncStorage.setItem(
      `cache:messages_thread_client:${userId}`,
      'shim-seeded',
    );
    await AsyncStorage.setItem('unrelated_key', 'should-stay');

    await clearUserScopedKeys();

    expect(
      await AsyncStorage.getItem(`prefs:onboarding.lean_q5_draft:${userId}`),
    ).toBeNull();
    expect(
      await AsyncStorage.getItem(`prefs:coach.stripe_banner_dismissed:${userId}`),
    ).toBeNull();
    expect(
      await AsyncStorage.getItem(`cache:messages_thread_client:${userId}`),
    ).toBeNull();
    expect(await AsyncStorage.getItem('unrelated_key')).toBe('should-stay');
  });
});
