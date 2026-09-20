/**
 * storage/mmkv — optional native module handling and the AsyncStorage fallback.
 *
 * `react-native-mmkv` is undeclared and absent in every current build, so the
 * AsyncStorage shim IS the persistence layer. These tests pin:
 *   1. availability is decided by module shape (a resolved-but-empty module or
 *      one without an `MMKV` constructor is NOT available), never by "require
 *      did not throw";
 *   2. with the module absent (this Jest environment, where the require is
 *      also short-circuited by NODE_ENV=test) every namespaced instance is the
 *      AsyncStorage shim, with the `namespace:key` layout consumers and the
 *      sign-out wipe rely on;
 *   3. `clearAllStorage()` removes exactly the three namespaces and nothing
 *      else — the logout contract `authActions.signOut` depends on.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  asMmkvModule,
  cacheStorage,
  clearAllStorage,
  isMmkvAvailable,
  prefsStorage,
  secureStorage,
} from '../mmkv';

describe('asMmkvModule — truthful capability detection', () => {
  it('rejects nothing-shaped results (absent module, Metro empty stub, primitives)', () => {
    expect(asMmkvModule(undefined)).toBeNull();
    expect(asMmkvModule(null)).toBeNull();
    expect(asMmkvModule({})).toBeNull(); // what a Metro `type: 'empty'` resolution yields
    expect(asMmkvModule('react-native-mmkv')).toBeNull();
    expect(asMmkvModule(42)).toBeNull();
    expect(asMmkvModule(true)).toBeNull();
  });

  it('rejects a module whose MMKV export is not a constructor', () => {
    expect(asMmkvModule({ MMKV: undefined })).toBeNull();
    expect(asMmkvModule({ MMKV: null })).toBeNull();
    expect(asMmkvModule({ MMKV: 'MMKV' })).toBeNull();
    expect(asMmkvModule({ MMKV: {} })).toBeNull();
    expect(asMmkvModule({ useMMKVString: () => undefined })).toBeNull();
  });

  it('accepts a module exposing an MMKV constructor, returning the same object', () => {
    class MMKV {}
    const mod = { MMKV };
    expect(asMmkvModule(mod)).toBe(mod);
    const fnStyle = { MMKV: function MMKV() {} };
    expect(asMmkvModule(fnStyle)).toBe(fnStyle);
  });
});

describe('with react-native-mmkv absent, the AsyncStorage shim is the storage layer', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it('reports MMKV as unavailable', () => {
    expect(isMmkvAvailable()).toBe(false);
  });

  it('synchronous getString is undefined (shim limitation, documented for callers)', async () => {
    await prefsStorage.set('theme', 'dark');
    expect(prefsStorage.getString('theme')).toBeUndefined();
    await expect(prefsStorage.getStringAsync('theme')).resolves.toBe('dark');
  });

  it('writes under the `namespace:key` layout for all three instances', async () => {
    await prefsStorage.set('a', 'p');
    await cacheStorage.set('a', 1);
    await secureStorage.set('a', true);
    await expect(AsyncStorage.getItem('prefs:a')).resolves.toBe('p');
    await expect(AsyncStorage.getItem('cache:a')).resolves.toBe('1');
    await expect(AsyncStorage.getItem('secure:a')).resolves.toBe('true');
    await expect(AsyncStorage.getAllKeys()).resolves.toEqual(
      expect.arrayContaining(['prefs:a', 'cache:a', 'secure:a']),
    );
  });

  it('keeps namespaces isolated for reads, deletes and key enumeration', async () => {
    await prefsStorage.set('shared', 'from-prefs');
    await cacheStorage.set('shared', 'from-cache');
    await expect(prefsStorage.getStringAsync('shared')).resolves.toBe('from-prefs');
    await expect(cacheStorage.getStringAsync('shared')).resolves.toBe('from-cache');
    await expect(prefsStorage.getAllKeys()).resolves.toEqual(['shared']);
    await prefsStorage.delete('shared');
    await expect(prefsStorage.getStringAsync('shared')).resolves.toBeUndefined();
    await expect(cacheStorage.getStringAsync('shared')).resolves.toBe('from-cache');
  });

  it('clearNamespace removes only that namespace', async () => {
    await prefsStorage.set('k', '1');
    await cacheStorage.set('k', '2');
    await AsyncStorage.setItem('unrelated', 'x');
    await cacheStorage.clearNamespace();
    await expect(AsyncStorage.getAllKeys()).resolves.toEqual(
      expect.arrayContaining(['prefs:k', 'unrelated']),
    );
    await expect(AsyncStorage.getItem('cache:k')).resolves.toBeNull();
  });

  it('clearAllStorage (logout) wipes prefs, cache and secure namespaces and nothing else', async () => {
    await prefsStorage.set('user', '{"id":"A"}');
    await cacheStorage.set('thread:A', '[]');
    await secureStorage.set('pin', 'hash');
    await AsyncStorage.setItem('legacy-outside-namespaces', 'keep');
    await clearAllStorage();
    const remaining = await AsyncStorage.getAllKeys();
    expect(remaining).toEqual(['legacy-outside-namespaces']);
    await expect(prefsStorage.getStringAsync('user')).resolves.toBeUndefined();
    await expect(cacheStorage.getStringAsync('thread:A')).resolves.toBeUndefined();
    await expect(secureStorage.getStringAsync('pin')).resolves.toBeUndefined();
  });

  it('clearAllStorage is a no-op on an empty store (no removeMany with an empty list)', async () => {
    const removeMany = jest.spyOn(AsyncStorage, 'removeMany');
    await clearAllStorage();
    expect(removeMany).not.toHaveBeenCalled();
  });
});
