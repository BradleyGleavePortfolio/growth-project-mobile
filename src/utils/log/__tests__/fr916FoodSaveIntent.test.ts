/**
 * FR-916 F1: one food save, one key, whichever path sends it. A food whose answer was lost sends its kept
 * key again from Repeat, Recent or search, online or queued; a food the member logs again after the first
 * was answered is a new save with its own key.
 */
import api, { logApi } from '../../../services/api';
import { enqueue } from '../../../services/foodLogQueue';
import { submitSearchLogOffline, submitSearchLogOnline } from '../logSubmit';
import { repeatPastMeal } from '../quickLog';
import { forgetSaveKeys } from '../saveKey';
import type { SearchResult } from '../types';

jest.mock('../../../services/foodLogQueue', () => ({ enqueue: jest.fn(async () => undefined) }));

const lost = () => Object.assign(new Error('Network Error'), { request: {} });
const day = '2026-10-30';
const milk = {
  id: 'milk', name: 'Milk', calories: 42, protein: 3.4, carbs: 5, fat: 1,
  serving_size_grams: 244, nutrient_basis: 'PER_100G', supports_volume_units: true,
} as unknown as SearchResult;
const milkAdd = { food: milk, date: day, mealType: 'breakfast' as const, multiplier: 1, originalQuantity: 1, originalUnit: 'cup' };
const meal = (entries: Array<[string, number]>) => ({
  mealType: 'breakfast', date: '2026-10-29',
  entries: entries.map(([id, q]) => ({ foodItemId: id, name: id, quantityMultiplier: q, originalQuantity: q, originalUnit: 'cup' })),
}) as never;

let keys: Array<{ food: string; key: string }>;
let loseMilk: number;
beforeEach(() => {
  forgetSaveKeys();
  keys = [];
  loseMilk = 0;
  (enqueue as jest.Mock).mockClear();
  jest.spyOn(api, 'post').mockResolvedValue({ data: {}, status: 201 } as never);
  jest.spyOn(logApi, 'logFood').mockImplementation(async (body) => {
    keys.push({ food: body.food_item_id, key: body.client_uuid as string });
    if (body.food_item_id === 'milk' && loseMilk-- > 0) throw lost(); // saved, answer lost
    return { data: { id: body.client_uuid } } as never;
  });
});
afterEach(() => jest.restoreAllMocks());

const milkKeys = () => keys.filter((k) => k.food === 'milk').map((k) => k.key);

it('FR-916: a repeat whose milk answer was lost, then milk added from Recent while offline, queues the kept key', async () => {
  loseMilk = 1;
  expect((await repeatPastMeal(meal([['oats', 0.4], ['milk', 1]]), day, 'breakfast')).failedNames).toEqual(['milk']);
  await submitSearchLogOffline(milkAdd);
  expect(enqueue).toHaveBeenCalledTimes(1);
  expect((enqueue as jest.Mock).mock.calls[0][1]).toBe(milkKeys()[0]);
});

it('FR-916: a repeat whose milk answer was lost, repeated again, then milk added from search, sends one key', async () => {
  loseMilk = 2;
  await repeatPastMeal(meal([['milk', 1]]), day, 'breakfast');
  await repeatPastMeal(meal([['milk', 1]]), day, 'breakfast');
  await submitSearchLogOnline(milkAdd);
  expect(new Set(milkKeys()).size).toBe(1);
  expect(milkKeys()).toHaveLength(3);
});

it('FR-916: milk logged again after the first milk was answered is a new save with its own key', async () => {
  await repeatPastMeal(meal([['milk', 1]]), day, 'breakfast');
  await submitSearchLogOnline(milkAdd);
  await submitSearchLogOnline(milkAdd);
  expect(new Set(milkKeys()).size).toBe(3);
});

it('FR-916: the same food twice in one repeated meal is two saves, and a lost one keeps only its own key', async () => {
  loseMilk = 1;
  const first = await repeatPastMeal(meal([['milk', 1], ['milk', 1]]), day, 'breakfast');
  expect(first.added).toBe(1);
  expect(new Set(milkKeys()).size).toBe(2);
  await submitSearchLogOnline(milkAdd);
  // The Recent add after the lost one sends the lost one's key, not the answered one's.
  expect(milkKeys()[2]).toBe(milkKeys()[0]);
});

it('FR-916: a different portion of the same food is a different save', async () => {
  loseMilk = 1;
  await repeatPastMeal(meal([['milk', 1]]), day, 'breakfast');
  await submitSearchLogOnline({ ...milkAdd, multiplier: 2, originalQuantity: 2 });
  expect(new Set(milkKeys()).size).toBe(2);
});
