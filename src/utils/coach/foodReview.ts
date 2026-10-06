import type { RecordedFoodEntry } from '../../api/coachFoodReviewApi';
import type { MacroTarget } from '../../api/macrosApi';
import type { ClientProfile } from '../../types';

export interface NutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export type NutritionTargets = { [K in keyof NutritionTotals]: number | null };

type ServerProfileTargets = {
  macro_target_calories?: number | null;
  macro_target_protein_g?: number | null;
  macro_target_carbs_g?: number | null;
  macro_target_fat_g?: number | null;
};

// Same precedence as the client's /me/macros/current and /log/daily:
// live coach prescription, then server-computed profile fields, never defaults.
export function resolveCoachTargets(
  target: Pick<MacroTarget, 'calories_kcal' | 'protein_g' | 'carbs_g' | 'fats_g'> | null | undefined,
  profile: ClientProfile | null | undefined,
): NutritionTargets | null {
  if (target) {
    return {
      calories: target.calories_kcal, protein: target.protein_g,
      carbs: target.carbs_g, fat: target.fats_g,
    };
  }
  const raw = profile as (ClientProfile & ServerProfileTargets) | null | undefined;
  if (raw?.macro_target_calories == null) return null;
  return {
    calories: Math.round(raw.macro_target_calories),
    protein: raw.macro_target_protein_g == null ? null : Math.round(raw.macro_target_protein_g),
    carbs: raw.macro_target_carbs_g == null ? null : Math.round(raw.macro_target_carbs_g),
    fat: raw.macro_target_fat_g == null ? null : Math.round(raw.macro_target_fat_g),
  };
}

export function foodEntryTotals(entry: RecordedFoodEntry): NutritionTotals {
  const food = entry.food_item;
  const q = entry.quantity_multiplier;
  return {
    calories: food.calories * q,
    protein: food.protein_g * q,
    carbs: food.carbs_g * q,
    fat: food.fat_g * q,
  };
}

// Keep exact portion products until the final display, matching /log/daily.
export function sumFoodEntries(entries: RecordedFoodEntry[]): NutritionTotals {
  return entries.reduce((sum, entry) => {
    const value = foodEntryTotals(entry);
    return {
      calories: sum.calories + value.calories,
      protein: sum.protein + value.protein,
      carbs: sum.carbs + value.carbs,
      fat: sum.fat + value.fat,
    };
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

export function groupRecordedMeals(entries: RecordedFoodEntry[]) {
  const groups = new Map<string, RecordedFoodEntry[]>();
  for (const entry of entries) {
    // `date` is the client's chosen eat date (Postgres DATE), not the
    // server sync timestamp. Do not convert it into the coach's device zone.
    const day = entry.date.slice(0, 10);
    const meals = groups.get(day) ?? [];
    meals.push(entry);
    groups.set(day, meals);
  }
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a));
}
