/** K1-OVERVIEW — the This week model, from the server's week (GET /coach/clients/:id/week) and the timeline. */
import {
  checkInLine, checkInWeek, dayLabel, foodLine, foodWeek, needsNextMealPage, toGoLine,
  weekHeadline, workoutWeek, workoutsLine, type ClientWeek, type MealRow,
} from '../thisWeek';

// The client's week runs Monday 12 to Sunday 18 October 2026; today is Wednesday 14.
const row = (day: number, done = false, skipped = false) => ({ day: `2026-10-${day}`, completed_at: done ? 'x' : null, skipped_at: skipped ? 'x' : null });
const of = (assignments: ClientWeek['assignments']) => workoutWeek({ week_start: '2026-10-12', today: '2026-10-14', assignments });

describe('workoutWeek', () => {
  it('reads done, missed, today, planned and rest from the week read (the K1 C week)', () => {
    const w = of([row(12, true), row(13), row(16)]);
    expect(w.segments).toEqual(['done', 'missed', 'planned']);
    expect(w.days).toEqual(['done', 'missed', 'today', 'rest', 'planned', 'rest', 'rest']);
    expect(w.dates).toEqual([12, 13, 14, 15, 16, 17, 18]);
    expect([w.done, w.total, w.missed, w.week]).toEqual([1, 3, 1, '2026-10-12']);
    expect([weekHeadline(w), toGoLine(w), workoutsLine(w)]).toEqual(['Missed Tue', '1 to go', '1 of 3 done · Missed Tue']);
    expect([dayLabel(w, 0), dayLabel(w, 1), dayLabel(w, 2), dayLabel(w, 3)]).toEqual(['Mon 12 done', 'Tue 13 missed', 'Wed 14 today', 'Thu 15']);
  });

  it('a skipped later day is dashed but not named missed until it comes; a fully done day is done, a half-done past day is missed', () => {
    const s = of([row(16, false, true)]);
    expect([s.days[4], s.missed, weekHeadline(s), weekHeadline(of([row(13), row(16, false, true)]))]).toEqual(['missed', null, '0 of 1 done', 'Missed Tue']);
    const w = of([row(12, true), row(12, true), row(13, true), row(13)]);
    expect(w.days.slice(0, 2)).toEqual(['done', 'missed']);
    expect([weekHeadline(w), toGoLine(w)]).toEqual(['Missed Tue', null]);
    expect(weekHeadline(of([row(12, true), row(16)]))).toBe('1 of 2 done');
  });

  it('nothing planned: no segments and a plain card line', () => {
    expect(of([]).total).toBe(0);
    expect(workoutsLine(of([]))).toBe('Nothing planned this week');
  });
});

describe('food, check-ins and paging', () => {
  const meal = (id: string, date: string, kcal: number, qty = 1): MealRow => ({ id, date: `${date}T00:00:00.000Z`, quantity_multiplier: qty, food_item: { calories: kcal } });

  // #FOODAVG: today counts as logged but never enters the average; with no finished logged day there is no average.
  it.each<[string, MealRow[], string]>([
    ['nothing logged', [], 'Logged 0 of 7 days'],
    ['today only', [meal('a', '2026-10-14', 500)], 'Logged 1 of 7 days'],
    ['a finished day only', [meal('b', '2026-10-13', 1800)], 'Logged 1 of 7 days · Average 1,800 kcal · target 2,100'],
    ['finished days and today (the eighth day back is out)', [meal('a', '2026-10-14', 500), meal('b', '2026-10-13', 300, 2), meal('c', '2026-10-08', 2000), meal('d', '2026-10-07', 9000)], 'Logged 3 of 7 days · Average 1,300 kcal · target 2,100'],
  ])('food over the seven days ending the client\'s today: %s', (_name, meals, line) => {
    expect(foodLine(foodWeek(meals, '2026-10-14'), 2100)).toBe(line);
  });
  it('the Food line drops the target part when no target is set', () => {
    expect(foodLine({ logged: 3, average: 1300 }, null)).toBe('Logged 3 of 7 days · Average 1,300 kcal');
  });

  it('reads the next page only while a full page still reaches into the seven days', () => {
    const page = (date: string) => Array.from({ length: 100 }, (_, i) => meal(String(i), date, 10));
    expect(needsNextMealPage(page('2026-10-08'), '2026-10-14')).toBe(true);
    expect(needsNextMealPage(page('2026-10-07'), '2026-10-14')).toBe(false);
    expect(needsNextMealPage(page('2026-10-14').slice(1), '2026-10-14')).toBe(false);
  });

  it('counts this week\'s check-ins and the ones waiting for review', () => {
    const ci = (date: string, reviewed: boolean) => ({ date: `${date}T00:00:00.000Z`, reviewed_by_coach: reviewed });
    expect(checkInLine(checkInWeek([ci('2026-10-14', false), ci('2026-10-12', true), ci('2026-10-11', false)], '2026-10-12'))).toBe('2 this week · 1 to review');
  });
});
