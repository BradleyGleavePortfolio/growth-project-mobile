/**
 * PLAN-SWAPS-COACH-M: the pure part of the coach's meal page and the builder's times (mealLinks.ts). Red at the base
 * because the module does not exist there. Every slot write is one table (R9); time order (R10); the wheel's
 * wall-clock time in two zones and on a clock-change day (R8); the options list, the picker list and his own recipes.
 */
import type { DailyMealPlanSlot, MealTemplate } from '../../../../api/mealTemplatesApi';
import * as L from '../mealLinks';

// Two zones, set before any Date is made in a case (R8; PLAN 4). Each case asserts that its zone took.
const inZone = (tz: string, run: () => void) => {
  const was = process.env.TZ;
  process.env.TZ = tz;
  try { run(); } finally { process.env.TZ = was; }
};

const links = () => L;

const meal = (id: string, name: string, k = 200, p = 20, c = 20, f = 5): MealTemplate => ({
  id, coach_id: 'coach', name, description: null, calories_kcal: k, protein_g: p, carbs_g: c, fats_g: f,
  fiber_g: null, items: null, created_at: '2026-11-01T00:00:00.000Z', archived_at: null,
});
const slot = (id: string, meal_template_id: string, slot_label: DailyMealPlanSlot['slot_label'], order: number, time_of_day: string | null = null) =>
  ({ id, daily_meal_plan_id: 'p1', meal_template_id, slot_label, order, time_of_day, meal_template: meal(meal_template_id, meal_template_id) }) as DailyMealPlanSlot;
const sent = (rows: { meal_template_id: string; slot_label: string; order?: number; time_of_day?: string | null }[]) =>
  rows.map((r) => `${r.meal_template_id} ${r.slot_label} ${r.order} ${r.time_of_day ?? '-'}`);

describe('options for clients', () => {
  const live = [meal('a', 'Rice cakes, honey and whey'), meal('b', 'Greek yoghurt and granola'), meal('self', 'Banana and whey shake')];

  it('rows keep his order; an id not among his live meals is archived only from a fresh read, else unknown', () => {
    const { optionRows } = links();
    expect(optionRows(['b', 'gone', 'a'], live, true).map((r) => `${r.id} ${r.state}`)).toEqual(['b meal', 'gone archived', 'a meal']);
    expect(optionRows(['b', 'gone', 'a'], live, false).map((r) => `${r.id} ${r.state}`)).toEqual(['b meal', 'gone unknown', 'a meal']);
    expect(optionRows(['a'], undefined, false).map((r) => r.state)).toEqual(['unknown']);
  });

  it('move up, move down, remove and the picker tick keep every other id where it sits', () => {
    const { moveOption, removeOption, toggleOption, MAX_OPTIONS } = links();
    expect(MAX_OPTIONS).toBe(10);
    expect(moveOption(['a', 'x', 'b'], 1, -1)).toEqual(['x', 'a', 'b']);
    expect(moveOption(['a', 'x', 'b'], 1, 1)).toEqual(['a', 'b', 'x']);
    expect(moveOption(['a', 'x', 'b'], 0, -1)).toEqual(['a', 'x', 'b']);
    expect(moveOption(['a', 'x', 'b'], 2, 1)).toEqual(['a', 'x', 'b']);
    expect(removeOption(['a', 'x', 'b'], 1)).toEqual(['a', 'b']);
    expect(toggleOption(['a', 'x', 'b'], 'a')).toEqual(['x', 'b']);
    expect(toggleOption(['x', 'b'], 'c')).toEqual(['x', 'b', 'c']);
  });

  it('the picker lists his live meals A to Z, this meal left out, and finds by name', () => {
    const { pickerMeals } = links();
    expect(pickerMeals(live, 'self', '').map((m) => m.name)).toEqual(['Greek yoghurt and granola', 'Rice cakes, honey and whey']);
    expect(pickerMeals(live, undefined, '').map((m) => m.id)).toEqual(['self', 'b', 'a']);
    expect(pickerMeals(live, 'self', '  RICE ').map((m) => m.id)).toEqual(['a']);
  });
});

