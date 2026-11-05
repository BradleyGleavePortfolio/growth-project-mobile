import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildUsualDay } from '../foodDay';
import { queuePastMeal } from '../quickLog';
import { withQueuedFoods } from '../queuedDay';
import { readQueue } from '../../../services/foodLogQueue';

jest.mock('../../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'member-1' })),
}));
jest.mock('../../../services/api', () => ({
  foodApi: { create: jest.fn() },
  logApi: { logFood: jest.fn() },
}));

it('Repeat from the usual day queues enough nutrition to show and count every food offline', async () => {
  await AsyncStorage.clear();
  const entry = {
    food_item_id: 'food-oats', meal_type: 'breakfast' as const, quantity_multiplier: 1,
    original_quantity: 1, original_unit: 'serving',
    food_item: {
      id: 'food-oats', name: 'Rolled oats', calories: 150, protein_g: 5,
      carbs_g: 27, fat_g: 3, nutrient_basis: 'PER_SERVING' as const, serving_size_grams: 40,
    },
  };
  const usual = buildUsualDay([
    { date: '2026-11-03', entries: [entry] },
    { date: '2026-11-02', entries: [entry] },
  ], []);
  const meal = usual.slots[0].usual!.meal;
  expect(meal.entries[0].name).toBe('Rolled oats');
  await queuePastMeal(meal, '2026-11-04', 'breakfast', { fillsUsualMeal: true });
  const queue = await readQueue();
  expect(queue).toHaveLength(1);
  const shown = withQueuedFoods([], { calories: 0, protein: 0, carbs: 0, fat: 0 },
    queue, '2026-11-04', 'member-1');
  expect(shown.foodLogs).toEqual([
    expect.objectContaining({ foodName: 'Rolled oats', offline: 'waiting', fillsUsualMeal: true }),
  ]);
  expect(shown.dailyTotals).toEqual({ calories: 150, protein: 5, carbs: 27, fat: 3 });
});
