import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  enqueue,
  flush,
  getQueueLength,
  clearQueue,
  mergeAnonymousQueueIntoUser,
} from '../foodLogQueue';

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

const mockUserCache = { id: undefined as string | undefined };
jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() =>
    mockUserCache.id ? { id: mockUserCache.id } : null,
  ),
}));

const api = jest.requireMock('../api') as {
  __create: jest.Mock;
  __logFood: jest.Mock;
};

describe('foodLogQueue — offline enqueue + flush on reconnect', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockUserCache.id = undefined;
    await clearQueue();
    api.__create.mockReset();
    api.__logFood.mockReset();
  });

  it('enqueues entries while offline and flushes them in order when reconnected', async () => {
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

    api.__create.mockResolvedValue({ data: { id: 'food-456' } });
    api.__logFood.mockResolvedValue({ data: {} });

    const { flushed, remaining } = await flush();

    expect(flushed).toBe(2);
    expect(remaining).toBe(0);
    expect(api.__create).toHaveBeenCalledTimes(1);
    expect(api.__logFood).toHaveBeenCalledTimes(2);
    expect(api.__logFood).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ food_item_id: 'food-123' }),
    );
    expect(api.__logFood).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ food_item_id: 'food-456' }),
    );
    expect(await getQueueLength()).toBe(0);
  });

  it('stops flushing on first transient failure and leaves remaining entries queued', async () => {
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

  it('drops items on permanent 4xx but continues flushing remaining items', async () => {
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

    const e400 = Object.assign(new Error('bad payload'), {
      response: { status: 400 },
    });
    api.__logFood
      .mockRejectedValueOnce(e400)
      .mockResolvedValueOnce({ data: {} });

    const { flushed, remaining, dropped } = await flush();

    expect(dropped).toBe(1);
    expect(flushed).toBe(1);
    expect(remaining).toBe(0);
  });

  it('preserves the queue on 401 (lets the auth refresh layer handle it)', async () => {
    await enqueue({
      kind: 'search',
      foodItemId: 'a',
      log: { date: '2026-04-23', meal_type: 'breakfast', quantity_multiplier: 1 },
    });

    const e401 = Object.assign(new Error('unauthorized'), {
      response: { status: 401 },
    });
    api.__logFood.mockRejectedValueOnce(e401);

    const { flushed, remaining, dropped } = await flush();

    expect(flushed).toBe(0);
    expect(dropped).toBe(0);
    expect(remaining).toBe(1);
  });

  it('preserves the queue on 5xx errors', async () => {
    await enqueue({
      kind: 'search',
      foodItemId: 'a',
      log: { date: '2026-04-23', meal_type: 'breakfast', quantity_multiplier: 1 },
    });

    const e503 = Object.assign(new Error('service unavailable'), {
      response: { status: 503 },
    });
    api.__logFood.mockRejectedValueOnce(e503);

    const { remaining, dropped } = await flush();
    expect(remaining).toBe(1);
    expect(dropped).toBe(0);
  });

  it('captures userId once at the top of flush — sign-out mid-flush does not retarget the queue key', async () => {
    mockUserCache.id = 'user-A';
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

    // Simulate sign-out happening after the first success but before the second.
    api.__logFood.mockImplementationOnce(async () => {
      mockUserCache.id = undefined;
      return { data: {} };
    });
    api.__logFood.mockResolvedValueOnce({ data: {} });

    const { flushed } = await flush();
    expect(flushed).toBe(2);

    // The user-A queue should be drained — not the anonymous one. If we had
    // re-read userId mid-flush, the second write would have landed in the
    // anonymous key and left user-A's queue with one stale row.
    const userAQueue = await AsyncStorage.getItem('pending_food_logs_user-A');
    expect(userAQueue).toBe('[]');
    expect(
      await AsyncStorage.getItem('pending_food_logs_anonymous'),
    ).toBeNull();
  });

  it('mergeAnonymousQueueIntoUser folds anonymous items into the user queue and removes the anonymous key', async () => {
    // Seed anonymous queue
    mockUserCache.id = undefined;
    await enqueue({
      kind: 'search',
      foodItemId: 'anon-1',
      log: { date: '2026-04-23', meal_type: 'breakfast', quantity_multiplier: 1 },
    });
    await enqueue({
      kind: 'search',
      foodItemId: 'anon-2',
      log: { date: '2026-04-23', meal_type: 'lunch', quantity_multiplier: 1 },
    });

    // Seed user queue separately
    mockUserCache.id = 'user-A';
    await enqueue({
      kind: 'search',
      foodItemId: 'user-1',
      log: { date: '2026-04-23', meal_type: 'dinner', quantity_multiplier: 1 },
    });

    const { merged } = await mergeAnonymousQueueIntoUser('user-A');

    expect(merged).toBe(2);
    expect(
      await AsyncStorage.getItem('pending_food_logs_anonymous'),
    ).toBeNull();

    const userQueueRaw = await AsyncStorage.getItem(
      'pending_food_logs_user-A',
    );
    const userQueue = JSON.parse(userQueueRaw ?? '[]');
    // Anonymous items come first (FIFO order preserved).
    expect(userQueue).toHaveLength(3);
    expect(userQueue[0].foodItemId).toBe('anon-1');
    expect(userQueue[1].foodItemId).toBe('anon-2');
    expect(userQueue[2].foodItemId).toBe('user-1');
  });

  it('uses crypto-grade UUIDs for queue item ids (no Math.random collision)', async () => {
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
    const raw = await AsyncStorage.getItem('pending_food_logs_anonymous');
    const queue = JSON.parse(raw ?? '[]');
    expect(queue[0].id).toMatch(/^pfl_[0-9a-f-]{36}$/);
    expect(queue[1].id).toMatch(/^pfl_[0-9a-f-]{36}$/);
    expect(queue[0].id).not.toBe(queue[1].id);
  });
});
