/**
 * KITCHEN-M: the Kitchen page's pure part (kitchen.ts). R4's numbers against the Food day's own map, the truth rule
 * (only 'ok' shows numbers; a meal with any other has no total), R5's meal of the hour, R8's plan card by the Food
 * day's own nextSlot, and the words. Fixtures fictional (client Jordan, coach Sam).
 */
import { foodLogFromDailyEntry } from '../../../../utils/log/dailyEntry';
import type { SavedMeal, SavedMealItem } from '../../../../api/savedFoodsApi';
import {
  addIntent, failureOf, foodsLine, heldNote, mealOfHour, mealView, planCard, recipesDetail, rowSpoken, savedMealsOf, sheetLine,
} from '../kitchen';

let k = 0;
const food = (name: string, calories: number, protein: number, m: number, qty: number | null, unit: string | null,
  truth: SavedMealItem['food_truth'] | 'unknown' | null = 'ok'): SavedMealItem => {
  k += 1;
  const item: SavedMealItem = {
    id: `i${k}`, saved_meal_id: 'm', food_item_id: `f${k}`, quantity_multiplier: m, original_quantity: qty, original_unit: unit,
    position: k, food_item: { id: `f${k}`, name, calories, protein_g: protein, carbs_g: 0, fat_g: 0 } as never,
  };
  if (truth !== null) (item as { food_truth?: string }).food_truth = truth;
  return item;
};
const meal = (id: string, name: string, items: SavedMealItem[] | undefined): SavedMeal =>
  ({ id, user_id: 'jordan', name, created_at: '2026-10-01', updated_at: '2026-10-01', items });
const usualBreakfast = () => meal('m1', 'Usual breakfast', [
  food('Greek yoghurt, plain', 59, 12, 2.0, 200, 'g'),
  food('Rolled oats', 379, 13.2, 0.5, 50, 'g'),
  food('Blueberries', 57, 0.7, 0.8, 80, 'g'),
  food('Honey', 314, 0.3, 0.21, 1, 'tsp'),
]);

describe('R4: a saved meal\'s numbers are the Food day\'s own', () => {
  it('each food equals foodLogFromDailyEntry for the same food once logged; the total is the sum: 420 kcal, 32 g', () => {
    const m = usualBreakfast();
    const view = mealView(m);
    view.foods.forEach((f, i) => {
      const it = m.items![i];
      const logged = foodLogFromDailyEntry({ id: 'e', food_item_id: it.food_item_id, user_id: 'jordan', meal_type: 'breakfast',
        quantity_multiplier: it.quantity_multiplier, original_quantity: it.original_quantity, original_unit: it.original_unit,
        food_item: it.food_item }, '2026-10-13');
      expect([f.kcal, f.protein]).toEqual([logged.calories, logged.protein]);
    });
    expect(view.foods.map((f) => f.kcal)).toEqual([118, 190, 46, 66]);
    expect(view.total).toEqual({ kcal: 420, protein: 32 });
    expect(view.foods.map((f) => f.amount)).toEqual(['200 g', '50 g', '80 g', '1 tsp']);
    expect(sheetLine(view)).toBe('420 kcal, 32 g protein. 4 foods.');
    expect(rowSpoken(m, view)).toBe('Usual breakfast, 420 kcal, 32 g protein');
  });

  it('an amount with no original quantity and unit is the multiplier as servings', () => {
    const view = mealView(meal('m2', 'Shake', [food('Whey', 120, 24, 1.5, null, null)]));
    expect(view.foods[0].amount).toBe('1.5 servings');
    expect(sheetLine(view)).toBe('180 kcal, 36 g protein. 1 food.');
  });

  it.each([['held'], ['legacy_zero'], ['unknown'], [null]])('a food whose truth is %p shows no number and the meal has no total', (truth) => {
    const m = meal('m3', 'Pantry bar', [food('Oat bar', 200, 8, 1, null, null), food('Mystery bar', 0, 0, 1, null, null, truth as never)]);
    const view = mealView(m);
    expect(view.total).toBeNull();
    expect(view.held).toEqual(['Mystery bar']);
    expect(view.foods.map((f) => f.ok)).toEqual([true, false]);
    expect(sheetLine(view)).toBe('No total. 2 foods.');
    expect(rowSpoken(m, view)).toBe('Pantry bar, no total: numbers held back for 1 of its foods');
  });

  it('a meal with no foods, or no items list, has no total and says so', () => {
    for (const items of [[], undefined]) {
      const m = meal('m4', 'Gone lunch', items);
      expect(mealView(m)).toEqual({ foods: [], held: [], total: null });
      expect(rowSpoken(m, mealView(m))).toBe('Gone lunch, No foods left in this meal');
    }
  });

  it('a list answer that is not a list is a failed read; a row without an id or name is dropped', () => {
    expect(savedMealsOf({ items: [] })).toBeNull();
    expect(savedMealsOf(undefined)).toBeNull();
    expect(savedMealsOf([usualBreakfast(), { id: 3 }, null])!.map((m) => m.id)).toEqual(['m1']);
  });
});

