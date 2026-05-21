// Hunter #2 P1-7 (R15 — cross-user data leak): every zustand store that holds
// user-scoped state must be reset on signOut so the next user on the same
// device cannot see the previous user's data flash through before the
// post-login fetches complete.
//
// This suite seeds each store with non-default state, calls signOut(), and
// asserts each store has returned to its documented initial state.

import { signOut, resetUserScopedStores } from '../authActions';
import { useCoachStore } from '../../store/coachStore';
import { useClientStore } from '../../store/clientStore';
import { useFastingStore } from '../../store/fastingStore';
import { foregroundBannerStore } from '../../store/foregroundBannerStore';

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

describe('signOut → store resets (Hunter #2 P1-7)', () => {
  beforeEach(() => {
    // Seed each user-scoped store with non-default state representing the
    // previous user's session.
    useCoachStore.setState({
      clients: [
        {
          id: 'c1',
          role: 'client',
          email: 'a@b.com',
          passwordHash: '',
          firstName: 'Prev',
          lastName: 'Client',
          status: 'active',
          createdAt: '2025-01-01',
          updatedAt: '2025-01-01',
        },
      ],
      isLoading: true,
      loadError: 'transient error',
      searchQuery: 'prev search',
      filterStatus: 'archived',
    });

    useClientStore.setState({
      foodLogs: [
        {
          id: 'fl1',
          foodName: 'Steak',
          calories: 500,
          protein: 50,
          carbs: 0,
          fat: 30,
          mealType: 'dinner',
          date: '2025-05-01',
          quantity: 1,
          unit: 'serving',
          userId: 'user-A',
          coachId: '',
          createdAt: '2025-05-01',
          foodItemId: 'fi1',
        } as never,
      ],
      dailyTotals: { calories: 1234, protein: 100, carbs: 50, fat: 30 },
      waterOz: 64,
      isLoading: true,
    });

    useFastingStore.setState({
      activeFast: {
        id: 'fast-1',
        userId: 'user-A',
        coachId: 'coach-1',
        startTime: '2025-05-01T08:00:00Z',
        endTime: null,
        targetHours: 16,
      } as never,
      selectedProtocol: 20,
      history: [{ id: 'fast-0' } as never],
      isLoading: true,
    });

    foregroundBannerStore.setState({
      banner: {
        title: 'Prev user message',
        body: 'leaked body',
        notificationId: 'n-1',
      },
    });
  });

  it('resets every user-scoped zustand store on signOut', async () => {
    await signOut();

    const coach = useCoachStore.getState();
    expect(coach.clients).toEqual([]);
    expect(coach.isLoading).toBe(false);
    expect(coach.loadError).toBeNull();
    expect(coach.searchQuery).toBe('');
    expect(coach.filterStatus).toBe('all');

    const client = useClientStore.getState();
    expect(client.foodLogs).toEqual([]);
    expect(client.dailyTotals).toEqual({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
    expect(client.waterOz).toBe(0);
    expect(client.isLoading).toBe(false);

    const fasting = useFastingStore.getState();
    expect(fasting.activeFast).toBeNull();
    expect(fasting.selectedProtocol).toBe(16);
    expect(fasting.history).toEqual([]);
    expect(fasting.isLoading).toBe(false);

    const banner = foregroundBannerStore.getState();
    expect(banner.banner).toBeNull();
  });

  it('exposes resetUserScopedStores() as a standalone helper that wipes all stores', () => {
    resetUserScopedStores();
    expect(useCoachStore.getState().clients).toEqual([]);
    expect(useClientStore.getState().foodLogs).toEqual([]);
    expect(useFastingStore.getState().activeFast).toBeNull();
    expect(foregroundBannerStore.getState().banner).toBeNull();
  });

  it('does not throw if a store reset throws — logout event must still proceed', async () => {
    const original = useCoachStore.getState().reset;
    useCoachStore.setState({
      reset: () => {
        throw new Error('boom');
      },
    });

    await expect(signOut()).resolves.toBeUndefined();

    // restore so later tests aren't affected
    useCoachStore.setState({ reset: original });
  });

  it('isolates per-store reset failures so the remaining stores still reset', () => {
    // Audit follow-up: outer try/catch used to short-circuit at the first
    // throw, leaving subsequent stores holding the previous user's state.
    // Each reset must now be wrapped individually.
    const originalCoachReset = useCoachStore.getState().reset;
    useCoachStore.setState({
      reset: () => {
        throw new Error('coach reset boom');
      },
    });

    expect(() => resetUserScopedStores()).not.toThrow();

    // Coach store still holds the seeded state because its reset threw…
    expect(useCoachStore.getState().clients.length).toBe(1);
    // …but every other user-scoped store was reset to initial state.
    expect(useClientStore.getState().foodLogs).toEqual([]);
    expect(useClientStore.getState().dailyTotals).toEqual({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
    expect(useFastingStore.getState().activeFast).toBeNull();
    expect(useFastingStore.getState().history).toEqual([]);
    expect(foregroundBannerStore.getState().banner).toBeNull();

    useCoachStore.setState({ reset: originalCoachReset });
  });
});
