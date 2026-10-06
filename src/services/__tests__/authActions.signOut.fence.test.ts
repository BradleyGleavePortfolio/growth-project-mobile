/**
 * Mobile #331 B-331-8: the sign-out after a failed token refresh runs while
 * the API client holds the session fence for the failed session. It removes
 * the session keys with the fence pass (so it never waits on itself) and
 * skips the push-token clear: that session's access token was just rejected
 * and could not be refreshed, and the clear's 401 would wait on the refresh
 * that is signing out. An ordinary sign-out is unchanged.
 */
import { signOut } from '../authActions';
import type { SessionFencePass } from '../sessionFence';

jest.mock('../secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('../api', () => ({
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
  coachApi: { getClients: jest.fn(async () => ({ data: [] })) },
  logApi: { getDaily: jest.fn(async () => ({ data: { entries: [] } })) },
  waterApi: { getDaily: jest.fn(async () => ({ data: { total_ml: 0 } })) },
}));

jest.mock('../sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ reset: jest.fn() }));

jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'user-A' })),
  readUserCache: jest.fn(async () => ({ id: 'user-A' })),
  clearUserCache: jest.fn(async () => undefined),
}));

jest.mock('../../offline/sync/sync-engine', () => ({
  deleteWorkoutLogsForUser: jest.fn(async () => 0),
}));

jest.mock('../../storage/mmkv', () => ({
  clearAllStorage: jest.fn(async () => undefined),
  prefsStorage: { getString: () => undefined },
  cacheStorage: { getString: () => undefined },
  secureStorage: { getString: () => undefined },
}));

// fastingDb pulls in expo-sqlite which doesn't load under Jest; the store's
// reset() never touches the db, so a thin functional stub is enough.
jest.mock('../../db/fastingDb', () => ({
  getActiveFast: jest.fn(async () => null),
  getFastingHistory: jest.fn(async () => []),
  startFast: jest.fn(async () => undefined),
  endFast: jest.fn(async () => undefined),
}));

const { usersApi } = jest.requireMock('../api') as { usersApi: { updatePushToken: jest.Mock } };
const { secureStorage } = jest.requireMock('../secureStorage') as { secureStorage: { removeItem: jest.Mock } };

beforeEach(() => {
  usersApi.updatePushToken.mockClear();
  secureStorage.removeItem.mockClear();
});

function sessionKeyRemovals(): unknown[][] {
  return secureStorage.removeItem.mock.calls.filter((c) => c[0] === 'supabase_token' || c[0] === 'supabase_refresh_token');
}

it('ordinary sign-out: clears the push token, removes both session keys without a pass', async () => {
  await signOut();
  expect(usersApi.updatePushToken).toHaveBeenCalledWith(null);
  expect(sessionKeyRemovals()).toEqual([['supabase_token'], ['supabase_refresh_token']]);
});

it('sign-out under the session fence: no push-token request, both keys removed with the pass', async () => {
  const pass = Object.freeze({}) as SessionFencePass;
  await signOut(undefined, { sessionFence: pass });
  expect(usersApi.updatePushToken).not.toHaveBeenCalled();
  const removals = sessionKeyRemovals();
  expect(removals.map((c) => c[0])).toEqual(['supabase_token', 'supabase_refresh_token']);
  removals.forEach((c) => expect(c[1]).toBe(pass));
});
