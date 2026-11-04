import { logApi } from '../../services/api';
import { MealType } from '../../types';
import type { PastMeal } from '../../hooks/useFoodBrowse';
import { SearchResult } from './types';
import { planLink, type PlanLink } from './planLink';
import { foodSaveIntent, withSaveKey } from './saveKey';
import { enqueue as enqueueFoodLog } from '../../services/foodLogQueue';

// Words in a search that describe the amount rather than the food
// ("2 eggs", "150 g chicken"). They are ignored when matching foods the
// client has already logged.
const AMOUNT_WORDS = new Set(['g', 'gram', 'grams', 'oz', 'ounce', 'ounces', 'cup', 'cups', 'tbsp', 'tsp', 'serving', 'servings', 'x']);

const normalise = (s: string) => s.trim().toLowerCase();

/**
 * Foods from the client's own recent log that match what is being typed.
 * Shown the moment the client types, before the catalog search returns, so
 * the usual foods are one tap away.
 */
export function matchLoggedFoods(query: string, ...lists: SearchResult[][]): SearchResult[] {
  const words = normalise(query)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !/^[\d.,]+[a-z]*$/.test(w) && !AMOUNT_WORDS.has(w));
  if (words.length === 0) return [];
  const seen = new Set<string>();
  const matches: SearchResult[] = [];
  for (const list of lists) {
    for (const food of list) {
      const key = food.id || normalise(food.name);
      if (seen.has(key)) continue;
      const haystack = normalise(`${food.name} ${food.brand ?? ''}`);
      if (words.every((w) => haystack.includes(w))) {
        seen.add(key);
        matches.push({ ...food, from_log: true });
      }
    }
  }
  return matches.slice(0, 5);
}

/** Logged-food matches first, then catalog results that are not the same food. */
export function mergeWithLoggedMatches(logged: SearchResult[], catalog: SearchResult[]): SearchResult[] {
  if (logged.length === 0) return catalog;
  const ids = new Set(logged.map((f) => f.id).filter(Boolean));
  const names = new Set(logged.map((f) => `${normalise(f.name)}|${normalise(f.brand ?? '')}`));
  const rest = catalog.filter(
    (f) => !(f.id && ids.has(f.id)) && !names.has(`${normalise(f.name)}|${normalise(f.brand ?? '')}`),
  );
  return [...logged, ...rest];
}

export interface RepeatMealResult {
  added: number;
  failedNames: string[];
}

/**
 * Logs every food of a past meal into `mealType` on `date` with the exact
 * saved portion (same food item, same multiplier, same entered amount), so
 * the copied meal has the same calories and macros as the original.
 */
/** `link`: the plan meal or usual-day meal this repeat fills (FOODLINK), sent on every food. */
export async function repeatPastMeal(meal: PastMeal, date: string, mealType: MealType, link?: PlanLink): Promise<RepeatMealResult> {
  const settled = await Promise.allSettled(
    meal.entries.map((e) => {
      const log = {
        date,
        meal_type: mealType,
        quantity_multiplier: e.quantityMultiplier,
        original_quantity: e.originalQuantity,
        original_unit: e.originalUnit,
        ...planLink(link),
      };
      // FR-916 F1: each food is its own save, keyed by what it sends (foodSaveIntent), so the same food
      // sent again after a lost answer, by Repeat or from Recent as the alert says, sends the same key.
      // The same food twice in this meal is two saves of one intent: each takes its own key (withSaveKey).
      return withSaveKey(foodSaveIntent(log, e.foodItemId), (key) =>
        logApi.logFood({ ...log, food_item_id: e.foodItemId, client_uuid: key }));
    }),
  );
  const failedNames = meal.entries
    .filter((_e, i) => settled[i].status === 'rejected')
    .map((e) => e.name);
  return { added: meal.entries.length - failedNames.length, failedNames };
}

/**
 * OFFLINE-FOOD-M: Repeat with no signal. Each food of the meal goes to the offline queue as its own
 * save with its own key (the same intent and key rule as repeatPastMeal, so a food whose online try
 * lost its answer keeps that key), with the same portion; the queue sends each once on reconnect.
 * One at a time, in the meal's order. Returns the number queued; a failed write throws after the
 * foods before it are queued (the caller says what was saved).
 */
export async function queuePastMeal(meal: PastMeal, date: string, mealType: MealType, link?: PlanLink): Promise<number> {
  let queued = 0;
  for (const e of meal.entries) {
    const log = {
      date,
      meal_type: mealType,
      quantity_multiplier: e.quantityMultiplier,
      original_quantity: e.originalQuantity,
      original_unit: e.originalUnit,
      ...planLink(link),
    };
    await withSaveKey(foodSaveIntent(log, e.foodItemId), (key) =>
      enqueueFoodLog({ kind: 'search', foodItemId: e.foodItemId, shown: e.shown, log }, key));
    queued += 1;
  }
  return queued;
}

/** "1 serving", "2 servings", "150 g", "0.5 cup" */
export function formatPortion(quantity: number, unit: string): string {
  const qty = String(Math.round(quantity * 100) / 100);
  if (unit === 'serving') return `${qty} ${quantity === 1 ? 'serving' : 'servings'}`;
  return `${qty} ${unit}`;
}
