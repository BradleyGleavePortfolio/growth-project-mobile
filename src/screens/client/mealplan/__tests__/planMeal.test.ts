// PLAN-SWAPS-M (C2 Style C C_something, C_changed, C_recipe; operator rulings R2, R9, R10, R11, R12): the pure part
// of the coach's plan meals on the phone. Fictional data (client Jordan, coach Sam) from the frames' data.py.
import fs from 'fs';
import path from 'path';
import {
  changeNote, findPlanSlot, footnoteFor, groceryItems, ingredientRows, perServingLine, somethingElseSheet, swapsToShow,
  updatedSlotIds,
} from '../planMeal';
import type { ClientTodayResponse, DailyMealPlan, DailyMealPlanSlot, PlanChange } from '../../../../api/mealTemplatesApi';

const tpl = (id: string, name: string, kcal: number, p: number, c: number, f: number, extra: object = {}) => ({
  id, coach_id: 'sam', name, description: null, calories_kcal: kcal, protein_g: p, carbs_g: c, fats_g: f, fiber_g: null,
  items: null, created_at: '2026-11-01T00:00:00Z', archived_at: null, ...extra,
});
const slot = (id: string, label: DailyMealPlanSlot['slot_label'], t: ReturnType<typeof tpl>, extra: object = {}): DailyMealPlanSlot => ({
  id, daily_meal_plan_id: 'p1', meal_template_id: t.id, slot_label: label, order: 0, time_of_day: null, meal_template: t, ...extra,
} as DailyMealPlanSlot);
const RICE = { id: 'm-rice', name: 'Rice cakes, honey and whey', calories_kcal: 240, protein_g: 26, carbs_g: 30, fats_g: 2 };
const GRANOLA = { id: 'm-gran', name: 'Greek yoghurt and granola', calories_kcal: 260, protein_g: 22, carbs_g: 34, fats_g: 5 };
const HALF = { id: 'm-half', name: 'Protein bar', calories_kcal: 200, protein_g: 20 };
const pre = slot('s-pre', 'preworkout', tpl('m-shake', 'Banana and whey shake', 250, 27, 30, 2), { swaps: [RICE, HALF, GRANOLA] });
const dinner = slot('s-din', 'dinner', tpl('m-chilli', 'Turkey chilli with rice', 610, 48, 62, 16), { recipe_id: 'r1' });
const snackA = slot('s-snA', 'snack', tpl('m-apple', 'Apple and almonds', 180, 5, 20, 9));
const snackB = slot('s-snB', 'snack', tpl('m-cottage', 'Cottage cheese and berries', 190, 20, 14, 4));
const plan: DailyMealPlan = { id: 'p1', coach_id: 'sam', name: 'Training day', notes: null, created_at: '', archived_at: null, slots: [pre, dinner, snackA, snackB] };
const at = (hhmm: string) => new Date(`2026-11-27T${hhmm}:00`).toISOString();
const change = (slotId: string, label: DailyMealPlanSlot['slot_label'], to: [string, string] | null, hhmm: string, from: [string, string] | null = ['m-old', 'Old meal']): PlanChange => ({
  plan_id: 'p1', slot_id: slotId, slot_label: label, from_template_id: from?.[0] ?? null, from_name: from?.[1] ?? null,
  to_template_id: to?.[0] ?? null, to_name: to?.[1] ?? null, changed_at: at(hhmm),
});

