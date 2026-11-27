/**
 * The Kitchen page's pure part (KITCHEN-M, the owner's PICK #ALM-P2: Style 2 Menu, after Paprika). Nothing here reads,
 * writes or stores anything. Every word the page shows is a constant here (the 137-2 table in the PR body).
 *
 * Numbers (R4): a food's numbers are the Food day's own (foodLogFromDailyEntry), shown only when its food_truth is
 * exactly 'ok'; 'held', 'legacy_zero', a value not known here and a missing field all count as not 'ok'. A meal with
 * any such food, or with no foods, has no total anywhere. A total is the sum of its foods' rounded numbers.
 */
import type { ClientTodayResponse, DailyMealPlan } from '../../../api/mealTemplatesApi';
import type { SavedMeal, SavedMealItem } from '../../../api/savedFoodsApi';
import type { MealType } from '../../../types';
import { foodLogFromDailyEntry, type DailyLogEntry } from '../../../utils/log/dailyEntry';
import { buildPlanDay, joinNames, nextSlot } from '../../../utils/log/foodDay';
import { formatPortion } from '../../../utils/log/quickLog';
import { countsInDay } from '../../../utils/log/queuedDay';
import { MEAL_SECTIONS } from '../../../utils/log/types';
import { formatPlanNumber as n } from '../mealplan/planStyleC';

// ─── Words (137-2: every one approved (operator, #203-E15) or main's) ─────────────────────────────────────────────
export const WORDS = {
  title: 'Kitchen', // C2-S-65
  mastLine: 'Your meals, recipes and grocery list.', // KM-2
  yourMeals: 'Your meals', // KM-9
  more: 'More in your kitchen', // KM-9
  fromYourCoach: 'From your coach', // KK-1b
  loading: 'Loading saved meals', // KM-13 (spoken)
  failed: "Couldn't load saved meals", // KM-14
  failedLine: 'Check the connection and try again.', // main
  tryAgain: 'Try again', // main
  empty: 'No saved meals yet. Save one you eat often and log it again in two taps.', // KM-7
  noTotal: 'No total', // KK-2
  held: 'Numbers held back', // KK-3
  noFoods: 'No foods left in this meal', // KK-8a
  nothingToAdd: 'Its foods were removed, so there is nothing to add.', // KK-8b
  foodGone: 'A food in this meal can no longer be logged, so nothing was added.', // KK-5
  notAdded: 'This meal was not added. Check the connection and try again.', // KK-6 (main's, LogPlannedMealButton)
  mealGone: 'This meal is no longer saved.', // KK-7
  offline: 'Adding a saved meal needs a connection. Nothing was added.', // KK-9
  day: 'Day', // KM-20
  today: 'Today', // main
  meal: 'Meal', // KM-20
  add: 'Add to today', // KM-20
  close: 'Close', // main
  seeToday: 'See today', // KM-15
  recipes: 'Recipes', // main
  grocery: 'Grocery list', // main
  prep: 'Prep guide', // main
  week: 'Food this week', // KITCHEN-WEEK-M
  logFood: 'Log food', // the owner's (#ALM-E26)
  logFoodHint: 'Opens today on the Food tab', // new (operator, #203-E15): the add sheet opens from the Food tab only
} as const;

export const fromCoach = (first: string | null): string => (first ? `From ${first}` : WORDS.fromYourCoach); // C2-S-83
export const kcalWords = (kcal: number): string => `${n(kcal)} kcal`; // KM-4
export const proteinWords = (p: number): string => `${n(p)} g protein`; // KM-4
export const addedWords = (meal: MealType): string => `Added to today's ${mealWord(meal)}.`; // KM-15
export const toGetWords = (m: number): string => `${n(m)} to get`; // KM-10
/** KM-10: the recipe count, with how many came from her coach when there are any and she has one. */
export function recipesDetail(total: number, fromHim: number, coach: string | null): string {
  return coach && fromHim > 0 ? `${n(total)}, ${n(fromHim)} from ${coach}` : n(total);
}
/** KK-4: one held food is named; two or more are counted. */
export function heldNote(held: string[]): string {
  return held.length === 1
    ? `Numbers for ${held[0]} are held back here, so this meal has no total. Adding it checks the food again.`
    : `Numbers for ${held.length} of its foods are held back here, so this meal has no total. Adding it checks them again.`;
}
/** KK-2 spoken. */
export const noTotalSpoken = (name: string, held: number): string => `${name}, no total: numbers held back for ${held} of its foods`;
/** "A", "A and B", "A, B and C" (main's joinNames); KK-10 for four or more. */
export function foodsLine(names: string[]): string {
  return names.length <= 3 ? joinNames(names) : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}
/** Breakfast, lunch, dinner or snacks: the Food day's own section names (MEAL_SECTIONS), lower case in a sentence. */
export const mealWord = (meal: MealType): string => (MEAL_SECTIONS.find((m) => m.type === meal)?.label ?? 'Snacks').toLowerCase();

// ─── A meal's foods and numbers (R4) ──────────────────────────────────────────────────────────────────────────────
export interface KitchenFood { name: string; amount: string; ok: boolean; kcal: number; protein: number }
export interface MealView {
  foods: KitchenFood[];
  /** The foods whose numbers are held back. */
  held: string[];
  /** Null: no total anywhere (a food not 'ok', or no foods). */
  total: { kcal: number; protein: number } | null;
}

const itemsOf = (meal: SavedMeal): SavedMealItem[] => (Array.isArray(meal.items) ? meal.items : []);

