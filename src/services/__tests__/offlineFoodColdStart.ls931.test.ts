import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, offlineFoodInDay: true } };
});
jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'member-1' })),
}));
jest.mock('../api', () => ({
  foodApi: { create: jest.fn() },
  logApi: { getDaily: jest.fn(async () => { throw new Error('Network Error'); }), logFood: jest.fn() },
  waterApi: { getDaily: jest.fn(async () => { throw new Error('Network Error'); }) },
}));

import { useClientStore } from '../../store/clientStore';
import { enqueue, readQueue } from '../foodLogQueue';
import { notifyPendingFoodLogs } from '../foodLogSync';

const DAY = '2026-11-04';
const item = {
  kind: 'search' as const,
  foodItemId: 'oats',
  shown: { name: 'Rolled oats', calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3 },
  log: { date: DAY, meal_type: 'breakfast' as const, quantity_multiplier: 1 },
};

beforeEach(async () => {
  await AsyncStorage.clear();
  useClientStore.getState().reset();
  useClientStore.getState().setSelectedDate(DAY);
});

it.each(['queued before restart', 'saved after offline start'])(
  'a food %s is visible and counted without any successful network read',
  async (scenario) => {
    if (scenario === 'queued before restart') {
      await enqueue(item, 'pfl-cold-start');
      useClientStore.getState().reset();
      useClientStore.getState().setSelectedDate(DAY);
    }
    await useClientStore.getState().loadDayData('member-1', DAY);
    if (scenario === 'saved after offline start') await enqueue(item, 'pfl-cold-start');
    await notifyPendingFoodLogs();

    // The food is durable, so an absent row is an offline day-read failure, not a lost disk write.
    expect(await readQueue()).toHaveLength(1);
    const store = useClientStore.getState();
    expect(store.foodLogs).toEqual([
      expect.objectContaining({ id: 'pfl-cold-start', foodName: 'Rolled oats', offline: 'waiting' }),
    ]);
    expect(store.dailyTotals).toEqual({ calories: 150, protein: 5, carbs: 27, fat: 3 });
  },
);
