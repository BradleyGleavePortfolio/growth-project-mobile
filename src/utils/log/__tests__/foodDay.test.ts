import { buildPlanDay, buildUsualDay, dayWord, extrasMeal, joinNames, loggedOn, nextSlot, weekday, type PastDay } from '../foodDay';
import type { DailyMealPlan, SlotLabel } from '../../../api/mealTemplatesApi';
import type { FoodLog } from '../../../types';

const slot = (id: string, slot_label: SlotLabel, name: string, kcal: number, order = 0) => ({
  id, daily_meal_plan_id: 'plan', meal_template_id: `t-${id}`, slot_label, order,
  meal_template: {
    id: `t-${id}`, name, calories_kcal: kcal, protein_g: 30, carbs_g: 40, fats_g: 10,
    items: [{ name: `${name} base`, grams: 120 }, { name: 'Berries', portion: '1 cup' }],
  },
}) as unknown as DailyMealPlan['slots'][number];

const plan = {
  id: 'plan', name: 'Lean week 2', notes: null,
  // Alphabetical, as the backend orders slot labels: the day order is rebuilt.
  slots: [
    slot('d', 'dinner', 'Salmon and rice', 610),
    slot('l', 'lunch', 'Chicken bowl', 560),
    slot('p', 'preworkout', 'Banana', 100),
    slot('b', 'breakfast', 'Overnight oats', 390),
  ],
} as unknown as DailyMealPlan;

const log = (id: string, mealType: FoodLog['mealType'], foodName: string, extra: Partial<FoodLog> = {}): FoodLog => ({
  id, userId: 'u', coachId: 'c', date: '2026-10-09', mealType, foodName, calories: 100, protein: 10, carbs: 10, fat: 1,
  quantity: 1, unit: 'serving', createdAt: '2026-10-09T08:00:00.000Z', ...extra,
});

describe('buildPlanDay', () => {
  it('puts the coach meals in day order and maps pre-workout to snack', () => {
    const day = buildPlanDay(plan, []);
    expect(day.slots.map((x) => x.name)).toEqual(['Overnight oats', 'Banana', 'Chicken bowl', 'Salmon and rice']);
    expect(day.slots[1]).toMatchObject({ label: 'Pre-workout', mealType: 'snack', kcal: 100, status: null, logs: [] });
    expect(day.slots[0].foods).toEqual([{ name: 'Overnight oats base', portion: '120 g' }, { name: 'Berries', portion: '1 cup' }]);
    expect(nextSlot(day)?.name).toBe('Overnight oats');
  });

  it('marks a meal logged under its own name as planned and moves next on', () => {
    const day = buildPlanDay(plan, [log('1', 'breakfast', 'overnight oats')]);
    expect(day.slots[0].status).toBe('Logged as planned');
    expect(nextSlot(day)?.name).toBe('Banana');
  });

  it('names a changed amount, or the foods eaten instead, as the change', () => {
    const amount = buildPlanDay(plan, [log('1', 'breakfast', 'Overnight oats', { quantity: 1.5 })]);
    expect(amount.slots[0].status).toBe('Logged with a change: 1.5 servings');
    const swap = buildPlanDay(plan, [log('1', 'dinner', 'Pasta'), log('2', 'dinner', 'Salad')]);
    expect(swap.slots[3].status).toBe('Logged with a change: Pasta and Salad');
    expect(swap.slots[3].logs.map((l) => l.id)).toEqual(['1', '2']);
    expect(nextSlot(swap)?.name).toBe('Overnight oats');
  });

  it('keeps foods beside a logged plan meal, or in a meal the plan does not have, as extras', () => {
    const lunch = buildPlanDay(plan, [log('1', 'lunch', 'Chicken bowl'), log('2', 'lunch', 'Avocado')]);
    expect(lunch.slots[2].status).toBe('Logged as planned');
    expect(lunch.extras.map((l) => l.foodName)).toEqual(['Avocado']);
    const noSnackPlan = { ...plan, slots: plan.slots.filter((x) => x.slot_label !== 'preworkout') } as DailyMealPlan;
    const day = buildPlanDay(noSnackPlan, [log('1', 'snack', 'Coffee with milk')]);
    expect(day.extras.map((l) => l.foodName)).toEqual(['Coffee with milk']);
    expect(day.slots.every((x) => x.logs.length === 0)).toBe(true);
  });

  it('files an extra under a meal with no plan meal open, so the next meal stays open', () => {
    expect(extrasMeal(buildPlanDay(plan, []))).toBeNull();
    const done = [log('1', 'breakfast', 'Overnight oats'), log('2', 'snack', 'Banana')];
    expect(extrasMeal(buildPlanDay(plan, done))).toBe('breakfast');
    const day = buildPlanDay(plan, [...done, log('3', 'breakfast', 'Coffee')]);
    expect(nextSlot(day)?.key).toBe('l');
    expect(day.extras.map((l) => l.foodName)).toEqual(['Coffee']);
    const noLunch = { ...plan, slots: plan.slots.filter((x) => x.slot_label !== 'lunch') } as DailyMealPlan;
    expect(extrasMeal(buildPlanDay(noLunch, []))).toBe('lunch');
  });

  it('has no next meal once every meal is logged', () => {
    const day = buildPlanDay(plan, [
      log('1', 'breakfast', 'Overnight oats'), log('2', 'snack', 'Banana'),
      log('3', 'lunch', 'Chicken bowl'), log('4', 'dinner', 'Salmon and rice'),
    ]);
    expect(nextSlot(day)).toBeNull();
    expect(day.extras).toEqual([]);
  });
});

