/**
 * The Food tab's day as a checklist (V1_1_UI_SPEC UI-3): the coach's plan meals in order, or, for a
 * client with no coach, "Your usual day" from the meals they repeat; each one done once the day's log
 * has it. Pure: every meal, food and number comes from the plan read, the past week's logs and the
 * day's logs; nothing is invented.
 */
import type { FoodLog, MealType } from '../../types';
import type { DailyMealPlan, SlotLabel } from '../../api/mealTemplatesApi';
import type { PastMeal } from '../../hooks/useFoodBrowse';
import { formatPortion } from './quickLog';
import { mapLogEntryToFood, type RawLogEntry } from './mapFoodItem';

export interface DaySlot {
  key: string;
  mealType: MealType;
  label: string;
  name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  foods: Array<{ name: string; portion: string }>;
  /** Foods logged today that count toward this meal; empty while it is still to eat. */
  logs: FoodLog[];
  /** Done line: "Logged as planned", or "Logged with a change:" and the new amount or the foods eaten instead. */
  status: string | null;
  /** Usual day only: the newest earlier version of this meal (to repeat) and every day it was eaten, newest first. */
  usual?: { meal: PastMeal; days: string[] };
}

export interface FoodDay {
  kind: 'plan' | 'usual';
  slots: DaySlot[];
  extras: FoodLog[];
}

/** One earlier day's `/log/daily` entries, as useFoodBrowse reads them. */
export interface PastDay {
  date: string;
  entries: Array<RawLogEntry & {
    food_item_id?: string; meal_type?: MealType; quantity_multiplier?: number;
    original_quantity?: number | null; original_unit?: string | null;
  }>;
}

const DAY_MEALS: MealType[] = ['breakfast', 'lunch', 'snack', 'dinner'];
const RANK: Record<SlotLabel, number> = { breakfast: 0, preworkout: 1, lunch: 2, snack: 3, postworkout: 4, dinner: 5 };
const LOG_MEAL: Record<SlotLabel, MealType> = {
  breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snack: 'snack', preworkout: 'snack', postworkout: 'snack',
};
const LABEL: Record<SlotLabel, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack', preworkout: 'Pre-workout', postworkout: 'Post-workout',
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const isPlainServing = (l: FoodLog) => l.quantity === 1 && l.unit === 'serving';

export function buildPlanDay(plan: DailyMealPlan, logs: FoodLog[]): FoodDay {
  const left = [...logs];
  const slots = [...plan.slots].sort((a, b) => RANK[a.slot_label] - RANK[b.slot_label] || a.order - b.order);
  // A plan meal is logged when an entry under its own name is in its meal ("Ate it as planned").
  const planned = slots.map((s) => {
    const i = left.findIndex((l) => l.mealType === LOG_MEAL[s.slot_label] && same(l.foodName, s.meal_template.name));
    return i >= 0 ? left.splice(i, 1)[0] : null;
  });
  const claimed: FoodLog[][] = planned.map((p) => (p ? [p] : []));
  // Other foods in a meal whose plan meal is still open stand in for it (a change); the first open
  // slot of that meal takes them. Every other food is an extra, not in the plan.
  for (const meal of DAY_MEALS) {
    const rest = left.filter((l) => l.mealType === meal);
    const to = slots.findIndex((s, i) => LOG_MEAL[s.slot_label] === meal && !planned[i]);
    if (rest.length === 0 || to < 0) continue;
    claimed[to].push(...rest);
    rest.forEach((l) => left.splice(left.indexOf(l), 1));
  }
  return {
    kind: 'plan',
    extras: left,
    slots: slots.map((s, i) => {
      const t = s.meal_template;
      const mine = claimed[i];
      const p = planned[i];
      const status = p
        ? isPlainServing(p) ? 'Logged as planned' : `Logged with a change: ${formatPortion(p.quantity, p.unit)}`
        : mine.length > 0 ? `Logged with a change: ${joinNames(mine.map((l) => l.foodName))}` : null;
      return {
        key: s.id,
        mealType: LOG_MEAL[s.slot_label],
        label: LABEL[s.slot_label],
        name: t.name,
        kcal: t.calories_kcal,
        protein: t.protein_g,
        carbs: t.carbs_g,
        fat: t.fats_g,
        foods: (t.items ?? []).map((f) => ({ name: f.name, portion: f.portion ?? (f.grams != null ? `${f.grams} g` : '') })),
        logs: mine,
        status,
      };
    }),
  };
}

/** The first meal still to eat. */
export const nextSlot = (day: FoodDay): DaySlot | null => day.slots.find((s) => s.logs.length === 0) ?? null;

const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((t, r) => t + (Number(pick(r)) || 0), 0);

type Usual = { days: string[]; meal: PastMeal; protein: number; carbs: number; fat: number; foods: DaySlot['foods'] };