describe('case 1: types and model', () => {
  it('R2: a swap shows only with all four numbers, in the server order; none when the slot has no swaps', () => {
    expect(swapsToShow(pre).map((s) => s.name)).toEqual(['Rice cakes, honey and whey', 'Greek yoghurt and granola']);
    expect(swapsToShow(dinner)).toEqual([]);
    expect(swapsToShow({ ...pre, swaps: [{ ...RICE, carbs_g: Number.NaN }] } as DailyMealPlanSlot)).toEqual([]);
    expect(swapsToShow({ ...pre, swaps: [{ ...RICE, fats_g: null }] } as unknown as DailyMealPlanSlot)).toEqual([]);
  });

  it('R10: the note for one, two and three changed meals, a removal, an addition, and a meal changed twice', () => {
    const one = [change('s-din', 'dinner', ['m-chilli', 'Turkey chilli with rice'], '11:20')];
    expect(changeNote(one, 'Sam')).toBe("Sam updated today's plan at 11:20 am. Dinner is now Turkey chilli with rice. Meals you already logged stay as they are.");
    expect(changeNote(one, '')).toBe("Your coach updated today's plan at 11:20 am. Dinner is now Turkey chilli with rice. Meals you already logged stay as they are.");
    const two = [...one, change('s-pre', 'preworkout', ['m-rice', 'Rice cakes, honey and whey'], '12:05')];
    expect(changeNote(two, 'Sam')).toBe("Sam updated today's plan at 12:05 pm. Dinner is now Turkey chilli with rice. Pre-workout is now Rice cakes, honey and whey. Meals you already logged stay as they are.");
    const three = [...two, change('s-snA', 'snack', ['m-x', 'Oat bar'], '09:00')];
    expect(changeNote(three, 'Sam')).toBe("Sam updated today's plan at 12:05 pm. 3 meals changed. Meals you already logged stay as they are.");
    const removed = [change('s-gone', 'lunch', null, '10:00', ['m-l', 'Chicken, rice and greens'])];
    expect(changeNote(removed, 'Sam')).toBe("Sam updated today's plan at 10:00 am. Lunch is off today's plan. Meals you already logged stay as they are.");
    const added = [change('s-new', 'postworkout', ['m-pw', 'Chocolate milk'], '08:15', null)];
    expect(changeNote(added, 'Sam')).toBe("Sam updated today's plan at 8:15 am. Post-workout is now Chocolate milk. Meals you already logged stay as they are.");
    const twice = [change('s-din', 'dinner', ['m-a', 'Fish pie'], '09:00'), change('s-din', 'dinner', ['m-chilli', 'Turkey chilli with rice'], '11:20')];
    expect(changeNote(twice, 'Sam')).toBe("Sam updated today's plan at 11:20 am. Dinner is now Turkey chilli with rice. Meals you already logged stay as they are.");
    expect(changeNote([], 'Sam')).toBeNull();
    expect(changeNote(undefined, 'Sam')).toBeNull();
  });

  it('R11: the Updated mark goes by slot id and the current meal, never by label or name (two snacks, one changed)', () => {
    const rows = [change('s-snB', 'snack', ['m-cottage', 'Cottage cheese and berries'], '11:00')];
    expect([...updatedSlotIds(rows, [plan])]).toEqual(['s-snB']);
    // A row whose meal is no longer the slot's (changed again by a row the server cut) marks nothing.
    expect([...updatedSlotIds([change('s-din', 'dinner', ['m-a', 'Fish pie'], '09:00')], [plan])]).toEqual([]);
    expect([...updatedSlotIds(undefined, [plan])]).toEqual([]);
  });

  it('finds a slot by id across the day\'s plans; a slot the coach removed is not found', () => {
    const data = { date: '2026-11-27', assignments: [{ daily_meal_plan: plan }] } as unknown as ClientTodayResponse;
    expect(findPlanSlot(data, 's-din')?.slot.meal_template.name).toBe('Turkey chilli with rice');
    expect(findPlanSlot(data, 's-gone')).toBeNull();
    expect(findPlanSlot(undefined, 's-din')).toBeNull();
  });

  it('R9: ingredient rows and grocery items from a recipe, and from items (grams, portion, neither); never invented', () => {
    const recipe = { id: 'r1', ingredients: ['Salmon fillet 160 g', 'Baby potatoes 200 g', ' ', 'Olive oil 1 tsp'] };
    expect(ingredientRows(recipe, null)).toEqual([
      { name: 'Salmon fillet 160 g', amount: null }, { name: 'Baby potatoes 200 g', amount: null }, { name: 'Olive oil 1 tsp', amount: null },
    ]);
    expect(groceryItems(recipe, null)).toEqual([
      { name: 'Salmon fillet 160 g', source_recipe_id: 'r1' }, { name: 'Baby potatoes 200 g', source_recipe_id: 'r1' },
      { name: 'Olive oil 1 tsp', source_recipe_id: 'r1' },
    ]);
    const items = [{ name: 'Banana', portion: '1 medium' }, { name: 'Whey protein', grams: 30 }, { name: 'Water' }];
    expect(ingredientRows(null, items)).toEqual([
      { name: 'Banana', amount: '1 medium' }, { name: 'Whey protein', amount: '30 g' }, { name: 'Water', amount: null },
    ]);
    expect(groceryItems(null, items)).toEqual([{ name: 'Banana', unit: '1 medium' }, { name: 'Whey protein', quantity: 30, unit: 'g' }, { name: 'Water' }]);
    expect(groceryItems(null, null)).toEqual([]);
    const long = 'x'.repeat(260);
    expect(groceryItems({ id: 'r2', ingredients: [long] }, null)[0].name).toHaveLength(200);
    expect(groceryItems(null, [{ name: 'Rice', portion: 'y'.repeat(80) }])[0].unit).toHaveLength(50);
    for (const item of [...groceryItems(recipe, null), ...groceryItems(null, items)]) expect(item).not.toHaveProperty('source_plan_slot_id');
  });

  it('R12: the footnote keeps the drawn sentence for pre-workout and names each of the six meals', () => {
    expect(footnoteFor('preworkout')).toBe('What you log here fills the pre-workout meal. Extras never tick a plan meal.');
    expect(['postworkout', 'breakfast', 'lunch', 'dinner', 'snack'].map((l) => footnoteFor(l as never))).toEqual([
      'What you log here fills the post-workout meal. Extras never tick a plan meal.',
      'What you log here fills the breakfast. Extras never tick a plan meal.',
      'What you log here fills the lunch. Extras never tick a plan meal.',
      'What you log here fills the dinner. Extras never tick a plan meal.',
      'What you log here fills the snack. Extras never tick a plan meal.',
    ]);
  });

  it('R4, R5, R8: the sheet model and the page line carry the true four numbers; a swap is one serving with no grams', () => {
    const sheet = somethingElseSheet(pre, 'Sam');
    expect(sheet.instead).toBe('Instead of Banana and whey shake, 250 kcal.');
    expect(sheet.heading).toBe('Swaps from Sam');
    expect(somethingElseSheet(pre, '').heading).toBe('Swaps from your coach');
    expect(sheet.label).toBe('Pre-workout');
    expect(sheet.swaps.map((s) => s.line)).toEqual(['240 kcal, 26 g protein', '260 kcal, 22 g protein']);
    expect(sheet.swaps[0].food).toMatchObject({ name: 'Rice cakes, honey and whey', calories: 240, protein: 26, carbs: 30, fat: 2,
      nutrient_basis: 'PER_SERVING', serving_size_grams: 0 });
    expect(sheet.swaps[0].food.id).toBeUndefined();
    expect(somethingElseSheet(dinner, 'Sam').heading).toBeNull();
    expect(perServingLine(dinner.meal_template)).toBe('Per serving: 610 kcal, 48 g protein, 62 g carbs, 16 g fat.');
  });
});

describe('case 12: guards on the new product files', () => {
  const files = ['src/screens/client/mealplan/planMeal.ts', 'src/screens/client/mealplan/PlanMealScreen.tsx'];
  it.each(files)('%s has no colour literal and no pale green token', (rel) => {
    const text = fs.readFileSync(path.join(__dirname, '../../../../..', rel), 'utf8');
    expect(text).not.toMatch(/['"`]#[0-9a-fA-F]{3,8}['"`]|rgba?\(|\b(white|black)\b['"`]/);
    expect(text).not.toMatch(/surface\.sage|sageLine/);
  });
});
