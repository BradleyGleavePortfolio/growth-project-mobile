/**
 * PLAN-SWAPS-COACH-M: the pure part of the coach's meal page (mealLinks.ts). Red at the base because the module does
 * not exist there: the options list, the picker list, his own recipes and the save refusals. (The builder's slot
 * writes, time order and wheel cases go with the builder to PLAN-SWAPS-COACH-M2, Size split.)
 */
import type { MealTemplate } from '../../../../api/mealTemplatesApi';
import * as L from '../mealLinks';

const links = () => L;

const meal = (id: string, name: string, k = 200, p = 20, c = 20, f = 5): MealTemplate => ({
  id, coach_id: 'coach', name, description: null, calories_kcal: k, protein_g: p, carbs_g: c, fats_g: f,
  fiber_g: null, items: null, created_at: '2026-11-01T00:00:00.000Z', archived_at: null,
});

describe('options for clients', () => {
  const live = [meal('a', 'Rice cakes, honey and whey'), meal('b', 'Greek yoghurt and granola'), meal('self', 'Banana and whey shake')];

  it('rows keep his order; an id not among his live meals is archived only from a fresh read, else unknown', () => {
    const { optionRows } = links();
    expect(optionRows(['b', 'gone', 'a'], live, true).map((r) => `${r.id} ${r.state}`)).toEqual(['b meal', 'gone archived', 'a meal']);
    expect(optionRows(['b', 'gone', 'a'], live, false).map((r) => `${r.id} ${r.state}`)).toEqual(['b meal', 'gone unknown', 'a meal']);
    expect(optionRows(['a'], undefined, false).map((r) => r.state)).toEqual(['unknown']);
  });

  it('move up, move down, remove and the picker tick keep every other id where it sits', () => {
    const { moveOption, removeOption, toggleOption, MAX_OPTIONS } = links();
    expect(MAX_OPTIONS).toBe(10);
    expect(moveOption(['a', 'x', 'b'], 1, -1)).toEqual(['x', 'a', 'b']);
    expect(moveOption(['a', 'x', 'b'], 1, 1)).toEqual(['a', 'b', 'x']);
    expect(moveOption(['a', 'x', 'b'], 0, -1)).toEqual(['a', 'x', 'b']);
    expect(moveOption(['a', 'x', 'b'], 2, 1)).toEqual(['a', 'x', 'b']);
    expect(removeOption(['a', 'x', 'b'], 1)).toEqual(['a', 'b']);
    expect(toggleOption(['a', 'x', 'b'], 'a')).toEqual(['x', 'b']);
    expect(toggleOption(['x', 'b'], 'c')).toEqual(['x', 'b', 'c']);
  });

  it('the picker lists his live meals A to Z, this meal left out, and finds by name', () => {
    const { pickerMeals } = links();
    expect(pickerMeals(live, 'self', '').map((m) => m.name)).toEqual(['Greek yoghurt and granola', 'Rice cakes, honey and whey']);
    expect(pickerMeals(live, undefined, '').map((m) => m.id)).toEqual(['self', 'b', 'a']);
    expect(pickerMeals(live, 'self', '  RICE ').map((m) => m.id)).toEqual(['a']);
  });
});

describe('his own recipes (R7)', () => {
  const rows = [
    { id: 'r1', title: 'Banana protein shake', created_by_id: 'coach', is_public: true, allergens: ['dairy'], allergens_declared: true },
    { id: 'rR', title: 'Riley bowl', created_by_id: 'riley', is_public: true, allergens: [], allergens_declared: true },
    { id: 'r3', title: 'Overnight protein oats', created_by_id: 'coach', is_public: false, allergens: [], allergens_declared: true },
  ];
  it('only rows he created, in the server order; nothing until his id is known; a list of other shapes is none', () => {
    const { ownRecipes } = links();
    expect(ownRecipes(rows, 'coach').map((r) => r.id)).toEqual(['r1', 'r3']);
    expect(ownRecipes(rows, undefined)).toEqual([]);
    expect(ownRecipes([{ id: 'p1', name: 'Training day' }], 'coach')).toEqual([]);
    expect(ownRecipes({ data: rows }, 'coach')).toEqual([]);
  });
  it('share line and the allergen rule (R6: any declared allergen, shared or private)', () => {
    const { recipeShare, declaresAllergen } = links();
    expect(rows.map((r) => recipeShare(r as never))).toEqual(['Shared with your clients', 'Shared with your clients', 'Only you']);
    expect(rows.map((r) => declaresAllergen(r as never))).toEqual([true, false, false]);
    expect(declaresAllergen({ allergens: ['soy'], is_public: false } as never)).toBe(true);
    expect(declaresAllergen({ allergens: null } as never)).toBe(false);
  });
});

describe('the save refusals by code (R4, F10)', () => {
  const err = (code: string) => ({ response: { status: 400, data: { code, error: code, message: 'Something from the server' } } });
  it('MEAL_SWAP_INVALID and MEAL_RECIPE_INVALID say the drawn sentences; anything else is main saveFailed', () => {
    const { saveRefused } = links();
    expect(saveRefused(err('MEAL_SWAP_INVALID'))).toBe(
      'A swap must be one of your own meals that is not archived, and not this meal. Pick swaps from your meals and save again.');
    expect(saveRefused(err('MEAL_RECIPE_INVALID'))).toBe('The recipe must be one of your own recipes. Pick a recipe you created and save again.');
    expect(saveRefused({ message: 'Network Error', isAxiosError: true })).toBe('That did not save. Check your connection, then try again.');
    expect(saveRefused({ response: { status: 500, data: {} } })).toBe('That did not save. Try again in a moment.');
  });
});
