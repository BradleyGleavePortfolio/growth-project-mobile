/**
 * K1-OVERVIEW — the This week model. The ring is drawn only when the
 * summary's 20 latest assignments provably hold the whole week.
 */
import {
  checkInLine, checkInWeek, dayLabel, foodLine, foodWeek, needsNextMealPage, toGoLine,
  weekHeadline, workoutWeek, workoutsLine, type AssignmentRow, type MealRow,
} from '../thisWeek';

// Wednesday 14 October 2026, 10:00 local; the week runs Monday 12 to Sunday 18.
const NOW = new Date(2026, 9, 14, 10);
const at = (day: number, hour = 8) => new Date(2026, 9, day, hour).toISOString();
const row = (day: number, done = false): AssignmentRow => ({ scheduled_for: at(day), completed_at: done ? at(day, 9) : null });

describe('workoutWeek', () => {
  it('reads done, missed, today, planned and rest from the assignments (the K1 C week)', () => {
    const w = workoutWeek([row(16), row(14), row(13), row(12, true)], NOW)!;
    expect(w.segments).toEqual(['done', 'missed', 'planned', 'planned']);
    expect(w.days).toEqual(['done', 'missed', 'today', 'rest', 'planned', 'rest', 'rest']);
    expect(w.dates).toEqual([12, 13, 14, 15, 16, 17, 18]);
    expect([w.done, w.total, w.missed, w.week]).toEqual([1, 4, 1, '2026-10-12']);
    expect([weekHeadline(w), toGoLine(w), workoutsLine(w)]).toEqual(['Missed Tue', '2 to go', '1 of 4 done · Missed Tue']);
    expect([dayLabel(w, 0), dayLabel(w, 1), dayLabel(w, 2), dayLabel(w, 3)]).toEqual(['Mon 12 done', 'Tue 13 missed', 'Wed 14 today', 'Thu 15']);
  });

  it.each<[string, AssignmentRow[], 'drawn' | 'left out']>([
    ['fewer than 20 rows: every assignment is there', [row(12), ...Array.from({ length: 18 }, (_, i) => row(19 + i))], 'drawn'],
    ['20 rows reaching back before Monday: the week is whole', [row(11), row(12), ...Array.from({ length: 18 }, (_, i) => row(19 + i))], 'drawn'],
    ['20 rows all from Monday on: this week may be cut off', Array.from({ length: 20 }, (_, i) => row(12 + i)), 'left out'],
    ['20 future rows of a delivered program: this week is cut off', Array.from({ length: 20 }, (_, i) => row(40 + i)), 'left out'],
  ])('%s', (_name, rows, expected) => {
    expect(workoutWeek(rows, NOW) ? 'drawn' : 'left out').toBe(expected);
  });

  it('a week with nothing planned has no segments; a fully done day is done, a half-done past day is missed', () => {
    expect(workoutWeek([], NOW)!.total).toBe(0);
    const w = workoutWeek([row(12, true), row(12, true), row(13, true), row(13)], NOW)!;
    expect(w.days.slice(0, 2)).toEqual(['done', 'missed']);
    expect([weekHeadline(w), toGoLine(w)]).toEqual(['Missed Tue', null]);
    expect(weekHeadline(workoutWeek([row(12, true), row(16)], NOW)!)).toBe('1 of 2 done');
  });
});

describe('food, check-ins and paging', () => {
  const meal = (id: string, date: string, kcal: number, qty = 1): MealRow => ({ id, date: `${date}T00:00:00.000Z`, quantity_multiplier: qty, food_item: { calories: kcal } });

  it('counts the seven local days ending today and averages the logged ones', () => {
    const f = foodWeek([meal('a', '2026-10-14', 500), meal('b', '2026-10-14', 300, 2), meal('c', '2026-10-08', 2000), meal('d', '2026-10-07', 9000)], NOW);
    expect(f).toEqual({ logged: 2, average: 1550 });
    expect(foodLine(f, 2100)).toBe('Logged 2 of 7 days · Average 1,550 kcal · target 2,100');
    expect(foodLine(f, null)).toBe('Logged 2 of 7 days · Average 1,550 kcal');
    expect(foodLine(foodWeek([], NOW), 2100)).toBe('Logged 0 of 7 days');
  });

  it('reads the next page only while a full page still reaches into the seven days', () => {
    const page = (date: string) => Array.from({ length: 100 }, (_, i) => meal(String(i), date, 10));
    expect(needsNextMealPage(page('2026-10-08'), NOW)).toBe(true);
    expect(needsNextMealPage(page('2026-10-07'), NOW)).toBe(false);
    expect(needsNextMealPage(page('2026-10-14').slice(1), NOW)).toBe(false);
  });

  it('counts this week\'s check-ins and the ones waiting for review', () => {
    const c = checkInWeek([
      { date: '2026-10-14T00:00:00.000Z', reviewed_by_coach: false },
      { date: '2026-10-12T00:00:00.000Z', reviewed_by_coach: true },
      { date: '2026-10-11T00:00:00.000Z', reviewed_by_coach: false },
    ], NOW);
    expect(checkInLine(c)).toBe('2 this week · 1 to review');
  });
});
