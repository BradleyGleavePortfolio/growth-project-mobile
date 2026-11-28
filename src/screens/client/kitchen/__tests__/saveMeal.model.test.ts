/**
 * SAVED-MEAL-SAVE-M: the save sheet's pure part (saveMeal.ts). Today's groups from the daily entries (R3), the picks
 * and their numbers, the default name (R5), the body sent (R4), the name rule, the limit (R8) and the lost-send match
 * (R6). Every time is built from local clock parts, so the clock words hold in any time zone. Fixtures fictional
 * (client Jordan); the day is Tuesday 2026-10-13.
 */
import {
  SAVED_MEALS_MAX, SAVED_MEAL_ITEMS_MAX, atLimit, dayGroups, defaultName, firstPicks, groupTitle, lostSaveIn, matchesSend,
  nameOk, pickedFoods, saveBody, todayEntries,
} from '../saveMeal';

const at = (h: number, m: number) => new Date(2026, 9, 13, h, m).toISOString();
let k = 0;
const entry = (meal: string, time: string | undefined, name: string, kcal: number, protein: number, m: number,
  qty: number | null = null, unit: string | null = null) => {
  k += 1;
  return { id: `e${k}`, food_item_id: `f${k}`, user_id: 'jordan', meal_type: meal, quantity_multiplier: m,
    original_quantity: qty, original_unit: unit, ...(time ? { logged_at: time } : {}),
    food_item: { id: `f${k}`, name, calories: kcal, protein_g: protein, carbs_g: 0, fat_g: 0 } };
};
function day() {
  k = 0;
  return [
    entry('breakfast', at(7, 40), 'Greek yoghurt, plain', 59, 10, 2.0, 200, 'g'),
    entry('breakfast', at(7, 40), 'Rolled oats', 379, 13.2, 0.5, 50, 'g'),
    entry('breakfast', at(7, 40), 'Blueberries', 57, 0.7, 0.8, 80, 'g'),
    entry('snack', at(10, 15), 'Flat white', 110, 6, 1.0, 1, 'cup'),
    entry('lunch', at(12, 35), 'Chicken breast, grilled', 165, 31, 1.5, 150, 'g'),
    entry('lunch', at(12, 35), 'Rice, cooked', 130, 1.7, 1.8, 180, 'g'),
    entry('lunch', at(12, 35), 'Avocado', 120, 1, 1.0),
  ];
}
const meal = (id: string, name: string, items: Array<[string, number]>) => ({
  id, user_id: 'jordan', name, created_at: '2026-10-13', updated_at: '2026-10-13',
  items: items.map(([food, m], i) => ({ id: `${id}-${i}`, saved_meal_id: id, food_item_id: food, quantity_multiplier: m, position: i })),
});