/** One adapter: a saved food read through the Food day's own map (dailyEntry.ts), so no second formula exists. */
function asLogged(item: SavedMealItem): KitchenFood {
  const entry: DailyLogEntry = {
    id: item.id, food_item_id: item.food_item_id, user_id: '', meal_type: 'snack',
    quantity_multiplier: item.quantity_multiplier, original_quantity: item.original_quantity,
    original_unit: item.original_unit, food_item: item.food_item,
  };
  const log = foodLogFromDailyEntry(entry, '');
  return { name: log.foodName, amount: formatPortion(log.quantity, log.unit), ok: item.food_truth === 'ok' || item.food_truth === 'held',
    kcal: log.calories, protein: log.protein };
}

export function mealView(meal: SavedMeal): MealView {
  const foods = itemsOf(meal).map(asLogged);
  const held = foods.filter((f) => !f.ok).map((f) => f.name);
  const total = foods.length > 0 && held.length === 0
    ? foods.reduce((t, f) => ({ kcal: t.kcal + f.kcal, protein: t.protein + f.protein }), { kcal: 0, protein: 0 })
    : null;
  return { foods, held, total };
}

/** The sheet's line: "{kcal} kcal, {p} g protein. {n} foods." or KK-2's form when there is no total. */
export function sheetLine(view: MealView): string {
  const count = view.foods.length === 1 ? '1 food.' : `${view.foods.length} foods.`;
  return view.total ? `${kcalWords(view.total.kcal)}, ${proteinWords(view.total.protein)}. ${count}` : `${WORDS.noTotal}. ${count}`;
}

/** The row's spoken label (protein is spoken though not drawn). */
export function rowSpoken(meal: SavedMeal, view: MealView): string {
  if (view.foods.length === 0) return `${meal.name}, ${WORDS.noFoods}`;
  return view.total ? `${meal.name}, ${kcalWords(view.total.kcal)}, ${proteinWords(view.total.protein)}`
    : noTotalSpoken(meal.name, view.held.length);
}

/** A list answer that is not a list is a failed read (S8); a meal without an id or name is dropped, never a crash. */
export function savedMealsOf(data: unknown): SavedMeal[] | null {
  if (!Array.isArray(data)) return null;
  return data.filter((m): m is SavedMeal => !!m && typeof m === 'object' && typeof (m as SavedMeal).id === 'string'
    && typeof (m as SavedMeal).name === 'string');
}

// ─── The meal of the hour (R5) ────────────────────────────────────────────────────────────────────────────────────
/** Before 10:30 breakfast, 10:30 to 14:59 lunch, 15:00 to 16:59 snacks, 17:00 to 20:59 dinner, otherwise snacks. */
export function mealOfHour(minute: number): MealType {
  if (minute < 10 * 60 + 30) return 'breakfast';
  if (minute < 15 * 60) return 'lunch';
  if (minute < 17 * 60) return 'snack';
  if (minute < 21 * 60) return 'dinner';
  return 'snack';
}

/** A refused or lost log: the status (none for a lost answer) and the server's message. */
export function failureOf(err: unknown): { status?: number; message: string } {
  const res = (err as { response?: { status?: number; data?: { message?: unknown } } } | null)?.response;
  const m = res?.data?.message;
  return { status: res?.status, message: Array.isArray(m) ? m.join(' ') : typeof m === 'string' ? m : '' };
}

/** R6: the intent of one save; a changed meal or day is another save with its own key. */
export const addIntent = (mealId: string, date: string, meal: MealType): unknown[] => ['saved-meal', mealId, date, meal];

// ─── From {coach} (R8) ────────────────────────────────────────────────────────────────────────────────────────────
const KM5: Record<string, string> = {
  Breakfast: "Today's breakfast", Lunch: "Today's lunch", Dinner: "Tonight's dinner", Snack: "Today's snack",
  'Pre-workout': 'Before your workout today', 'Post-workout': 'After your workout today',
};
export interface PlanCard { slotId: string; name: string; line: string; kcal: number | null }

/** The first plan meal of today still to eat, built as the Food day builds it; null when there is none to show. */
export function planCard(plan: ClientTodayResponse | null | undefined, daily: unknown, today: string): PlanCard | null {
  if (!plan || !daily || typeof daily !== 'object') return null;
  const plans: DailyMealPlan[] = [...new Map((plan.assignments ?? [])
    .flatMap((a) => (a?.daily_meal_plan ? [[a.daily_meal_plan.id, a.daily_meal_plan] as const] : []))).values()]
    .filter((x) => Array.isArray(x.slots) && x.slots.length > 0);
  if (plans.length === 0) return null;
  const entries = (daily as { entries?: unknown }).entries;
  const logs = (Array.isArray(entries) ? entries as DailyLogEntry[] : []).map((e) => foodLogFromDailyEntry(e, today)).filter(countsInDay);
  const slot = nextSlot(buildPlanDay(plans, logs));
  if (!slot) return null;
  return { slotId: slot.key, name: slot.name, line: KM5[slot.label] ?? KM5.Snack,
    kcal: typeof slot.kcal === 'number' && Number.isFinite(slot.kcal) ? slot.kcal : null };
}

/** The coach's first name from GET /v1/clients/me/coach, as the Food day reads it (FoodDayView.tsx coachFirst). */
export const coachFirst = (data: { name?: string } | undefined): string | null => (data?.name ?? '').trim().split(/\s+/)[0] || null;
