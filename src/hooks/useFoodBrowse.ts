import { useState, useCallback } from 'react';
import { logApi } from '../services/api';
import { MealType } from '../types';
import { SearchResult, unitOptionsFor } from '../utils/log/types';
import { mapLogEntryToFood, RawLogEntry } from '../utils/log/mapFoodItem';
import { quantityMultiplier } from '../utils/log/macros';
import { addDays } from '../utils/date';

// How far back Recent, Frequent and "repeat a past meal" look. Seven days
// covers the everyday case (same breakfast as yesterday, the usual lunch)
// with the same number of requests the Frequent tab already made.
export const BROWSE_LOOKBACK_DAYS = 7;
const BROWSE_LIMIT = 12;

// One logged entry of a past meal, carrying exactly what is needed to log
// the same portion again: the stored food item and its saved multiplier.
export interface PastMealEntry {
  foodItemId: string;
  name: string;
  calories: number;
  quantityMultiplier: number;
  originalQuantity?: number;
  originalUnit?: string;
}

export interface PastMeal {
  date: string;
  entries: PastMealEntry[];
  calories: number;
}

type BrowseEntry = RawLogEntry & {
  food_item_id?: string;
  meal_type?: MealType;
  quantity_multiplier?: number;
  original_quantity?: number | null;
  original_unit?: string | null;
};

const foodKey = (food: SearchResult) => food.id || food.name.trim().toLowerCase();

const sameMultiplier = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

// Prefill the portion logged last time as a quantity + unit that the picker's
// own math turns back into the SAVED multiplier, so preview and save match
// the original entry exactly (B-403-1). The entered amount is used when it
// reproduces the multiplier ("60 g" oats, "150 g" custom bowl). When it is
// only a description (a custom food whose nutrition is for the whole
// "2 serving" portion, saved with multiplier 1), the saved multiplier is
// expressed in the food's own basis instead: portions for per-portion foods,
// grams for per-100g foods. Anything else gets no prefill.
function withLastPortion(food: SearchResult, e: BrowseEntry): SearchResult {
  const saved = e.quantity_multiplier;
  if (typeof saved !== 'number' || !Number.isFinite(saved) || saved <= 0) return food;
  const options = unitOptionsFor(food);
  const candidates: Array<{ qty: number; unit: string }> = [];
  const qty = e.original_quantity;
  const unit = e.original_unit?.trim();
  if (typeof qty === 'number' && Number.isFinite(qty) && qty > 0 && unit) candidates.push({ qty, unit });
  candidates.push(
    food.nutrient_basis === 'PER_SERVING'
      ? { qty: saved, unit: 'serving' }
      : { qty: Math.round(saved * 100 * 10000) / 10000, unit: 'g' },
  );
  const match = candidates.find(
    (c) => options.includes(c.unit) && sameMultiplier(quantityMultiplier(food, c.qty, c.unit), saved),
  );
  return match ? { ...food, last_quantity: match.qty, last_unit: match.unit } : food;
}

function toPastMealEntry(e: BrowseEntry, food: SearchResult): PastMealEntry | null {
  const foodItemId = e.food_item_id || food.id;
  const multiplier = e.quantity_multiplier;
  if (!foodItemId || typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier <= 0) {
    return null;
  }
  const calories = Number.isFinite(food.calories) ? food.calories * multiplier : 0;
  return {
    foodItemId,
    name: food.name,
    calories,
    quantityMultiplier: multiplier,
    originalQuantity: typeof e.original_quantity === 'number' ? e.original_quantity : undefined,
    originalUnit: e.original_unit?.trim() || undefined,
  };
}

/**
 * Browse data for the Add Food sheet, built from one parallel fetch of the
 * selected day and the six days before it:
 *   - recentFoods: newest first across the whole week (not just the selected
 *     day), each carrying the portion logged last time;
 *   - frequentFoods: most-logged foods of the week, newest first on ties;
 *   - lastMeals: for each meal slot, the most recent earlier day that has it,
 *     so the client can repeat yesterday's breakfast in one tap.
 */
