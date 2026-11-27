/**
 * KITCHEN-WEEK-M: the food week page's pure part (foodWeek.ts). The range, the seven days, each day's numbers, the
 * average, the plan meals done per day (the Food day's own rule, buildPlanDay) and the chart's points. Fixtures are
 * fictional (client Jordan, coach Sam) and follow C2 Style C frame C_week (planning/MOCKUP3/C2/style-c/C_week_*.png):
 * Wednesday October 7 to Tuesday October 13, today the Tuesday.
 */
import type { ClientTodayResponse } from '../../../../api/mealTemplatesApi';
import {
  CHART, averageLine, chartGeometry, chartLabel, legendLine, planDots, rowNumbers, rowSentence, weekAverage, weekRange,
  weekdayName, weeklyTotals,
} from '../foodWeek';

const TODAY = '2026-10-13';
const DAYS = ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'];
// GET /log/weekly (log.service.ts getWeekly): one row per day with entries, raw sums, keyed by the stored date.
const WEEKLY = [
  { date: '2026-10-07', calories: 1819.6, protein_g: 146.2, carbs_g: 180, fat_g: 60 },
  { date: '2026-10-08', calories: 1790, protein_g: 151, carbs_g: 170, fat_g: 62 },
  { date: '2026-10-09', calories: 2140, protein_g: 128, carbs_g: 230, fat_g: 70 },
  { date: '2026-10-10', calories: 1960, protein_g: 139, carbs_g: 200, fat_g: 66 },
  { date: '2026-10-11', calories: 1610, protein_g: 118, carbs_g: 160, fat_g: 55 },
  { date: '2026-10-12', calories: 1840, protein_g: 146, carbs_g: 190, fat_g: 61 },
  { date: '2026-10-13', calories: 1210, protein_g: 87, carbs_g: 120, fat_g: 40 },
];

const slot = (id: string, label: string, name: string) => ({
  id, daily_meal_plan_id: 'dp', meal_template_id: `m-${id}`, slot_label: label, order: 0, time_of_day: null,
  meal_template: { id: `m-${id}`, coach_id: 'sam', name, calories_kcal: 450, protein_g: 35, carbs_g: 40, fats_g: 14,
    fiber_g: null, items: null, description: null, created_at: '2026-10-01', archived_at: null },
});
const PLAN = {
  id: 'dp', coach_id: 'sam', name: 'Cut, week 3', notes: null, created_at: '2026-10-01', archived_at: null,
  slots: [slot('s1', 'breakfast', 'Oats and berries'), slot('s2', 'lunch', 'Chicken bowl'), slot('s3', 'snack', 'Greek yoghurt'),
    slot('s4', 'dinner', 'Salmon and rice')],
};
const assignment = (id: string, plan = PLAN) => ({ id, daily_meal_plan_id: plan.id, client_id: 'jordan', assigned_by_coach_id: 'sam',
  starts_on: '2026-10-01', ends_on: null, created_at: '2026-10-01', daily_meal_plan: plan });
const planRead = (assignments: unknown[]) => ({ date: '2026-10-09', assignments }) as unknown as ClientTodayResponse;
let n = 0;
const entry = (meal: string, name: string, slotId: string | null) => ({
  id: `e${++n}`, food_item_id: `f${n}`, user_id: 'jordan', meal_type: meal, quantity_multiplier: 1, logged_at: '2026-10-09T08:00:00Z',
  food_item: { id: `f${n}`, name, calories: 450, protein_g: 35, carbs_g: 40, fat_g: 14 }, plan_slot_id: slotId,
});

