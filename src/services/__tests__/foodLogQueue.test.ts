import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueue, flush, getQueueLength, clearQueue } from '../foodLogQueue';

jest.mock('../api', () => {
  const create = jest.fn();
  const logFood = jest.fn();
  return {
    __create: create,
    __logFood: logFood,
    foodApi: { create },
    logApi: { logFood },
  };
});

const api = jest.requireMock('../api') as {
  __create: jest.Mock;
  __logFood: jest.Mock;
};

describe('foodLogQueue — offline enqueue + flush on reconnect', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await clearQueue();
    api.__create.mockReset();
    api.__logFood.mockReset();
  });

  it('enqueues entries while offline and flushes them in order when reconnected', async () => {
    // Simulate two writes while offline.
    await enqueue({
      kind: 'search',
      foodItemId: 'food-123',
      log: { date: '2026-04-23', meal_type: 'lunch', quantity_multiplier: 1 },
    });
    await enqueue({
      kind: 'manual',
      food: {
        name: 'Homemade chili',
        brand_or_restaurant: null,
        category: 'other',
        serving_description: '1 cup',
        serving_size_grams: 250,
        calories: 400,
        protein_g: 30,
        carbs_g: 35,
        fat_g: 15,
        tags: [],
        search_aliases: [],
      },
      log: { date: '2026-04-23', meal_type: 'dinner', quantity_multiplier: 1 },
    });

    expect(await getQueueLength()).toBe(2);

    // Reconnect: flush should send the first as-is and create+log the second.
    api.__create.mockResolvedValue({ data: { id: 'food-456' } });
    api.__logFood.mockResolvedValue({ data: {} });

    const { flushed, remaining } = await flush();

    expect(flushed).toBe(2);
    expect(remaining).toBe(0);
    expect(api.__create).toHaveBeenCalledTimes(1);
    expect(api.__logFood).toHaveBeenCalledTimes(2);
    expect(api.__logFood).toHaveBeenNthCalledWith(1, expect.objectContaining({ food_item_id: 'food-123' }));
    expect(api.__logFood).toHaveBeenNthCalledWith(2, expect.objectContaining({ food_item_id: 'food-456' }));
    expect(await getQueueLength()).toBe(0);
  });

  it('stops flushing on first failure and leaves remaining entries queued', async () => {
    await enqueue({
      kind: 'search',
      foodItemId: 'a',
      log: { date: '2026-04-23', meal_type: 'breakfast', quantity_multiplier: 1 },
    });
    await enqueue({
      kind: 'search',
      foodItemId: 'b',
      log: { date: '2026-04-23', meal_type: 'snack', quantity_multiplier: 1 },
    });

    api.__logFood
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(new Error('backend down'));

    const { flushed, remaining } = await flush();

    expect(flushed).toBe(1);
    expect(remaining).toBe(1);
    expect(await getQueueLength()).toBe(1);
  });
});
