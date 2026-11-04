// FOOD-DAY-STYLEC-M (C2 Style C slice C1): the day as a 24-hour timeline. Order with and without the coach's
// times (DailyMealPlanSlot.time_of_day, "HH:MM"), the now line's place at a given time, the workout from Train,
// and the masthead's left / over line. Every number comes from the plan, the day's log and the targets.
import { buildTimeline, clockOf, dayLeft, minutesOf } from '../foodTimeline';
import type { DaySlot, FoodDay } from '../foodDay';
import type { FoodLog } from '../../../types';

const at = (hhmm: string) => `2026-10-13T${hhmm}:00.000`;
const log = (id: string, mealType: FoodLog['mealType'], foodName: string, createdAt?: string): FoodLog => ({
  id, userId: 'u', coachId: 'c', date: '2026-10-13', mealType, foodName, calories: 100, protein: 10, carbs: 10, fat: 1,
  quantity: 1, unit: 'serving', createdAt: createdAt as string,
});
const slot = (key: string, label: string, logs: FoodLog[] = [], time?: string | null): DaySlot & { time?: string | null } => ({
  key, mealType: label === 'Pre-workout' ? 'snack' : (label.toLowerCase() as DaySlot['mealType']), label, name: `${label} meal`,
  kcal: 400, protein: 30, carbs: 40, fat: 10, foods: [], logs, status: logs.length ? 'Logged as planned' : null, time,
});
const day = (slots: DaySlot[], extras: FoodLog[] = []): FoodDay => ({ kind: 'plan', slots, extras });
const order = (items: ReturnType<typeof buildTimeline>) => items.map((x) =>
  (x.kind === 'slot' ? x.slot.key : x.kind === 'extra' ? `x:${x.log.id}` : x.kind === 'workout' ? 'workout' : 'now'));

describe('minutesOf and clockOf', () => {
  it('reads the server HH:MM and writes the drawn clock', () => {
    expect(minutesOf('07:40')).toBe(460);
    expect(minutesOf('17:30')).toBe(1050);
    expect([minutesOf(null), minutesOf(undefined), minutesOf(''), minutesOf('7:4'), minutesOf('25:00')]).toEqual([null, null, null, null, null]);
    expect([clockOf(460), clockOf(735), clockOf(0), clockOf(720), clockOf(1050)]).toEqual(['7:40 am', '12:15 pm', '12:00 am', '12:00 pm', '5:30 pm']);
  });
});

describe('buildTimeline', () => {
  it('puts every entry in clock order: a done meal at its log time, a meal to eat at the coach time, extras at their log time', () => {
    const b = slot('b', 'Breakfast', [log('1', 'breakfast', 'Breakfast meal', at('07:40'))], '07:30');
    const l = slot('l', 'Lunch', [], '12:30');
    const p = slot('p', 'Pre-workout', [], '17:30');
    const items = buildTimeline({ day: day([b, l, p], [log('x', 'snack', 'Flat white', at('10:15'))]), nowMin: null });
    expect(order(items)).toEqual(['b', 'x:x', 'l', 'p']);
    expect(items.map((x) => x.min)).toEqual([460, 615, 750, 1050]);
  });

  it('keeps plan order and shows no time for a meal without a coach time', () => {
    const items = buildTimeline({ day: day([slot('b', 'Breakfast', [], '08:00'), slot('l', 'Lunch'), slot('d', 'Dinner', [], '19:00')]), nowMin: null });
    expect(order(items)).toEqual(['b', 'l', 'd']);
    expect(items.map((x) => x.min)).toEqual([480, null, 1140]);
  });

  it('keeps plan order on a day where the coach set no times at all', () => {
    const items = buildTimeline({ day: day([slot('b', 'Breakfast'), slot('l', 'Lunch'), slot('s', 'Snack'), slot('d', 'Dinner')]), nowMin: null });
    expect(order(items)).toEqual(['b', 'l', 's', 'd']);
    expect(items.every((x) => x.min === null)).toBe(true);
  });

  it('draws the now line after everything at or before the time and before everything after it', () => {
    const b = slot('b', 'Breakfast', [log('1', 'breakfast', 'Breakfast meal', at('07:40'))], '07:30');
    const l = slot('l', 'Lunch', [log('2', 'lunch', 'Lunch meal', at('12:35'))], '12:30');
    const p = slot('p', 'Pre-workout', [], '17:30');
    const items = buildTimeline({ day: day([b, l, p]), nowMin: 15 * 60 + 10 });
    expect(order(items)).toEqual(['b', 'l', 'now', 'p']);
    expect(items[2].min).toBe(910);
    // At 7:00 am the now line opens the day; at 11 pm it closes it.
    expect(order(buildTimeline({ day: day([slot('b', 'Breakfast', [], '07:30'), slot('d', 'Dinner', [], '19:00')]), nowMin: 420 }))).toEqual(['now', 'b', 'd']);
    expect(order(buildTimeline({ day: day([slot('b', 'Breakfast', [], '07:30'), slot('d', 'Dinner', [], '19:00')]), nowMin: 1380 }))).toEqual(['b', 'd', 'now']);
  });

  it('puts a meal still to eat with no time after the now line, in plan order', () => {
    const b = slot('b', 'Breakfast', [log('1', 'breakfast', 'Breakfast meal', at('08:05'))]);
    const items = buildTimeline({ day: day([b, slot('l', 'Lunch'), slot('d', 'Dinner')]), nowMin: 12 * 60 + 10 });
    expect(order(items)).toEqual(['b', 'now', 'l', 'd']);
    expect(items[0].min).toBe(485);
  });

  it('draws no now line on another day', () => {
    expect(order(buildTimeline({ day: day([slot('b', 'Breakfast', [], '07:30')]), nowMin: null }))).toEqual(['b']);
  });

  it('puts the workout from Train at its time, and with no time right after the pre-workout meal', () => {
    const p = slot('p', 'Pre-workout', [], '17:30');
    const d = slot('d', 'Dinner', [], '19:30');
    expect(order(buildTimeline({ day: day([p, d]), nowMin: null, workout: { name: 'Full body A', time: '18:00' } })))
      .toEqual(['p', 'workout', 'd']);
    const untimed = buildTimeline({ day: day([slot('p', 'Pre-workout'), slot('d', 'Dinner')]), nowMin: null, workout: { name: 'Full body A', time: null } });
    expect(order(untimed)).toEqual(['p', 'workout', 'd']);
    expect(untimed[1].min).toBeNull();
    // No pre-workout meal and no time: the workout closes the day, with no time.
    expect(order(buildTimeline({ day: day([slot('b', 'Breakfast')]), nowMin: null, workout: { name: 'Full body A', time: null } }))).toEqual(['b', 'workout']);
  });
});

describe('dayLeft', () => {
  it('counts what is left from the target and what is eaten', () => {
    expect(dayLeft({ calories: 1850, protein: 150 }, { calories: 1210, protein: 87 })).toEqual({ over: false, kcal: 640, protein: 63, target: 1850, targetProtein: 150, eatenProtein: 87 });
  });
  it('says how far above the target, never a negative left', () => {
    expect(dayLeft({ calories: 1850, protein: 150 }, { calories: 2080, protein: 154 })).toEqual({ over: true, kcal: 230, protein: 0, target: 1850, targetProtein: 150, eatenProtein: 154 });
  });
  it('has no line without a target', () => {
    expect(dayLeft(null, { calories: 500, protein: 20 })).toBeNull();
    expect(dayLeft({ calories: 0, protein: 0 }, { calories: 500, protein: 20 })).toBeNull();
  });
});
