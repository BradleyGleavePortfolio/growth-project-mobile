/**
 * GOAL-927-M, OPERATOR RULING 4: the /log/daily entry -> FoodLog map moves out of clientStore's day loader,
 * unchanged, into one exported pure function the loader and the meal plan both call. `atBase` below is the
 * loader's inline map at 8efe38e095d1d8c009b1d0dd8e2b838092bb7583 (src/store/clientStore.ts:192-230), copied
 * word for word with only its closure (the loader's day `d`) made a parameter; the moved function must give
 * the same rows for every fixture entry. Every entry carries logged_at or created_at, so the map's clock
 * fallback never runs.
 */
import type { FoodLog } from '../../../types';
import { mapFoodItem, type RawFoodItem } from '../mapFoodItem';
import { foodLogFromDailyEntry, type DailyLogEntry } from '../dailyEntry';

function atBase(e: DailyLogEntry, d: string): FoodLog {
  const hasOriginal =
    typeof e.original_quantity === 'number' &&
    !!e.original_unit &&
    (e.original_unit || '').trim().length > 0;
  return ({
    id: e.id,
    foodItemId: e.food_item_id,
    quantityMultiplier: e.quantity_multiplier,
    foodItem: e.food_item ? mapFoodItem(e.food_item) : undefined,
    foodName: e.food_item?.name || '',
    name: e.food_item?.name || '',
    calories: Math.round((e.food_item?.calories || 0) * e.quantity_multiplier),
    protein: Math.round((e.food_item?.protein_g || 0) * e.quantity_multiplier),
    carbs: Math.round((e.food_item?.carbs_g || 0) * e.quantity_multiplier),
    fat: Math.round((e.food_item?.fat_g || 0) * e.quantity_multiplier),
    mealType: e.meal_type,
    date: d,
    quantity: hasOriginal
      ? (e.original_quantity as number)
      : e.quantity_multiplier,
    unit: hasOriginal ? (e.original_unit as string) : 'serving',
    originalQuantity:
      typeof e.original_quantity === 'number'
        ? e.original_quantity
        : undefined,
    originalUnit: e.original_unit ? e.original_unit : undefined,
    userId: e.user_id,
    planSlotId: e.plan_slot_id || undefined,
    fillsUsualMeal: e.fills_usual_meal === true || undefined,
    clientUuid: e.client_uuid || undefined,
    coachId: '',
    createdAt: e.logged_at || e.created_at || new Date().toISOString(),
  } as FoodLog & { name: string });
}

const item = (name: string, calories: number): RawFoodItem => ({
  id: `fi-${name}`, name, calories, protein_g: 12.4, carbs_g: 30.6, fat_g: 7.5, serving_size: 1, serving_unit: 'serving',
} as unknown as RawFoodItem);

const FIXTURE: DailyLogEntry[] = [
  // Logged as planned from the meal plan (FOODLINK: plan_slot_id).
  { id: 'e1', food_item_id: 'fi-a', user_id: 'u1', meal_type: 'breakfast', quantity_multiplier: 1, logged_at: '2026-10-13T07:42:00.000Z',
    food_item: item('Greek yoghurt, oats and berries', 420), plan_slot_id: 'slot-a', client_uuid: 'cu-1' },
  // A changed amount with the user's own quantity and unit.
  { id: 'e2', food_item_id: 'fi-b', user_id: 'u1', meal_type: 'lunch', quantity_multiplier: 1.5, original_quantity: 300, original_unit: 'g',
    created_at: '2026-10-13T12:35:00.000Z', food_item: item('Chicken, rice and greens', 680), plan_slot_id: 'slot-b' },
  // An extra with no plan link, a blank unit and the usual-day mark.
  { id: 'e3', food_item_id: 'fi-c', user_id: 'u1', meal_type: 'snack', quantity_multiplier: 2, original_quantity: 2, original_unit: '  ',
    logged_at: '2026-10-13T10:15:00.000Z', created_at: '2026-10-13T10:16:00.000Z', food_item: item('Flat white', 55), fills_usual_meal: true,
    plan_slot_id: null, client_uuid: null },
  // A legacy row with no food item.
  { id: 'e4', food_item_id: 'fi-d', user_id: 'u1', meal_type: 'dinner', quantity_multiplier: 0.5, created_at: '2026-10-13T19:00:00.000Z' },
];

it('RULING 4: the moved map gives the loader\'s rows at 8efe38e0 for every fixture entry', () => {
  const day = '2026-10-13';
  const moved = FIXTURE.map((e) => foodLogFromDailyEntry(e, day));
  expect(moved).toEqual(FIXTURE.map((e) => atBase(e, day)));
  // Spot checks of the fields the meal plan's eaten marks read (buildPlanDay: planSlotId, mealType, foodName, quantity, unit).
  expect(moved.map((l) => [l.planSlotId, l.mealType, l.foodName, l.quantity, l.unit])).toEqual([
    ['slot-a', 'breakfast', 'Greek yoghurt, oats and berries', 1, 'serving'],
    ['slot-b', 'lunch', 'Chicken, rice and greens', 300, 'g'],
    [undefined, 'snack', 'Flat white', 2, 'serving'],
    [undefined, 'dinner', '', 0.5, 'serving'],
  ]);
});
