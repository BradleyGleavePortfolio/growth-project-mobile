/**
 * The Kitchen's one add step (KITCHEN-M R6), exported once so every place that adds a saved meal to a day adds it the
 * same way (the Kitchen's sheet; KITCHEN-DOOR-M next). One intended save, one key: withSaveKey keeps the key on a lost
 * answer or a 5xx, so the same save sends the same key and the server returns what it stored; any other answer lets it
 * go. The caller checks the connection first (R7: no queue) and sends one at a time; this reads the answer only.
 */
import { savedFoodsApi } from '../../../api/savedFoodsApi';
import type { MealType } from '../../../types';
import { withSaveKey } from '../../../utils/log/saveKey';
import { addIntent, failureOf } from './kitchen';

/**
 * added: the server wrote her entries. empty: it wrote nothing (the meal's foods were removed since the read).
 * food-not-found and meal-gone: a 404 for a food or for the meal. lost: no answer or a 5xx (Try again resends the key).
 * refused: any other answer below 500.
 */
export type AddOutcome = 'added' | 'empty' | 'food-not-found' | 'meal-gone' | 'lost' | 'refused';

export async function addSavedMeal(mealId: string, date: string, meal: MealType): Promise<AddOutcome> {
  try {
    const res = await withSaveKey(addIntent(mealId, date, meal), (key) => savedFoodsApi.log(mealId, { date, meal_type: meal }, key));
    return Array.isArray(res.data) && res.data.length > 0 ? 'added' : 'empty';
  } catch (err) {
    const { status, message } = failureOf(err);
    if (status === 404) return /saved meal/i.test(message) ? 'meal-gone' : 'food-not-found';
    return !status || status >= 500 ? 'lost' : 'refused';
  }
}
