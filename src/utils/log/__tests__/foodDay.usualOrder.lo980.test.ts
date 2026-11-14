// LO-980 B1 (lens, m#980 @ 3c0e2001): a usual meal's time comes from when its newest day's foods were saved
// (logged_at). A client who saved yesterday's breakfast after dinner (a late catch-up log, a normal habit) gets
// a usual breakfast timed in the evening, so this morning's Food day puts breakfast last and offers lunch as
// Up next. Meal order (breakfast, lunch, dinner) must hold before the now line; Up next is breakfast.
import { buildUsualDay, type PastDay } from '../foodDay';
import { buildTimeline, type TimelineItem } from '../foodTimeline';

type Entry = PastDay['entries'][number];
const food = (id: string, name: string, kcal: number) => ({ id, name, calories_per_serving: kcal, protein: 20, carbs: 30, fat: 10, nutrient_basis: 'PER_SERVING' });
const entry = (meal: Entry['meal_type'], id: string, name: string, kcal: number, loggedAt: string): Entry => ({
  meal_type: meal, food_item_id: id, quantity_multiplier: 1, original_quantity: 1, original_unit: 'serving',
  food_item: food(id, name, kcal), logged_at: loggedAt,
} as Entry);
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00`;
const Y = '2026-11-04';
const S = '2026-11-01';
// Yesterday: lunch at 12:30, dinner at 19:00, and breakfast caught up at 21:10. Three days ago: in order.
const past: PastDay[] = [
  { date: Y, entries: [entry('lunch', 'wrap', 'Turkey wrap', 470, at(Y, '12:30')), entry('dinner', 'curry', 'Chickpea curry', 540, at(Y, '19:00')),
    entry('breakfast', 'oats', 'Overnight oats', 380, at(Y, '21:10'))] },
  { date: S, entries: [entry('breakfast', 'oats', 'Overnight oats', 380, at(S, '07:50')), entry('lunch', 'wrap', 'Turkey wrap', 470, at(S, '12:40')),
    entry('dinner', 'curry', 'Chickpea curry', 540, at(S, '19:15'))] },
];
const keys = (items: TimelineItem[]) => items.map((it) => (it.kind === 'slot' ? it.slot.key : it.kind));
const upNext = (items: TimelineItem[]) => items.find((it) => it.kind === 'slot' && it.slot.logs.length === 0);

describe('LO-980 B1: a usual day keeps meal order when a meal was logged late', () => {
  it('at 8:00 am with nothing eaten, breakfast comes before lunch and dinner and is Up next', () => {
    const items = buildTimeline({ day: buildUsualDay(past, []), nowMin: 8 * 60 });
    expect(keys(items)).toEqual(['now', 'breakfast', 'lunch', 'dinner']);
    const next = upNext(items);
    expect(next && next.kind === 'slot' && next.slot.key).toBe('breakfast');
  });
});
