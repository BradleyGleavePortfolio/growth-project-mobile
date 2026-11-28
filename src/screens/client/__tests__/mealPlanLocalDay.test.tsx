/**
 * MEALPLAN-LOCAL-DAY-M (SWEEP-MEAL-PLANS B3): the meal plan page, the Kitchen's plan card and a notice's link show the
 * plan of HER day, and "Ate it as planned" logs her day's meal to her day, whatever day the server's clock is on.
 *
 * Backend main answers GET /me/meal-plan/today for ?date's day, and with no ?date for the server's own day (planDay():
 * `new Date()` at midnight, on a server that runs with TZ=UTC; meal-plan-notice.ts). The fake server below answers the
 * same way from the test's clock. The phone's zone is set through Intl, as clientStore.fr916WaterZoneChange.test.ts
 * does; the clock is a system time only (react-query's and waitFor's timers stay real), as Kitchen.test.tsx does.
 * Two phones: 16:30 on Friday 27 November in America/Los_Angeles (UTC is already Saturday 28 November) and 08:30 on
 * Saturday 28 November in Australia/Brisbane (UTC+10, no daylight saving; UTC is still Friday 27 November). Her coach's
 * this-week plan ends on Friday 27 November and next week's starts on Saturday 28 November.
 * FIX-MLD-1 (m#1038 B1, LO 7234024743 and LS 7234028928, OPERATOR RULING 7234060232): a door that opens the page by
 * plan id with no date (a delivered plan, a notice's tgp://meal-plan/<id>) opens that plan at every hour, as main does.
 * The server picks the plan such a door names on its own day: a delivery starts on todayUtcDate()
 * (packages/asset-resolvers/meal-plan.resolver.ts) and a notice links tgp://meal-plan/<id> only while the plan is in
 * force on planDay() (real-meal-plans/meal-plan-notice.ts:122-126), else tgp://plan. When her day's answer lacks the
 * plan, the page reads once more with no date and shows it under the day that answer names; the plain doors (More,
 * the Kitchen card, tgp://plan) read her day only. The notice cases below take the link the server sends at the clock.
 * Real: ClientDailyMealPlanScreen, KitchenScreen, useMealPlanToday, useTodayLog, LogPlannedMealButton with logSubmit,
 * routeForDrop and the notice link rules (incomingLinkPath, resolveAppLink). Stubbed: the HTTP edge (services/api,
 * mealTemplatesApi), navigation, the theme, icons and haptics. Every switch is on. Names and ids are fictional.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../config/featureFlags', () => ({ featureFlags: new Proxy({}, { get: () => true }) }));
jest.mock('../../../theme/ThemeProvider', () => {
  const sc = jest.requireActual('../../../theme/tokens').lightTokens;
  return { useTheme: () => ({ semanticColors: sc, colors: { ...jest.requireActual('../../../constants/colors').default } }) };
});
jest.mock('@expo/vector-icons', () => {
  const Icon = () => null;
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const R = require('react');
  return { __esModule: true, default: (props: object) => R.createElement(require('react-native').View, props) };
});
jest.mock('../../../components/HapticPressable', () => require('react-native').Pressable);
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../components/FadeInView', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' }, NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: new Proxy({}, { get: () => jest.fn(async () => undefined) }),
}));
let mockParams: { date?: string; assignmentId?: string } | undefined;
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), getParent: jest.fn(), addListener: jest.fn(() => () => undefined) };
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: mockParams }),
  useNavigation: () => mockNav,
  useFocusEffect: () => undefined,
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1', coach_id: 'coach-1' }) }));
jest.mock('../../../hooks/useMacros', () => ({ useCurrentMacrosForSelf: () => ({ data: null }) }));
const mockToday = jest.fn();
jest.mock('../../../api/mealTemplatesApi', () => ({
  SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack', 'preworkout', 'postworkout'],
  mealTemplatesApi: { todayForClient: (date?: string) => mockToday(date) },
}));
const mockLogFood = jest.fn();
const mockCreateFood = jest.fn();
const mockGetDaily = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: (url: string) => Promise.resolve({ data: url === '/v1/clients/me/coach' ? { name: 'Sam Rivera' } : [] }),
    post: jest.fn(),
  },
  logApi: {
    getDaily: (date: string) => mockGetDaily(date),
    logFood: (...a: unknown[]) => mockLogFood(...a),
    deleteEntry: jest.fn(),
  },
  foodApi: { create: (...a: unknown[]) => mockCreateFood(...a) },
  recipesApi: { list: () => Promise.resolve({ data: [] }) },
  listsApi: { getList: () => Promise.resolve({ data: [] }) },
}));
jest.mock('../../../services/foodLogQueue', () => ({ ...jest.requireActual('../../../services/foodLogQueue'), enqueue: jest.fn() }));
jest.mock('../../../services/foodLogSync', () => ({ notifyPendingFoodLogs: jest.fn() }));
jest.mock('../../../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
const mockStore = { selectedDate: '', setSelectedDate: jest.fn(), loadDayData: jest.fn(async () => undefined), refreshShownDay: jest.fn(),
  queuedFoods: [], sentFoods: [] };
jest.mock('../../../store/clientStore', () => ({
  useClientStore: Object.assign((pick?: (s: unknown) => unknown) => (pick ? pick(mockStore) : mockStore), { getState: () => mockStore }),
}));
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'client-1' }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));

import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';
import KitchenScreen from '../kitchen/KitchenScreen';
import { incomingLinkPath, resolveAppLink } from '../../../navigation/incomingLinks';
import { routeForDrop } from '../deliverables/dropRow';
import type { ClientTodayResponse, DailyMealPlanAssignmentWithPlan } from '../../../api/mealTemplatesApi';
import type { ScheduledDropView } from '../../../api/clientPaymentsApi';

jest.setTimeout(30_000);

const THIS_RUN = '3a1f0c52-7b4e-4d21-9c6a-0e5d8f2b1a01';
const NEXT_RUN = '3a1f0c52-7b4e-4d21-9c6a-0e5d8f2b1a02';
function run(id: string, name: string, meal: string, starts: string, ends: string | null): DailyMealPlanAssignmentWithPlan {
  return {
    id, daily_meal_plan_id: `plan-${id}`, client_id: 'client-1', assigned_by_coach_id: 'coach-1',
    starts_on: starts, ends_on: ends, created_at: '2026-11-01',
    daily_meal_plan: { id: `plan-${id}`, coach_id: 'coach-1', name, notes: null, created_at: '2026-11-01',
      archived_at: null, slots: [{ id: `slot-${id}`, daily_meal_plan_id: `plan-${id}`, meal_template_id: `m-${id}`,
        slot_label: 'dinner', order: 0, meal_template: { id: `m-${id}`, coach_id: 'coach-1', name: meal,
          calories_kcal: 600, protein_g: 40, carbs_g: 60, fats_g: 20, fiber_g: null, items: null,
          description: null, created_at: '2026-11-01', archived_at: null } }] },
  };
}
// The coach's two runs (Assign > Starts and Ends): this week's ends Friday 27 November, next week's starts the day after.
const THIS_WEEK = run(THIS_RUN, 'Cut, week 1', 'Chicken rice bowl', '2026-11-21', '2026-11-27');
const NEXT_WEEK = run(NEXT_RUN, 'Cut, week 2', 'Salmon and greens', '2026-11-28', null);

/** The server's own day (planDay() / todayUtcDate() on a TZ=UTC server) at the test's clock. */
const serverDay = () => new Date().toISOString().slice(0, 10);
const inForce = (a: DailyMealPlanAssignmentWithPlan, day: string) => a.starts_on <= day && (!a.ends_on || a.ends_on >= day);
let runs: DailyMealPlanAssignmentWithPlan[] = [];
/** Backend main's GET /me/meal-plan/today: ?date's day, or with no ?date the server's UTC day at the test's clock. */
function server(date?: string): ClientTodayResponse {
  const day = date ?? serverDay();
  return { date: day, assignments: runs.filter((a) => inForce(a, day)), changes_today: [] };
}
/** meal-plan-notice.ts:122-126, the link a notice carries: in force on the server's day -> tgp://meal-plan/<id>, else tgp://plan. */
const noticeLink = (id: string) => (server().assignments.some((a) => a.id === id) ? `tgp://meal-plan/${id}` : 'tgp://plan');
const mealOf = (a: DailyMealPlanAssignmentWithPlan) => a.daily_meal_plan.slots[0].meal_template.name;
/** The page's eyebrow for a day (ClientDailyMealPlanScreen longDay, the same formula in the same process). */
const longDay = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
const eyebrow = (day: string, herDay: string) => (day === herDay ? `Today, ${longDay(day)}` : longDay(day)).toUpperCase();