export function useFoodBrowse(currentUserId: string | undefined, selectedDate: string) {
  const [recentFoods, setRecentFoods] = useState<SearchResult[]>([]);
  const [frequentFoods, setFrequentFoods] = useState<SearchResult[]>([]);
  const [lastMeals, setLastMeals] = useState<Partial<Record<MealType, PastMeal>>>({});
  // True when no day of the week could be read (offline or server down).
  // The lists from the last successful read stay usable, including offline.
  const [browseUnavailable, setBrowseUnavailable] = useState(false);

  const loadBrowseFoods = useCallback(async () => {
    if (!currentUserId) return;
    try {
      // `selectedDate` is a bare YYYY-MM-DD; string-level `addDays` keeps the
      // calendar walk in local space (see useFoodBrowse.test.ts).
      const dateStrings: string[] = [];
      for (let i = 0; i < BROWSE_LOOKBACK_DAYS; i++) {
        dateStrings.push(addDays(selectedDate, -i));
      }
      const settled = await Promise.allSettled(dateStrings.map((ds) => logApi.getDaily(ds)));
      if (settled.every((result) => result.status === 'rejected')) {
        setBrowseUnavailable(true);
        return;
      }
      setBrowseUnavailable(false);

      const recent: SearchResult[] = [];
      const recentSeen = new Set<string>();
      const counts = new Map<string, { count: number; order: number; food: SearchResult }>();
      const meals: Partial<Record<MealType, PastMeal>> = {};

      settled.forEach((result, dayIndex) => {
        if (result.status !== 'fulfilled') return;
        const entries: BrowseEntry[] = result.value.data?.entries || [];
        // The server returns a day oldest-first; walk it newest-first.
        const newestFirst = [...entries].reverse();
        for (const e of newestFirst) {
          const mapped = mapLogEntryToFood(e);
          if (!mapped) continue;
          const food = withLastPortion(mapped, e);
          const key = foodKey(food);
          if (!recentSeen.has(key)) {
            recentSeen.add(key);
            recent.push(food);
          }
          const counted = counts.get(key);
          if (counted) counted.count++;
          else counts.set(key, { count: 1, order: counts.size, food });
        }
        // Past meals come from earlier days only; the selected day's own
        // meals are already on screen.
        if (dayIndex === 0) return;
        for (const e of entries) {
          const meal = e.meal_type;
          if (!meal || (meals[meal] && meals[meal]!.date !== dateStrings[dayIndex])) continue;
          const mapped = mapLogEntryToFood(e);
          const entry = mapped ? toPastMealEntry(e, mapped) : null;
          if (!entry) continue;
          const pastMeal = meals[meal] ?? { date: dateStrings[dayIndex], entries: [], calories: 0 };
          pastMeal.entries.push(entry);
          pastMeal.calories += entry.calories;
          meals[meal] = pastMeal;
        }
      });

      const frequent = [...counts.values()]
        .sort((a, b) => b.count - a.count || a.order - b.order)
        .slice(0, BROWSE_LIMIT)
        .map((item) => item.food);

      setRecentFoods(recent.slice(0, BROWSE_LIMIT));
      setFrequentFoods(frequent);
      setLastMeals(meals);
    } catch (err) {
      console.error('useFoodBrowse: loadBrowseFoods failed', err);
      setBrowseUnavailable(true);
    }
  }, [currentUserId, selectedDate]);

  // Both tabs come from the same single fetch; the older names stay as
  // aliases so existing callers keep working.
  return {
    recentFoods,
    frequentFoods,
    lastMeals,
    browseUnavailable,
    loadBrowseFoods,
    loadRecentFoods: loadBrowseFoods,
    loadFrequentFoods: loadBrowseFoods,
  };
}
