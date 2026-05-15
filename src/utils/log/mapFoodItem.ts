import { NutrientBasis, SearchResult } from './types';

// Server payload shape (loose — backend has historically sent at least three
// schemas for food items so each field is optional and we normalise here).
export interface RawFoodItem {
  id?: string;
  name?: string;
  calories?: number;
  calories_per_serving?: number;
  protein_g?: number;
  protein?: number;
  carbs_g?: number;
  carbs?: number;
  fat_g?: number;
  fat?: number;
  serving_description?: string;
  serving_size?: string;
  serving_size_grams?: number;
  brand_or_restaurant?: string | null;
  brand?: string | null;
  image_url?: string | null;
  image_front_thumb_url?: string | null;
  image_front_small_url?: string | null;
  // Fields added in the Trainerize-floor backend PR.
  nutrient_basis?: NutrientBasis;
  supports_volume_units?: boolean;
  cup_grams?: number;
  tbsp_grams?: number;
  tsp_grams?: number;
  food_category?: string;
  category?: string;
}

export interface RawLogEntry {
  food_item?: RawFoodItem;
  foodItem?: RawFoodItem;
  food_name?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

// Per-serving rows (legacy or freshly-manual) report macros on the basis of
// one serving, not 100g. When the backend omits `nutrient_basis` we infer it
// from which calories field was populated: `calories_per_serving` only
// → PER_SERVING; `calories` only → PER_100G.
function inferNutrientBasis(item: RawFoodItem): NutrientBasis | undefined {
  if (item.nutrient_basis) return item.nutrient_basis;
  const hasPer100 = typeof item.calories === 'number';
  const hasPerServing = typeof item.calories_per_serving === 'number';
  if (hasPerServing && !hasPer100) return 'PER_SERVING';
  if (hasPer100 && !hasPerServing) return 'PER_100G';
  return undefined;
}

// Pick the macro value from whichever per-100g / per-serving field the
// backend populated. Critically, the result is null when ALL candidate
// fields are missing — callers decide what to do (B4: stop silently
// saving 0 as a calorie or macro value when the row had no number at all).
function pickMacro(
  per100g: number | undefined,
  perServing: number | undefined,
  legacy?: number | undefined,
): number | null {
  if (typeof per100g === 'number' && Number.isFinite(per100g)) return per100g;
  if (typeof perServing === 'number' && Number.isFinite(perServing)) return perServing;
  if (typeof legacy === 'number' && Number.isFinite(legacy)) return legacy;
  return null;
}

export const mapFoodItem = (item: RawFoodItem): SearchResult => {
  const basis = inferNutrientBasis(item);
  // B4: do NOT silently default to 0 — leave NaN so calcMacros + the saving
  // path can refuse to persist an empty-macro row. The displayable picker
  // still uses Number.isFinite checks downstream, so the search list shows
  // a "macros unknown" stub instead of a fake 0kcal banana.
  const calories = pickMacro(item.calories, item.calories_per_serving);
  const protein = pickMacro(item.protein_g, item.protein);
  const carbs = pickMacro(item.carbs_g, item.carbs);
  const fat = pickMacro(item.fat_g, item.fat);
  return {
    id: String(item.id ?? ''),
    name: item.name ?? '',
    calories: calories ?? NaN,
    protein: protein ?? NaN,
    carbs: carbs ?? NaN,
    fat: fat ?? NaN,
    serving_size: item.serving_description ?? item.serving_size ?? undefined,
    serving_size_grams: item.serving_size_grams,
    brand: item.brand_or_restaurant ?? item.brand ?? null,
    image_url: item.image_url ?? item.image_front_thumb_url ?? item.image_front_small_url ?? null,
    nutrient_basis: basis,
    supports_volume_units: item.supports_volume_units,
    cup_grams: item.cup_grams,
    tbsp_grams: item.tbsp_grams,
    tsp_grams: item.tsp_grams,
    food_category: item.food_category ?? item.category,
  };
};

// For log-entry shape: {food_item, food_name, calories, ...} → SearchResult
export const mapLogEntryToFood = (e: RawLogEntry): SearchResult | null => {
  const fi = e.food_item || e.foodItem;
  const name = fi?.name || e.food_name || '';
  if (!name) return null;
  const basis = fi ? inferNutrientBasis(fi) : undefined;
  const calories = pickMacro(fi?.calories, fi?.calories_per_serving, e.calories);
  const protein = pickMacro(fi?.protein_g, fi?.protein, e.protein);
  const carbs = pickMacro(fi?.carbs_g, fi?.carbs, e.carbs);
  const fat = pickMacro(fi?.fat_g, fi?.fat, e.fat);
  return {
    id: String(fi?.id ?? ''),
    name,
    calories: calories ?? NaN,
    protein: protein ?? NaN,
    carbs: carbs ?? NaN,
    fat: fat ?? NaN,
    serving_size: fi?.serving_description ?? fi?.serving_size,
    serving_size_grams: fi?.serving_size_grams,
    brand: fi?.brand_or_restaurant ?? fi?.brand ?? null,
    image_url: fi?.image_url ?? fi?.image_front_thumb_url ?? fi?.image_front_small_url ?? null,
    nutrient_basis: basis,
    supports_volume_units: fi?.supports_volume_units,
    cup_grams: fi?.cup_grams,
    tbsp_grams: fi?.tbsp_grams,
    tsp_grams: fi?.tsp_grams,
    food_category: fi?.food_category ?? fi?.category,
  };
};