describe('the range: the last seven days ending today, oldest first (R4)', () => {
  it('the current range is Wednesday to today, Tuesday', () => {
    expect(weekRange(TODAY, 0)).toEqual({ start: '2026-10-07', end: '2026-10-13', days: DAYS, current: true });
  });
  it('Previous week moves seven days back; that range is not the current one', () => {
    const earlier = weekRange(TODAY, 1);
    expect(earlier.start).toBe('2026-09-30');
    expect(earlier.end).toBe('2026-10-06');
    expect(earlier.days).toHaveLength(7);
    expect(earlier.current).toBe(false);
  });
  it('names each day by its own calendar date', () => {
    expect(DAYS.map(weekdayName)).toEqual(['Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday']);
  });
});

describe('the numbers (R5)', () => {
  it('each day is the weekly row for its date; a day with no row has no numbers', () => {
    const totals = weeklyTotals(WEEKLY.filter((r) => r.date !== '2026-10-10'), DAYS);
    expect(totals[0]).toEqual({ kcal: 1819.6, protein: 146.2 });
    expect(totals[3]).toBeNull();
    expect(rowNumbers(totals[0])).toBe('1,820 kcal, 146 g');
    expect(rowNumbers(totals[3])).toBe('Nothing yet');
  });
  it('rows from outside the range, and rows that are not days, are not this range\'s', () => {
    const totals = weeklyTotals([{ date: '2026-10-14', calories: 900, protein_g: 40 }, { calories: 3 }, null, 'x'], DAYS);
    expect(totals.every((t) => t === null)).toBe(true);
    expect(weeklyTotals(undefined, DAYS).every((t) => t === null)).toBe(true);
  });
  it('a stored date with a time still reads as its own calendar day', () => {
    expect(weeklyTotals([{ date: '2026-10-09T00:00:00.000Z', calories: 2140, protein_g: 128 }], DAYS)[2]).toEqual({ kcal: 2140, protein: 128 });
  });
  it('the average counts finished days with entries and leaves out today (C2-A-22): 1,860 kcal and 138 g', () => {
    const avg = weekAverage(weeklyTotals(WEEKLY, DAYS), DAYS, TODAY);
    expect(avg).toEqual({ kcal: 1860, protein: 138 });
    expect(averageLine(avg!)).toBe('1,860 kcal and 138 g protein a day, on average.');
  });
  it('an earlier range counts every day with entries', () => {
    const earlier = weekRange(TODAY, 1).days;
    const rows = [{ date: earlier[0], calories: 2000, protein_g: 100 }, { date: earlier[6], calories: 1000, protein_g: 50 }];
    expect(weekAverage(weeklyTotals(rows, earlier), earlier, TODAY)).toEqual({ kcal: 1500, protein: 75 });
  });
  it('with no finished day with entries there is no average', () => {
    const onlyToday = weeklyTotals([WEEKLY[6]], DAYS);
    expect(weekAverage(onlyToday, DAYS, TODAY)).toBeNull();
    expect(weekAverage(weeklyTotals([], DAYS), DAYS, TODAY)).toBeNull();
  });
});

describe('plan meals done per day: the Food day\'s own rule (R6, buildPlanDay)', () => {
  const daily = (entries: unknown[]) => ({ entries, total_calories: 0, total_protein_g: 0 });
  it('counts plan meals whose foods were logged for them: 2 of 4', () => {
    const dots = planDots(planRead([assignment('a1')]), daily([entry('breakfast', 'Oats and berries', 's1'),
      entry('lunch', 'Chicken bowl', 's2')]), '2026-10-09');
    expect(dots).toEqual({ done: 2, total: 4 });
  });
  it('two entries for one plan meal count once', () => {
    const dots = planDots(planRead([assignment('a1')]), daily([entry('breakfast', 'Oats', 's1'), entry('breakfast', 'Berries', 's1')]), '2026-10-09');
    expect(dots).toEqual({ done: 1, total: 4 });
  });
  it('an entry with no plan meal counts none', () => {
    expect(planDots(planRead([assignment('a1')]), daily([entry('lunch', 'Chicken bowl', null)]), '2026-10-09')).toEqual({ done: 0, total: 4 });
  });
  it('an entry whose meal no longer matches its plan meal counts none', () => {
    expect(planDots(planRead([assignment('a1')]), daily([entry('dinner', 'Oats and berries', 's1')]), '2026-10-09')).toEqual({ done: 0, total: 4 });
  });
  it('a plan assigned twice shows its meals once, as the Food day lists it', () => {
    expect(planDots(planRead([assignment('a1'), assignment('a2')]), daily([]), '2026-10-09')).toEqual({ done: 0, total: 4 });
  });
  it('a day with no plan, or a plan with no meals, has no dots', () => {
    expect(planDots(planRead([]), daily([]), '2026-10-09')).toBeNull();
    expect(planDots(planRead([assignment('a1', { ...PLAN, slots: [] })]), daily([]), '2026-10-09')).toBeNull();
  });
  it('no plan read or no daily read: no dots, never 0 of 4', () => {
    expect(planDots(undefined, daily([]), '2026-10-09')).toBeNull();
    expect(planDots(planRead([assignment('a1')]), undefined, '2026-10-09')).toBeNull();
  });
});