const PHONES = [
  { phone: '16:30 Friday in Los Angeles', zone: 'America/Los_Angeles', at: '2026-11-28T00:30:00Z', herDay: '2026-11-27',
    her: THIS_WEEK, herMeal: 'Chicken rice bowl', otherMeal: 'Salmon and greens' },
  { phone: '08:30 Saturday in Brisbane (UTC+10)', zone: 'Australia/Brisbane', at: '2026-11-27T22:30:00Z', herDay: '2026-11-28',
    her: NEXT_WEEK, herMeal: 'Salmon and greens', otherMeal: 'Chicken rice bowl' },
];
type Phone = (typeof PHONES)[number];
/** The control: 10:00 on Friday in Los Angeles, the server on the same day (18:00 UTC). */
const DAYTIME: Phone = { phone: '10:00 Friday in Los Angeles (the server on the same day)', zone: 'America/Los_Angeles',
  at: '2026-11-27T18:00:00Z', herDay: '2026-11-27', her: THIS_WEEK, herMeal: 'Chicken rice bowl', otherMeal: 'Salmon and greens' };

const RealDateTimeFormat = Intl.DateTimeFormat;
let zoneSpy: jest.SpyInstance | undefined;
function onPhone(p: Phone) {
  jest.useFakeTimers({ doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  jest.setSystemTime(new Date(p.at));
  zoneSpy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(((locale, options) =>
    new RealDateTimeFormat(locale, { ...options, timeZone: options?.timeZone ?? p.zone })) as typeof Intl.DateTimeFormat);
  mockStore.selectedDate = p.herDay;
}

let client: QueryClient;
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
async function openPage(params: typeof mockParams) {
  mockParams = params;
  return render(wrap(<ClientDailyMealPlanScreen />));
}
/** Every plan read the screens made sent her day: none was left to the server's clock. */
const expectEveryReadHerDay = (p: Phone) => {
  expect(mockToday).toHaveBeenCalled();
  expect(mockToday.mock.calls.map((c) => c[0])).toEqual(mockToday.mock.calls.map(() => p.herDay));
};
const reads = () => mockToday.mock.calls.map((c) => c[0] as string | undefined);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockParams = undefined;
  runs = [NEXT_WEEK, THIS_WEEK];
  mockToday.mockReset().mockImplementation((date?: string) => Promise.resolve({ data: server(date) }));
  mockGetDaily.mockReset().mockResolvedValue({ data: { entries: [] } });
  mockLogFood.mockReset().mockResolvedValue({ data: { id: 'entry-1' } });
  mockCreateFood.mockReset().mockResolvedValue({ data: { id: 'food-1' } });
  mockNav.navigate.mockClear();
  (jest.requireMock('@react-native-community/netinfo') as { __reset: () => void }).__reset();
});
afterEach(() => {
  client.clear();
  zoneSpy?.mockRestore();
  jest.useRealTimers();
});

