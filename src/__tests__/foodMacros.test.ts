/**
 * Macro math correctness tests for the food logger.
 *
 * The Trainerize-floor fix re-centred `calcMacros` on a strict per-100g
 * canonical basis. These tests cover the five spot-check foods called out
 * in the audit (§5) plus the regression cases the old code got wrong:
 *
 *   - "1 serving" of a 28 g almond pack used to credit 579 kcal — should
 *     now credit ~162 kcal.
 *   - "1 cup oats" used to silently fall through to multiplier = 1 — should
 *     now use the density table (81 g per cup of dry oats → ~307 kcal).
 *   - Tablespoons / teaspoons of olive oil used to silently misreport — now
 *     use the density-derived gram weight.
 *
 * Macro values for the mock foods are USDA Foundation / SR Legacy figures
 * per 100 g; reference servings come from USDA household-serving data.
 */

import { calcMacros, densityGramsFor, quantityMultiplier } from '../utils/log/macros';
import { SearchResult, unitOptionsFor } from '../utils/log/types';

const within = (actual: number, expected: number, tolerancePct = 5) => {
  const tolerance = (Math.abs(expected) * tolerancePct) / 100;
  return Math.abs(actual - expected) <= tolerance;
};

const food = (overrides: Partial<SearchResult>): SearchResult => ({
  id: 'mock',
  name: 'mock',
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  ...overrides,
});

describe('quantityMultiplier', () => {
  it('treats grams as qty/100', () => {
    expect(quantityMultiplier(food({}), 100, 'g')).toBeCloseTo(1);
    expect(quantityMultiplier(food({}), 50, 'g')).toBeCloseTo(0.5);
  });

  it('converts ounces to grams using 28.3495', () => {
    expect(quantityMultiplier(food({}), 1, 'oz')).toBeCloseTo(0.283495, 4);
    expect(quantityMultiplier(food({}), 6, 'oz')).toBeCloseTo(1.70097, 4);
  });

  it('uses serving_size_grams for the serving unit', () => {
    expect(quantityMultiplier(food({ serving_size_grams: 28 }), 1, 'serving')).toBeCloseTo(0.28);
    expect(quantityMultiplier(food({ serving_size_grams: 118 }), 1, 'serving')).toBeCloseTo(1.18);
  });

  it('defaults serving to 100 g when serving_size_grams is missing', () => {
    expect(quantityMultiplier(food({}), 1, 'serving')).toBe(1);
  });

  it('honours explicit cup_grams when provided', () => {
    expect(quantityMultiplier(food({ cup_grams: 244 }), 1, 'cup')).toBeCloseTo(2.44);
  });

  it('falls back to the category density table for volume units', () => {
    expect(quantityMultiplier(food({ food_category: 'oats' }), 0.5, 'cup')).toBeCloseTo(0.405, 3);
    expect(quantityMultiplier(food({ food_category: 'oil' }), 1, 'tbsp')).toBeCloseTo(0.14);
  });

  it('keeps the legacy qty fall-through when no density is available', () => {
    expect(quantityMultiplier(food({}), 1, 'cup')).toBe(1);
    expect(quantityMultiplier(food({}), 2, 'tsp')).toBe(2);
  });

  it('treats PER_SERVING basis as qty regardless of unit', () => {
    expect(quantityMultiplier(food({ nutrient_basis: 'PER_SERVING' }), 2, 'g')).toBe(2);
  });

  it('is case-insensitive on the unit string', () => {
    expect(quantityMultiplier(food({}), 100, 'G')).toBeCloseTo(1);
    expect(quantityMultiplier(food({}), 1, 'OZ')).toBeCloseTo(0.283495, 4);
  });
});

describe('densityGramsFor', () => {
  it('prefers explicit per-food gram weights', () => {
    expect(densityGramsFor({ cup_grams: 240, food_category: 'oats' }, 'cup')).toBe(240);
    expect(densityGramsFor({ tbsp_grams: 13 }, 'tbsp')).toBe(13);
  });

  it('falls back to the category table', () => {
    expect(densityGramsFor({ food_category: 'milk' }, 'cup')).toBe(244);
    expect(densityGramsFor({ food_category: 'oil' }, 'tsp')).toBe(5);
  });

  it('returns null when neither source is available', () => {
    expect(densityGramsFor({}, 'cup')).toBeNull();
    expect(densityGramsFor({ food_category: 'unknown_category_xyz' }, 'tbsp')).toBeNull();
  });
});

