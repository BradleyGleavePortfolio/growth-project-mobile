import { MealType } from '../../types';
import { densityGramsFor } from './macros';

// Imported foods use per-100g nutrition. Custom foods may instead describe
// one whole portion, so their declared PER_SERVING basis must be preserved.
export type NutrientBasis = 'PER_100G' | 'PER_SERVING';

export interface SearchResult {
  id?: string;
  name: string;
  // Macros on the declared nutrient_basis.
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_size?: string;
  // Grams in one "serving" of this food (e.g. 28 for almonds, 118 for a
  // medium banana). Used by calcMacros when the user picks unit='serving'.
  serving_size_grams?: number;
  brand?: string | null;
  image_url?: string | null;

  // Set by the backend mapper. Always 'PER_100G' for newly imported foods;
  // legacy rows may still surface 'PER_SERVING'. calcMacros honors both.
  nutrient_basis?: NutrientBasis;

  // True when the backend knows a density for this food's category and can
  // therefore convert cup/tbsp/tsp to grams. When false, the picker hides
  // those chips to avoid producing wrong numbers.
  supports_volume_units?: boolean;

  // Optional precomputed gram weights for one cup / tablespoon / teaspoon of
  // this food (backend-provided when supports_volume_units is true). If the
  // backend omits them, mobile falls back to a category-keyed density table
  // (see densityGramsFor() in macros.ts).
  cup_grams?: number;
  tbsp_grams?: number;
  tsp_grams?: number;

  // Food category (e.g. 'oats', 'milk', 'oil'). Used as the fallback key for
  // the local density table when the backend doesn't ship explicit gram
  // weights for cup/tbsp/tsp.
  food_category?: string;
}

export const MEAL_SECTIONS: { type: MealType; label: string; icon: string }[] = [
  { type: 'breakfast', label: 'Breakfast', icon: 'sunny-outline' },
  { type: 'lunch', label: 'Lunch', icon: 'restaurant-outline' },
  { type: 'dinner', label: 'Dinner', icon: 'moon-outline' },
  { type: 'snack', label: 'Snacks', icon: 'cafe-outline' },
];

// Mass-based chips are always available. Volume chips (cup/tbsp/tsp) are
// gated behind FoodItem.supports_volume_units — see unitOptionsFor() below.
export const MASS_UNIT_OPTIONS = ['serving', 'g', 'oz'] as const;
export const VOLUME_UNIT_OPTIONS = ['cup', 'tbsp', 'tsp'] as const;
export const UNIT_OPTIONS: readonly string[] = [
  ...MASS_UNIT_OPTIONS,
  ...VOLUME_UNIT_OPTIONS,
];

// Offer only conversions the app can actually calculate.
export function unitOptionsFor(food: Partial<SearchResult> | null | undefined): readonly string[] {
  if (food?.nutrient_basis === 'PER_SERVING' && !(food.serving_size_grams && food.serving_size_grams > 0)) {
    return ['serving'];
  }
  const volumeUnits = !food || food.supports_volume_units === false
    ? []
    : VOLUME_UNIT_OPTIONS.filter((unit) => {
        const grams = densityGramsFor(food, unit);
        return grams != null && grams > 0;
      });
  return [...MASS_UNIT_OPTIONS, ...volumeUnits];
}
