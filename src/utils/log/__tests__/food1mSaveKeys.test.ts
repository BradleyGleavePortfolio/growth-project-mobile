/**
 * FOOD-1-M R3 (operator ruling): one client key per intended save, made at the tap and kept through
 * every retry. Each save site below sends the key; a tap again after a lost answer sends the same key;
 * an answered or refused save lets the key go, so a new intended save gets a new key.
 */
import api, { foodApi, logApi, waterApi } from '../../../services/api';
import { enqueue } from '../../../services/foodLogQueue';
import {
  submitManualLogOffline, submitManualLogOnlineWithId, submitSearchLogOffline, submitSearchLogOnline,
} from '../logSubmit';
import { useClientStore } from '../../../store/clientStore';
import { repeatPastMeal } from '../quickLog';
import { withSaveKey } from '../saveKey';
import type { SearchResult } from '../types';

jest.mock('../../../services/foodLogQueue', () => ({ enqueue: jest.fn(async () => undefined) }));

const lost = () => Object.assign(new Error('Network Error'), { request: {} });
const answered = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const food = {
  id: 'oats', name: 'Rolled oats', calories: 379, protein: 13, carbs: 68, fat: 6.5,
  serving_size_grams: 40, nutrient_basis: 'PER_100G', supports_volume_units: false,
} as unknown as SearchResult;
const search = (date = '2026-10-30') => ({
  food, date, mealType: 'breakfast' as const, multiplier: 1, originalQuantity: 40, originalUnit: 'g',
});
const manual = (foodName = 'Breakfast bowl') => ({
  foodName, calories: '400', protein: '25', carbs: '45', fat: '13', quantity: '1', unit: 'serving',
  date: '2026-10-30', mealType: 'breakfast' as const,
});
const keysSent = () => jest.mocked(logApi.logFood).mock.calls.map((c) => c[0].client_uuid);

let post: jest.SpyInstance;
beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  post = jest.spyOn(api, 'post').mockResolvedValue({ data: { id: 'row' }, status: 201 } as never);
  jest.spyOn(foodApi, 'create').mockResolvedValue({ data: { id: 'custom' } } as never);
});

