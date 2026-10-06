import type { FoodLog } from '../../../types';
import type { SearchResult } from '../types';
import { editPortionMultiplier, initialEditPortion, editUnitsFor } from '../editPortion';
import { quantityMultiplier } from '../macros';
import { mapFoodItem } from '../mapFoodItem';
import { submitManualLogOnline, submitManualLogOffline, submitSearchLogOnline } from '../logSubmit';
import { useClientStore } from '../../../store/clientStore';
import { foodApi, logApi, waterApi } from '../../../services/api';
import { enqueue } from '../../../services/foodLogQueue';

jest.mock('../../../services/api', () => ({
  foodApi: { create: jest.fn() },
  logApi: { logFood: jest.fn(), getDaily: jest.fn() },
  waterApi: { getDaily: jest.fn() },
}));
jest.mock('../../../services/foodLogQueue', () => ({ enqueue: jest.fn() }));

const almonds: SearchResult = {
  id: 'almonds', name: 'Almonds', calories: 579, protein: 21, carbs: 22, fat: 50,
  nutrient_basis: 'PER_100G', serving_size_grams: 28, supports_volume_units: false,
};

const log: FoodLog = {
  id: 'entry', userId: 'user', coachId: '', date: '2026-10-06', mealType: 'lunch',
  foodName: 'Almonds', calories: 162, protein: 6, carbs: 6, fat: 14,
  quantity: 1, unit: 'serving', createdAt: '2026-10-06T12:00:00Z',
  originalQuantity: 1, originalUnit: 'serving', quantityMultiplier: 0.28, foodItem: almonds,
};

const manual = {
  foodName: 'Label lunch', calories: '400', protein: '', carbs: '', fat: '',
  quantity: '2', unit: 'serving', date: '2026-10-06', mealType: 'lunch' as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(foodApi.create).mockResolvedValue({ data: { id: 'created-food' } });
  jest.mocked(logApi.logFood).mockResolvedValue({ data: {} });
  jest.mocked(waterApi.getDaily).mockResolvedValue({ data: { total_ml: 0 } });
  useClientStore.getState().reset();
});

describe('ordinary portion edits', () => {
  it('keeps an unchanged 28g serving at the exact recorded 0.28 multiplier', () => {
    expect(initialEditPortion(log)).toEqual({ quantity: 1, unit: 'serving' });
    expect(editPortionMultiplier(log, 1, 'serving')).toBe(0.28);
    expect(editPortionMultiplier(log, 2, 'serving')).toBe(0.56);
  });

  it('uses the food serving weight when switching from servings to grams', () => {
    expect(editPortionMultiplier(log, 28, 'g')).toBe(0.28);
    expect(editPortionMultiplier(log, 1, 'oz')).toBeCloseTo(0.283495);
  });

  it('preserves a recorded cup conversion without replacing it with 100g', () => {
    const cupLog = { ...log, originalQuantity: 1, originalUnit: 'cup', quantityMultiplier: 2.4 };
    expect(editPortionMultiplier(cupLog, 1, 'cup')).toBe(2.4);
    expect(editPortionMultiplier(cupLog, 0.5, 'cup')).toBe(1.2);
  });

  it('keeps the whole nutrition of a manually described 2-serving portion unchanged', () => {
    const manualLog = {
      ...log, originalQuantity: 2, quantityMultiplier: 1,
      foodItem: { ...almonds, nutrient_basis: 'PER_SERVING' as const, serving_size_grams: 0 },
    };
    expect(editPortionMultiplier(manualLog, 2, 'serving')).toBe(1);
    expect(editPortionMultiplier(manualLog, 1, 'serving')).toBe(0.5);
    expect(editUnitsFor(manualLog)).toEqual(['serving']);
  });

  it('shows existing per-100g entries without original units as their actual gram quantity', () => {
    expect(initialEditPortion({ ...log, originalQuantity: undefined, originalUnit: undefined }))
      .toEqual({ quantity: 28, unit: 'g' });
  });
});

describe('manual and packaged save payloads', () => {
  it('sends numeric fields and the per-portion basis accepted by the server', async () => {
    await submitManualLogOnline(manual);
    expect(foodApi.create).toHaveBeenCalledWith(expect.objectContaining({
      nutrient_basis: 'PER_SERVING', serving_size_grams: 0,
      calories: 400, protein_g: 0, carbs_g: 0, fat_g: 0,
    }));
    expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({
      food_item_id: 'created-food', quantity_multiplier: 1,
      original_quantity: 2, original_unit: 'serving',
    }));
  });

  it('keeps weighed manual portions correctly convertible when reused', async () => {
    await submitManualLogOnline({ ...manual, quantity: '200', unit: 'g' });
    const payload = jest.mocked(foodApi.create).mock.calls[0][0];
    const food = mapFoodItem(payload);
    expect(quantityMultiplier(food, 100, 'g')).toBe(0.5);
  });

  it('uses the same numeric contract in the offline queue', async () => {
    await submitManualLogOffline(manual);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'manual',
      food: expect.objectContaining({ nutrient_basis: 'PER_SERVING', serving_size_grams: 0, protein_g: 0 }),
      log: expect.objectContaining({ quantity_multiplier: 1, original_quantity: 2 }),
    }));
  });

  it('rejects a cleared portion instead of silently saving one serving', async () => {
    await expect(submitManualLogOnline({ ...manual, quantity: '' })).rejects.toThrow(/quantity greater than zero/);
    expect(foodApi.create).not.toHaveBeenCalled();
  });

  it('creates a complete packaged food with its nutrient basis before logging', async () => {
    await submitSearchLogOnline({
      food: { ...almonds, id: 'off_123' }, date: manual.date, mealType: 'snack',
      multiplier: 0.28, originalQuantity: 1, originalUnit: 'serving',
    });
    expect(foodApi.create).toHaveBeenCalledWith(expect.objectContaining({ nutrient_basis: 'PER_100G' }));
    expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({ quantity_multiplier: 0.28 }));
  });
});

it('retains daily API food metadata and the exact multiplier for the actual edit screen', async () => {
  jest.mocked(logApi.getDaily).mockResolvedValue({ data: {
    entries: [{
      id: 'entry', food_item_id: 'almonds', user_id: 'user', meal_type: 'lunch',
      quantity_multiplier: 0.28, original_quantity: 1, original_unit: 'serving',
      food_item: { ...almonds, protein_g: 21, carbs_g: 22, fat_g: 50 },
    }],
    total_calories: 162, total_protein_g: 6, total_carbs_g: 6, total_fat_g: 14,
  } });
  await useClientStore.getState().loadDayData('user', '2026-10-06');
  const stored = useClientStore.getState().foodLogs[0];
  expect(stored.foodItem?.serving_size_grams).toBe(28);
  expect(stored.quantityMultiplier).toBe(0.28);
  expect(editPortionMultiplier(stored, 1, 'serving')).toBe(0.28);
});
