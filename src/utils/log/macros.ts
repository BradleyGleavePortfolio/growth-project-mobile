// Macro math for the food logger.
//
// Canonical basis: every SearchResult carries per-100g macros (calories,
// protein_g, carbs_g, fat_g). The backend normalizes USDA / OpenFoodFacts
// rows to this basis at import time and sets `nutrient_basis: 'PER_100G'`.
//
// `quantityMultiplier(food, qty, unit)` produces a single scalar to multiply
// those per-100g macros by. The math:
//   g     →  qty / 100
//   oz    →  (qty * 28.3495) / 100
//   serving → (qty * food.serving_size_grams) / 100      (28g almonds → 0.28)
//   cup / tbsp / tsp → (qty * gramsPerVolumeUnit) / 100
//
// For volume units we prefer backend-supplied gram weights on the FoodItem
// (`cup_grams`, `tbsp_grams`, `tsp_grams`). If absent, we look up a small
// category-keyed density table — graceful degradation rather than the
// previous silent `multiplier = qty` fall-through that produced 2-4× errors.
//
// Legacy rows that still report `nutrient_basis: 'PER_SERVING'` are handled
// by treating their macros as belonging to one serving and scaling by qty
// directly. New code should not produce PER_SERVING rows.

import { SearchResult } from './types';

const OZ_TO_GRAMS = 28.3495;

// Category-keyed densities for the picker's cup/tbsp/tsp chips. Values are
// grams per US cup, tablespoon, and teaspoon — derived from USDA reference
// densities (rounded to whole grams). Kept small on purpose: the backend is
// the source of truth for densities and will ship explicit gram weights on
// the FoodItem for foods whose category lives outside this table.
//
// Volumes are US customary: 1 cup = 16 tbsp = 48 tsp.
const CATEGORY_DENSITY_GRAMS: Record<string, { cup: number; tbsp: number; tsp: number }> = {
  // Liquids
  water: { cup: 237, tbsp: 15, tsp: 5 },
  milk: { cup: 244, tbsp: 15, tsp: 5 },
  juice: { cup: 248, tbsp: 16, tsp: 5 },
  oil: { cup: 218, tbsp: 14, tsp: 5 },
  // Dry pantry staples
  oats: { cup: 81, tbsp: 5, tsp: 2 },
  rice_dry: { cup: 185, tbsp: 12, tsp: 4 },
  rice_cooked: { cup: 158, tbsp: 10, tsp: 3 },
  flour: { cup: 125, tbsp: 8, tsp: 3 },
  sugar: { cup: 200, tbsp: 13, tsp: 4 },
  // Generic catch-alls
  cereal: { cup: 30, tbsp: 2, tsp: 1 },
  yogurt: { cup: 245, tbsp: 15, tsp: 5 },
};

// Resolves grams for one unit of the requested volume. Prefers the explicit
// per-food values when present, falls back to the category density table,
// returns null when neither is available so the caller can decide what to do.
export function densityGramsFor(
  food: Pick<SearchResult, 'cup_grams' | 'tbsp_grams' | 'tsp_grams' | 'food_category'>,
  unit: 'cup' | 'tbsp' | 'tsp',
): number | null {
  if (unit === 'cup' && typeof food.cup_grams === 'number') return food.cup_grams;
  if (unit === 'tbsp' && typeof food.tbsp_grams === 'number') return food.tbsp_grams;
  if (unit === 'tsp' && typeof food.tsp_grams === 'number') return food.tsp_grams;
  const cat = food.food_category?.toLowerCase();
  if (cat && CATEGORY_DENSITY_GRAMS[cat]) {
    return CATEGORY_DENSITY_GRAMS[cat][unit];
  }
  return null;
}

// Returns the scalar to multiply the food's per-100g macros by. Falls back to
// qty (legacy behaviour) for unrecognised units rather than throwing, so the
// UI never wedges on a malformed input.
export function quantityMultiplier(
  food: Pick<SearchResult, 'serving_size_grams' | 'cup_grams' | 'tbsp_grams' | 'tsp_grams' | 'food_category' | 'nutrient_basis'> | null | undefined,
  qty: number,
  unit: string,
): number {
  // Legacy PER_SERVING rows: macros already represent one serving, so qty
  // is the multiplier no matter the unit.
  if (food?.nutrient_basis === 'PER_SERVING') return qty;

  const u = (unit || '').toLowerCase();
  if (u === 'g') return qty / 100;
  if (u === 'oz') return (qty * OZ_TO_GRAMS) / 100;
  if (u === 'serving') {
    const grams = food?.serving_size_grams ?? 100;
    return (qty * grams) / 100;
  }
  if (u === 'cup' || u === 'tbsp' || u === 'tsp') {
    const grams = food ? densityGramsFor(food, u) : null;
    if (grams != null) return (qty * grams) / 100;
    // No density: treat one unit as one 100g portion. Picker should have
    // hidden these chips when supports_volume_units is false; this branch
    // exists only as a defensive fall-back.
    return qty;
  }
  return qty;
}

export interface MacroBundle {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export function calcMacros(food: SearchResult, qty: number, unit: string): MacroBundle {
  const multiplier = quantityMultiplier(food, qty, unit);
  return {
    calories: Math.round(food.calories * multiplier),
    protein: Math.round(food.protein * multiplier * 10) / 10,
    carbs: Math.round(food.carbs * multiplier * 10) / 10,
    fat: Math.round(food.fat * multiplier * 10) / 10,
  };
}