describe('his own recipes (R7)', () => {
  const rows = [
    { id: 'r1', title: 'Banana protein shake', created_by_id: 'coach', is_public: true, allergens: ['dairy'], allergens_declared: true },
    { id: 'rR', title: 'Riley bowl', created_by_id: 'riley', is_public: true, allergens: [], allergens_declared: true },
    { id: 'r3', title: 'Overnight protein oats', created_by_id: 'coach', is_public: false, allergens: [], allergens_declared: true },
  ];
  it('only rows he created, in the server order; nothing until his id is known; a list of other shapes is none', () => {
    const { ownRecipes } = links();
    expect(ownRecipes(rows, 'coach').map((r) => r.id)).toEqual(['r1', 'r3']);
    expect(ownRecipes(rows, undefined)).toEqual([]);
    expect(ownRecipes([{ id: 'p1', name: 'Training day' }], 'coach')).toEqual([]);
    expect(ownRecipes({ data: rows }, 'coach')).toEqual([]);
  });
  it('share line and the allergen rule (R6: any declared allergen, shared or private)', () => {
    const { recipeShare, declaresAllergen } = links();
    expect(rows.map((r) => recipeShare(r as never))).toEqual(['Shared with your clients', 'Shared with your clients', 'Only you']);
    expect(rows.map((r) => declaresAllergen(r as never))).toEqual([true, false, false]);
    expect(declaresAllergen({ allergens: ['soy'], is_public: false } as never)).toBe(true);
    expect(declaresAllergen({ allergens: null } as never)).toBe(false);
  });
});

describe('slot writes (R9): every slot the coach did not tap is sent as stored', () => {
  const stored = [slot('s1', 'm8', 'dinner', 0, '19:30'), slot('s2', 'm7', 'breakfast', 1, '07:40'), slot('s3', 'm5', 'snack', 3, null)];
  const full = Array.from({ length: 20 }, (_, i) => slot(`f${i}`, `m${i}`, 'snack', i === 0 ? 0 : i + 1, i % 2 ? '12:00' : null));
  it.each<[string, DailyMealPlanSlot[], Parameters<ReturnType<typeof links>['slotWrite']>[1], string[]]>([
    ['Swap keeps its order and time', stored, { kind: 'swap', id: 's2', meal: 'm9', label: 'breakfast' },
      ['m8 dinner 0 19:30', 'm9 breakfast 1 07:40', 'm5 snack 3 -']],
    ['Swap with a new label is his change, order and time kept', stored, { kind: 'swap', id: 's2', meal: 'm9', label: 'lunch' },
      ['m8 dinner 0 19:30', 'm9 lunch 1 07:40', 'm5 snack 3 -']],
    ['Add takes the next order after the highest and no time', stored, { kind: 'add', meal: 'm2', label: 'lunch' },
      ['m8 dinner 0 19:30', 'm7 breakfast 1 07:40', 'm5 snack 3 -', 'm2 lunch 4 -']],
    ['Remove of the first meal keeps every other order and time', stored, { kind: 'remove', id: 's1' },
      ['m7 breakfast 1 07:40', 'm5 snack 3 -']],
    ['Remove of the middle meal leaves a gap', stored, { kind: 'remove', id: 's2' }, ['m8 dinner 0 19:30', 'm5 snack 3 -']],
    ['A time touches only its slot', stored, { kind: 'time', id: 's1', time: '18:45' }, ['m8 dinner 0 18:45', 'm7 breakfast 1 07:40', 'm5 snack 3 -']],
    ['No time sends null for its slot only', stored, { kind: 'time', id: 's2', time: null }, ['m8 dinner 0 19:30', 'm7 breakfast 1 -', 'm5 snack 3 -']],
    ['Add when the highest order is 20 takes the lowest free order, never 21', full, { kind: 'add', meal: 'mx', label: 'dinner' },
      [...full.map((s) => `${s.meal_template_id} snack ${s.order} ${s.time_of_day ?? '-'}`), 'mx dinner 1 -']],
  ])('%s', (_, slots, change, want) => {
    const out = links().slotWrite(slots, change);
    expect(sent(out)).toEqual(want);
    expect(out.every((s) => 'time_of_day' in s && 'order' in s)).toBe(true);
  });
  it('the 20-order cap: with 0 to 20 all used, Add sends the others as stored (the server refuses 21, as main)', () => {
    const all = Array.from({ length: 21 }, (_, i) => slot(`g${i}`, `m${i}`, 'snack', i));
    const out = links().slotWrite(all, { kind: 'add', meal: 'mx', label: 'dinner' });
    expect(out.slice(0, 21).map((s) => s.order)).toEqual(all.map((s) => s.order));
    expect(out[21]).toMatchObject({ meal_template_id: 'mx', order: 21 });
  });
});

