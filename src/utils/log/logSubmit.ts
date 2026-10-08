import { foodApi, logApi } from '../../services/api';
import { enqueue as enqueueFoodLog } from '../../services/foodLogQueue';
import { MealType } from '../../types';
import { SearchResult } from './types';
import { parseQuantityInput, densityGramsFor } from './macros';

const OZ_TO_GRAMS = 28.3495;

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

export class FoodLogValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FoodLogValidationError';
  }
}

// B4: refuse to build a food payload when every macro is unknown. The mapper
// emits NaN for missing values so this check catches the silent-zero saves
// that used to land empty rows on the server.
function assertMacrosFinite(food: Pick<SearchResult, 'calories' | 'protein' | 'carbs' | 'fat' | 'name'>): void {
  const fields: Array<['calories' | 'protein' | 'carbs' | 'fat', number]> = [
    ['calories', food.calories],
    ['protein', food.protein],
    ['carbs', food.carbs],
    ['fat', food.fat],
  ];
  const allNaN = fields.every(([, v]) => !Number.isFinite(v));
  if (allNaN) {
    throw new FoodLogValidationError(
      `Cannot log "${food.name || 'food'}" — no calorie or macro data is available for this item.`,
    );
  }
}

export function buildFoodPayload(food: SearchResult) {
  assertMacrosFinite(food);
  // B4: never silently coerce a missing macro to 0 — if the upstream row
  // genuinely has no value, send null and let the server preserve "unknown".
  const macro = (v: number) => (Number.isFinite(v) ? v : null);
  return {
    name: food.name,
    brand_or_restaurant: food.brand || null,
    category: food.food_category || 'generic',
    serving_description: food.serving_size || '100g',
    // Backend canonical basis is per-100g; honour serving_size_grams when the
    // upstream item declares it (B4: stop hardcoding 100 when the row
    // actually carried a different gram weight).
    serving_size_grams: food.serving_size_grams ?? 100,
    nutrient_basis: food.nutrient_basis ?? 'PER_100G',
    calories: macro(food.calories),
    protein_g: macro(food.protein),
    carbs_g: macro(food.carbs),
    fat_g: macro(food.fat),
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

// Convert a manual qty + unit pair into grams, so we can store a real
// serving_size_grams instead of the legacy hardcoded 100. Returns null for
// an unweighed portion; the payload stores 0 with PER_SERVING so the app
// does not invent a weight or offer unresolvable conversions.
function manualServingGrams(qty: number, unit: string): number | null {
  const u = (unit || '').trim().toLowerCase();
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (u === 'g') return qty;
  if (u === 'oz') return qty * OZ_TO_GRAMS;
  if (u === 'cup' || u === 'tbsp' || u === 'tsp') {
    // Manual entry doesn't know the food category, so we have no density
    // table to resolve against — the portion remains unweighed.
    const grams = densityGramsFor({}, u);
    return grams != null ? qty * grams : null;
  }
  // "serving" or unrecognised: gram weight unknown.
  return null;
}

function buildManualPayload(args: ManualLogArgs) {
  const name = args.foodName.trim();
  if (!name) {
    throw new FoodLogValidationError('A food name is required.');
  }
  const qty = parseQuantityInput(args.quantity);
  if (qty == null) {
    throw new FoodLogValidationError('Enter a portion quantity greater than zero.');
  }

  // The numeric server contract cannot preserve unknown nutrition. Require
  // entered values instead of silently turning blanks into measured zeros.
  const parseMacro = (raw: string): number | null => {
    const trimmed = (raw ?? '').trim().replace(',', '.');
    if (!trimmed) return null;
    const n = Number.parseFloat(trimmed);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const calories = parseMacro(args.calories);
  const protein = parseMacro(args.protein);
  const carbs = parseMacro(args.carbs);
  const fat = parseMacro(args.fat);
  for (const [label, raw] of [
    ['Calories', args.calories], ['Protein', args.protein],
    ['Carbs', args.carbs], ['Fat', args.fat],
  ]) {
    if (raw.trim() && parseMacro(raw) == null) {
      throw new FoodLogValidationError(`${label} must be zero or a positive number.`);
    }
  }
  if (protein == null || carbs == null || fat == null) {
    throw new FoodLogValidationError('Enter protein, carbs and fat. Use 0 if there is none.');
  }
  if (calories == null) {
    throw new FoodLogValidationError('Enter calories. Use 0 if there is none.');
  }
  const unit = args.unit || 'serving';
  const servingGrams = manualServingGrams(qty, unit);
  const foodPayload = {
    name,
    brand_or_restaurant: null,
    category: 'generic',
    serving_description: `${qty} ${unit}`,
    // 0 denotes an unweighed portion; PER_SERVING preserves its nutrition and
    // the picker does not offer weight conversions until a weight is known.
    serving_size_grams: servingGrams ?? 0,
    nutrient_basis: 'PER_SERVING' as const,
    calories,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    tags: [],
    search_aliases: [],
  };
  const logPayload = {
    date: args.date,
    meal_type: args.mealType,
    // PER_SERVING semantics: one log entry = one serving the user described.
    // quantity_multiplier=1 is the honest value; we send the literal
    // qty/unit in original_quantity / original_unit so coaches see intent.
    quantity_multiplier: 1,
    original_quantity: qty,
    original_unit: unit,
  };
  return { foodPayload, logPayload };
}

export async function submitManualLogOffline(args: ManualLogArgs) {
  const { foodPayload, logPayload } = buildManualPayload(args);
  await enqueueFoodLog({ kind: 'manual', food: foodPayload, log: logPayload });
  return foodPayload.name;
}

// Same write as submitManualLogOnline, plus the new entry's id so a caller
// can offer an in-place Undo (meal plan "Log this meal").
export async function submitManualLogOnlineWithId(args: ManualLogArgs) {
  const { foodPayload, logPayload } = buildManualPayload(args);
  const createRes = await foodApi.create(foodPayload);
  const foodItemId = createRes.data.id;
  const logRes = await logApi.logFood({ ...logPayload, food_item_id: foodItemId });
  const id: unknown = logRes?.data?.id;
  return { name: foodPayload.name, entryId: typeof id === 'string' ? id : null };
}

export async function submitManualLogOnline(args: ManualLogArgs) {
  return (await submitManualLogOnlineWithId(args)).name;
}
