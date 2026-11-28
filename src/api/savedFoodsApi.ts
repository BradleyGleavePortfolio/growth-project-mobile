/**
 * Saved meals (KITCHEN-M): the signed-in client's own meals under /me/foods (backend saved-foods.controller.ts,
 * Roles('student'), open to every client and through the payment lockout): the list and the log (KITCHEN-M), and
 * create, rename and delete (SAVED-MEAL-SAVE-M).
 * Each food carries food_truth (b#1262, CONTRACT 7214392327 section 1); an older server sends none, which the
 * Kitchen reads as not 'ok' (fail closed, kitchen.ts).
 */
import api from '../services/api';
import type { MealType } from '../types';
import type { RawFoodItem } from '../utils/log/mapFoodItem';

export type FoodTruth = 'ok' | 'held' | 'legacy_zero';

export interface SavedMealItem {
  id: string;
  saved_meal_id: string;
  food_item_id: string;
  quantity_multiplier: number;
  original_quantity?: number | null;
  original_unit?: string | null;
  position: number;
  food_item?: RawFoodItem;
  /** Optional: a server before b#1262 sends none (R4). */
  food_truth?: FoodTruth;
}

export interface SavedMeal {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  /** In position order; [] when every food was removed from the catalog (CONTRACT 7214392327 section 3). */
  items?: SavedMealItem[];
}

/** One saved meal, one key, every client: the list read the Kitchen and SAVED-MEAL-SAVE-M share (R10). */
export const SAVED_MEALS_KEY = ['me', 'foods', 'saved-meals'] as const;

/** POST /me/foods/saved-meals (CreateSavedMealDto): no other key is accepted (forbidNonWhitelisted). */
export interface SaveMealBody {
  name: string;
  items: Array<{ food_item_id: string; quantity_multiplier: number; original_quantity?: number; original_unit?: string }>;
}

export const savedFoodsApi = {
  /** Newest first. */
  list: () => api.get<SavedMeal[]>('/me/foods/saved-meals'),
  /** SAVED-MEAL-SAVE-M: the new meal, its items carrying food_truth. The route takes no key (its guard is the sheet's). */
  create: (body: SaveMealBody) => api.post<SavedMeal>('/me/foods/saved-meals', body),
  /** The renamed meal; 404 "Saved meal not found" when it is not hers or is gone. */
  rename: (id: string, name: string) => api.patch<SavedMeal>(`/me/foods/saved-meals/${encodeURIComponent(id)}`, { name }),
  /** { deleted: true }; 404 when it is not hers or is already gone. */
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/me/foods/saved-meals/${encodeURIComponent(id)}`),
  /**
   * Logs every food of the meal to `date` under `meal_type`; one LoggedFoodEntry per food. The key goes in the body
   * and the Idempotency-Key header (withClientKey): a resend with it returns what the server stored and writes nothing.
   */
  log: (id: string, body: { date: string; meal_type: MealType }, key: string) =>
    api.post<unknown[]>(`/me/foods/saved-meals/${encodeURIComponent(id)}/log`, { ...body, client_uuid: key },
      { headers: { 'Idempotency-Key': key } }),
};