describe('time order on the builder (R10)', () => {
  it('a timed meal at its minutes; an untimed one right after the meal before it in saved order; ties keep saved order', () => {
    const { byTime } = links();
    const plan = [slot('d', 'm8', 'dinner', 0, '19:30'), slot('b', 'm7', 'breakfast', 1, '07:40'), slot('s', 'm5', 'snack', 2, null)];
    expect(byTime(plan).map(({ slot: x, index }) => `${x.id} ${index}`)).toEqual(['b 1', 's 2', 'd 0']);
    const first = [slot('x', 'm1', 'snack', 0, null), slot('y', 'm2', 'lunch', 1, '12:00'), slot('z', 'm3', 'dinner', 2, '12:00')];
    expect(byTime(first).map(({ slot: x }) => x.id)).toEqual(['x', 'y', 'z']);
    // The index is into the saved order (sortedSlots), whatever order the server listed the rows in.
    expect(byTime([plan[2], plan[0], plan[1]]).map(({ index }) => index)).toEqual([1, 2, 0]);
  });
});

describe('the wheel is wall-clock local time on a fixed ordinary day (R8)', () => {
  it.each([['Asia/Tokyo', -540], ['America/Los_Angeles', 480]])('%s', (tz, offset) => inZone(tz, () => {
    const { toWheel, fromWheel, openingTime } = links();
    expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(offset);
    for (const t of ['00:00', '07:40', '12:35', '19:30', '23:55', '12:37']) expect(fromWheel(toWheel(t))).toBe(t);
    const d = toWheel('07:40');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2024, 0, 15, 7, 40]);
    expect([openingTime(null, 'breakfast'), openingTime(null, 'lunch'), openingTime(null, 'snack'), openingTime(null, 'preworkout'),
      openingTime(null, 'dinner'), openingTime(null, 'postworkout'), openingTime('06:05', 'dinner')])
      .toEqual(['07:30', '12:30', '15:30', '17:30', '19:30', '19:00', '06:05']);
  }));
  it('a time inside the skipped hour of a clock-change day survives (the fixed day is not today)', () => inZone('America/New_York', () => {
    const { toWheel, fromWheel } = links();
    const skipped = new Date(2026, 2, 8, 2, 30);
    expect(skipped.getHours()).toBe(3); // 02:30 does not exist on 2026-03-08 in New York
    expect(fromWheel(toWheel('02:30'))).toBe('02:30');
  }));
});

describe('the save refusals by code (R4, F10)', () => {
  const err = (code: string) => ({ response: { status: 400, data: { code, error: code, message: 'Something from the server' } } });
  it('MEAL_SWAP_INVALID and MEAL_RECIPE_INVALID say the drawn sentences; anything else is main saveFailed', () => {
    const { saveRefused } = links();
    expect(saveRefused(err('MEAL_SWAP_INVALID'))).toBe(
      'A swap must be one of your own meals that is not archived, and not this meal. Pick swaps from your meals and save again.');
    expect(saveRefused(err('MEAL_RECIPE_INVALID'))).toBe('The recipe must be one of your own recipes. Pick a recipe you created and save again.');
    expect(saveRefused({ message: 'Network Error', isAxiosError: true })).toBe('That did not save. Check your connection, then try again.');
    expect(saveRefused({ response: { status: 500, data: {} } })).toBe('That did not save. Try again in a moment.');
  });
});
