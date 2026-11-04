/**
 * LO-916R2 B1 (m#916 @ a745f11a): a food the member entered by hand as "2 servings" (or in cups),
 * repeated with yesterday's meal, whose answer was lost, then added from Recent as the alert says
 * ("Check the connection, then add it from Recent."), is saved twice.
 *
 * Why: Repeat sends the saved row's own amount (original_quantity 2, original_unit 'serving'), but
 * Recent prefills that food as "1 serving" (useFoodBrowse withLastPortion: the entered amount does not
 * turn back into the saved multiplier 1, so it falls back to the food's basis). The two saves send
 * different fields, so foodSaveIntent differs and the Recent add gets a new client_uuid.
 * The server here keeps one row per client_uuid (backend log.service upsert on client_uuid).
 * The Recent add below is what LogScreen.handleConfirmLog sends for the prefilled portion.
 */
import { act, renderHook } from '@testing-library/react-native';
import { logApi } from '../../services/api';
import { useFoodBrowse } from '../useFoodBrowse';
import { repeatPastMeal } from '../../utils/log/quickLog';
import { submitSearchLogOnline } from '../../utils/log/logSubmit';
import { quantityMultiplier } from '../../utils/log/macros';
import { addDays } from '../../utils/date';
import { forgetSaveKeys } from '../../utils/log/saveKey';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { post: jest.fn() },
  foodApi: { create: jest.fn() },
  logApi: { getDaily: jest.fn(), logFood: jest.fn() },
}));
jest.mock('../../services/foodLogQueue', () => ({ enqueue: jest.fn(async () => undefined) }));

const TODAY = '2026-10-30';
const YESTERDAY = addDays(TODAY, -1);

// What submitManualLogOnline stored yesterday for a hand-entered food (logSubmit buildManualPayload).
const manualRow = (name: string, id: string, qty: number, unit: string) => ({
  food_item_id: id,
  meal_type: 'breakfast',
  quantity_multiplier: 1,
  original_quantity: qty,
  original_unit: unit,
  food_item: {
    id, name, calories: 320, protein_g: 12, carbs_g: 50, fat_g: 8,
    nutrient_basis: 'PER_SERVING', serving_size_grams: 0, serving_description: `${qty} ${unit}`,
  },
});

describe.each([
  ['2 servings', 2, 'serving'],
  ['1 cup', 1, 'cup'],
])('LO-916R2 B1 hand-entered food (%s), repeat then Recent', (_label, qty, unit) => {
  beforeEach(() => {
    jest.clearAllMocks();
    forgetSaveKeys();
  });

  it('a hand-entered food whose repeat answer was lost, added again from Recent as the alert says, is saved once', async () => {
    const row = manualRow('Overnight oats', 'oats-own', qty as number, unit as string);
    (logApi.getDaily as jest.Mock).mockImplementation(async (d: string) => ({
      data: { entries: d === YESTERDAY ? [row] : [] },
    }));
    const rows = new Map<string, Record<string, unknown>>();
    let lose = true;
    (logApi.logFood as jest.Mock).mockImplementation(async (body: Record<string, unknown>) => {
      const key = String(body.client_uuid);
      if (!rows.has(key)) rows.set(key, body);
      if (lose) { lose = false; throw Object.assign(new Error('Network Error'), { request: {} }); } // saved, answer lost
      return { data: { id: key } };
    });

    const { result } = await renderHook(() => useFoodBrowse('viewer', TODAY));
    await act(async () => { await result.current.loadBrowseFoods(); });
    const meal = result.current.lastMeals.breakfast!;
    expect(meal.entries).toHaveLength(1);

    const first = await repeatPastMeal(meal, TODAY, 'breakfast');
    expect(first.failedNames).toEqual(['Overnight oats']);

    // The member follows the alert: the food from Recent, its prefilled portion, same meal and day.
    const recent = result.current.recentFoods.find((f) => f.name === 'Overnight oats')!;
    const pickedQty = recent.last_quantity ?? 1;
    const pickedUnit = recent.last_unit ?? 'serving';
    await submitSearchLogOnline({
      food: recent, date: TODAY, mealType: 'breakfast',
      multiplier: quantityMultiplier(recent, pickedQty, pickedUnit),
      originalQuantity: pickedQty, originalUnit: pickedUnit,
    });

    const oatsRows = [...rows.values()].filter((r) => r.food_item_id === 'oats-own');
    expect(oatsRows).toHaveLength(1);
  });
});