describe('R5: the meal of the hour', () => {
  it.each([
    ['08:00', 'breakfast', 8 * 60], ['10:29', 'breakfast', 10 * 60 + 29], ['10:30', 'lunch', 10 * 60 + 30],
    ['12:00', 'lunch', 12 * 60], ['16:00', 'snack', 16 * 60], ['17:00', 'dinner', 17 * 60], ['18:30', 'dinner', 18 * 60 + 30],
    ['20:59', 'dinner', 20 * 60 + 59], ['22:00', 'snack', 22 * 60], ['00:10', 'breakfast', 10],
  ])('%s is %s', (_t, want, minute) => expect(mealOfHour(minute as number)).toBe(want));
});

describe('R6: one intended save is one intent', () => {
  it('the intent is the meal, the day and the meal type, so a changed meal type is another save', () => {
    expect(addIntent('m1', '2026-10-13', 'breakfast')).toEqual(['saved-meal', 'm1', '2026-10-13', 'breakfast']);
    expect(JSON.stringify(addIntent('m1', '2026-10-13', 'lunch'))).not.toBe(JSON.stringify(addIntent('m1', '2026-10-13', 'breakfast')));
  });
  it('a refusal reads its status and message; a lost answer has no status', () => {
    expect(failureOf({ response: { status: 404, data: { message: 'Saved meal not found' } } })).toEqual({ status: 404, message: 'Saved meal not found' });
    expect(failureOf(new Error('Network Error'))).toEqual({ status: undefined, message: '' });
  });
});

describe('Words', () => {
  it('the foods line: main\'s joinNames up to three, KK-10 for four or more', () => {
    expect(foodsLine(['A'])).toBe('A');
    expect(foodsLine(['A', 'B'])).toBe('A and B');
    expect(foodsLine(['A', 'B', 'C'])).toBe('A, B and C');
    expect(foodsLine(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more');
  });
  it('KK-4 names one held food and counts two or more; no word says we, us or our', () => {
    expect(heldNote(['Mystery bar'])).toBe('Numbers for Mystery bar are held back here, so this meal has no total. Adding it checks the food again.');
    expect(heldNote(['A', 'B'])).toBe('Numbers for 2 of its foods are held back here, so this meal has no total. Adding it checks them again.');
    expect(heldNote(['A', 'B'])).not.toMatch(/\b(we|us|our)\b/i);
  });
  it('KM-10: the recipe count names the coach only when some recipes are his', () => {
    expect(recipesDetail(12, 2, 'Sam')).toBe('12, 2 from Sam');
    expect(recipesDetail(12, 0, 'Sam')).toBe('12');
    expect(recipesDetail(12, 2, null)).toBe('12');
  });
});

// ---------- R8: the plan card ----------
const slot = (id: string, label: string, name: string, kcal: number, order: number) => ({ id, daily_meal_plan_id: 'dp',
  meal_template_id: `t-${id}`, slot_label: label, order, time_of_day: null, meal_template: { id: `t-${id}`, coach_id: 'sam', name,
    calories_kcal: kcal, protein_g: 30, carbs_g: 40, fats_g: 12, fiber_g: null, items: null, description: null, created_at: '2026-10-01', archived_at: null } });
const samPlan = () => ({ date: '2026-10-13', assignments: [{ id: 'a1', daily_meal_plan_id: 'dp', client_id: 'jordan',
  assigned_by_coach_id: 'sam', starts_on: '2026-10-01', ends_on: null, created_at: '2026-10-01', daily_meal_plan: {
    id: 'dp', coach_id: 'sam', name: 'Cut', notes: null, created_at: '2026-10-01', archived_at: null,
    slots: [slot('s1', 'breakfast', 'Oats and berries', 420, 0), slot('s2', 'lunch', 'Chicken bowl', 560, 1),
      slot('s3', 'dinner', 'Salmon, potatoes and green beans', 620, 2)] } }] });
const ate = (id: string, meal: string, name: string, slotId: string) => ({ id, food_item_id: `f-${id}`, user_id: 'jordan', meal_type: meal,
  quantity_multiplier: 1, food_item: { id: `f-${id}`, name, calories: 400, protein_g: 30 }, plan_slot_id: slotId });
const samDay = (eaten = 2) => ({ entries: [ate('e1', 'breakfast', 'Oats and berries', 's1'), ate('e2', 'lunch', 'Chicken bowl', 's2'),
  ate('e3', 'dinner', 'Salmon, potatoes and green beans', 's3')].slice(0, eaten) });

describe('R8: From {coach} is today\'s first plan meal still to eat, by the Food day\'s own rule', () => {
  it('breakfast and lunch logged with their plan links: the card is the dinner, "Tonight\'s dinner", 620 kcal', () => {
    expect(planCard(samPlan() as never, samDay(), '2026-10-13')).toEqual({ slotId: 's3', name: 'Salmon, potatoes and green beans',
      line: "Tonight's dinner", kcal: 620 });
  });
  it('every plan meal eaten, no plan, or a read that did not succeed: no card', () => {
    expect(planCard(samPlan() as never, samDay(3), '2026-10-13')).toBeNull();
    expect(planCard({ date: '2026-10-13', assignments: [] }, samDay(), '2026-10-13')).toBeNull();
    expect(planCard(undefined, samDay(), '2026-10-13')).toBeNull();
    expect(planCard(samPlan() as never, undefined, '2026-10-13')).toBeNull();
  });
});
