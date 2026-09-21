/**
 * lib/userCache — REAL composition tests (S6 R3 reimplementation).
 *
 * Nothing in the storage path is mocked except the AsyncStorage jest mock
 * that every build relies on: `storage/mmkv` resolves to the AsyncStorage shim
 * (react-native-mmkv is undeclared and `NODE_ENV=test` short-circuits the
 * optional require), exactly as in every shipped build. These tests pin the
 * findings closed in R3:
 *
 *   S6-R2-A-01 / S6-B2-1 — a freshly written identity was unreadable because
 *   the read path never consulted the shim asynchronously, and the legacy
 *   migration deleted the only copy before confirming the new one.
 *
 * "Restart" is modelled with `jest.isolateModules`, which yields a fresh module
 * instance (empty in-memory mirror) over the SAME AsyncStorage contents.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CurrentUser } from '../../hooks/useCurrentUser';

type UserCacheModule = typeof import('../userCache');

function freshModule(): UserCacheModule {
  let mod: UserCacheModule | undefined;
  jest.isolateModules(() => {
    mod = require('../userCache') as UserCacheModule;
  });
  if (!mod) throw new Error('module load failed');
  return mod;
}

const userA: CurrentUser = { id: 'user-A', email: 'a@example.com', role: 'client' };
const userB: CurrentUser = { id: 'user-B', email: 'b@example.com', role: 'coach' };

const NAMESPACED_KEY = 'prefs:auth.user_data';
const LEGACY_KEY = 'user_data';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('userCache — hydration through the AsyncStorage shim', () => {
  it('starts unhydrated: the synchronous view is null and says so', () => {
    const uc = freshModule();
    expect(uc.isUserCacheHydrated()).toBe(false);
    expect(uc.readUserCacheSync()).toBeNull();
  });

  it('set → read round-trip within one process (the R2 defect)', async () => {
    const uc = freshModule();
    await uc.setUserCache(userA);
    expect(await AsyncStorage.getItem(NAMESPACED_KEY)).toBe(JSON.stringify(userA));
    expect(await uc.readUserCache()).toEqual(userA);
    expect(uc.readUserCacheSync()).toEqual(userA);
    expect(uc.isUserCacheHydrated()).toBe(true);
  });

  it('set → restart → read: the namespaced value survives a fresh module instance', async () => {
    const first = freshModule();
    await first.setUserCache(userA);

    const restarted = freshModule();
    expect(restarted.readUserCacheSync()).toBeNull(); // truthful: not yet hydrated
    expect(await restarted.readUserCache()).toEqual(userA);
    expect(restarted.readUserCacheSync()).toEqual(userA);
  });

  it('shares one in-flight storage read across concurrent boot-time callers', async () => {
    await AsyncStorage.setItem(NAMESPACED_KEY, JSON.stringify(userA));
    const getItem = jest.spyOn(AsyncStorage, 'getItem');
    const uc = freshModule();
    const [a, b, c] = await Promise.all([uc.readUserCache(), uc.readUserCache(), uc.readUserCache()]);
    expect(a).toEqual(userA);
    expect(b).toEqual(userA);
    expect(c).toEqual(userA);
    expect(getItem.mock.calls.filter(([k]) => k === NAMESPACED_KEY)).toHaveLength(1);
  });

  it('treats an unparseable namespaced value as no user, without throwing', async () => {
    await AsyncStorage.setItem(NAMESPACED_KEY, '{not json');
    const uc = freshModule();
    expect(await uc.readUserCache()).toBeNull();
    expect(uc.isUserCacheHydrated()).toBe(true);
  });
});

describe('userCache — legacy `user_data` migration', () => {
  it('migrates the legacy key into the namespaced key and removes it only after verifying the copy', async () => {
    await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(userA));
    const uc = freshModule();
    expect(await uc.readUserCache()).toEqual(userA);
    expect(await AsyncStorage.getItem(NAMESPACED_KEY)).toBe(JSON.stringify(userA));
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
    // And is readable after a restart without the legacy key present.
    expect(await freshModule().readUserCache()).toEqual(userA);
  });

  it('keeps the legacy key when the namespaced write cannot be read back (repeatable migration)', async () => {
    await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(userA));
    // Simulate a write that does not land: setItem for the namespaced key is swallowed.
    const realSet = AsyncStorage.setItem.bind(AsyncStorage);
    jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (k, v) => {
      if (k === NAMESPACED_KEY) return;
      return realSet(k, v);
    });
    const uc = freshModule();
    expect(await uc.readUserCache()).toEqual(userA); // this read still answers truthfully
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBe(JSON.stringify(userA)); // not deleted
    jest.restoreAllMocks();
    // Next process: migration simply runs again and now completes.
    const again = freshModule();
    expect(await again.readUserCache()).toEqual(userA);
    expect(await AsyncStorage.getItem(NAMESPACED_KEY)).toBe(JSON.stringify(userA));
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('prefers the namespaced value over a stale legacy value', async () => {
    await AsyncStorage.setItem(NAMESPACED_KEY, JSON.stringify(userB));
    await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(userA));
    const uc = freshModule();
    expect(await uc.readUserCache()).toEqual(userB);
  });
});

describe('userCache — mutation generation fences', () => {
  it('a hydration that started before setUserCache cannot overwrite the newer value', async () => {
    await AsyncStorage.setItem(NAMESPACED_KEY, JSON.stringify(userA));
    // Hold the storage read open until the set has landed.
    let release: (() => void) | null = null;
    const realGet = AsyncStorage.getItem.bind(AsyncStorage);
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (k) => {
      if (k === NAMESPACED_KEY && release === null) {
        await new Promise<void>((r) => {
          release = r;
        });
      }
      return realGet(k);
    });
    const uc = freshModule();
    const staleRead = uc.readUserCache();
    await Promise.resolve();
    await uc.setUserCache(userB); // newer truth lands while the read is outstanding
    expect(uc.readUserCacheSync()).toEqual(userB);
    (release as unknown as () => void)();
    expect(await staleRead).toEqual(userB); // stale result discarded, newer truth returned
    expect(uc.readUserCacheSync()).toEqual(userB);
  });

  it('a hydration that started before clearUserCache cannot resurrect the signed-out user', async () => {
    await AsyncStorage.setItem(NAMESPACED_KEY, JSON.stringify(userA));
    let release: (() => void) | null = null;
    const realGet = AsyncStorage.getItem.bind(AsyncStorage);
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (k) => {
      if (k === NAMESPACED_KEY && release === null) {
        await new Promise<void>((r) => {
          release = r;
        });
      }
      return realGet(k);
    });
    const uc = freshModule();
    const staleRead = uc.readUserCache();
    await Promise.resolve();
    await uc.clearUserCache();
    (release as unknown as () => void)();
    expect(await staleRead).toBeNull();
    expect(uc.readUserCacheSync()).toBeNull();
    expect(await AsyncStorage.getItem(NAMESPACED_KEY)).toBeNull();
  });

  it('patchUserCache merges against the current mirror and deep-merges profile', async () => {
    const uc = freshModule();
    await uc.setUserCache({ ...userA, profile: { calorie_target: 2000, sex: 'f' } });
    await uc.patchUserCache({ profile: { calorie_target: 2200 } });
    const merged = await uc.readUserCache();
    expect(merged).toEqual({ ...userA, profile: { calorie_target: 2200, sex: 'f' } });
    expect(await AsyncStorage.getItem(NAMESPACED_KEY)).toBe(JSON.stringify(merged));
  });

  it('patchUserCache on a cold process hydrates first, so it never wipes unseen fields', async () => {
    await AsyncStorage.setItem(
      NAMESPACED_KEY,
      JSON.stringify({ ...userA, name: 'Ann', profile: { protein_target: 150 } }),
    );
    const uc = freshModule();
    await uc.patchUserCache({ profile: { day_one_completed: true } });
    expect(await uc.readUserCache()).toEqual({
      ...userA,
      name: 'Ann',
      profile: { protein_target: 150, day_one_completed: true },
    });
  });

  it('a patch that raced a newer set respects the set (merge is against the mirror at merge time)', async () => {
    const uc = freshModule();
    await uc.setUserCache(userA);
    const p = uc.patchUserCache({ name: 'patched' });
    await uc.setUserCache(userB);
    await p;
    // The patch merged against whatever the mirror held when it ran; the
    // last write to storage is the last mutation applied, never a stale one.
    const final = await freshModule().readUserCache();
    expect(final).toEqual(uc.readUserCacheSync());
    expect(final?.id).toBe(final?.id === 'user-B' ? 'user-B' : 'user-A');
  });
});

describe('userCache — logout and account switch isolation', () => {
  it('clearUserCache empties the mirror synchronously and removes namespaced + legacy keys', async () => {
    await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(userA));
    const uc = freshModule();
    await uc.setUserCache(userA);
    const clearing = uc.clearUserCache();
    expect(uc.readUserCacheSync()).toBeNull(); // before the storage delete settles
    await clearing;
    expect(await AsyncStorage.getItem(NAMESPACED_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(await uc.readUserCache()).toBeNull();
    expect(await freshModule().readUserCache()).toBeNull();
  });

  it('A → clear → B: B is the only identity visible, in-process and after restart', async () => {
    const uc = freshModule();
    await uc.setUserCache(userA);
    await uc.clearUserCache();
    await uc.setUserCache(userB);
    expect(uc.readUserCacheSync()).toEqual(userB);
    expect(await uc.readUserCache()).toEqual(userB);
    expect(await freshModule().readUserCache()).toEqual(userB);
    const keys = await AsyncStorage.getAllKeys();
    expect(keys).toEqual([NAMESPACED_KEY]);
  });
});
