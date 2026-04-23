import { SearchResult } from './types';

export const mapFoodItem = (item: any): SearchResult => ({
  id: item.id,
  name: item.name,
  calories: item.calories ?? item.calories_per_serving ?? 0,
  protein: item.protein_g ?? item.protein ?? 0,
  carbs: item.carbs_g ?? item.carbs ?? 0,
  fat: item.fat_g ?? item.fat ?? 0,
  serving_size: item.serving_description ?? item.serving_size ?? undefined,
  brand: item.brand_or_restaurant ?? item.brand ?? null,
  image_url: item.image_url ?? item.image_front_thumb_url ?? item.image_front_small_url ?? null,
});

// For log-entry shape: {food_item, food_name, calories, ...} → SearchResult
export const mapLogEntryToFood = (e: any): SearchResult | null => {
  const fi = e.food_item || e.foodItem;
  const name = fi?.name || e.food_name || '';
  if (!name) return null;
  return {
    id: fi?.id,
    name,
    calories: fi?.calories ?? fi?.calories_per_serving ?? e.calories ?? 0,
    protein: fi?.protein_g ?? e.protein ?? 0,
    carbs: fi?.carbs_g ?? e.carbs ?? 0,
    fat: fi?.fat_g ?? e.fat ?? 0,
    serving_size: fi?.serving_description ?? fi?.serving_size,
    brand: fi?.brand_or_restaurant ?? fi?.brand ?? null,
    image_url: fi?.image_url ?? fi?.image_front_thumb_url ?? fi?.image_front_small_url ?? null,
  };
};
