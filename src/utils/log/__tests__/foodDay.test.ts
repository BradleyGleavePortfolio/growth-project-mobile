import { buildPlanDay, joinNames, nextSlot } from '../foodDay';
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

  it('marks a meal planned only from a food logged for it under its own name, and moves next on', () => {
    const day = buildPlanDay(plan, [log('1', 'breakfast', 'overnight oats', { planSlotId: 'b' })]);
    expect(day.slots[0].status).toBe('Logged as planned');
    expect(nextSlot(day)?.name).toBe('Banana');
  });

  it('names a changed amount, or the foods logged for it through Something else, as the change', () => {
    const amount = buildPlanDay(plan, [log('1', 'breakfast', 'Overnight oats', { quantity: 1.5, planSlotId: 'b' })]);
    expect(amount.slots[0].status).toBe('Logged with a change: 1.5 servings');
    const swap = buildPlanDay(plan, [log('1', 'dinner', 'Pasta', { planSlotId: 'd' }), log('2', 'dinner', 'Salad', { planSlotId: 'd' })]);
    expect(swap.slots[3].status).toBe('Logged with a change: Pasta and Salad');
    expect(swap.slots[3].logs.map((l) => l.id)).toEqual(['1', '2']);
    expect(nextSlot(swap)?.name).toBe('Overnight oats');
    const plus = buildPlanDay(plan, [log('1', 'lunch', 'Chicken bowl', { planSlotId: 'l' }), log('2', 'lunch', 'Avocado', { planSlotId: 'l' })]);
    expect(plus.slots[2].status).toBe('Logged with a change: Chicken bowl and Avocado');
  });

  it('keeps every unlinked food an extra, even one with the plan meal\'s own name', () => {
    const day = buildPlanDay(plan, [log('1', 'lunch', 'Chicken bowl'), log('2', 'breakfast', 'Overnight oats'), log('3', 'lunch', 'Avocado')]);
    expect(day.extras.map((l) => l.foodName)).toEqual(['Chicken bowl', 'Overnight oats', 'Avocado']);
    expect(day.slots.every((x) => x.logs.length === 0)).toBe(true);
  });

  it('turns a linked food moved to another meal, or linked to another plan, into an extra', () => {
    const day = buildPlanDay(plan, [log('1', 'lunch', 'Toast', { planSlotId: 'b' }), log('2', 'dinner', 'Pasta', { planSlotId: 'gone' })]);
    expect(day.extras.map((l) => l.foodName)).toEqual(['Toast', 'Pasta']);
    expect(nextSlot(day)?.name).toBe('Overnight oats');
  });

  it('fills pre-workout and snack, which both log to snack, each only from its own link', () => {
    const withSnack = { ...plan, slots: [...plan.slots, slot('s', 'snack', 'Banana', 100)] };
    const day = buildPlanDay(withSnack, [log('1', 'snack', 'Banana', { planSlotId: 's' })]);
    expect(day.slots.find((x) => x.key === 'p')?.logs).toEqual([]);
    expect(day.slots.find((x) => x.key === 's')?.status).toBe('Logged as planned');
    expect(nextSlot(day)?.key).toBe('b');
  });

  it('has no next meal once every meal is logged', () => {
    const day = buildPlanDay(plan, [
      log('1', 'breakfast', 'Overnight oats', { planSlotId: 'b' }), log('2', 'snack', 'Banana', { planSlotId: 'p' }),
      log('3', 'lunch', 'Chicken bowl', { planSlotId: 'l' }), log('4', 'dinner', 'Salmon and rice', { planSlotId: 'd' }),
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