it('joins names the way a sentence does', () => {
  expect(joinNames(['Oats'])).toBe('Oats');
  expect(joinNames(['Oats', 'Berries'])).toBe('Oats and Berries');
  expect(joinNames(['Oats', 'Berries', 'Honey'])).toBe('Oats, Berries and Honey');
});

const eat = (meal: FoodLog['mealType'], id: string, name: string, k = 1, qty?: number, unit?: string) => ({
  meal_type: meal, food_item_id: id, quantity_multiplier: k, original_quantity: qty, original_unit: unit,
  food_item: { id, name, calories: 200, protein_g: 10, carbs_g: 20, fat_g: 5, nutrient_basis: 'PER_100G' },
}) as PastDay['entries'][number];
const oats = [eat('breakfast', 'oats', 'Rolled oats', 0.6, 60, 'g'), eat('breakfast', 'milk', 'Milk', 2)];
const eggs = [eat('breakfast', 'eggs', 'Eggs', 1)];

describe('buildUsualDay', () => {
  it('takes the meal eaten on the most days, the newest on a tie, and needs two days', () => {
    const day = buildUsualDay([
      { date: '2026-10-05', entries: eggs }, { date: '2026-10-08', entries: oats }, { date: '2026-10-07', entries: eggs },
      { date: '2026-10-06', entries: oats }, { date: '2026-10-04', entries: [eat('lunch', 'soup', 'Soup')] },
    ], []);
    expect(day.kind).toBe('usual');
    expect(day.slots.map((x) => x.mealType)).toEqual(['breakfast']);
    const b = day.slots[0];
    expect(b.name).toBe('Rolled oats and Milk');
    expect(b.usual?.days).toEqual(['2026-10-08', '2026-10-06']);
    expect(b.usual?.meal.entries[0]).toEqual({
      foodItemId: 'oats', name: 'Rolled oats', calories: 120, quantityMultiplier: 0.6, originalQuantity: 60, originalUnit: 'g',
    });
    expect(b.foods).toEqual([{ name: 'Rolled oats', portion: '60 g' }, { name: 'Milk', portion: '200 g' }]);
    expect(b.kcal).toBe(520);
    expect(nextSlot(day)).toBe(b);
  });

  it('counts the usual foods of a logged meal and lists the others as extras', () => {
    const past = [{ date: '2026-10-08', entries: oats }, { date: '2026-10-07', entries: oats }];
    const day = buildUsualDay(past, [
      log('1', 'breakfast', 'Rolled oats', { foodItemId: 'oats' }), log('2', 'breakfast', 'Coffee with milk'), log('3', 'dinner', 'Pizza'),
    ]);
    expect(day.slots.map((x) => [x.mealType, x.status, x.logs.map((l) => l.id)])).toEqual([['breakfast', null, ['1']], ['dinner', null, ['3']]]);
    expect(day.extras.map((l) => l.id)).toEqual(['2']);
    expect(nextSlot(day)).toBeNull();
    expect(buildUsualDay(past.slice(0, 1), [log('3', 'dinner', 'Pizza')]).slots).toEqual([]);
  });
});

it('names the days a meal was logged', () => {
  expect(dayWord('2026-10-08', '2026-10-08')).toBe('yesterday');
  expect(dayWord('2026-10-08', null)).toBe(weekday('2026-10-08'));
  expect(loggedOn(['2026-10-08', '2026-10-06'], '2026-10-08')).toBe(`Logged yesterday and on ${weekday('2026-10-06')}`);
});
