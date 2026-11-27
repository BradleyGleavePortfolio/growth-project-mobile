/**
 * PLAN-SWAPS-M: the pure part of the coach's plan meals on the phone (C2 Style C C_something, C_changed, C_recipe).
 * Every word and number comes from the plan read (GET /me/meal-plan/today: slots with swaps and recipe_id, and
 * changes_today) or the recipe; nothing is invented, and a missing number is never shown or logged as zero.
 */
import type {
  ClientTodayResponse, DailyMealPlan, DailyMealPlanSlot, MealTemplate, MealTemplateItem, PlanChange, PlanSwap, SlotLabel,
} from '../../../api/mealTemplatesApi';
import type { SearchResult } from '../../../utils/log/types';
import { clockOf } from '../../../utils/log/foodTimeline';

/** Grouped whole numbers, as the meal plan page writes them (planStyleC formatPlanNumber). */
const n = (v: number) => Math.round(v).toLocaleString('en-US');

/** The slot's label as the Food day writes it (foodDay.ts LABEL). */
export const SLOT_NAME: Record<SlotLabel, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack', preworkout: 'Pre-workout', postworkout: 'Post-workout',
};
// R12: the drawn sentence names "the pre-workout meal"; the four day meals read as themselves.
const MEAL_WORD: Record<SlotLabel, string> = {
  breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snack: 'snack', preworkout: 'pre-workout meal', postworkout: 'post-workout meal',
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
type FullSwap = PlanSwap & { carbs_g: number; fats_g: number };

/** R2: the swaps that may show, in the server's order: only those with all four numbers (a swap that cannot log is never offered). */
export function swapsToShow(slot: Pick<DailyMealPlanSlot, 'swaps'> | null | undefined): FullSwap[] {
  return (slot?.swaps ?? []).filter((s): s is FullSwap =>
    !!s && typeof s.name === 'string' && s.name.trim() !== '' && [s.calories_kcal, s.protein_g, s.carbs_g, s.fats_g].every(finite));
}

/** R12: the footnote under the search field of a plan meal's Something else. */
export const footnoteFor = (label: SlotLabel) =>
  `What you log here fills the ${MEAL_WORD[label] ?? 'meal'}. Extras never tick a plan meal.`;

/** The coach's first name, as the Food day reads it (FoodDayView.tsx coachFirst). */
export const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

/** "{kcal} kcal, {p} g protein, {c} g carbs, {f} g fat." (C2-C-09). */
const fourNumbers = (kcal: number, p: number, c: number, f: number) => `${n(kcal)} kcal, ${n(p)} g protein, ${n(c)} g carbs, ${n(f)} g fat.`;

/** R8: the page's masthead line, the plan meal's own numbers (what "Ate it as planned" logs). */
export const perServingLine = (t: Pick<MealTemplate, 'calories_kcal' | 'protein_g' | 'carbs_g' | 'fats_g'>) =>
  `Per serving: ${fourNumbers(t.calories_kcal, t.protein_g, t.carbs_g, t.fats_g)}`;

/** R5: a swap as the add sheet's food: no id (one food is made), one serving with no grams, its four numbers per serving. */
const swapFood = (s: FullSwap): SearchResult => ({
  name: s.name.trim(), calories: s.calories_kcal, protein: s.protein_g, carbs: s.carbs_g, fat: s.fats_g,
  nutrient_basis: 'PER_SERVING', serving_size: '1 serving', serving_size_grams: 0,
});

export interface SwapRow { id: string; name: string; line: string; label: string; hint: string; food: SearchResult }
export interface PlanMealSheet {
  slot: SlotLabel;
  /** The plan meal's label ("Pre-workout"): the portion sheet's "For {meal}". */
  label: string;
  instead: string;
  /** "Swaps from {coach}", only with at least one swap row. */
  heading: string | null;
  swaps: SwapRow[];
  footnote: string;
}

/** R4: the Something else sheet for a plan meal: the "Instead of" line, the coach's swaps (R2) and the footnote (R12). */
export function somethingElseSheet(slot: DailyMealPlanSlot, coach: string): PlanMealSheet {
  const t = slot.meal_template;
  const label = SLOT_NAME[slot.slot_label] ?? 'Meal';
  const swaps = swapsToShow(slot).map((s) => {
    const line = `${n(s.calories_kcal)} kcal, ${n(s.protein_g)} g protein`;
    return { id: s.id, name: s.name.trim(), line, label: `${s.name.trim()}, ${line}`, hint: `Opens the amount for ${label}`, food: swapFood(s) };
  });
  return {
    slot: slot.slot_label,
    label,
    instead: `Instead of ${t.name}, ${n(t.calories_kcal)} kcal.`,
    heading: swaps.length > 0 ? `Swaps from ${coach || 'your coach'}` : null,
    swaps,
    footnote: footnoteFor(slot.slot_label),
  };
}

/** Every plan of the day, a plan assigned twice once (FoodDayView's rule). */
export const plansOf = (data: ClientTodayResponse | null | undefined): DailyMealPlan[] =>
  [...new Map((data?.assignments ?? []).flatMap((a) => (a?.daily_meal_plan ? [[a.daily_meal_plan.id, a.daily_meal_plan] as const] : []))).values()];

/** A plan meal by its slot id across the day's plans; null when the coach has removed it. */
export function findPlanSlot(data: ClientTodayResponse | null | undefined, slotId: string): { slot: DailyMealPlanSlot; plan: DailyMealPlan } | null {
  for (const plan of plansOf(data)) {
    const slot = (plan.slots ?? []).find((s) => s.id === slotId);
    if (slot) return { slot, plan };
  }
  return null;
}

const timeOf = (c: PlanChange) => {
  const d = new Date(c.changed_at);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * R10 (C_changed, C2-S-67 to C2-S-69): "{coach} updated today's plan at {time}." with one sentence per changed meal
 * (its newest row wins), or "{n} meals changed." for three or more, then "Meals you already logged stay as they are."
 * A meal whose newest row has no new meal is off the plan; one the server could not name gets no sentence.
 */
export function changeNote(changes: PlanChange[] | null | undefined, coach: string): string | null {
  const rows = (changes ?? []).filter((c) => c && typeof c.slot_id === 'string' && timeOf(c));
  if (rows.length === 0) return null;
  const newest = new Map<string, PlanChange>();
  for (const c of rows) {
    const seen = newest.get(c.slot_id);
    if (!seen || (timeOf(c) as Date) >= (timeOf(seen) as Date)) newest.set(c.slot_id, c);
  }
  const last = rows.reduce((a, c) => ((timeOf(c) as Date) > (timeOf(a) as Date) ? c : a));
  const at = timeOf(last) as Date;
  const meals = [...newest.values()].flatMap((c) => {
    const meal = SLOT_NAME[c.slot_label] ?? 'A meal';
    if (!c.to_template_id) return [`${meal} is off today's plan.`];
    return c.to_name ? [`${meal} is now ${c.to_name}.`] : [];
  });
  const middle = newest.size >= 3 ? [`${newest.size} meals changed.`] : meals;
  return [`${coach || 'Your coach'} updated today's plan at ${clockOf(at.getHours() * 60 + at.getMinutes())}.`, ...middle,
    'Meals you already logged stay as they are.'].join(' ');
}

/** R11: the slots to mark "Updated": a change row names the slot by id and its new meal is the slot's meal now. */
export function updatedSlotIds(changes: PlanChange[] | null | undefined, plans: DailyMealPlan[]): Set<string> {
  const rows = changes ?? [];
  return new Set(plans.flatMap((p) => p.slots ?? []).filter((s) =>
    rows.some((c) => c && c.slot_label === s.slot_label && !!c.to_template_id)).map((s) => s.id));
}

export interface IngredientRow { name: string; amount: string | null }
type RecipeLines = { id: string; ingredients?: string[] | null };
const lines = (recipe: RecipeLines) => (recipe.ingredients ?? []).map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
const named = (items: MealTemplateItem[] | null | undefined) =>
  (items ?? []).filter((i) => i && typeof i.name === 'string' && i.name.trim() !== '');

/** S7, S10: a recipe's lines as written (no amount of their own), or the meal's items with their grams or portion. */
export function ingredientRows(recipe: RecipeLines | null, items: MealTemplateItem[] | null | undefined): IngredientRow[] {
  if (recipe) return lines(recipe).map((name) => ({ name, amount: null }));
  return named(items).map((i) => ({ name: i.name.trim(), amount: finite(i.grams) ? `${i.grams} g` : i.portion?.trim() || null }));
}

export type GroceryItem = { name: string; quantity?: number; unit?: string; source_recipe_id?: string };
/** R9: the grocery list items for the page's ingredients; never an invented quantity and never a plan slot id. */
export function groceryItems(recipe: RecipeLines | null, items: MealTemplateItem[] | null | undefined): GroceryItem[] {
  if (recipe) return lines(recipe).map((name) => ({ name: name.slice(0, 200), source_recipe_id: recipe.id }));
  return named(items).map((i) => {
    const name = i.name.trim().slice(0, 200);
    if (finite(i.grams) && i.grams >= 0) return { name, quantity: i.grams, unit: 'g' };
    const portion = i.portion?.trim();
    return portion ? { name, unit: portion.slice(0, 50) } : { name };
  });
}