describe('SAVED-MEAL-SAVE-M: saveMeal.ts', () => {
  it('the limits name the server (saved-foods.dto.ts:8-9): 100 meals, 30 foods', () => {
    expect(SAVED_MEALS_MAX).toBe(100);
    expect(SAVED_MEAL_ITEMS_MAX).toBe(30);
  });

  it('R3: a read is a day only when it is an object with an entries list; anything else is a failed read', () => {
    expect(todayEntries({ entries: [] })).toEqual([]);
    expect(todayEntries({ entries: day() })).toHaveLength(7);
    for (const bad of [{}, 'nope', null, undefined, [], { entries: 'x' }]) expect(todayEntries(bad)).toBeNull();
  });

  it('R3: groups newest first, each titled by its meal and its newest time; foods in the day order with the Food day numbers', () => {
    const groups = dayGroups(day() as never);
    expect(groups.map(groupTitle)).toEqual(['Lunch, 12:35 pm', 'Snacks, 10:15 am', 'Breakfast, 7:40 am']);
    const lunch = groups[0];
    expect(lunch.foods.map((f) => [f.name, f.amount, f.kcal, f.protein])).toEqual([
      ['Chicken breast, grilled', '150 g', 248, 47], ['Rice, cooked', '180 g', 234, 3], ['Avocado', '1 serving', 120, 1],
    ]);
    const breakfast = groups[2].foods;
    expect(breakfast.reduce((t, f) => t + f.kcal, 0)).toBe(354);
    expect(breakfast.reduce((t, f) => t + f.protein, 0)).toBe(28);
  });

  it('R3: a group with no time on any entry has no time; created_at stands in for logged_at', () => {
    k = 0;
    const plain = [entry('dinner', undefined, 'Soup', 100, 5, 1)];
    expect(groupTitle(dayGroups(plain as never)[0])).toBe('Dinner');
    const made = [{ ...entry('dinner', undefined, 'Soup', 100, 5, 1), created_at: at(19, 5) }];
    expect(groupTitle(dayGroups(made as never)[0])).toBe('Dinner, 7:05 pm');
  });

  it('SS1: the newest group is picked first; an entry outside the multiplier bounds is never picked (KS-17)', () => {
    const groups = dayGroups(day() as never);
    expect(firstPicks(groups)).toEqual(['e5', 'e6', 'e7']);
    k = 10;
    const odd = dayGroups([entry('lunch', at(12, 0), 'Old row', 100, 1, 60), entry('lunch', at(12, 0), 'Tiny', 100, 1, 0.001),
      entry('lunch', at(12, 0), 'Fine', 100, 1, 1)] as never);
    expect(odd[0].foods.map((f) => f.savable)).toEqual([false, false, true]);
    expect(firstPicks(odd)).toEqual(['e13']);
  });

  it('R5: the default name: each name up to its first comma, as stored, joined by the Kitchen foods line, cut at a word end to 80', () => {
    expect(defaultName(['Chicken breast, grilled', 'Rice, cooked', 'Avocado'])).toBe('Chicken breast, Rice and Avocado');
    expect(defaultName(['Flat white', 'Chicken breast, grilled', 'Rice, cooked', 'Avocado'])).toBe('Flat white, Chicken breast, Rice and 1 more');
    expect(defaultName(['greek yoghurt'])).toBe('greek yoghurt');
    const long = defaultName(['Wholegrain sourdough toast with extra seeds', 'Smoked salmon and cream cheese spread', 'Cucumber']);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long).toBe('Wholegrain sourdough toast with extra seeds, Smoked salmon and cream cheese');
    expect(defaultName([])).toBe('');
  });

  it('R5: a name is 1 to 80 characters once trimmed, with a visible character', () => {
    expect(nameOk('Lunch')).toBe(true);
    expect(nameOk('   ')).toBe(false);
    expect(nameOk('')).toBe(false);
    expect(nameOk(`  ${'a'.repeat(80)}  `)).toBe(true);
    expect(nameOk('a'.repeat(81))).toBe(false);
  });

  it('R4: the body: the trimmed name and the picked entries in the day order, each with only the four keys the server takes', () => {
    const groups = dayGroups(day() as never);
    const picks = pickedFoods(groups, ['e7', 'e4', 'e5', 'e6']);
    expect(picks.map((f) => f.id)).toEqual(['e4', 'e5', 'e6', 'e7']);
    const body = saveBody('  Lunch and coffee ', picks);
    expect(body).toEqual({
      name: 'Lunch and coffee',
      items: [
        { food_item_id: 'f4', quantity_multiplier: 1, original_quantity: 1, original_unit: 'cup' },
        { food_item_id: 'f5', quantity_multiplier: 1.5, original_quantity: 150, original_unit: 'g' },
        { food_item_id: 'f6', quantity_multiplier: 1.8, original_quantity: 180, original_unit: 'g' },
        { food_item_id: 'f7', quantity_multiplier: 1 },
      ],
    });
    for (const item of body.items) {
      expect(Object.keys(item).every((key) => ['food_item_id', 'quantity_multiplier', 'original_quantity', 'original_unit'].includes(key))).toBe(true);
    }
  });

  it('R4: a quantity with no unit, a unit with no quantity or one out of bounds sends neither', () => {
    k = 20;
    const rows = [entry('lunch', at(12, 0), 'A', 1, 1, 1, 5, null), entry('lunch', at(12, 0), 'B', 1, 1, 1, null, 'g'),
      entry('lunch', at(12, 0), 'C', 1, 1, 1, 200000, 'g'), entry('lunch', at(12, 0), 'D', 1, 1, 1, 2, 'x'.repeat(33))];
    const body = saveBody('x', pickedFoods(dayGroups(rows as never), ['e21', 'e22', 'e23', 'e24']));
    expect(body.items).toEqual(['f21', 'f22', 'f23', 'f24'].map((id) => ({ food_item_id: id, quantity_multiplier: 1 })));
  });

  it('R8: the limit counts what the cache holds', () => {
    expect(atLimit(Array.from({ length: 99 }, (_, i) => meal(`m${i}`, 'x', [])))).toBe(false);
    expect(atLimit(Array.from({ length: 100 }, (_, i) => meal(`m${i}`, 'x', [])))).toBe(true);
    expect(atLimit(null)).toBe(false);
  });

  it('R6: a lost send matches a meal not kept, with the same trimmed name and foods in order (multiplier within 1e-6)', () => {
    const body = { name: 'Lunch', items: [{ food_item_id: 'f5', quantity_multiplier: 1.5 }, { food_item_id: 'f6', quantity_multiplier: 1.8 }] };
    const written = meal('new', 'Lunch', [['f5', 1.5000000001], ['f6', 1.8]]);
    expect(matchesSend(written as never, body)).toBe(true);
    expect(matchesSend(meal('x', 'Lunch', [['f6', 1.8], ['f5', 1.5]]) as never, body)).toBe(false);
    expect(matchesSend(meal('x', 'Lunch 2', [['f5', 1.5], ['f6', 1.8]]) as never, body)).toBe(false);
    expect(matchesSend(meal('x', 'Lunch', [['f5', 1.5]]) as never, body)).toBe(false);
    const kept = new Set(['old']);
    expect(lostSaveIn([meal('old', 'Lunch', [['f5', 1.5], ['f6', 1.8]]), written] as never, kept, [body])?.id).toBe('new');
    expect(lostSaveIn([meal('old', 'Lunch', [['f5', 1.5], ['f6', 1.8]])] as never, kept, [body])).toBeNull();
    expect(lostSaveIn([written] as never, kept, [])).toBeNull();
  });
});