describe.each(PHONES)('$phone', (p) => {
  beforeEach(() => onPhone(p));

  it('More > Meal plan shows her day\'s plan under "Today\'s meals"', async () => {
    await openPage(undefined);
    expect(await screen.findByText(p.herMeal)).toBeTruthy();
    expect(screen.getByText("Today's meals")).toBeTruthy();
    expect(screen.queryByText(p.otherMeal)).toBeNull();
    expectEveryReadHerDay(p);
  });

  it('the Kitchen card shows her day\'s meal, and the page it opens shows the same plan', async () => {
    const view = await render(wrap(<KitchenScreen />));
    const card = await screen.findByTestId('kitchen-plan-card');
    expect(within(card).getByText(p.herMeal)).toBeTruthy();
    await fireEvent.press(card);
    expect(mockNav.navigate).toHaveBeenCalledTimes(1);
    const [route, params] = mockNav.navigate.mock.calls[0] as [string, typeof mockParams];
    expect(route).toBe('ClientDailyMealPlan');
    expect(params).toBeUndefined(); // the Kitchen card's door is More's: no date and no plan id
    mockParams = params;
    await view.rerender(wrap(<ClientDailyMealPlanScreen />));
    expect(await screen.findByText(p.herMeal)).toBeTruthy();
    expect(screen.queryByText(p.otherMeal)).toBeNull();
    expectEveryReadHerDay(p);
  });

  it('a notice about her day\'s plan carries the link the server sends at this clock and opens her day\'s plan', async () => {
    const link = noticeLink(p.her.id); // LO N1 and LS N1: the server's own link rule, not a link it never sends
    const target = resolveAppLink(incomingLinkPath(link) as string, 'student');
    expect(target?.screen).toBe('ClientDailyMealPlan');
    await openPage(target?.params);
    expect(await screen.findByText(p.herMeal)).toBeTruthy();
    expect(screen.queryByTestId('meal-plan-ended')).toBeNull();
    expect(screen.queryByText(p.otherMeal)).toBeNull();
    expect(screen.getByText(eyebrow(p.herDay, p.herDay))).toBeTruthy();
    // Her day's plan is not in force on the server's day at either clock, so the server links tgp://plan.
    expect(link).toBe('tgp://plan');
    expectEveryReadHerDay(p);
  });

  it('"Ate it as planned" logs her day\'s meal, linked to its plan meal, to her day', async () => {
    await openPage(undefined);
    expect(await screen.findByText('Ate it as planned')).toBeTruthy();
    await fireEvent.press(await screen.findByLabelText(`Log this meal: ${p.herMeal}`));
    await waitFor(() => expect(mockLogFood).toHaveBeenCalledTimes(1));
    expect(mockCreateFood).toHaveBeenCalledWith(expect.objectContaining({ name: p.herMeal }));
    expect(mockLogFood).toHaveBeenCalledWith(expect.objectContaining({ date: p.herDay, plan_slot_id: `slot-${p.her.id}` }));
    expectEveryReadHerDay(p);
  });
});

