import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, offlineFoodInDay: true } };
});
jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'member-1' })),
}));
const mockGetDaily = jest.fn();
jest.mock('../api', () => ({
  foodApi: { create: jest.fn() },
  logApi: { getDaily: (...args: unknown[]) => mockGetDaily(...args), logFood: jest.fn() },
  waterApi: { getDaily: jest.fn(async () => ({ data: { entries: [], total_oz: 0 } })) },
}));

import { useClientStore } from '../../store/clientStore';
import { dropQueued, enqueue, readQueue } from '../foodLogQueue';
import { notifyPendingFoodLogs } from '../foodLogSync';

const DAY = '2026-11-04';
const empty = () => ({ data: {
  entries: [], total_calories: 0, total_protein_g: 0, total_carbs_g: 0, total_fat_g: 0,
} });
const item = {
  kind: 'search' as const,
  foodItemId: 'oats',
  shown: { name: 'Rolled oats', calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3 },
  log: { date: DAY, meal_type: 'breakfast' as const, quantity_multiplier: 1 },
};

beforeEach(async () => {
  await AsyncStorage.clear();
  mockGetDaily.mockReset();
  useClientStore.getState().reset();
});

it.each([
  ['add', 'success'], ['add', 'failure'],
  ['remove', 'success'], ['remove', 'failure'],
] as const)(
  'a day refresh ending in %s/%s cannot overwrite a newer offline queue mutation',
  async (mutation, result) => {
    if (mutation === 'remove') await enqueue(item, 'oats-intent');
    mockGetDaily.mockResolvedValueOnce(empty());
    await useClientStore.getState().loadDayData('member-1', DAY);

    let answer!: (value: ReturnType<typeof empty>) => void;
    let fail!: (reason: Error) => void;
    mockGetDaily.mockImplementationOnce(() => new Promise((resolve, reject) => {
      answer = resolve;
      fail = reject;
    }));
    const pending = useClientStore.getState().loadDayData('member-1', DAY);
    // The queue read has finished; the network request is still pending.
    await new Promise<void>((resolve) => setImmediate(resolve));

    if (mutation === 'add') await enqueue(item, 'oats-intent');
    else await dropQueued('oats-intent');
    await notifyPendingFoodLogs();
    const ids = mutation === 'add' ? ['oats-intent'] : [];
    expect(useClientStore.getState().foodLogs.map((food) => food.id)).toEqual(ids);

    if (result === 'success') answer(empty());
    else fail(new Error('Network Error'));
    await pending;

    expect((await readQueue()).map((food) => food.id)).toEqual(ids);
    expect(useClientStore.getState().foodLogs.map((food) => food.id)).toEqual(ids);
    expect(useClientStore.getState().dailyTotals.calories).toBe(mutation === 'add' ? 150 : 0);
  },
);
