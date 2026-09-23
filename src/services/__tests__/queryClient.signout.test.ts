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
  readUserCache: jest.fn(async () => ({ id: 'user-A' })),
  clearUserCache: jest.fn(async () => undefined),
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

import { QueryObserver } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as qc from '../queryClient';
import { createIdentityPersistence, queryClient } from '../queryClient';
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

  // S6-P1 ordering defect (observed, not hypothetical): signOut runs while the
  // signed-in screens are still mounted, so a bare queryClient.clear() removed
  // and destroyed every Query while its QueryObserver stayed attached. The
  // observer's later removeObserver() — on unmount after the 'logout' event, or
  // on its next render — then hit an orphan Query whose observer list went
  // empty, calling scheduleGc() and arming a gcTime timer on an object no
  // longer in the cache, which nothing can ever clear. signOut now settles and
  // detaches first (settleAndClearQueryCache), which makes those later calls
  // inert. Privacy assertions above are unchanged.
  it('detaches live observers before clearing, so a later removeObserver cannot arm an unclearable gc timer', async () => {
    jest.useFakeTimers();
    try {
      const observer = new QueryObserver(queryClient, {
        queryKey: USER_A_QUERY_KEY,
        queryFn: () => new Promise<never>(() => {}),
        staleTime: Infinity,
      });
      const unsubscribe = observer.subscribe(() => {});
      const query = queryClient.getQueryCache().find({ queryKey: USER_A_QUERY_KEY });
      expect(query).toBeDefined();
      expect(query!.getObserversCount()).toBe(1);

      await signOut('user-A');

      // The live observer was detached while its query was still cached, so the
      // query could be destroyed with its gc timer cleared for good.
      expect(query!.getObserversCount()).toBe(0);
      expect(queryClient.getQueryCache().find({ queryKey: USER_A_QUERY_KEY })).toBeUndefined();
      expect(queryClient.getQueryData(USER_A_QUERY_KEY)).toBeUndefined();

      // Flush the notify scheduler's setTimeout(0) hops so only durable timers
      // remain in the count.
      jest.advanceTimersByTime(0);
      const timersBeforeTeardown = jest.getTimerCount();

      // The screen unmounts after the logout event: QueryObserver.destroy()
      // calls removeObserver() on the already-removed query. No new timer.
      unsubscribe();
      observer.destroy();
      jest.advanceTimersByTime(0);
      expect(jest.getTimerCount()).toBe(timersBeforeTeardown);
    } finally {
      jest.useRealTimers();
    }
  });

  // S6-P2 (S6-A-02): the identity persistence subscribed to the live client
  // must be retired and drained by signOut ITSELF, before its final purge, so a
  // cache update that lands during signOut (H3) cannot start a private write
  // after the purge — `await signOut()` is the completed disk-privacy boundary
  // and does not depend on a later PersistedQueryCacheGate effect.
  it('retires and drains the live identity persistence before the purge, so a late cache update during signOut writes nothing', async () => {
    jest.useFakeTimers();
    const persistence = createIdentityPersistence('user-A');
    const setItem = AsyncStorage.setItem as unknown as jest.Mock;
    const realPurge = qc.purgePersistedQueryCacheForAllUsers;
    let retiredAtPurge: boolean | undefined;
    const purgeSpy = jest.spyOn(qc, 'purgePersistedQueryCacheForAllUsers').mockImplementation(async () => {
      retiredAtPurge = persistence.isRetired();
      await realPurge();
      // Late private update landing right after the disk purge (H3 window).
      queryClient.setQueryData(USER_A_QUERY_KEY, { items: ['user-A late private'] });
    });
    try {
      expect(await persistence.restore()).toBe('empty'); // mock storage is empty; subscribes
      expect(persistence.isRetired()).toBe(false);
      queryClient.setQueryData(USER_A_QUERY_KEY, { items: ['user-A workout'] });
      await jest.advanceTimersByTimeAsync(1100); // throttled write of the live session lands
      expect(setItem.mock.calls.some((c) => c[0] === persistence.key)).toBe(true);
      const writesBeforeSignOut = setItem.mock.calls.length;

      await signOut('user-A');

      // At signOut completion: retirement preceded the purge and the persistence is fenced.
      expect(retiredAtPurge).toBe(true);
      expect(persistence.isRetired()).toBe(true);
      expect(queryClient.getQueryData(USER_A_QUERY_KEY)).toBeUndefined();
      // The late update can never reach disk, even after the throttle window elapses.
      await jest.advanceTimersByTimeAsync(1500);
      expect(setItem.mock.calls.slice(writesBeforeSignOut).filter((c) => c[0] === persistence.key)).toEqual([]);
    } finally {
      purgeSpy.mockRestore();
      jest.useRealTimers();
    }
  });
});
