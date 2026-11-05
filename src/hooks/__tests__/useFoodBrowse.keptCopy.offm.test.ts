// OFFLINE-FOOD-M (owner #191-E3): Recent, Frequent and the Repeat card are kept on the phone after
// each good read, per member, and shown from that copy when no day can be read (no signal).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';

jest.mock('../../services/api', () => ({
  __esModule: true,
  logApi: { getDaily: jest.fn() },
}));

import { useFoodBrowse } from '../useFoodBrowse';
import { logApi } from '../../services/api';

const getDaily = logApi.getDaily as jest.MockedFunction<typeof logApi.getDaily>;

const oats = {
  id: 'food-oats', name: 'Rolled oats', calories: 379, protein_g: 13, carbs_g: 68, fat_g: 6.5,
  serving_size_grams: 40, nutrient_basis: 'PER_100G', supports_volume_units: false,
};
const banana = {
  id: 'food-banana', name: 'Banana', calories: 89, protein_g: 1.1, carbs_g: 23, fat_g: 0.3,
  serving_size_grams: 118, nutrient_basis: 'PER_100G', supports_volume_units: false,
};
const entry = (id: string, food: typeof oats, meal: string, multiplier: number, qty: number, unit: string) => ({
  id, food_item_id: food.id, meal_type: meal, quantity_multiplier: multiplier,
  original_quantity: qty, original_unit: unit, food_item: food,
});
const days: Record<string, unknown[]> = {
  '2026-11-04': [],
  '2026-11-03': [entry('e1', oats, 'breakfast', 0.6, 60, 'g'), entry('e2', banana, 'breakfast', 1.18, 1, 'serving')],
};
const NO_SIGNAL = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

async function openSheet(userId: string) {
  const hook = await renderHook(() => useFoodBrowse(userId, '2026-11-04'));
  await act(async () => {
    await hook.result.current.loadBrowseFoods();
  });
  // Let the copy's write settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return hook;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  getDaily.mockReset();
});

it('a good read is kept; with no signal a fresh sheet shows Recent, Frequent and Repeat from it', async () => {
  getDaily.mockImplementation(async (date: string) => ({ data: { entries: days[date] ?? [] } }) as never);
  const first = await openSheet('member-1');
  expect(first.result.current.recentFoods.map((f) => f.name)).toEqual(['Banana', 'Rolled oats']);

  getDaily.mockReset();
  getDaily.mockRejectedValue(NO_SIGNAL);
  const offline = await openSheet('member-1');
  expect(offline.result.current.browseUnavailable).toBe(true);
  expect(offline.result.current.recentFoods.map((f) => f.name)).toEqual(['Banana', 'Rolled oats']);
  expect(offline.result.current.frequentFoods.map((f) => f.name).sort()).toEqual(['Banana', 'Rolled oats']);
  const breakfast = offline.result.current.lastMeals.breakfast;
  expect(breakfast?.entries.map((e) => e.name)).toEqual(['Rolled oats', 'Banana']);
  expect(breakfast?.entries[0]).toMatchObject({ foodItemId: 'food-oats', quantityMultiplier: 0.6, originalQuantity: 60, originalUnit: 'g' });
});

it('another member on the same phone does not see the kept lists', async () => {
  getDaily.mockImplementation(async (date: string) => ({ data: { entries: days[date] ?? [] } }) as never);
  await openSheet('member-1');

  getDaily.mockReset();
  getDaily.mockRejectedValue(NO_SIGNAL);
  const other = await openSheet('member-2');
  expect(other.result.current.recentFoods).toEqual([]);
  expect(other.result.current.lastMeals).toEqual({});
});

it('the kept copy is capped (12 Recent, 12 Frequent)', async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ ...oats, id: `food-${i}`, name: `Food ${i}` }));
  getDaily.mockImplementation(async (date: string) => ({
    data: { entries: date === '2026-11-03' ? many.map((f, i) => entry(`m${i}`, f, 'lunch', 1, 100, 'g')) : [] },
  }) as never);
  await openSheet('member-1');
  const kept = JSON.parse((await AsyncStorage.getItem('food_browse_copy_member-1')) || 'null');
  expect(kept.recentFoods).toHaveLength(12);
  expect(kept.frequentFoods.length).toBeLessThanOrEqual(12);
});
