import { foodApi, logApi } from '../../services/api';
import { enqueue as enqueueFoodLog } from '../../services/foodLogQueue';
import { MealType } from '../../types';
import { SearchResult } from './types';

interface SearchLogArgs {
  food: SearchResult;
  date: string;
  mealType: MealType;
  multiplier: number;
  // Optional: the literal qty + unit the user picked (e.g. 6, 'oz'). Stored
  // on LoggedFoodEntry so coaches can read the original intent rather than
  // a derived multiplier.
  originalQuantity?: number;
  originalUnit?: string;
}

interface ManualLogArgs {
  foodName: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  quantity: string;
  unit: string;
  date: string;
  mealType: MealType;
}

export function buildFoodPayload(food: SearchResult) {
  return {
    name: food.name,
    brand_or_restaurant: food.brand || null,
    category: 'generic',
    serving_description: food.serving_size || '100g',
    serving_size_grams: 100,
    calories: food.calories,
    protein_g: food.protein,
    carbs_g: food.carbs,
    fat_g: food.fat,
    tags: [],
    search_aliases: [],
  };
}

export async function submitSearchLogOffline({
  food,
  date,
  mealType,
  multiplier,
  originalQuantity,
  originalUnit,
}: SearchLogArgs) {
  const needsCreate = !food.id || food.id.startsWith('off_');
  await enqueueFoodLog({
    kind: 'search',
    foodItemId: needsCreate ? undefined : food.id,
    food: needsCreate ? buildFoodPayload(food) : undefined,
    log: {
      date,
      meal_type: mealType,
      quantity_multiplier: multiplier,
      original_quantity: originalQuantity,
      original_unit: originalUnit,
    },
  });
}

export async function submitSearchLogOnline({
  food,
  date,
  mealType,
  multiplier,
  originalQuantity,
  originalUnit,
}: SearchLogArgs) {
  let foodItemId = food.id || '';
  if (!foodItemId || foodItemId.startsWith('off_')) {
    const createRes = await foodApi.create(buildFoodPayload(food));
    foodItemId = createRes.data.id;
  }
  await logApi.logFood({
    date,
    meal_type: mealType,
    food_item_id: foodItemId,
    quantity_multiplier: multiplier,
    original_quantity: originalQuantity,
    original_unit: originalUnit,
  });
}

function buildManualPayload(args: ManualLogArgs) {
  const foodPayload = {
    name: args.foodName.trim(),
    brand_or_restaurant: null,
    category: 'generic',
    serving_description: `${args.quantity} ${args.unit || 'serving'}`,
    serving_size_grams: 100,
    calories: parseInt(args.calories) || 0,
    protein_g: parseInt(args.protein) || 0,
    carbs_g: parseInt(args.carbs) || 0,
    fat_g: parseInt(args.fat) || 0,
    tags: [],
    search_aliases: [],
  };
  const qty = parseFloat(args.quantity) || 1;
  const logPayload = {
    date: args.date,
    meal_type: args.mealType,
    quantity_multiplier: qty,
    original_quantity: qty,
    original_unit: args.unit || 'serving',
  };
  return { foodPayload, logPayload };
}

export async function submitManualLogOffline(args: ManualLogArgs) {
  const { foodPayload, logPayload } = buildManualPayload(args);
  await enqueueFoodLog({ kind: 'manual', food: foodPayload, log: logPayload });
  return foodPayload.name;
}

export async function submitManualLogOnline(args: ManualLogArgs) {
  const { foodPayload, logPayload } = buildManualPayload(args);
  const createRes = await foodApi.create(foodPayload);
  const foodItemId = createRes.data.id;
  await logApi.logFood({ ...logPayload, food_item_id: foodItemId });
  return foodPayload.name;
}
