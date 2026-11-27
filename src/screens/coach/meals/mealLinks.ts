/**
 * PLAN-SWAPS-COACH-M (Style 1 "Meal page", PICK #ALM-P3): the pure part of the coach's meal page, its two pickers and
 * the builder's times. Nothing here reads or saves. The server keeps a meal's options in his order (at most 10,
 * archived ids counted) and keys a day plan's slots by label and order (real-meal-plans.service.ts, "slot_label#order").
 */
import type { DailyMealPlanSlot, DailyPlanSlotInput, MealTemplate, SlotLabel } from '../../../api/mealTemplatesApi';
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

/** One change the coach tapped on a day plan. */
export type SlotChange =
  | { kind: 'swap'; id: string; meal: string; label: SlotLabel }
  | { kind: 'add'; meal: string; label: SlotLabel }
  | { kind: 'remove'; id: string }
  | { kind: 'time'; id: string; time: string | null };
export type SlotWrite = Required<Pick<DailyPlanSlotInput, 'meal_template_id' | 'slot_label' | 'order'>> & { time_of_day: string | null };

/** The plan DTO's highest order (DailyPlanSlotInputDto, @Max(20)). */
const MAX_ORDER = 20;

/**
 * R9: the whole slot list for one change, every slot the coach did not tap sent exactly as stored (meal, label, order
 * and time), so the server keeps its row and clients' food-log links to it. Swap keeps its slot's order and time; Add
 * takes the next order after the highest and no time (or, past 20, the lowest free order); Remove leaves a gap.
 */
export function slotWrite(slots: DailyMealPlanSlot[], change: SlotChange): SlotWrite[] {
  const kept = slots.map((s): SlotWrite => ({
    meal_template_id: s.meal_template_id, slot_label: s.slot_label, order: s.order, time_of_day: s.time_of_day ?? null,
  }));
  switch (change.kind) {
    case 'swap':
      return kept.map((s, i) => (slots[i].id === change.id ? { ...s, meal_template_id: change.meal, slot_label: change.label } : s));
    case 'time':
      return kept.map((s, i) => (slots[i].id === change.id ? { ...s, time_of_day: change.time } : s));
    case 'remove':
      return kept.filter((_, i) => slots[i].id !== change.id);
    case 'add': {
      const used = new Set(kept.map((s) => s.order));
      const next = Math.max(-1, ...kept.map((s) => s.order)) + 1;
      const free = Array.from({ length: MAX_ORDER + 1 }, (_, k) => k).find((k) => !used.has(k));
      const order = next <= MAX_ORDER || free === undefined ? next : free;
      return [...kept, { meal_template_id: change.meal, slot_label: change.label, order, time_of_day: null }];
    }
  }
}

/** The saved order (sortedSlots), as the builder's Swap and the picker's Remove index it. */
const savedOrder = (slots: DailyMealPlanSlot[]) => [...slots].sort((a, b) => a.order - b.order);

/**
 * R10: the builder's meals in time order, each with its index in the saved order. A timed meal sits at its minutes; a
 * meal with no time right after the meal before it in saved order; ties keep saved order (the client's day, foodTimeline).
 */
export function byTime(slots: DailyMealPlanSlot[]): { slot: DailyMealPlanSlot; index: number }[] {
  let at = -1;
  const placed = savedOrder(slots).map((slot, index) => {
    const min = minutesOfDay(slot.time_of_day);
    if (min !== null) at = min;
    return { slot, index, at: min ?? at };
  });
  return placed.sort((a, b) => a.at - b.at || a.index - b.index).map(({ slot, index }) => ({ slot, index }));
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutesOfDay = (t: string | null | undefined) => {
  const m = typeof t === 'string' ? HHMM.exec(t) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * R8: the wheel is wall-clock local time on one fixed ordinary day (15 January 2024), never today, so a time inside a
 * clock change's skipped hour still exists. "HH:MM" is built from local getHours() and getMinutes(), never UTC.
 */
export const toWheel = (hhmm: string) => {
  const min = minutesOfDay(hhmm) ?? 12 * 60;
  return new Date(2024, 0, 15, Math.floor(min / 60), min % 60);
};
export const fromWheel = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
/** Where the wheel opens for a meal with no time: its label's hour (F12). */
const LABEL_TIME: Record<SlotLabel, string> = {
  breakfast: '07:30', lunch: '12:30', snack: '15:30', preworkout: '17:30', dinner: '19:30', postworkout: '19:00',
};
export const openingTime = (stored: string | null | undefined, label: SlotLabel) =>
  minutesOfDay(stored) !== null ? (stored as string) : LABEL_TIME[label];

/** R4: the server's two refusals on a meal save, held on the phone by code (plan-swaps.ts); anything else is saveFailed. */
const REFUSALS: Record<string, string> = {
  MEAL_SWAP_INVALID:
    'A swap must be one of your own meals that is not archived, and not this meal. Pick swaps from your meals and save again.',
  MEAL_RECIPE_INVALID: 'The recipe must be one of your own recipes. Pick a recipe you created and save again.',
};
export const saveRefused = (err: unknown) => REFUSALS[errorCode(err) ?? ''] ?? saveFailed(err);
