/**
 * FOOD-SPEED-124: repeating a past meal logs the same foods with the same
 * saved portions, and foods already in the client's log are matched while
 * typing (ignoring the amount words of "2 eggs" or "150 g chicken").
 */
jest.mock('../../../services/api', () => ({
  __esModule: true,
  logApi: { logFood: jest.fn() },
}));

import { logApi } from '../../../services/api';
import { matchLoggedFoods, mergeWithLoggedMatches, repeatPastMeal, formatPortion } from '../quickLog';
import type { SearchResult } from '../types';
import { useClientStore } from '../../../store/clientStore';

const logFood = logApi.logFood as jest.MockedFunction<typeof logApi.logFood>;

const food = (id: string, name: string, extra: Partial<SearchResult> = {}): SearchResult => ({
  id, name, calories: 100, protein: 1, carbs: 1, fat: 1, nutrient_basis: 'PER_100G', ...extra,
});

describe('repeatPastMeal', () => {
  beforeEach(() => logFood.mockReset());

  const meal = {
    date: '2026-10-05',
    calories: 333,
    entries: [
      { foodItemId: 'food-oats', name: 'Rolled oats', calories: 227.4, quantityMultiplier: 0.6, originalQuantity: 60, originalUnit: 'g' },
      { foodItemId: 'food-banana', name: 'Banana', calories: 105, quantityMultiplier: 1.18, originalQuantity: 1, originalUnit: 'serving' },
    ],
  };

  it('logs every food into the chosen day and meal with its exact saved portion', async () => {
    logFood.mockResolvedValue({ data: {} } as never);
    const result = await repeatPastMeal(meal, '2026-10-06', 'breakfast');
    expect(result).toEqual({ added: 2, failedNames: [] });
    expect(logFood).toHaveBeenCalledTimes(2);
    expect(logFood).toHaveBeenCalledWith({
      date: '2026-10-06', meal_type: 'breakfast', food_item_id: 'food-oats',
      quantity_multiplier: 0.6, original_quantity: 60, original_unit: 'g',
    });
    expect(logFood).toHaveBeenCalledWith({
      date: '2026-10-06', meal_type: 'breakfast', food_item_id: 'food-banana',
      quantity_multiplier: 1.18, original_quantity: 1, original_unit: 'serving',
    });
  });

  it('names the foods that did not save instead of reporting the whole meal as added', async () => {
    logFood.mockResolvedValueOnce({ data: {} } as never).mockRejectedValueOnce(new Error('Network Error'));
    const result = await repeatPastMeal(meal, '2026-10-06', 'lunch');
    expect(result).toEqual({ added: 1, failedNames: ['Banana'] });
  });
});

describe('matchLoggedFoods', () => {
  const recent = [food('food-eggs', 'Eggs, whole', { last_quantity: 2, last_unit: 'serving' }), food('food-oats', 'Rolled oats')];
  const frequent = [food('food-oats', 'Rolled oats'), food('food-chicken', 'Chicken breast')];

  it('matches logged foods by name while ignoring the typed amount', () => {
    expect(matchLoggedFoods('2 eggs', recent, frequent).map((f) => f.id)).toEqual(['food-eggs']);
    expect(matchLoggedFoods('150g chicken', recent, frequent).map((f) => f.id)).toEqual(['food-chicken']);
    expect(matchLoggedFoods('oats', recent, frequent)).toHaveLength(1);
    expect(matchLoggedFoods('oats', recent, frequent)[0]).toMatchObject({ from_log: true });
  });

  it('returns nothing for an amount-only query', () => {
    expect(matchLoggedFoods('2 cups', recent, frequent)).toEqual([]);
  });
});

describe('mergeWithLoggedMatches', () => {
  it('puts logged foods first and drops the same food from the catalog results', () => {
    const logged = [food('food-oats', 'Rolled oats', { from_log: true })];
    const catalog = [food('usda_1', 'Oat bran'), food('food-oats', 'Rolled oats'), food('usda_2', 'Rolled Oats')];
    expect(mergeWithLoggedMatches(logged, catalog).map((f) => f.id)).toEqual(['food-oats', 'usda_1']);
  });
});

describe('formatPortion', () => {
  it('reads like a portion', () => {
    expect(formatPortion(1, 'serving')).toBe('1 serving');
    expect(formatPortion(2, 'serving')).toBe('2 servings');
    expect(formatPortion(150, 'g')).toBe('150 g');
  });
});

describe('deleting an entry updates the day at once', () => {
  it('drops the entry and takes its nutrition off the totals before the server answers', () => {
    useClientStore.setState({
      foodLogs: [
        { id: 'a', foodName: 'Rolled oats', calories: 227, protein: 8, carbs: 41, fat: 4 },
        { id: 'b', foodName: 'Banana', calories: 105, protein: 1, carbs: 27, fat: 0 },
      ] as never,
      dailyTotals: { calories: 332, protein: 9, carbs: 68, fat: 4 },
    });
    useClientStore.getState().removeFoodLogLocally('b');
    const state = useClientStore.getState();
    expect(state.foodLogs.map((f) => f.id)).toEqual(['a']);
    expect(state.dailyTotals).toEqual({ calories: 227, protein: 8, carbs: 41, fat: 4 });
  });
});