/** The foods logged to `meal` on two or more of the earlier days (the most days wins, then the newest), or null. */
function usualMeal(meal: MealType, newestFirst: PastDay[]): Usual | null {
  const groups = new Map<string, Usual>();
  for (const day of newestFirst) {
    const rows = day.entries.flatMap((e) => {
      const food = e.meal_type === meal ? mapLogEntryToFood(e) : null;
      const id = e.food_item_id || food?.id;
      const k = e.quantity_multiplier ?? 0;
      return food && id && Number.isFinite(k) && k > 0 ? [{ e, food, id, k }] : [];
    });
    if (rows.length === 0) continue;
    const signature = rows.map((r) => r.id).sort().join('|');
    const seen = groups.get(signature);
    if (seen) { seen.days.push(day.date); continue; }
    const entries = rows.map(({ e, food, id, k }) => ({
      foodItemId: id, name: food.name, calories: (Number(food.calories) || 0) * k, quantityMultiplier: k,
      originalQuantity: typeof e.original_quantity === 'number' ? e.original_quantity : undefined,
      originalUnit: e.original_unit?.trim() || undefined,
    }));
    groups.set(signature, {
      days: [day.date],
      meal: { date: day.date, entries, calories: sum(entries, (x) => x.calories) },
      protein: sum(rows, (r) => r.food.protein * r.k), carbs: sum(rows, (r) => r.food.carbs * r.k), fat: sum(rows, (r) => r.food.fat * r.k),
      foods: rows.map(({ e, food, k }) => {
        const unit = e.original_unit?.trim();
        const qty = e.original_quantity;
        const portion = unit && typeof qty === 'number' ? formatPortion(qty, unit)
          : food.nutrient_basis === 'PER_SERVING' ? formatPortion(k, 'serving') : `${Math.round(k * 100)} g`;
        return { name: food.name, portion };
      }),
    });
  }
  // Array sort is stable, so on a tie the newest version (seen first) stays first.
  const best = [...groups.values()].sort((x, y) => y.days.length - x.days.length)[0];
  return best && best.days.length >= 2 ? best : null;
}

/**
 * "Your usual day" for a client with no coach: each meal with a usual version (usualMeal), and each meal
 * logged on the shown day. A logged meal counts the foods of its usual version, or every food when none
 * of them is; its other foods are extras. A usual meal still to eat can be repeated with the same portions.
 */
export function buildUsualDay(past: PastDay[], logs: FoodLog[]): FoodDay {
  const newestFirst = [...past].sort((a, b) => (a.date < b.date ? 1 : -1));
  const slots: DaySlot[] = [];
  const extras: FoodLog[] = [];
  for (const meal of DAY_MEALS) {
    const usual = usualMeal(meal, newestFirst);
    const mine = logs.filter((l) => l.mealType === meal);
    const inUsual = mine.filter((l) => usual?.meal.entries.some((x) => x.foodItemId === l.foodItemId || same(x.name, l.foodName)));
    const counted = inUsual.length > 0 ? inUsual : mine;
    extras.push(...mine.filter((l) => !counted.includes(l)));
    const base = { key: meal, mealType: meal, label: LABEL[meal] };
    if (counted.length > 0) {
      slots.push({
        ...base, name: joinNames(counted.map((l) => l.foodName)), kcal: sum(counted, (l) => l.calories), protein: sum(counted, (l) => l.protein),
        carbs: sum(counted, (l) => l.carbs), fat: sum(counted, (l) => l.fat), foods: [], logs: counted,
        status: `${counted.length} ${counted.length === 1 ? 'food' : 'foods'}`,
      });
    } else if (usual) {
      slots.push({
        ...base, name: joinNames(usual.meal.entries.map((x) => x.name)), kcal: usual.meal.calories, protein: usual.protein,
        carbs: usual.carbs, fat: usual.fat, foods: usual.foods, logs: [], status: null, usual: { meal: usual.meal, days: usual.days },
      });
    }
  }
  return { kind: 'usual', slots, extras };
}

/** "Tuesday" for a YYYY-MM-DD day. */
export const weekday = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' });

/** "yesterday" for `yesterday` (passed only while today is shown, as in the search sheet), else the weekday. */
export const dayWord = (date: string, yesterday: string | null) => (date === yesterday ? 'yesterday' : weekday(date));

/** "Logged yesterday and on Tuesday", "Logged on Monday and on Friday". */
export const loggedOn = (days: string[], yesterday: string | null) =>
  `Logged ${joinNames(days.map((d) => (d === yesterday ? 'yesterday' : `on ${weekday(d)}`)))}`;

/** Where Extras "Add" files a food: the latest meal before the next one (else the latest) with no plan meal open,
 * since buildPlanDay counts other foods in an open plan meal's meal as a change. Null when every meal has one open. */
export function extrasMeal(day: FoodDay): MealType | null {
  const free = DAY_MEALS.filter((m) => !day.slots.some((x) => x.mealType === m && x.logs.length === 0));
  const next = nextSlot(day);
  const before = next ? free.filter((m) => DAY_MEALS.indexOf(m) < DAY_MEALS.indexOf(next.mealType)) : [];
  return before[before.length - 1] ?? free[free.length - 1] ?? null;
}
