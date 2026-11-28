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
 * Real: ClientDailyMealPlanScreen, KitchenScreen, useMealPlanToday, useTodayLog, LogPlannedMealButton with logSubmit,
 * and the notice link rules (incomingLinkPath, resolveAppLink). Stubbed: the HTTP edge (services/api,
 * mealTemplatesApi), navigation, the theme, icons and haptics. Every switch is on. Names and ids are fictional.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
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
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: (url: string) => Promise.resolve({ data: url === '/v1/clients/me/coach' ? { name: 'Sam Rivera' } : [] }),
    post: jest.fn(),
  },
  logApi: {
    getDaily: () => Promise.resolve({ data: { entries: [] } }),
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
import type { ClientTodayResponse, DailyMealPlanAssignmentWithPlan } from '../../../api/mealTemplatesApi';

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

/** Backend main's GET /me/meal-plan/today: ?date's day, or with no ?date the server's UTC day at the test's clock. */
function server(date?: string): ClientTodayResponse {
  const day = date ?? new Date().toISOString().slice(0, 10);
  const runs = [NEXT_WEEK, THIS_WEEK].filter((a) => a.starts_on <= day && (!a.ends_on || a.ends_on >= day));
  return { date: day, assignments: runs, changes_today: [] };
}

const PHONES = [
  { phone: '16:30 Friday in Los Angeles', zone: 'America/Los_Angeles', at: '2026-11-28T00:30:00Z', herDay: '2026-11-27',
    her: THIS_WEEK, herMeal: 'Chicken rice bowl', otherMeal: 'Salmon and greens' },
  { phone: '08:30 Saturday in Brisbane (UTC+10)', zone: 'Australia/Brisbane', at: '2026-11-27T22:30:00Z', herDay: '2026-11-28',
    her: NEXT_WEEK, herMeal: 'Salmon and greens', otherMeal: 'Chicken rice bowl' },
];
type Phone = (typeof PHONES)[number];

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

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockParams = undefined;
  mockToday.mockReset().mockImplementation((date?: string) => Promise.resolve({ data: server(date) }));
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
    mockParams = params;
    await view.rerender(wrap(<ClientDailyMealPlanScreen />));
    expect(await screen.findByText(p.herMeal)).toBeTruthy();
    expect(screen.queryByText(p.otherMeal)).toBeNull();
    expectEveryReadHerDay(p);
  });

  it.each([
    ['her plan\'s notice (tgp://meal-plan/:id)', (q: Phone) => `tgp://meal-plan/${q.her.id}`],
    ['tgp://plan', () => 'tgp://plan'],
  ])('a notice link, %s, opens her day\'s plan', async (_name, link) => {
    const target = resolveAppLink(incomingLinkPath(link(p)) as string, 'student');
    expect(target?.screen).toBe('ClientDailyMealPlan');
    await openPage(target?.params);
    expect(await screen.findByText(p.herMeal)).toBeTruthy();
    expect(screen.queryByTestId('meal-plan-ended')).toBeNull();
    expect(screen.queryByText(p.otherMeal)).toBeNull();
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
 * Class-first (R24): every phone read of a day's plan, and the day it sends. A new caller must be added here with the
 * day it sends; none may leave the day to the server (mealTemplatesApi.todayForClient's day is optional).
 */
const SRC = path.resolve(__dirname, '..', '..', '..');
const PLAN_READS: Array<[file: string, call: string]> = [
  ['components/log/FoodDayView.tsx', 'todayForClient(p.selectedDate)'],
  ['hooks/useMealTemplates.ts', 'todayForClient(dateIso)'],
  ['screens/client/ClientDailyMealPlanScreen.tsx', 'useMealPlanToday(dateParam ?? today)'],
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
