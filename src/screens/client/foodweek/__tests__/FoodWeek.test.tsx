/**
 * KITCHEN-WEEK-M: the food week page (C2 Style C frame C_week, planning/MOCKUP3/C2/style-c/C_week_*.png) and its
 * coachless version, opened from the You row "Food this week". The real screen mounts with the API mocked at its edge
 * (logApi, mealTemplatesApi, macrosApi), at 390 x 844 with the phone's text at 100 percent and at 320 x 568 at 130
 * percent. Each test sets every switch it reads, so it passes in the required run and the "All switches on" run alike.
 * Fixtures are fictional (client Jordan, coach Sam): Wednesday October 7 to Tuesday October 13, today the Tuesday.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { gold } from '../../../../theme/tokens';

let mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDims }));
jest.mock('../../../../theme/ThemeProvider', () => {
  const sc = jest.requireActual('../../../../theme/tokens').lightTokens;
  return { useTheme: () => ({ semanticColors: sc, colors: { ...sc, background: sc.bgPrimary, primary: sc.accent,
    surface: sc.bgSurface, textSecondary: sc.textMuted } }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const React = require('react');
  return { __esModule: true, default: (props: object) => React.createElement(require('react-native').View, { ...props, testID: 'food-week-refresh' }) };
});
jest.mock('../../../../components/HapticPressable', () => require('react-native').Pressable);
jest.mock('../../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('@react-navigation/native', () => {
  const React = require('react');
  const nav = {
    navigate: jest.fn(), goBack: jest.fn(), listeners: [] as Array<() => void>,
    addListener: jest.fn((event: string, cb: () => void) => { if (event === 'focus') nav.listeners.push(cb); return () => undefined; }),
  };
  return { NavigationContext: React.createContext(nav), useNavigation: () => nav, __nav: nav };
});
const mockFlags: Record<string, boolean> = {};
jest.mock('../../../../config/featureFlags', () => ({
  featureFlags: new Proxy({}, { get: (_t, key: string) => mockFlags[key] ?? false }),
}));
let mockUser: { id: string; coach_id?: string | null } = { id: 'jordan', coach_id: 'sam' };
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../../utils/date', () => ({ ...jest.requireActual('../../../../utils/date'), getTodayString: () => '2026-10-13' }));
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  logApi: { getWeekly: jest.fn(), getDaily: jest.fn() },
}));
jest.mock('../../../../api/mealTemplatesApi', () => ({ mealTemplatesApi: { todayForClient: jest.fn() } }));
jest.mock('../../../../api/macrosApi', () => ({ macrosApi: { currentForSelf: jest.fn() } }));

import { logApi } from '../../../../services/api';
import { mealTemplatesApi } from '../../../../api/mealTemplatesApi';
import { macrosApi } from '../../../../api/macrosApi';
import FoodWeekScreen from '../FoodWeekScreen';
import { MORE_ITEMS, PLAN_MORE_ITEMS } from '../../MoreScreen';

const nav = jest.requireMock('@react-navigation/native').__nav as { listeners: Array<() => void>; addListener: jest.Mock };
const HIDDEN = { includeHiddenElements: true } as const;
const SRC = path.resolve(__dirname, '..', '..', '..', '..');
const flat = (el: { props: { style?: unknown } }) => (StyleSheet.flatten(el.props.style as never) ?? {}) as Record<string, unknown>;

// ---------- fixtures (fictional: client Jordan, coach Sam) ----------
const DAYS = ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'];
const EARLIER = ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'];
const NUMBERS: Array<[number, number]> = [[1820, 146], [1790, 151], [2140, 128], [1960, 139], [1610, 118], [1840, 146], [1210, 87]];
const DONE = [4, 4, 2, 3, 2, 4, 2];
const weeklyRows = (days = DAYS, numbers = NUMBERS) =>
  days.map((date, i) => ({ date, calories: numbers[i][0], protein_g: numbers[i][1], carbs_g: 0, fat_g: 0 }));
const SLOTS = [['s1', 'breakfast', 'Oats and berries'], ['s2', 'lunch', 'Chicken bowl'], ['s3', 'snack', 'Greek yoghurt'],
  ['s4', 'dinner', 'Salmon and rice']] as const;
const PLAN = {
  id: 'dp', coach_id: 'sam', name: 'Cut, week 3', notes: null, created_at: '2026-10-01', archived_at: null,
  slots: SLOTS.map(([id, label, name]) => ({ id, daily_meal_plan_id: 'dp', meal_template_id: `m-${id}`, slot_label: label, order: 0,
    time_of_day: null, meal_template: { id: `m-${id}`, coach_id: 'sam', name, calories_kcal: 450, protein_g: 35, carbs_g: 40,
      fats_g: 14, fiber_g: null, items: null, description: null, created_at: '2026-10-01', archived_at: null } })),
};
const planFor = (date: string) => ({ date, assignments: [{ id: 'a1', daily_meal_plan_id: 'dp', client_id: 'jordan',
  assigned_by_coach_id: 'sam', starts_on: '2026-10-01', ends_on: null, created_at: '2026-10-01', daily_meal_plan: PLAN }] });
let n = 0;
const entry = (meal: string, name: string, slotId: string | null) => ({ id: `e${++n}`, food_item_id: `f${n}`, user_id: 'jordan',
  meal_type: meal, quantity_multiplier: 1, food_item: { id: `f${n}`, name, calories: 450, protein_g: 35, carbs_g: 40, fat_g: 14 },
  plan_slot_id: slotId });
const linked = (done: number) => SLOTS.slice(0, done).map(([id, label, name]) => entry(label, name, id));
const dailyFor = (date: string) => {
  const i = DAYS.indexOf(date);
  if (date === '2026-10-08') return [...linked(4), entry('breakfast', 'Oats and berries', 's1')]; // two for one meal: once
  if (date === '2026-10-10') return [...linked(3), entry('lunch', 'Apple', null), entry('breakfast', 'Salmon and rice', 's4')];
  return i >= 0 ? linked(DONE[i]) : [];
};

type Serve = {
  weekly?: (start: string) => Promise<unknown>;
  daily?: (date: string) => Promise<unknown>;
  plan?: (date: string) => Promise<unknown>;
  target?: () => Promise<unknown>;
};
function serve(over: Serve = {}) {
  jest.mocked(logApi.getWeekly).mockImplementation((start: string) =>
    (over.weekly ? over.weekly(start) : Promise.resolve({ data: start === DAYS[0] ? weeklyRows() : weeklyRows(EARLIER) })) as never);
  jest.mocked(logApi.getDaily).mockImplementation((date: string) =>
    (over.daily ? over.daily(date) : Promise.resolve({ data: { entries: dailyFor(date), total_calories: 0 } })) as never);
  jest.mocked(mealTemplatesApi.todayForClient).mockImplementation(((date?: string) =>
    (over.plan ? over.plan(date as string) : Promise.resolve({ data: planFor(date as string) }))) as never);
  jest.mocked(macrosApi.currentForSelf).mockImplementation((() =>
    (over.target ? over.target() : Promise.resolve({ data: { calories_kcal: 1850, protein_g: 140 } }))) as never);
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={client}><FoodWeekScreen /></QueryClientProvider>);
}
const row = (day: string) => screen.getByTestId(`food-week-row-${day}`);
const dotsOf = (day: string, kind: 'done' | 'open') => within(row(day)).queryAllByTestId(`food-week-dot-${kind}`, HIDDEN).length;
const allWords = () => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') { if (typeof node === 'string') out.push(node); return; }
    const n = node as { props?: Record<string, unknown>; children?: unknown[] };
    for (const key of ['accessibilityLabel', 'accessibilityHint']) if (typeof n.props?.[key] === 'string') out.push(n.props[key] as string);
    (n.children ?? []).forEach(walk);
  };
  walk(screen.toJSON());
  return out.join(' | ');
};
const SIZES = [['390 x 844 at 100%', { width: 390, height: 844, scale: 2, fontScale: 1 }],
  ['320 x 568 at 130%', { width: 320, height: 568, scale: 2, fontScale: 1.3 }]] as const;

beforeEach(() => {
  jest.clearAllMocks();
  nav.listeners.length = 0;
  Object.assign(mockFlags, { youTabV2: true, foodPlanChecklist: true, clientTimelineV2: true, clientPathCopilot: true, romanChat: true });
  mockUser = { id: 'jordan', coach_id: 'sam' };
  mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
  serve();
});

describe('1. the door: "Food this week" right after Macro targets, opening FoodWeek in the More stack (R2, R3)', () => {
  const NAV = fs.readFileSync(path.join(SRC, 'navigation', 'ClientNavigator.tsx'), 'utf8');
  it('the row sits right after Macro targets with its words, icon and target', () => {
    const labels = PLAN_MORE_ITEMS.map((i) => i.label);
    expect(labels.indexOf('Food this week')).toBe(labels.indexOf('Macro targets') + 1);
    expect(PLAN_MORE_ITEMS.find((i) => i.label === 'Food this week')).toEqual({
      icon: 'analytics-outline', label: 'Food this week', description: 'Calories and protein, day by day', section: 'Your plan',
      target: { type: 'stack', screen: 'FoodWeek' }, a11yHint: 'Opens your food week',
    });
  });
  it('the route is registered once, as the meal plan page is: the OWN wrapper and the Back row on the forest band', () => {
    expect(NAV.match(/<MoreStackNav\.Screen\s+name="FoodWeek"/g) ?? []).toHaveLength(1);
    expect(NAV).toMatch(/<MoreStackNav\.Screen\s+name="FoodWeek"\s+component=\{ProtectedFoodWeekScreen\}\s+options=\{backOnlyHeader\('', PLAN_BAND\)\}\s*\/>/);
    expect(NAV).toMatch(/const ProtectedFoodWeekScreen = withProtectedScreen\(FoodWeekScreen, OWN\);/);
    expect(NAV).toMatch(/FoodWeek:\s+undefined;/);
  });
  it('the kitchen rows and their targets are as they were', () => {
    const kitchen = MORE_ITEMS.filter((i) => ['Recipes', 'Grocery list', 'Prep guide'].includes(i.label)).map((i) => [i.label, i.target]);
    expect(kitchen).toEqual([['Recipes', { type: 'stack', screen: 'Recipes' }], ['Grocery list', { type: 'stack', screen: 'GroceryList' }],
      ['Prep guide', { type: 'stack', screen: 'PrepGuide' }]]);
  });
});

describe.each(SIZES)('S1 to S3 at %s', (_size, dims) => {
  beforeEach(() => { mockDims = { ...dims }; });

  it('2. S1: the range, the title, the average without today, seven rows oldest first', async () => {
    mount();
    expect(await screen.findByText('1,860 kcal and 138 g protein a day, on average.')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'This week' })).toBeTruthy();
    const range = screen.getByText('October 7 to 13');
    expect(flat(range).textTransform).toBe('uppercase');
    const rows = screen.getAllByTestId(/^food-week-row-/);
    expect(rows.map((r) => r.props.testID)).toEqual(DAYS.map((d) => `food-week-row-${d}`));
    expect(within(row(DAYS[0])).getByText('1,820 kcal, 146 g', HIDDEN)).toBeTruthy();
    expect(screen.getByText('Average leaves out today until the day ends.')).toBeTruthy();
    expect(logApi.getWeekly).toHaveBeenCalledWith('2026-10-07');
    expect(logApi.getWeekly).toHaveBeenCalledTimes(1);
  });

  it('3. dots: 4 of 4 on Wednesday, 2 of 4 on Friday, the Food day\'s rule; each row one sentence, dots hidden', async () => {
    mount();
    await waitFor(() => expect(row(DAYS[2]).props.accessibilityLabel).toBe('Friday, 2 of 4, 2,140 kcal, 128 g protein'));
    expect([dotsOf(DAYS[0], 'done'), dotsOf(DAYS[0], 'open')]).toEqual([4, 0]);
    expect([dotsOf(DAYS[2], 'done'), dotsOf(DAYS[2], 'open')]).toEqual([2, 2]);
    expect([dotsOf(DAYS[1], 'done'), dotsOf(DAYS[1], 'open')]).toEqual([4, 0]); // two foods for one meal count once
    expect([dotsOf(DAYS[3], 'done'), dotsOf(DAYS[3], 'open')]).toEqual([3, 1]); // no plan meal, or another meal: none
    expect(row(DAYS[2]).props.accessible).toBe(true);
    expect(row(DAYS[2]).props.accessibilityRole).toBeUndefined();
    expect(row(DAYS[2]).props.onPress).toBeUndefined();
    expect(within(row(DAYS[2])).queryAllByTestId('food-week-dot-done')).toHaveLength(0);
    const eyebrow = screen.getByRole('header', { name: 'Plan meals done' });
    expect(flat(eyebrow).textTransform).toBe('uppercase');
    expect(mealTemplatesApi.todayForClient).toHaveBeenCalledTimes(7);
    expect(logApi.getDaily).toHaveBeenCalledTimes(7);
    expect(macrosApi.currentForSelf).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no coach', () => { mockUser = { id: 'jordan', coach_id: null }; }],
    ['a coach with the checklist switch off', () => { mockFlags.foodPlanChecklist = false; }],
  ])('4. S2, %s: no eyebrow, no dots, no plan or daily read, no coach, Roman or plan word', async (_name, arrange) => {
    arrange();
    mount();
    await waitFor(() => expect(row(DAYS[2]).props.accessibilityLabel).toBe('Friday, 2,140 kcal, 128 g protein'));
    expect(screen.queryByText('Plan meals done', HIDDEN)).toBeNull();
    expect(screen.queryAllByTestId(/^food-week-dot-/, HIDDEN)).toHaveLength(0);
    expect(mealTemplatesApi.todayForClient).not.toHaveBeenCalled();
    expect(logApi.getDaily).not.toHaveBeenCalled();
    expect(allWords()).not.toMatch(/sam|coach|roman|plan/i);
  });

  it('5. S1 and S3: the dashed target line and its legend; none without a target; one spoken label', async () => {
    mount();
    expect(await screen.findByText('Dashed line: 1,850 kcal target. Gold dot: today so far.')).toBeTruthy();
    const chart = screen.getByRole('image');
    expect(chart.props.accessibilityLabel).toBe('Calories per day against the 1,850 kcal target');
    expect(screen.getByTestId('food-week-target', HIDDEN).props.strokeDasharray).toBeTruthy();
    expect(screen.getByTestId(`food-week-point-${DAYS[6]}`, HIDDEN).props.fill).toBe(gold[300]);
    expect(screen.getAllByRole('image')).toHaveLength(1);
  });

  it.each([
    ['no target', () => Promise.resolve({ data: null })],
    ['a failed target read', () => Promise.reject(new Error('boom'))],
  ])('5. S3 with %s: no dashed line, "Gold dot: today so far."', async (_name, target) => {
    serve({ target });
    mount();
    expect(await screen.findByText('Gold dot: today so far.')).toBeTruthy();
    expect(screen.queryByTestId('food-week-target', HIDDEN)).toBeNull();
    expect(screen.getByRole('image').props.accessibilityLabel).toBe('Calories per day');
    expect(screen.queryByText(/Dashed line/)).toBeNull();
  });
});

describe('6. S4, S5 and S10: a day with nothing, a day with no plan, a week with nothing', () => {
  it('S4: "Nothing yet", no point, the line breaks; its dots still follow its plan, all open', async () => {
    serve({ weekly: () => Promise.resolve({ data: weeklyRows().filter((r) => r.date !== DAYS[3]) }),
      daily: (date) => Promise.resolve({ data: { entries: date === DAYS[3] ? [] : dailyFor(date) } }) });
    mount();
    await waitFor(() => expect(row(DAYS[3]).props.accessibilityLabel).toBe('Saturday, 0 of 4, nothing yet'));
    expect(within(row(DAYS[3])).getByText('Nothing yet', HIDDEN)).toBeTruthy();
    expect(screen.queryByTestId(`food-week-point-${DAYS[3]}`, HIDDEN)).toBeNull();
    expect(screen.getAllByTestId('food-week-line', HIDDEN)).toHaveLength(2);
    expect([dotsOf(DAYS[3], 'done'), dotsOf(DAYS[3], 'open')]).toEqual([0, 4]);
  });
  it('S5: a day with no plan has no dots; its numbers stay', async () => {
    serve({ plan: (date) => Promise.resolve({ data: date === DAYS[4] ? { date, assignments: [] } : planFor(date) }) });
    mount();
    await waitFor(() => expect(row(DAYS[4]).props.accessibilityLabel).toBe('Sunday, 1,610 kcal, 118 g protein'));
    expect(within(row(DAYS[4])).queryAllByTestId(/^food-week-dot-/, HIDDEN)).toHaveLength(0);
    expect(within(row(DAYS[4])).getByText('1,610 kcal, 118 g', HIDDEN)).toBeTruthy();
  });
  it('S10: no entries all week: no chart, legend, average or footnote; seven "Nothing yet"', async () => {
    serve({ weekly: () => Promise.resolve({ data: [] }) });
    mount();
    await waitFor(() => expect(screen.getAllByText('Nothing yet', HIDDEN)).toHaveLength(7));
    expect(screen.queryByRole('image')).toBeNull();
    expect(screen.queryByText(/Gold dot|Dashed line/)).toBeNull();
    expect(screen.queryByText(/on average/)).toBeNull();
    expect(screen.queryByText('Average leaves out today until the day ends.')).toBeNull();
  });
});

describe('7. S6: an earlier range', () => {
  it('Previous week reads the seven days before; "Earlier week"; Next week shows and returns; none on the current range', async () => {
    mount();
    await screen.findByText('1,860 kcal and 138 g protein a day, on average.');
    expect(screen.queryByLabelText('Next week', HIDDEN)).toBeNull();
    fireEvent.press(screen.getByLabelText('Previous week'));
    expect(await screen.findByRole('header', { name: 'Earlier week' })).toBeTruthy();
    expect(logApi.getWeekly).toHaveBeenLastCalledWith('2026-09-30');
    await waitFor(() => expect(logApi.getDaily).toHaveBeenCalledTimes(14));
    for (const day of EARLIER) {
      expect(logApi.getDaily).toHaveBeenCalledWith(day);
      expect(mealTemplatesApi.todayForClient).toHaveBeenCalledWith(day);
    }
    expect(screen.getByText('September 30 to October 6')).toBeTruthy();
    expect(screen.queryByText('This week')).toBeNull();
    // Every day counts on an earlier range: 12,370 / 7 = 1,767 kcal and 915 / 7 = 131 g.
    await screen.findByText('1,767 kcal and 131 g protein a day, on average.');
    expect(screen.queryByTestId(`food-week-point-${EARLIER[6]}`, HIDDEN)?.props.fill).not.toBe(gold[300]);
    expect(screen.getByText('Dashed line: 1,850 kcal target.')).toBeTruthy();
    expect(screen.queryByText(/Gold dot/)).toBeNull();
    expect(screen.queryByText('Average leaves out today until the day ends.')).toBeNull();
    fireEvent.press(screen.getByLabelText('Next week'));
    expect(await screen.findByRole('header', { name: 'This week' })).toBeTruthy();
    expect(screen.queryByLabelText('Next week', HIDDEN)).toBeNull();
  });
});

describe('8. S7: loading', () => {
  it('the row, range and title at once; still blocks read once as "Loading your week"; a new range shows no old number', async () => {
    let release: (v: unknown) => void = () => undefined;
    serve({ weekly: (start) => (start === DAYS[0] ? Promise.resolve({ data: weeklyRows() }) : new Promise((r) => { release = r; })) });
    mount();
    await screen.findByText('1,860 kcal and 138 g protein a day, on average.');
    fireEvent.press(screen.getByLabelText('Previous week'));
    expect(await screen.findByLabelText('Loading your week')).toBeTruthy();
    expect(screen.getAllByLabelText('Loading your week', HIDDEN)).toHaveLength(1);
    expect(screen.getByRole('header', { name: 'Earlier week' })).toBeTruthy();
    expect(screen.getByLabelText('Previous week')).toBeTruthy();
    expect(screen.queryByText(/kcal/, HIDDEN)).toBeNull();
    await act(async () => release({ data: weeklyRows(EARLIER) }));
    expect(await screen.findByText('1,767 kcal and 131 g protein a day, on average.')).toBeTruthy();
  });
});

describe('9. S8 and S9: a read that failed is never a zero', () => {
  it('S8: the weekly read failed: main\'s sentence and Try again, which reads every read again; no numbers', async () => {
    let fail = true;
    serve({ weekly: () => (fail ? Promise.reject(Object.assign(new Error('Network Error'), { isAxiosError: true }))
      : Promise.resolve({ data: weeklyRows() })) });
    mount();
    expect(await screen.findByText('Your week could not load. Check your connection, then try again.')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'This week' })).toBeTruthy();
    expect(screen.queryByText(/kcal|Nothing yet|on average/, HIDDEN)).toBeNull();
    const daily = jest.mocked(logApi.getDaily).mock.calls.length;
    fail = false;
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('1,860 kcal and 138 g protein a day, on average.')).toBeTruthy();
    expect(logApi.getWeekly).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(jest.mocked(logApi.getDaily).mock.calls.length).toBeGreaterThan(daily));
  });
  it.each([
    ['daily', { daily: (date: string) => (date === '2026-10-09' ? Promise.reject(new Error('boom')) : Promise.resolve({ data: { entries: dailyFor(date) } })) }],
    ['plan', { plan: (date: string) => (date === '2026-10-09' ? Promise.reject(new Error('boom')) : Promise.resolve({ data: planFor(date) })) }],
  ])('S9: Friday\'s %s read failed: no dots and no count on Friday, its numbers kept; pull to refresh retries', async (_n, over) => {
    serve(over as Serve);
    mount();
    await waitFor(() => expect(row(DAYS[0]).props.accessibilityLabel).toBe('Wednesday, 4 of 4, 1,820 kcal, 146 g protein'));
    await waitFor(() => expect(row(DAYS[2]).props.accessibilityLabel).toBe('Friday, 2,140 kcal, 128 g protein'));
    expect(within(row(DAYS[2])).queryAllByTestId(/^food-week-dot-/, HIDDEN)).toHaveLength(0);
    expect(allWords()).not.toMatch(/0 of 4/);
    const before = [jest.mocked(logApi.getDaily).mock.calls.length, jest.mocked(mealTemplatesApi.todayForClient).mock.calls.length];
    serve();
    await act(async () => { screen.getByTestId('food-week-refresh').props.onRefresh(); });
    await waitFor(() => expect(row(DAYS[2]).props.accessibilityLabel).toBe('Friday, 2 of 4, 2,140 kcal, 128 g protein'));
    expect(jest.mocked(logApi.getDaily).mock.calls.length + jest.mocked(mealTemplatesApi.todayForClient).mock.calls.length)
      .toBeGreaterThan(before[0] + before[1]);
  });
});

describe('10. back on the page after logging a food elsewhere', () => {
  it('today\'s numbers, dots and point are read again', async () => {
    mount();
    await waitFor(() => expect(row(DAYS[6]).props.accessibilityLabel).toBe('Tuesday, 2 of 4, 1,210 kcal, 87 g protein'));
    const later = NUMBERS.map((x, i) => (i === 6 ? [1660, 122] : x)) as Array<[number, number]>;
    serve({ weekly: () => Promise.resolve({ data: weeklyRows(DAYS, later) }),
      daily: (date) => Promise.resolve({ data: { entries: date === DAYS[6] ? linked(3) : dailyFor(date) } }) });
    expect(nav.listeners.length).toBeGreaterThan(0);
    await act(async () => { nav.listeners.forEach((cb) => cb()); });
    await waitFor(() => expect(row(DAYS[6]).props.accessibilityLabel).toBe('Tuesday, 3 of 4, 1,660 kcal, 122 g protein'));
    expect(screen.getByTestId(`food-week-point-${DAYS[6]}`, HIDDEN).props.fill).toBe(gold[300]);
  });
});

describe('11. 320 x 568 at 130%: nothing cut, every control 44 pt, a row wraps rather than overlaps', () => {
  it.each([[true], [false]])('coached=%s', async (coached) => {
    mockDims = { width: 320, height: 568, scale: 2, fontScale: 1.3 };
    mockUser = { id: 'jordan', coach_id: coached ? 'sam' : null };
    mount();
    await screen.findByText('1,860 kcal and 138 g protein a day, on average.');
    fireEvent.press(screen.getByLabelText('Previous week'));
    await screen.findByRole('header', { name: 'Earlier week' });
    await screen.findByText('1,767 kcal and 131 g protein a day, on average.');
    for (const t of screen.UNSAFE_root.findAll((n) => typeof n.type === 'string' && n.type === 'Text')) {
      expect(t.props.numberOfLines).toBeUndefined();
      expect(t.props.adjustsFontSizeToFit).toBeUndefined();
    }
    for (const b of screen.getAllByRole('button')) {
      const s = flat(b);
      expect(Number(s.minHeight ?? s.height)).toBeGreaterThanOrEqual(44);
      expect(Number(s.minWidth ?? s.width ?? 44)).toBeGreaterThanOrEqual(44);
    }
    expect(flat(row(DAYS[2])).flexWrap).toBe('wrap');
  });
});

describe('12. guards on the new files', () => {
  it.each([['screens/client/foodweek/FoodWeekScreen.tsx'], ['screens/client/foodweek/foodWeek.ts']])('%s holds no colour literal and no pale green family name', (file) => {
    const text = fs.readFileSync(path.join(SRC, file), 'utf8');
    expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(text).not.toMatch(/\brgba?\(/);
    expect(text).not.toMatch(/sage|success\.bg|primaryPale|brand\[50\]/);
  });
});