/**
 * FIX-MLD-1 (B1), class-first (R24): every door that opens the page by plan id with no date (routeForDrop for the
 * Deliverables and purchase rows; incomingLinks.ts for tgp://meal-plan/<id>), at three clocks. The plan opens; it shows
 * under her day when her day holds it, else under the day the no-date answer names (the dated view: no "Today", no
 * "Ate it as planned", that day's log); and the no-date read happens only then.
 */
const BOUGHT = '3a1f0c52-7b4e-4d21-9c6a-0e5d8f2b1a03';
const ONE_DAY = '3a1f0c52-7b4e-4d21-9c6a-0e5d8f2b1a04';
type Door = [name: string, plan: () => DailyMealPlanAssignmentWithPlan, door: (a: DailyMealPlanAssignmentWithPlan) => typeof mockParams];
const viaDeliverables = (a: DailyMealPlanAssignmentWithPlan) => {
  const drop = { id: 'drop-1', asset_type: 'meal_plan', asset_id: a.daily_meal_plan_id, status: 'fired', materialised_ref: a.id } as ScheduledDropView;
  const navigate = jest.fn();
  routeForDrop(drop, { navigate } as never);
  expect(navigate).toHaveBeenCalledWith('ClientDailyMealPlan', { assignmentId: a.id });
  return navigate.mock.calls[0][1] as typeof mockParams;
};
const viaNotice = (a: DailyMealPlanAssignmentWithPlan) => {
  const target = resolveAppLink(incomingLinkPath(noticeLink(a.id)) as string, 'student');
  expect(target?.screen).toBe('ClientDailyMealPlan');
  return target?.params as typeof mockParams;
};
const bought = () => run(BOUGHT, 'Lean start', 'Turkey chilli', serverDay(), null); // meal-plan.resolver.ts: starts_on = todayUtcDate()
const DOORS: Door[] = [
  ['the plan she bought now, from its Deliverables or purchase row (routeForDrop)', bought, viaDeliverables],
  ['a notice about this week\'s plan', () => THIS_WEEK, viaNotice],
  ['a notice about next week\'s plan', () => NEXT_WEEK, viaNotice],
];

