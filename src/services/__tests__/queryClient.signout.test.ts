// P0-1 regression test (PR #192 audit).
//
// The in-memory React Query cache must be cleared on signOut so that user A's
// query data cannot hydrate into user B's session on an in-session account
// switch (i.e. without a full app relaunch).

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: jest.fn().mockResolvedValue([]),
    removeMany: jest.fn().mockResolvedValue(undefined),
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'user-A' })),
}));

jest.mock('../api', () => ({
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
}));

jest.mock('../sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ reset: jest.fn() }));

jest.mock('../../offline/sync/sync-engine', () => ({
  deleteWorkoutLogsForUser: jest.fn(async () => 0),
}));

jest.mock('../../storage/mmkv', () => ({
  clearAllStorage: jest.fn(async () => undefined),
  prefsStorage: {
    getAllKeys: jest.fn(async () => []),
    delete: jest.fn(async () => undefined),
    getString: () => undefined,
  },
  cacheStorage: {
    getAllKeys: jest.fn(async () => []),
    delete: jest.fn(async () => undefined),
    getString: () => undefined,
  },
}));

jest.mock('../../db/fastingDb', () => ({
  getActiveFast: jest.fn(async () => null),
  getFastingHistory: jest.fn(async () => []),
  startFast: jest.fn(async () => undefined),
  endFast: jest.fn(async () => undefined),
}));

import { queryClient } from '../queryClient';
import { signOut } from '../authActions';

const USER_A_QUERY_KEY = ['workouts', 'list', 10] as const;

describe('P0-1: in-memory query cache cleared on signOut', () => {
  it('clears queryClient cache before emitting logout so user B cannot see user A data', async () => {
    // Seed the in-memory cache with user A's data.
    queryClient.setQueryData(USER_A_QUERY_KEY, { items: ['user-A workout'] });
    expect(queryClient.getQueryData(USER_A_QUERY_KEY)).toEqual({
      items: ['user-A workout'],
    });

    await signOut('user-A');

    // After signOut the in-memory cache must be empty for this key.
    expect(queryClient.getQueryData(USER_A_QUERY_KEY)).toBeUndefined();
  });

  it('leaves the cache empty when it was already empty', async () => {
    // Ensure a clean slate from prior tests.
    queryClient.clear();

    await signOut('user-A');

    expect(queryClient.getQueryData(USER_A_QUERY_KEY)).toBeUndefined();
  });
});