describe('FOOD-1-M R3 the save key', () => {
  it('logApi.logFood sends the key in the Idempotency-Key header as well as client_uuid', async () => {
    await logApi.logFood({ date: '2026-10-30', meal_type: 'breakfast', food_item_id: 'oats', client_uuid: 'pfl_k1' });
    expect(post).toHaveBeenCalledWith('/log/food', expect.objectContaining({ client_uuid: 'pfl_k1' }),
      { headers: { 'Idempotency-Key': 'pfl_k1' } });
  });

  it('waterApi.log sends the key in the header only (the water body takes no key)', async () => {
    await waterApi.log({ amount_ml: 237, date: '2026-10-30' }, 'pfl_w1');
    expect(post).toHaveBeenCalledWith('/nutrition/water', { amount_ml: 237, date: '2026-10-30' },
      { headers: { 'Idempotency-Key': 'pfl_w1' } });
  });

  it('a search log tapped again after a lost answer sends the same key; the next new log a new key', async () => {
    const logFood = jest.spyOn(logApi, 'logFood').mockRejectedValueOnce(lost()).mockResolvedValue({ data: {} } as never);
    await expect(submitSearchLogOnline(search())).rejects.toThrow('Network Error');
    await submitSearchLogOnline(search());
    await submitSearchLogOnline(search());
    const [first, retry, next] = keysSent();
    expect(logFood).toHaveBeenCalledTimes(3);
    expect(first).toMatch(/^pfl_/);
    expect(retry).toBe(first);
    expect(next).not.toBe(first);
  });

  it('a server error keeps the key; a refusal (4xx) lets it go', async () => {
    jest.spyOn(logApi, 'logFood')
      .mockRejectedValueOnce(answered(503)).mockRejectedValueOnce(answered(400)).mockResolvedValue({ data: {} } as never);
    await expect(submitSearchLogOnline(search())).rejects.toThrow('HTTP 503');
    await expect(submitSearchLogOnline(search())).rejects.toThrow('HTTP 400');
    await submitSearchLogOnline(search());
    const [first, afterServerError, afterRefusal] = keysSent();
    expect(afterServerError).toBe(first);
    expect(afterRefusal).not.toBe(first);
  });

  it('an online try whose answer was lost hands its key to the offline queue entry', async () => {
    jest.spyOn(logApi, 'logFood').mockRejectedValueOnce(lost());
    await expect(submitSearchLogOnline(search('2026-10-29'))).rejects.toThrow();
    await submitSearchLogOffline(search('2026-10-29'));
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'search' }), keysSent()[0]);
  });

  it('a manual or planned food tapped again after a lost answer sends the same key, online or queued', async () => {
    jest.spyOn(logApi, 'logFood').mockRejectedValueOnce(lost()).mockResolvedValue({ data: { id: 'row' } } as never);
    await expect(submitManualLogOnlineWithId(manual())).rejects.toThrow();
    await submitManualLogOnlineWithId(manual());
    expect(keysSent()[1]).toBe(keysSent()[0]);

    jest.mocked(logApi.logFood).mockRejectedValueOnce(lost());
    await expect(submitManualLogOnlineWithId(manual('Plan dinner'))).rejects.toThrow();
    await submitManualLogOffline(manual('Plan dinner'));
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'manual' }), keysSent()[2]);
  });

  it('a repeated meal keys each food; repeating again after a lost answer reuses that food\'s key', async () => {
    const meal = {
      mealType: 'breakfast', date: '2026-10-29', entries: [
        { foodItemId: 'oats', name: 'Oats', quantityMultiplier: 1, originalQuantity: 40, originalUnit: 'g' },
        { foodItemId: 'milk', name: 'Milk', quantityMultiplier: 1, originalQuantity: 1, originalUnit: 'cup' },
      ],
    } as never;
    jest.spyOn(logApi, 'logFood').mockImplementation(async (body) => {
      if (body.food_item_id === 'milk' && jest.mocked(logApi.logFood).mock.calls.length <= 2) throw lost();
      return { data: {} } as never;
    });
    const first = await repeatPastMeal(meal, '2026-10-30', 'breakfast');
    expect(first.failedNames).toEqual(['Milk']);
    await repeatPastMeal(meal, '2026-10-30', 'breakfast');
    const calls = jest.mocked(logApi.logFood).mock.calls.map((c) => c[0]);
    const milk = calls.filter((b) => b.food_item_id === 'milk').map((b) => b.client_uuid);
    expect(milk[0]).toMatch(/^pfl_/);
    expect(milk[1]).toBe(milk[0]);
    expect(new Set(calls.filter((b) => b.food_item_id === 'oats').map((b) => b.client_uuid)).size).toBe(2);
  });

  it('two of the same save in flight at once are two saves with two keys (two glasses of water)', async () => {
    const keys: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const glass = () => withSaveKey(['water', '2026-10-30', 237], async (key) => { keys.push(key); await gate; });
    const both = Promise.all([glass(), glass()]);
    release();
    await both;
    expect(new Set(keys).size).toBe(2);
  });

  it('sign-out drops every unanswered key, so the next account on the phone never sends one', async () => {
    jest.spyOn(logApi, 'logFood').mockRejectedValueOnce(lost()).mockResolvedValue({ data: {} } as never);
    await expect(submitSearchLogOnline(search())).rejects.toThrow('Network Error');
    useClientStore.getState().reset();
    await submitSearchLogOnline(search());
    const [beforeSignOut, nextAccount] = keysSent();
    expect(nextAccount).toMatch(/^pfl_/);
    expect(nextAccount).not.toBe(beforeSignOut);
  });
});