describe.each([...PHONES, DAYTIME])('FIX-MLD-1 B1, $phone', (p) => {
  beforeEach(() => onPhone(p));

  it.each(DOORS)('%s opens that plan (by its id), or her day\'s plan when the server sent tgp://plan', async (_name, planOf, door) => {
    const plan = planOf();
    runs = [NEXT_WEEK, THIS_WEEK, plan].filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i);
    const params = door(plan);
    const byId = !!params?.assignmentId;
    expect(byId).toBe(params === undefined ? false : inForce(plan, serverDay())); // the id only for a plan in force on the server's day
    const fallback = byId && !inForce(plan, p.herDay);
    const day = fallback ? serverDay() : p.herDay;
    await openPage(params);
    expect(await screen.findByText(mealOf(byId ? plan : p.her))).toBeTruthy();
    expect(screen.queryByTestId('meal-plan-ended')).toBeNull();
    expect(screen.getByText(eyebrow(day, p.herDay))).toBeTruthy();
    await settle();
    // Her day first; the no-date read (the server's own day) only for a plan-id door whose plan her day lacks.
    expect(reads()).toEqual(fallback ? [p.herDay, undefined] : [p.herDay]);
    if (fallback) {
      expect(day).not.toBe(p.herDay);
      expect(screen.queryByText('Ate it as planned')).toBeNull(); // the dated view logs nothing as planned
      expect(screen.queryByTestId('daily-meal-plan-now')).toBeNull();
      await waitFor(() => expect(mockGetDaily).toHaveBeenCalledWith(day)); // its checklist reads that day's log
    }
  });

  it('a plan-id door whose plan neither answer holds keeps main\'s card, after both reads', async () => {
    const ended = run(ONE_DAY, 'Old plan', 'Lentil soup', '2026-11-01', '2026-11-10');
    runs = [NEXT_WEEK, THIS_WEEK, ended];
    await openPage(viaDeliverables(ended));
    expect(await screen.findByTestId('meal-plan-ended')).toBeTruthy();
    expect(screen.getByText('This plan is not available for this day')).toBeTruthy();
    await settle();
    expect(reads()).toEqual([p.herDay, undefined]);
  });
});

describe.each(PHONES)('FIX-MLD-1, the plain doors read her day only: $phone', (p) => {
  beforeEach(() => onPhone(p));

  // A plan in force on the server's day only (her tomorrow in Los Angeles, her yesterday in Brisbane): her day has none.
  it.each([
    ['More > Meal plan', () => undefined],
    ['the Kitchen card (the same door, no params)', () => undefined],
    ['tgp://plan', () => resolveAppLink(incomingLinkPath('tgp://plan') as string, 'student')?.params as typeof mockParams],
  ])('%s, with no plan on her day: "No plan for today" after exactly one read, for her day', async (_name, paramsOf) => {
    runs = [run(ONE_DAY, 'One-day plan', 'Lentil soup', serverDay(), serverDay())];
    expect(inForce(runs[0], p.herDay)).toBe(false);
    await openPage(paramsOf());
    expect(await screen.findByText('No plan for today')).toBeTruthy();
    await settle();
    await settle();
    expect(reads()).toEqual([p.herDay]);
    expect(screen.queryByText('Lentil soup')).toBeNull();
  });
});

/**
 * Class-first (R24): every phone read of a day's plan, and the day it sends. A new caller must be added here with the
 * day it sends. Only the meal plan page's plan-id door may leave the day to the server, and only while her day's
 * answer lacks its plan (`useMealPlanToday(null, askServer)`, FIX-MLD-1); mealTemplatesApi.todayForClient's day is optional.
 */
const SRC = path.resolve(__dirname, '..', '..', '..');
const PLAN_READS: Array<[file: string, call: string]> = [
  ['components/log/FoodDayView.tsx', 'todayForClient(p.selectedDate)'],
  ['hooks/useMealTemplates.ts', 'todayForClient(dateIso ?? undefined)'],
  ['screens/client/ClientDailyMealPlanScreen.tsx', 'useMealPlanToday(dateParam ?? today)'],
  ['screens/client/ClientDailyMealPlanScreen.tsx', 'useMealPlanToday(null, askServer)'],
  ['screens/client/foodweek/FoodWeekScreen.tsx', 'todayForClient(day)'],
  ['screens/client/kitchen/KitchenScreen.tsx', 'todayForClient(today)'],
  ['screens/client/mealplan/PlanMealScreen.tsx', 'todayForClient(date)'],
];
function planReadsInSource(): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(full); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      fs.readFileSync(full, 'utf8').split('\n').forEach((line) => {
        const code = line.trim();
        if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*') || code.startsWith('export function')) return;
        for (const m of code.matchAll(/\b(?:todayForClient|useMealPlanToday)\([^)]*\)/g)) {
          found.push([path.relative(SRC, full).split(path.sep).join('/'), m[0]]);
        }
      });
    }
  };
  walk(SRC);
  return found.sort((a, b) => a[0].localeCompare(b[0]));
}

it('class-first: every plan read in the app sends a day (the table above is the whole list)', () => {
  expect(planReadsInSource()).toEqual(PLAN_READS);
});