describe('calcMacros — spot-check foods from the audit', () => {
  // Per-100g USDA macros for each reference food.
  const chickenBreastCooked = food({
    name: 'Chicken breast, cooked',
    calories: 165,
    protein: 31,
    carbs: 0,
    fat: 3.6,
    serving_size_grams: 100,
    supports_volume_units: false,
  });

  const oatsDry = food({
    name: 'Oats, dry',
    calories: 379,
    protein: 13,
    carbs: 67.7,
    fat: 6.5,
    serving_size_grams: 40,
    supports_volume_units: true,
    food_category: 'oats',
  });

  const bananaMedium = food({
    name: 'Banana, raw',
    calories: 89,
    protein: 1.1,
    carbs: 22.8,
    fat: 0.3,
    // USDA "one medium banana" reference = 118 g.
    serving_size_grams: 118,
    supports_volume_units: false,
  });

  const almonds = food({
    name: 'Almonds, raw',
    calories: 579,
    protein: 21,
    carbs: 22,
    fat: 50,
    serving_size_grams: 28,
    supports_volume_units: false,
  });

  const wholeMilk = food({
    name: 'Whole milk',
    calories: 61,
    protein: 3.2,
    carbs: 4.8,
    fat: 3.3,
    serving_size_grams: 244,
    supports_volume_units: true,
    food_category: 'milk',
  });

  it('chicken breast cooked, 6 oz → ~285 kcal, ~54 g protein', () => {
    const m = calcMacros(chickenBreastCooked, 6, 'oz');
    expect(within(m.calories, 285)).toBe(true);
    expect(within(m.protein, 53, 7)).toBe(true);
  });

  it('oats dry, 1/2 cup → ~150 kcal', () => {
    const m = calcMacros(oatsDry, 0.5, 'cup');
    // 0.5 cup * 81 g/cup = 40.5 g → 379 * 0.405 ≈ 153 kcal
    expect(within(m.calories, 150, 8)).toBe(true);
  });

  it('banana, 1 medium → ~105 kcal', () => {
    const m = calcMacros(bananaMedium, 1, 'serving');
    // 118 g * 89 kcal/100g = 105 kcal
    expect(within(m.calories, 105)).toBe(true);
  });

  it('almonds, 1 oz (28 g) → ~164 kcal — regression of the 579-kcal bug', () => {
    const m = calcMacros(almonds, 1, 'oz');
    expect(within(m.calories, 164)).toBe(true);

    // The same food via "1 serving" with serving_size_grams=28 should yield
    // the same number, not the old 579 kcal.
    const viaServing = calcMacros(almonds, 1, 'serving');
    expect(within(viaServing.calories, 162, 5)).toBe(true);
    expect(viaServing.calories).toBeLessThan(200);
  });

  it('whole milk, 1 cup → ~149 kcal', () => {
    const m = calcMacros(wholeMilk, 1, 'cup');
    // 244 g * 61 kcal/100g = 148.8 kcal
    expect(within(m.calories, 149)).toBe(true);
  });

  it('preserves linearity across qty', () => {
    const one = calcMacros(almonds, 1, 'oz');
    const two = calcMacros(almonds, 2, 'oz');
    expect(two.calories).toBe(one.calories * 2);
  });

  it('PER_SERVING legacy rows scale macros directly by qty', () => {
    const legacy = food({
      calories: 200,
      protein: 10,
      carbs: 20,
      fat: 5,
      nutrient_basis: 'PER_SERVING',
    });
    expect(calcMacros(legacy, 2, 'serving').calories).toBe(400);
  });
});

describe('unitOptionsFor', () => {
  it('hides volume chips when the food does not support them', () => {
    const opts = unitOptionsFor({ supports_volume_units: false });
    expect(opts).toEqual(['serving', 'g', 'oz']);
  });

  it('shows the full chip row when supports_volume_units is true', () => {
    const opts = unitOptionsFor({ supports_volume_units: true });
    expect(opts).toContain('cup');
    expect(opts).toContain('tbsp');
    expect(opts).toContain('tsp');
  });

  it('defaults to showing volume chips when the field is missing', () => {
    expect(unitOptionsFor(null)).toContain('cup');
    expect(unitOptionsFor({})).toContain('cup');
  });
});
