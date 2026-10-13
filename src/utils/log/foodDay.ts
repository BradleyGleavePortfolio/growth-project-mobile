/**
 * The Food tab's day as a checklist (V1_1_UI_SPEC UI-3): the coach's plan meals in order, each one done
 * once the day's log has it. Pure: every meal, food and number comes from the plan read and the day's
 * logs; nothing is invented.
 */
import type { FoodLog, MealType } from '../../types';
import type { DailyMealPlan, SlotLabel } from '../../api/mealTemplatesApi';
import { formatPortion } from './quickLog';

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
}

export interface FoodDay {
  slots: DaySlot[];
  extras: FoodLog[];
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
