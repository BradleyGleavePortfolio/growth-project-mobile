// OFF-PHOTO-M: the real offline queue (api mocked) with an Open Food Facts pick saved offline by the real
// submitSearchLogOffline. The server answers are built from backend e24409bc: an off_ id resolves to the one
// shared row (food.service.ts:1060-1063, :1227-1276); a refused product answers 404 "Food not found"
// (log.service.ts:264-271); an Open Food Facts outage throws, a 500 (food.service.ts:1146, :1153).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearQueue, enqueue, flush, readQueue } from '../foodLogQueue';
import { submitSearchLogOffline } from '../../utils/log/logSubmit';
import { forgetSaveKeys } from '../../utils/log/saveKey';
import { withQueuedFoods } from '../../utils/log/queuedDay';
import type { SearchResult } from '../../utils/log/types';

jest.mock('../api', () => {
  const create = jest.fn();
  const logFood = jest.fn();
  return { __create: create, __logFood: logFood, foodApi: { create }, logApi: { logFood } };
});
const mockUserCache = { id: 'member-off' as string | undefined };
jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => (mockUserCache.id ? { id: mockUserCache.id } : null)),
}));
const api = jest.requireMock('../api') as { __create: jest.Mock; __logFood: jest.Mock };

const DAY = '2026-11-12';
const product: SearchResult = {
  id: 'off_0000000012345', name: 'Oat crunch bar', brand: 'Madeup Mills',
  calories: 410, protein: 9, carbs: 62, fat: 14,
  nutrient_basis: 'PER_100G', serving_size: '100g', serving_size_grams: 100,
  image_url: 'https://images.example.test/oat-crunch.jpg',
};
const saveOffline = () => submitSearchLogOffline({
  food: product, date: DAY, mealType: 'snack', multiplier: 0.4, originalQuantity: 40, originalUnit: 'g',
});
const answer = (status: number, message: string) =>
  Object.assign(new Error(message), { response: { status, data: { statusCode: status, message } } });
const zero = { calories: 0, protein: 0, carbs: 0, fat: 0 };

beforeEach(async () => {
  await AsyncStorage.clear();
  mockUserCache.id = 'member-off';
  await clearQueue();
  forgetSaveKeys();
  api.__create.mockReset();
  api.__logFood.mockReset();
  api.__create.mockResolvedValue({ data: { id: 'private-copy' } });
  api.__logFood.mockResolvedValue({ data: { id: 'entry-1' } });
});

describe('OFF-PHOTO-M case 3: the queue flushes an offline off_ pick by its id', () => {
  it('sends food_item_id off_<code> with client_uuid = the item id, and creates nothing', async () => {
    await saveOffline();
    const [item] = await readQueue();
    const { flushed, remaining } = await flush();
    expect(flushed).toBe(1);
    expect(remaining).toBe(0);
    expect(api.__create).not.toHaveBeenCalled();
    expect(api.__logFood).toHaveBeenCalledTimes(1);
    expect(api.__logFood).toHaveBeenCalledWith(expect.objectContaining({
      food_item_id: 'off_0000000012345', client_uuid: item.id, date: DAY, meal_type: 'snack', quantity_multiplier: 0.4,
    }));
  });
});

describe('OFF-PHOTO-M case 4: an item an older build queued with a food block still flushes by create', () => {
  it('creates the food block, then logs the new id, as before', async () => {
    await enqueue({
      kind: 'search',
      food: {
        name: 'Oat crunch bar', brand_or_restaurant: 'Madeup Mills', category: 'generic', serving_description: '100g',
        serving_size_grams: 100, nutrient_basis: 'PER_100G', calories: 410, protein_g: 9, carbs_g: 62, fat_g: 14,
        tags: [], search_aliases: [],
      },
      log: { date: DAY, meal_type: 'snack', quantity_multiplier: 0.4 },
    }, 'pfl_older-build-item');
    await flush();
    expect(api.__create).toHaveBeenCalledTimes(1);
    expect(api.__logFood).toHaveBeenCalledWith(expect.objectContaining({ food_item_id: 'private-copy', client_uuid: 'pfl_older-build-item' }));
  });
});

describe('OFF-PHOTO-M case 7: what the server answers a queued off_ pick', () => {
  it('a 404 "Food not found" parks the item; the day shows it refused and does not count it', async () => {
    api.__logFood.mockRejectedValue(answer(404, 'Food not found'));
    await saveOffline();
    const { parked } = await flush();
    expect(parked).toBe(1);
    expect(api.__create).not.toHaveBeenCalled();
    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].parkedAt).toEqual(expect.any(Number));
    const day = withQueuedFoods([], zero, queue, DAY, 'member-off');
    expect(day.foodLogs).toEqual([expect.objectContaining({ foodName: 'Oat crunch bar', offline: 'refused' })]);
    expect(day.dailyTotals).toEqual(zero);
    // Parked: never sent again.
    await flush();
    expect(api.__logFood).toHaveBeenCalledTimes(1);
  });

  it('a 500 (an Open Food Facts outage) keeps the item waiting and retries it later, never parked', async () => {
    api.__logFood.mockRejectedValueOnce(answer(500, 'Internal server error'));
    await saveOffline();
    const first = await flush();
    expect(first).toEqual(expect.objectContaining({ flushed: 0, remaining: 1, parked: 0 }));
    const queue = await readQueue();
    expect(queue[0].parkedAt).toBeUndefined();
    expect(withQueuedFoods([], zero, queue, DAY, 'member-off').foodLogs[0].offline).toBe('waiting');
    const second = await flush();
    expect(second).toEqual(expect.objectContaining({ flushed: 1, remaining: 0 }));
    const bodies = api.__logFood.mock.calls.map(([b]) => b);
    expect(bodies.map((b) => b.food_item_id)).toEqual(['off_0000000012345', 'off_0000000012345']);
    expect(bodies[1].client_uuid).toBe(bodies[0].client_uuid);
    expect(api.__create).not.toHaveBeenCalled();
  });
});
