/**
 * Recipe allergens: the app half of allergy filtering (ALLERGY-M-130).
 *
 * The backend (CF-ALLERGY-128, src/recipes/allergens.ts) owns the one allergen
 * list and the rule: a recipe the client's coach shares is left out of GET
 * /recipes, /recipes/saved and /prep-guide when its author DECLARED an
 * allergen saved on the client's profile, and opening one answers 404
 * RECIPE_HIDDEN_FOR_ALLERGENS. Recipe text is never guessed into an allergen,
 * so the app only repeats what the author declared and labels everything else
 * "Allergens not declared".
 *
 * GET /recipes/allergens answering means the rule is live for this account. A
 * backend without the rule answers 404 there (the path falls into
 * GET /recipes/:id), and the app keeps saying recipes are not filtered.
 */
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { recipesApi } from '../services/api';
import { errorCode, errorStatus } from '../types/common';

/** The allergen fields every recipe read carries once the backend rule is live. */
export interface RecipeAllergenFields {
  allergens?: string[] | null;
  allergens_declared?: boolean | null;
}

/** Names for the backend's allergen codes, in its list order (src/recipes/allergens.ts). */
const ALLERGEN_NAMES: ReadonlyMap<string, string> = new Map([
  ['peanuts', 'peanuts'],
  ['tree_nuts', 'tree nuts'],
  ['dairy', 'dairy'],
  ['eggs', 'eggs'],
  ['fish', 'fish'],
  ['shellfish', 'shellfish'],
  ['soy', 'soy'],
  ['sesame', 'sesame'],
  ['gluten', 'gluten'],
]);

export const RECIPE_HIDDEN_FOR_ALLERGENS = 'RECIPE_HIDDEN_FOR_ALLERGENS';

/** A code's name in a sentence; a code this build does not know is shown as sent, underscores as spaces. */
export function allergenName(code: string): string {
  return ALLERGEN_NAMES.get(code) ?? code.replace(/_/g, ' ').trim().toLowerCase();
}

/** "a", "a and b", "a, b and c". */
export function listWords(words: readonly string[], last = 'and'): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} ${last} ${words[words.length - 1]}`;
}

function declaredNames(recipe: RecipeAllergenFields): string[] {
  const codes = Array.isArray(recipe.allergens) ? recipe.allergens : [];
  return codes.filter((c): c is string => typeof c === 'string' && c.trim() !== '').map(allergenName);
}

/**
 * The row line, from the author's declaration only:
 *   declared, some allergens   -> "Contains peanuts and dairy"
 *   declared, none of the list -> "Declared free of 9 common allergens"
 *   some listed, not confirmed -> "Contains dairy; other allergens not declared"
 *   nothing declared, or a backend without the fields -> "Allergens not declared"
 */
export function recipeAllergenSummary(recipe: RecipeAllergenFields): string {
  const names = declaredNames(recipe);
  const complete = recipe.allergens_declared === true;
  if (names.length > 0) {
    const contains = `Contains ${listWords(names)}`;
    return complete ? contains : `${contains}; other allergens not declared`;
  }
  return complete ? `Declared free of ${ALLERGEN_NAMES.size} common allergens` : 'Allergens not declared';
}

/** The detail sentence: a recipe declared free of the list names every allergen on it. */
export function recipeAllergenDetail(recipe: RecipeAllergenFields): string {
  if (recipe.allergens_declared === true && declaredNames(recipe).length === 0) {
    return `Declared free of ${listWords([...ALLERGEN_NAMES.values()])}.`;
  }
  return `${recipeAllergenSummary(recipe)}.`;
}

/** True when a recipe read was refused because it declares an allergen saved on the profile. */
export function isHiddenForAllergens(err: unknown): boolean {
  return errorStatus(err) === 404 && errorCode(err) === RECIPE_HIDDEN_FOR_ALLERGENS;
}

/**
 * 'on' = the backend hides shared recipes that declare a saved allergen;
 * 'off' = this backend has no allergen rule (404 on GET /recipes/allergens);
 * 'unknown' = not confirmed either way (still loading, or the read failed).
 */
export type RecipeAllergenRule = 'on' | 'off' | 'unknown';

export interface RecipeAllergenGuide {
  rule: RecipeAllergenRule;
  /** The read answered or failed; the one-time prompt waits for it so its copy never changes while read. */
  settled: boolean;
  /** Names of the saved allergens that hide recipes for this account (rule 'on' only). */
  hiddenNames: string[];
}

function savedAllergens(data: unknown): string[] | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const { allergens, your_allergens: saved } = data as { allergens?: unknown; your_allergens?: unknown };
  if (!Array.isArray(allergens) || !Array.isArray(saved)) return null;
  return saved.filter((c): c is string => typeof c === 'string');
}

/** GET /recipes/allergens: whether the rule is live and which saved allergens hide recipes. */
export function useRecipeAllergenGuide(): RecipeAllergenGuide {
  const query = useQuery<unknown>({
    queryKey: ['recipes', 'allergens'],
    queryFn: () => recipesApi.allergens().then((r) => r.data as unknown),
    staleTime: 5 * 60 * 1000,
    // A 404 is an answer (no rule on this backend); a failed read stays 'unknown'.
    retry: false,
  });
  const saved = savedAllergens(query.data);
  if (saved) return { rule: 'on', settled: true, hiddenNames: saved.map(allergenName) };
  if (query.isError && errorStatus(query.error) === 404) return { rule: 'off', settled: true, hiddenNames: [] };
  return { rule: 'unknown', settled: !query.isLoading, hiddenNames: [] };
}

/** After saved allergies change: read every recipe list and detail again, so newly hidden recipes leave them. */
export function refreshRecipeReads(client: Pick<QueryClient, 'invalidateQueries'>): void {
  for (const queryKey of [['recipes'], ['recipe'], ['prep-guide']]) {
    void client.invalidateQueries({ queryKey });
  }
}
