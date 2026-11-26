// OFF-PHOTO-M: an Open Food Facts pick is logged by its off_<code> id; the server turns that id into its one
// shared food with the product's photo (backend food.service.ts:1060-1063, :1227-1276 at e24409bc), so the phone
// makes no private copy. Every other save sends what it sent before. Codes and names are made up.
import type { SearchResult } from '../types';
import { submitSearchLogOffline, submitSearchLogOnline } from '../logSubmit';
import { queuePastMeal, repeatPastMeal } from '../quickLog';
import { forgetSaveKeys } from '../saveKey';
import { shownFor } from '../queuedDay';
import { foodApi, logApi } from '../../../services/api';
import { enqueue } from '../../../services/foodLogQueue';
import type { PastMeal } from '../../../hooks/useFoodBrowse';

jest.mock('../../../services/api', () => ({
  foodApi: { create: jest.fn() },
  logApi: { logFood: jest.fn() },
}));
jest.mock('../../../services/foodLogQueue', () => ({ enqueue: jest.fn() }));

const product: SearchResult = {
  id: 'off_0000000012345', name: 'Oat crunch bar', brand: 'Madeup Mills',
  calories: 410, protein: 9, carbs: 62, fat: 14,
  nutrient_basis: 'PER_100G', serving_size: '100g', serving_size_grams: 100,
  image_url: 'https://images.example.test/oat-crunch.jpg',
};
const args = (food: SearchResult) => ({
  food, date: '2026-11-12', mealType: 'snack' as const, multiplier: 0.4, originalQuantity: 40, originalUnit: 'g',
});
const noAnswer = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

beforeEach(() => {
  jest.clearAllMocks();
  forgetSaveKeys();
  jest.mocked(foodApi.create).mockResolvedValue({ data: { id: 'private-copy' } } as never);
  jest.mocked(logApi.logFood).mockResolvedValue({ data: { id: 'entry-1' } } as never);
  jest.mocked(enqueue).mockResolvedValue(undefined as never);
});

describe('OFF-PHOTO-M case 1: an online search pick of an off_ id', () => {
  it('sends the off_ id as food_item_id with the save key and makes no food', async () => {
    await submitSearchLogOnline(args(product));
    expect(foodApi.create).not.toHaveBeenCalled();
    expect(logApi.logFood).toHaveBeenCalledTimes(1);
    expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({
      food_item_id: 'off_0000000012345', quantity_multiplier: 0.4, original_quantity: 40, original_unit: 'g',
      date: '2026-11-12', meal_type: 'snack', client_uuid: expect.stringMatching(/^pfl_/),
    }));
  });
});

describe('OFF-PHOTO-M case 2: an offline pick of an off_ id', () => {
  it('queues kind search with the off_ id, no food block, shown from the food', async () => {
    await submitSearchLogOffline(args(product));
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [item, key] = jest.mocked(enqueue).mock.calls[0];
    expect(item).toEqual(expect.objectContaining({ kind: 'search', foodItemId: 'off_0000000012345', shown: shownFor(product) }));
    expect((item as { food?: unknown }).food).toBeUndefined();
    expect(key).toMatch(/^pfl_/);
    expect(foodApi.create).not.toHaveBeenCalled();
  });
});

describe('OFF-PHOTO-M case 5: keys', () => {
  it('a lost online answer, then a tap again, sends the same key both times and no create', async () => {
    jest.mocked(logApi.logFood).mockRejectedValueOnce(noAnswer());
    await expect(submitSearchLogOnline(args(product))).rejects.toThrow('Network Error');
    await submitSearchLogOnline(args(product));
    const calls = jest.mocked(logApi.logFood).mock.calls.map(([body]) => body);
    expect(calls).toHaveLength(2);
    expect(calls[0].food_item_id).toBe('off_0000000012345');
    expect(calls[1].client_uuid).toBe(calls[0].client_uuid);
    expect(foodApi.create).not.toHaveBeenCalled();
  });

  it('a lost online try, then the same save queued offline, keeps the key as the queue id', async () => {
    jest.mocked(logApi.logFood).mockRejectedValueOnce(noAnswer());
    await expect(submitSearchLogOnline(args(product))).rejects.toThrow('Network Error');
    const sent = jest.mocked(logApi.logFood).mock.calls[0][0].client_uuid;
    await submitSearchLogOffline(args(product));
    const [item, key] = jest.mocked(enqueue).mock.calls[0];
    expect(key).toBe(sent);
    expect(item).toEqual(expect.objectContaining({ foodItemId: 'off_0000000012345' }));
    expect(foodApi.create).not.toHaveBeenCalled();
  });
});

describe('OFF-PHOTO-M case 8: every id a list holds is sent as is, no food made', () => {
  const ids: Array<[string, string]> = [
    ['a USDA pick', 'usda_171705'],
    ['a catalog row', '7d1f3c2a-0000-4000-8000-00000000c0de'],
    ['a Recent or Frequent row (a stored id)', '5b2e9e10-0000-4000-8000-0000000fee15'],
    ['a did-you-mean row with an off_ id (LogScreen.tsx:288-289, the same submit)', 'off_0000000067890'],
  ];
  it.each(ids)('%s online', async (_label, id) => {
    await submitSearchLogOnline(args({ ...product, id }));
    expect(foodApi.create).not.toHaveBeenCalled();
    expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({ food_item_id: id }));
  });
  it.each(ids)('%s offline', async (_label, id) => {
    await submitSearchLogOffline(args({ ...product, id }));
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'search', foodItemId: id, food: undefined }), expect.any(String));
  });

  const meal: PastMeal = {
    date: '2026-11-11', calories: 164,
    entries: [{ foodItemId: '5b2e9e10-0000-4000-8000-0000000fee15', name: 'Oat crunch bar', calories: 164, quantityMultiplier: 0.4 }],
  };
  it('a Repeat online sends each stored id (quickLog.ts:78-79)', async () => {
    await repeatPastMeal(meal, '2026-11-12', 'snack');
    expect(foodApi.create).not.toHaveBeenCalled();
    expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({ food_item_id: '5b2e9e10-0000-4000-8000-0000000fee15' }));
  });
  it('a Repeat offline queues each stored id (quickLog.ts:117-118)', async () => {
    await queuePastMeal(meal, '2026-11-12', 'snack');
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'search', foodItemId: '5b2e9e10-0000-4000-8000-0000000fee15' }), expect.any(String));
  });
});

describe('OFF-PHOTO-M case 9: a pick with no id still makes a food, as before', () => {
  const noId = { ...product, id: '' };
  it('online: creates the food from the row, then logs it', async () => {
    await submitSearchLogOnline(args(noId));
    expect(foodApi.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Oat crunch bar', nutrient_basis: 'PER_100G' }));
    expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({ food_item_id: 'private-copy' }));
  });
  it('offline: queues the food block and no id', async () => {
    await submitSearchLogOffline(args(noId));
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'search', foodItemId: undefined, food: expect.objectContaining({ name: 'Oat crunch bar' }),
    }), expect.any(String));
  });
});
