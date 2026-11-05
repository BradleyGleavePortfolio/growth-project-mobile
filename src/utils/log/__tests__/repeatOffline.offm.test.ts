// OFFLINE-FOOD-M: Repeat ({day}'s {meal}) with no signal queues each food of the meal once, each
// with its own key, and the queue sends each once on reconnect.
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: jest.fn(() => ({ id: 'member-1' })) }));
jest.mock('../../../services/api', () => ({
  foodApi: { create: jest.fn() },
  logApi: { logFood: jest.fn(async () => ({ data: {} })) },
}));

import * as quickLog from '../quickLog';
import { flush, getQueueLength, readQueue } from '../../../services/foodLogQueue';
import type { PastMeal } from '../../../hooks/useFoodBrowse';

const { logApi } = jest.requireMock('../../../services/api') as { logApi: { logFood: jest.Mock } };

const meal: PastMeal = {
  date: '2026-11-03',
  calories: 250,
  entries: [
    { foodItemId: 'food-oats', name: 'Rolled oats', calories: 150, quantityMultiplier: 1, originalQuantity: 1, originalUnit: 'serving',
      shown: { name: 'Rolled oats', calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3 } },
    { foodItemId: 'food-milk', name: 'Milk', calories: 100, quantityMultiplier: 1,
      shown: { name: 'Milk', calories: 100, protein_g: 8, carbs_g: 12, fat_g: 2 } },
  ],
} as PastMeal;

beforeEach(async () => {
  await AsyncStorage.clear();
  logApi.logFood.mockClear();
});

it('queues each food of the meal once, each with its own key and the same portion', async () => {
  const queuePastMeal = (quickLog as unknown as { queuePastMeal?: typeof quickLog.queuePastMeal }).queuePastMeal;
  expect(typeof queuePastMeal).toBe('function');
  const queued = await queuePastMeal!(meal, '2026-11-04', 'breakfast');
  expect(queued).toBe(2);
  const queue = await readQueue();
  expect(queue.map((q) => (q.kind === 'search' ? q.foodItemId : null))).toEqual(['food-oats', 'food-milk']);
  expect(new Set(queue.map((q) => q.id)).size).toBe(2);
  expect(queue.every((q) => q.log.date === '2026-11-04' && q.log.meal_type === 'breakfast')).toBe(true);
  expect(queue[0].shown?.name).toBe('Rolled oats');
  expect(queue[0].log.original_unit).toBe('serving');

  await flush();
  expect(logApi.logFood).toHaveBeenCalledTimes(2);
  const keys = logApi.logFood.mock.calls.map((c) => c[0].client_uuid);
  expect(keys).toEqual(queue.map((q) => q.id));
  expect(await getQueueLength()).toBe(0);
});

it('the same food twice in one meal is two saves with two keys', async () => {
  const twice = { ...meal, entries: [meal.entries[0], meal.entries[0]] } as PastMeal;
  await quickLog.queuePastMeal(twice, '2026-11-04', 'breakfast');
  const queue = await readQueue();
  expect(queue).toHaveLength(2);
  expect(queue[0].id).not.toBe(queue[1].id);
});
