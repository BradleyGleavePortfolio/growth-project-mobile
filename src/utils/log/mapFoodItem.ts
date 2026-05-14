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

export const mapFoodItem = (item: RawFoodItem): SearchResult => ({
  id: String(item.id ?? ''),
  name: item.name ?? '',
  calories: item.calories ?? item.calories_per_serving ?? 0,
  protein: item.protein_g ?? item.protein ?? 0,
  carbs: item.carbs_g ?? item.carbs ?? 0,
  fat: item.fat_g ?? item.fat ?? 0,
  serving_size: item.serving_description ?? item.serving_size ?? undefined,
  serving_size_grams: item.serving_size_grams,
  brand: item.brand_or_restaurant ?? item.brand ?? null,
  image_url: item.image_url ?? item.image_front_thumb_url ?? item.image_front_small_url ?? null,
  nutrient_basis: item.nutrient_basis,
  supports_volume_units: item.supports_volume_units,
  cup_grams: item.cup_grams,
  tbsp_grams: item.tbsp_grams,
  tsp_grams: item.tsp_grams,
  food_category: item.food_category ?? item.category,
});

// For log-entry shape: {food_item, food_name, calories, ...} → SearchResult
export const mapLogEntryToFood = (e: RawLogEntry): SearchResult | null => {
  const fi = e.food_item || e.foodItem;
  const name = fi?.name || e.food_name || '';
  if (!name) return null;
  return {
    id: String(fi?.id ?? ''),
    name,
    calories: fi?.calories ?? fi?.calories_per_serving ?? e.calories ?? 0,
    protein: fi?.protein_g ?? e.protein ?? 0,
    carbs: fi?.carbs_g ?? e.carbs ?? 0,
    fat: fi?.fat_g ?? e.fat ?? 0,
    serving_size: fi?.serving_description ?? fi?.serving_size,
    serving_size_grams: fi?.serving_size_grams,
    brand: fi?.brand_or_restaurant ?? fi?.brand ?? null,
    image_url: fi?.image_url ?? fi?.image_front_thumb_url ?? fi?.image_front_small_url ?? null,
    nutrient_basis: fi?.nutrient_basis,
    supports_volume_units: fi?.supports_volume_units,
    cup_grams: fi?.cup_grams,
    tbsp_grams: fi?.tbsp_grams,
    tsp_grams: fi?.tsp_grams,
    food_category: fi?.food_category ?? fi?.category,
  };
};
