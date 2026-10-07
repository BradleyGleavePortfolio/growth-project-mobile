/**
 * FOOD-SPEED-124: the Add Food sheet's Recent list, Frequent list and
 * repeat-meal card come from the client's last seven days of logging, not
 * only the day on screen. A client opening an empty "today" must still see
 * yesterday's oats, at the portion logged last time.
 */
import { act, renderHook } from '@testing-library/react-native';

jest.mock('../../services/api', () => ({
  __esModule: true,
  logApi: { getDaily: jest.fn() },
}));

import { useFoodBrowse } from '../useFoodBrowse';
import { logApi } from '../../services/api';
import { calcMacros, quantityMultiplier } from '../../utils/log/macros';
import type { SearchResult } from '../../utils/log/types';

const getDaily = logApi.getDaily as jest.MockedFunction<typeof logApi.getDaily>;

const oats = {
  id: 'food-oats', name: 'Rolled oats', calories: 379, protein_g: 13, carbs_g: 68, fat_g: 6.5,
  serving_size_grams: 40, nutrient_basis: 'PER_100G', supports_volume_units: false,
};
const banana = {
  id: 'food-banana', name: 'Banana', calories: 89, protein_g: 1.1, carbs_g: 23, fat_g: 0.3,
  serving_size_grams: 118, nutrient_basis: 'PER_100G', supports_volume_units: false,
};
const chicken = {
  id: 'food-chicken', name: 'Chicken breast', calories: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6,
  serving_size_grams: 100, nutrient_basis: 'PER_100G', supports_volume_units: false,
};

const entry = (id: string, food: typeof oats, meal: string, multiplier: number, qty: number, unit: string) => ({
  id, food_item_id: food.id, meal_type: meal, quantity_multiplier: multiplier,
  original_quantity: qty, original_unit: unit, food_item: food,
});

const days: Record<string, unknown[]> = {
  // Today (selected): nothing logged yet.
  '2026-10-06': [],
  // Yesterday: breakfast of oats + banana, chicken at lunch.
  '2026-10-05': [
    entry('e1', oats, 'breakfast', 0.6, 60, 'g'),
    entry('e2', banana, 'breakfast', 1.18, 1, 'serving'),
    entry('e3', chicken, 'lunch', 1.5, 150, 'g'),
  ],
  // Two days ago: oats again (smaller portion) and a different lunch.
  '2026-10-04': [
    entry('e4', oats, 'breakfast', 0.4, 40, 'g'),
    entry('e5', banana, 'lunch', 1.18, 1, 'serving'),
  ],
};

beforeEach(() => {
  getDaily.mockReset();
  getDaily.mockImplementation(async (date: string) => ({ data: { entries: days[date] ?? [] } }) as never);
});

async function loaded() {
  const { result } = await renderHook(() => useFoodBrowse('user-1', '2026-10-06'));
  await act(async () => {
    await result.current.loadBrowseFoods();
  });
  return result;
}

describe('useFoodBrowse — recent foods and past meals for fast logging', () => {
  it('fills Recent from earlier days when the selected day is still empty, newest first, once per food', async () => {
    const result = await loaded();
    expect(getDaily).toHaveBeenCalledTimes(7);
    expect(result.current.recentFoods.map((f) => f.name)).toEqual(['Chicken breast', 'Banana', 'Rolled oats']);
  });

  it('carries the portion logged most recently so the picker can start there', async () => {
    const result = await loaded();
    const recentOats = result.current.recentFoods.find((f) => f.id === 'food-oats');
    expect(recentOats).toMatchObject({ last_quantity: 60, last_unit: 'g' });
    const recentBanana = result.current.recentFoods.find((f) => f.id === 'food-banana');
    expect(recentBanana).toMatchObject({ last_quantity: 1, last_unit: 'serving' });
  });

  it('ranks Frequent by how often a food was logged this week', async () => {
    const result = await loaded();
    expect(result.current.frequentFoods.map((f) => f.name).slice(0, 2).sort()).toEqual(['Banana', 'Rolled oats']);
    expect(result.current.frequentFoods[2].name).toBe('Chicken breast');
  });

  it("offers yesterday's breakfast with the exact saved portions and calories", async () => {
    const result = await loaded();
    const breakfast = result.current.lastMeals.breakfast;
    expect(breakfast?.date).toBe('2026-10-05');
    expect(breakfast?.entries).toEqual([
      { foodItemId: 'food-oats', name: 'Rolled oats', calories: 379 * 0.6, quantityMultiplier: 0.6, originalQuantity: 60, originalUnit: 'g' },
      { foodItemId: 'food-banana', name: 'Banana', calories: 89 * 1.18, quantityMultiplier: 1.18, originalQuantity: 1, originalUnit: 'serving' },
    ]);
    expect(Math.round(breakfast?.calories ?? 0)).toBe(Math.round(379 * 0.6 + 89 * 1.18));
    // Lunch also comes from the most recent day that has one, not a mix of days.
    expect(result.current.lastMeals.lunch?.entries.map((e) => e.name)).toEqual(['Chicken breast']);
    expect(result.current.lastMeals.dinner).toBeUndefined();
  });
});

