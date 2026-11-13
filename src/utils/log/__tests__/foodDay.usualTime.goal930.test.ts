// GOAL-930-M (D3, C2 Style C C_usual, owner #203-E50 "op 1 to all"): on a coachless client's "Your usual day" each
// usual meal still to eat shows a time. C_usual.html :87-88 (.c-e .tm, the 54 pt gutter, Inter 500 12) draws
// "12:30 pm" beside UP NEXT, YOUR USUAL LUNCH and "7:00 pm" beside dinner. The rule: the phone's local clock minute
// of the earliest logged_at among the usual version's entries on that version's newest day (usual.meal.date, the
// day Repeat copies), written to the slot's own `time` ("HH:MM"), so buildTimeline places and labels it as it does
// a plan meal the coach timed. No logged_at, or one that does not parse: no time (main's behaviour).
import { buildUsualDay, type PastDay } from '../foodDay';
import { buildTimeline, type TimelineItem } from '../foodTimeline';
import type { FoodLog } from '../../../types';

type Entry = PastDay['entries'][number];
const food = (id: string, name: string, kcal: number) => ({ id, name, calories_per_serving: kcal, protein: 20, carbs: 30, fat: 10, nutrient_basis: 'PER_SERVING' });
const entry = (meal: Entry['meal_type'], id: string, name: string, kcal: number, loggedAt?: unknown): Entry => ({
  meal_type: meal, food_item_id: id, quantity_multiplier: 1, original_quantity: 1, original_unit: 'serving',
  food_item: food(id, name, kcal), ...(loggedAt === undefined ? {} : { logged_at: loggedAt }),
} as Entry);
// Local clock strings (no zone), so "12:30" is 12:30 on the phone that runs the test, whatever its zone.
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00`;

// Newest first as FoodDayView reads them: yesterday, then two days before.
const Y = '2026-11-04';
const S = '2026-11-01';
const week = (lunchY: unknown, lunchS: unknown, extra: Entry[] = []): PastDay[] => [
  { date: Y, entries: [entry('breakfast', 'oats', 'Overnight oats', 380, at(Y, '08:05')), entry('lunch', 'wrap', 'Turkey and hummus wrap', 470, lunchY),
    entry('lunch', 'apple', 'Apple', 95, lunchY), entry('dinner', 'curry', 'Chickpea and spinach curry', 540, at(Y, '19:00')), ...extra] },
  { date: S, entries: [entry('breakfast', 'oats', 'Overnight oats', 380, at(S, '07:50')), entry('lunch', 'wrap', 'Turkey and hummus wrap', 470, lunchS),
    entry('lunch', 'apple', 'Apple', 95, lunchS), entry('dinner', 'curry', 'Chickpea and spinach curry', 540, at(S, '19:45'))] },
];
const slot = (past: PastDay[], key: string, logs: FoodLog[] = []) => buildUsualDay(past, logs).slots.find((x) => x.key === key);

const eaten = (id: string, mealType: FoodLog['mealType'], name: string, hhmm: string): FoodLog => ({
  id, userId: 'u', coachId: '', date: '2026-11-05', mealType, foodName: name, calories: 380, protein: 20, carbs: 30, fat: 10,
  quantity: 1, unit: 'serving', createdAt: `2026-11-05T${hhmm}:00`, fillsUsualMeal: true,
});
const keys = (items: TimelineItem[]) => items.map((it) => (it.kind === 'slot' ? it.slot.key : it.kind));
// FoodDayView.tsx:346: Up next is the first meal still to eat in timeline order.
const upNext = (items: TimelineItem[]) => items.find((it) => it.kind === 'slot' && it.slot.logs.length === 0);

describe('GOAL-930-M D3: a usual meal still to eat carries its usual time', () => {
  it('the newest day\'s earliest logged_at sets "HH:MM" in the phone\'s zone', () => {
    // Yesterday's lunch: the wrap at 12:40 and the apple at 12:30; the earliest wins.
    const past = week(at(Y, '12:40'), at(S, '13:15'));
    (past[0].entries[2] as { logged_at?: string }).logged_at = at(Y, '12:30');
    expect(slot(past, 'lunch')?.time).toBe('12:30');
    expect(slot(past, 'breakfast')?.time).toBe('08:05');
    expect(slot(past, 'dinner')?.time).toBe('19:00');
  });

  it('a server time with a zone is read on the phone\'s clock', () => {
    const iso = '2026-11-04T20:30:00.000Z';
    const d = new Date(iso);
    const local = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    expect(slot(week(iso, at(S, '13:15')), 'lunch')?.time).toBe(local);
  });

  it('two days with different times take the newest day (the version Repeat copies)', () => {
    const lunch = slot(week(at(Y, '12:30'), at(S, '13:15')), 'lunch');
    expect(lunch?.usual?.meal.date).toBe(Y);
    expect(lunch?.time).toBe('12:30');
  });

  it.each([
    ['no logged_at', undefined],
    ['a null logged_at', null],
    ['"not a date"', 'not a date'],
  ])('%s on the newest day gives no time (main)', (_label, value) => {
    const lunch = slot(week(value, at(S, '13:15')), 'lunch');
    expect(lunch?.usual).toBeTruthy();
    expect(lunch?.time ?? null).toBeNull();
    const items = buildTimeline({ day: buildUsualDay(week(value, at(S, '13:15')), []), nowMin: 12 * 60 + 10 });
    expect(items.find((it) => it.kind === 'slot' && it.slot.key === 'lunch')).toEqual(expect.objectContaining({ min: null }));
  });

  it('a usual meal already eaten keeps its log time through buildTimeline', () => {
    const day = buildUsualDay(week(at(Y, '12:30'), at(S, '13:15')), [eaten('l1', 'lunch', 'Tuna salad', '13:05')]);
    const lunch = buildTimeline({ day, nowMin: 15 * 60 + 10 }).find((it) => it.kind === 'slot' && it.slot.key === 'lunch');
    expect(lunch).toEqual(expect.objectContaining({ min: 13 * 60 + 5 }));
  });

  it('C_usual: a usual lunch at 12:30 with now 12:10 sits after the now line and is Up next', () => {
    const day = buildUsualDay(week(at(Y, '12:30'), at(S, '13:15')), [eaten('b1', 'breakfast', 'Overnight oats', '08:05')]);
    const items = buildTimeline({ day, nowMin: 12 * 60 + 10 });
    expect(keys(items)).toEqual(['breakfast', 'now', 'lunch', 'dinner']);
    const next = upNext(items);
    expect(next).toEqual(expect.objectContaining({ min: 12 * 60 + 30 }));
    expect(next && next.kind === 'slot' && next.slot.key).toBe('lunch');
  });

  it('a usual lunch at 12:30 with now 15:10 sits above the now line and is still Up next', () => {
    const day = buildUsualDay(week(at(Y, '12:30'), at(S, '13:15')), [eaten('b1', 'breakfast', 'Overnight oats', '08:05')]);
    const items = buildTimeline({ day, nowMin: 15 * 60 + 10 });
    expect(keys(items)).toEqual(['breakfast', 'lunch', 'now', 'dinner']);
    const next = upNext(items);
    expect(next && next.kind === 'slot' && next.slot.key).toBe('lunch');
  });
});