describe('words', () => {
  const fri = { kcal: 2140, protein: 128 };
  it('a row reads its day, its count when it has dots, and its numbers', () => {
    expect(rowSentence('2026-10-09', fri, { done: 2, total: 4 })).toBe('Friday, 2 of 4, 2,140 kcal, 128 g protein');
    expect(rowSentence('2026-10-09', fri, null)).toBe('Friday, 2,140 kcal, 128 g protein');
    expect(rowSentence('2026-10-09', null, null)).toBe('Friday, nothing yet');
    expect(rowSentence('2026-10-09', null, { done: 0, total: 4 })).toBe('Friday, 0 of 4, nothing yet');
  });
  it('the legend says only what the chart draws', () => {
    expect(legendLine(1850, true)).toBe('Dashed line: 1,850 kcal target. Gold dot: today so far.');
    expect(legendLine(null, true)).toBe('Gold dot: today so far.');
    expect(legendLine(1850, false)).toBe('Dashed line: 1,850 kcal target.');
    expect(legendLine(null, false)).toBeNull();
  });
  it('the chart has one spoken label', () => {
    expect(chartLabel(1850)).toBe('Calories per day against the 1,850 kcal target');
    expect(chartLabel(null)).toBe('Calories per day');
  });
});

describe('the chart: a line through the days with entries, breaking at a day with none', () => {
  const W = 342;
  it('higher calories sit higher; every point is inside the chart; the target line is level with its number', () => {
    const g = chartGeometry(weeklyTotals(WEEKLY, DAYS), W, 1850);
    const ys = g.points.map((p) => p!.y);
    expect(ys[2]).toBeLessThan(ys[6]); // Friday 2,140 above Tuesday 1,210
    for (const p of g.points) {
      expect(p!.y).toBeGreaterThanOrEqual(CHART.padY);
      expect(p!.y).toBeLessThanOrEqual(CHART.height - CHART.padY);
      expect(p!.x).toBeGreaterThanOrEqual(CHART.inset);
      expect(p!.x).toBeLessThanOrEqual(W - CHART.inset);
    }
    expect(g.targetY).not.toBeNull();
    expect(ys[5]).toBeCloseTo(g.targetY! + ((1850 - 1840) / (2140 - 1210)) * (CHART.height - 2 * CHART.padY), 5);
    expect(g.runs).toHaveLength(1);
  });
  it('a day with no entries has no point and the line breaks there', () => {
    const g = chartGeometry(weeklyTotals(WEEKLY.filter((r) => r.date !== '2026-10-10'), DAYS), W, 1850);
    expect(g.points[3]).toBeNull();
    expect(g.runs.map((r) => r.length)).toEqual([3, 3]);
  });
  it('no target: no target line', () => {
    expect(chartGeometry(weeklyTotals(WEEKLY, DAYS), W, null).targetY).toBeNull();
  });
});
