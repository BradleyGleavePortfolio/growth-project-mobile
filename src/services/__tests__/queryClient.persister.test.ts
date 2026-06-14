// R15 — PR #192 fix round 1
//
// Persisted React Query cache must be namespaced per authenticated user so a
// shared device cannot hydrate user A's cache into user B's session. This
// suite locks the persister key shape and the sign-out purge behavior.

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: jest.fn(),
    removeMany: jest.fn(),
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: () => null,
}));

import {
  persisterKeyForUser,
  purgePersistedQueryCacheForAllUsers,
  QUERY_CACHE_KEY_PREFIX,
} from '../queryClient';

describe('queryClient persister — R15 user-scoping', () => {
  it('namespaces the key with the authenticated user id', () => {
    expect(persisterKeyForUser('user-abc')).toBe(`${QUERY_CACHE_KEY_PREFIX}:user-abc`);
  });

  it('falls back to :anonymous when no user is provided', () => {
    expect(persisterKeyForUser(null)).toBe(`${QUERY_CACHE_KEY_PREFIX}:anonymous`);
    expect(persisterKeyForUser(undefined)).toBe(`${QUERY_CACHE_KEY_PREFIX}:anonymous`);
    expect(persisterKeyForUser('  ')).toBe(`${QUERY_CACHE_KEY_PREFIX}:anonymous`);
  });

  it('purgePersistedQueryCacheForAllUsers removes every matching key', async () => {
    const getAllKeys = AsyncStorage.getAllKeys as jest.Mock;
    const removeMany = AsyncStorage.removeMany as jest.Mock;
    getAllKeys.mockResolvedValueOnce([
      'TGP_RQ_CACHE_V1', // legacy unsuffixed
      'TGP_RQ_CACHE_V1:user-a',
      'TGP_RQ_CACHE_V1:user-b',
      'unrelated_key',
      'macro_targets:user-a',
    ]);

    await purgePersistedQueryCacheForAllUsers();

    expect(removeMany).toHaveBeenCalledTimes(1);
    expect(removeMany.mock.calls[0][0].sort()).toEqual(
      ['TGP_RQ_CACHE_V1', 'TGP_RQ_CACHE_V1:user-a', 'TGP_RQ_CACHE_V1:user-b'].sort(),
    );
  });

  it('purgePersistedQueryCacheForAllUsers no-ops when nothing matches', async () => {
    const getAllKeys = AsyncStorage.getAllKeys as jest.Mock;
    const removeMany = AsyncStorage.removeMany as jest.Mock;
    removeMany.mockClear();
    getAllKeys.mockResolvedValueOnce(['unrelated_key', 'macro_targets:user-a']);

    await purgePersistedQueryCacheForAllUsers();

    expect(removeMany).not.toHaveBeenCalled();
  });
});