describe('useFoodBrowse — last portion reproduces the saved entry exactly (B-403-1)', () => {
  // Manual foods store nutrition for the whole described portion: PER_SERVING,
  // multiplier 1, with "2 serving" kept only as the description.
  const customLunch = {
    id: 'food-custom-lunch', name: 'Custom lunch', calories: 400, protein_g: 12, carbs_g: 60, fat_g: 12,
    serving_size_grams: 0, serving_description: '2 serving', nutrient_basis: 'PER_SERVING', supports_volume_units: false,
  };
  const customBowl = {
    id: 'food-custom-bowl', name: 'Custom bowl', calories: 520, protein_g: 30, carbs_g: 50, fat_g: 20,
    serving_size_grams: 150, serving_description: '150 g', nutrient_basis: 'PER_SERVING', supports_volume_units: false,
  };

  beforeEach(() => {
    getDaily.mockImplementation(async (date: string) => ({
      data: {
        entries: date === '2026-10-05'
          ? [
            entry('c1', customLunch as never, 'lunch', 1, 2, 'serving'),
            entry('c2', customBowl as never, 'dinner', 1, 150, 'g'),
            entry('c3', oats, 'breakfast', 0.6, 60, 'g'),
          ]
          : [],
      },
    }) as never);
  });

  const multiplierOf = (food: SearchResult) =>
    quantityMultiplier(food, food.last_quantity as number, food.last_unit as string);

  it('starts a custom whole-portion food at the one portion that was saved, not its description count', async () => {
    const result = await loaded();
    const lunch = result.current.recentFoods.find((f) => f.id === 'food-custom-lunch') as SearchResult;
    expect(lunch).toMatchObject({ last_quantity: 1, last_unit: 'serving' });
    expect(multiplierOf(lunch)).toBe(1);
    expect(calcMacros(lunch, lunch.last_quantity as number, lunch.last_unit as string))
      .toEqual({ calories: 400, protein: 12, carbs: 60, fat: 12 });
  });

  it('keeps the weighed amount when it reproduces the saved entry (custom and catalog foods)', async () => {
    const result = await loaded();
    const bowl = result.current.recentFoods.find((f) => f.id === 'food-custom-bowl') as SearchResult;
    expect(bowl).toMatchObject({ last_quantity: 150, last_unit: 'g' });
    expect(multiplierOf(bowl)).toBe(1);
    const recentOats = result.current.recentFoods.find((f) => f.id === 'food-oats') as SearchResult;
    expect(recentOats).toMatchObject({ last_quantity: 60, last_unit: 'g' });
    expect(multiplierOf(recentOats)).toBeCloseTo(0.6, 10);
  });
});

// FU-FOODLOG-126: offline, the week cannot be read. Recent stays usable from
// the last read (a recent food can still be saved offline) and the sheet is
// told the lists are unavailable rather than empty.
describe('useFoodBrowse — offline', () => {
  it('keeps the last lists and flags them unavailable when no day can be read', async () => {
    const result = await loaded();
    expect(result.current.recentFoods).toHaveLength(3);
    expect(result.current.browseUnavailable).toBe(false);
    getDaily.mockRejectedValue(new Error('Network Error'));
    await act(async () => {
      await result.current.loadBrowseFoods();
    });
    expect(result.current.browseUnavailable).toBe(true);
    expect(result.current.recentFoods.map((f) => f.name)).toEqual(['Chicken breast', 'Banana', 'Rolled oats']);
    expect(result.current.lastMeals.breakfast).toBeDefined();
  });

  it('clears the flag on the next successful read', async () => {
    const working = getDaily.getMockImplementation();
    getDaily.mockRejectedValue(new Error('Network Error'));
    const result = await loaded();
    expect(result.current.browseUnavailable).toBe(true);
    expect(result.current.recentFoods).toEqual([]);
    if (working) getDaily.mockImplementation(working);
    await act(async () => {
      await result.current.loadBrowseFoods();
    });
    expect(result.current.browseUnavailable).toBe(false);
    expect(result.current.recentFoods).toHaveLength(3);
  });
});
