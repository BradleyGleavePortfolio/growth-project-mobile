import AsyncStorage from '@react-native-async-storage/async-storage';

let mockMemberId = 'member-a';
jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, offlineFoodInDay: true } };
});
jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: mockMemberId })),
}));
jest.mock('../api', () => ({
  foodApi: { create: jest.fn() },
  logApi: {
    getDaily: jest.fn(async () => ({ data: {
      entries: [], totals: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
    } })),
    logFood: jest.fn(),
  },
  waterApi: { getDaily: jest.fn(async () => ({ data: { total_oz: 0, entries: [] } })) },
}));

import { useClientStore } from '../../store/clientStore';
import { enqueue } from '../foodLogQueue';
import { notifyPendingFoodLogs } from '../foodLogSync';

// LS-931 B4 is deferred to v1.1 by the owner (#193-E4; #196-D12: "v1.1", #196-E14): one client signing out and
// another signing in on the same phone. Kept as a known failure, so it turns red (to flip back to `it`) the day
// the v1.1 fix lands.
it.failing('a queue read started by the old account cannot populate the second account after reset', async () => {
  await AsyncStorage.clear();
  useClientStore.getState().reset();
  const day = '2026-11-04';
  mockMemberId = 'member-a';
  await enqueue({
    kind: 'search', foodItemId: 'a-food',
    shown: { name: 'Member A private meal', calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3 },
    log: { date: day, meal_type: 'breakfast', quantity_multiplier: 1 },
  }, 'pfl-member-a');

  const keyA = 'pending_food_logs_member-a';
  const rawA = await AsyncStorage.getItem(keyA);
  const normalGet = AsyncStorage.getItem;
  const release: Array<() => void> = [];
  const getItem = jest.spyOn(AsyncStorage, 'getItem').mockImplementation((key: string) => key === keyA
    ? new Promise((resolve) => release.push(() => resolve(rawA)))
    : normalGet(key));

  try {
    const oldAccountRead = notifyPendingFoodLogs();
    // Both queue/count reads have already captured A's key and returned pending storage promises.
    expect(release).toHaveLength(2);
    useClientStore.getState().reset();
    mockMemberId = 'member-b';
    await useClientStore.getState().loadDayData('member-b', day);
    expect(useClientStore.getState().foodLogs).toEqual([]);
    for (const done of release) done();
    await oldAccountRead;

    expect(useClientStore.getState().serverDay?.userId).toBe('member-b');
    expect(useClientStore.getState().foodLogs).toEqual([]);
    expect(useClientStore.getState().queuedFoods).toEqual([]);
  } finally {
    getItem.mockRestore();
  }
});
