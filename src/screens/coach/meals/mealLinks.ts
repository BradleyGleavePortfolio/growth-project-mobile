/**
 * PLAN-SWAPS-COACH-M (Style 1 "Meal page", PICK #ALM-P3): the pure part of the coach's meal page and its two pickers.
 * Nothing here reads or saves. The server keeps a meal's options in his order (at most 10, archived ids counted).
 */
import type { MealTemplate } from '../../../api/mealTemplatesApi';
import type { RecipeAllergenFields } from '../../../lib/recipeAllergens';
import { errorCode } from '../../../types/common';
import { macroLine, saveFailed } from './mealUi';

export const MAX_OPTIONS = 10;

/** One option row: his live meal, or (only from a read answered this visit or still fresh, R5) a meal he archived. */
export type OptionRow = { id: string; state: 'meal' | 'archived' | 'unknown'; meal?: MealTemplate };
export const optionRows = (ids: string[], live: MealTemplate[] | undefined, fresh: boolean): OptionRow[] =>
  ids.map((id) => {
    const meal = live?.find((m) => m.id === id);
    if (meal) return { id, state: 'meal', meal };
    return { id, state: live && fresh ? 'archived' : 'unknown' };
  });

/** Move the id at `i` one place up (-1) or down (1); every other id stays where it sits. */
export const moveOption = (ids: string[], i: number, by: -1 | 1): string[] => {
  const j = i + by;
  if (i < 0 || i >= ids.length || j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};
export const removeOption = (ids: string[], i: number): string[] => ids.filter((_, k) => k !== i);
/** The picker's tick: an id he had leaves; a new one joins the end, in tick order. */
export const toggleOption = (ids: string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

/** The options picker's list: his live meals but this one, A to Z, found by name. */
export const pickerMeals = (live: MealTemplate[], selfId: string | undefined, q: string): MealTemplate[] => {
  const term = q.trim().toLowerCase();
  return live
    .filter((m) => m.id !== selfId && m.name.toLowerCase().includes(term))
    .sort((a, b) => a.name.localeCompare(b.name));
};

/** A recipe row of GET /recipes as the server sends it (prisma Recipe; per serving). */
export interface CoachRecipe extends RecipeAllergenFields {
  id: string;
  title: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  is_public: boolean;
  created_by_id: string;
}

/**
 * R7: only the recipes he created, in the server's order (newest first). GET /recipes also returns his own coach's
 * shared recipes, which the server refuses for a meal (MEAL_RECIPE_INVALID). Nothing until his id is known.
 */
export const ownRecipes = (rows: unknown, userId: string | undefined): CoachRecipe[] =>
  !userId || !Array.isArray(rows) ? [] : rows.filter((r): r is CoachRecipe =>
    !!r && typeof r === 'object' && (r as CoachRecipe).created_by_id === userId && typeof (r as CoachRecipe).id === 'string');

export const recipeLine = (r: CoachRecipe) =>
  `Per serving · ${macroLine({ calories_kcal: r.calories, protein_g: r.protein, carbs_g: r.carbs, fats_g: r.fat })}`;
export const recipeShare = (r: Pick<CoachRecipe, 'is_public'>) => (r.is_public ? 'Shared with your clients' : 'Only you');
/** R6: the allergen line shows whenever the recipe declares at least one allergen, shared or private. */
export const declaresAllergen = (r: RecipeAllergenFields) =>
  Array.isArray(r.allergens) && r.allergens.some((c) => typeof c === 'string' && c.trim() !== '');

/** R4: the server's two refusals on a meal save, held on the phone by code (plan-swaps.ts); anything else is saveFailed. */
const REFUSALS: Record<string, string> = {
  MEAL_SWAP_INVALID:
    'A swap must be one of your own meals that is not archived, and not this meal. Pick swaps from your meals and save again.',
  MEAL_RECIPE_INVALID: 'The recipe must be one of your own recipes. Pick a recipe you created and save again.',
};
export const saveRefused = (err: unknown) => REFUSALS[errorCode(err) ?? ''] ?? saveFailed(err);
