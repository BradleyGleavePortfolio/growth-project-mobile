/**
 * One `/v1/log/daily` entry as the app's FoodLog row. Moved unchanged from clientStore's day loader
 * (GOAL-927-M, OPERATOR RULING 4) so the loader and the meal plan's eaten marks read one map; the
 * loader's day becomes the `day` parameter. Pure.
 */
import type { FoodLog } from '../../types';
import { mapFoodItem, type RawFoodItem } from './mapFoodItem';

// Wire shape returned by /v1/log/daily.
export interface DailyLogEntry {
  id: string;
  food_item_id: string;
  user_id: string;
  meal_type: FoodLog['mealType'];
  quantity_multiplier: number;
  original_quantity?: number | null;
  original_unit?: string | null;
  logged_at?: string;
  created_at?: string;
  food_item?: RawFoodItem;
  plan_slot_id?: string | null;
  fills_usual_meal?: boolean;
  client_uuid?: string | null;
}

// The existing mapping intentionally writes both `foodName` (the
// canonical FoodLog field) and a duplicate `name` consumed by older
// screens; FoodLog itself doesn't declare `name`, so we have to
// double-cast through unknown to keep both shapes in flight without
// re-introducing `any`.
// TODO(types): drop the duplicate `name` field once all consumers
// read `foodName` directly.
export function foodLogFromDailyEntry(e: DailyLogEntry, day: string): FoodLog {
  // F-3 fix: surface original_quantity/original_unit so meal cards
  // can render "6 oz chicken" instead of the hardcoded
  // "1 serving" placeholder. Falls back to the multiplier when the
  // backend row is legacy and has no original_* fields.
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
    date: day,
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
