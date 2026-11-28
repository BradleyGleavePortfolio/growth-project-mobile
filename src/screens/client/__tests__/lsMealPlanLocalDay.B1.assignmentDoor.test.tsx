/**
 * LS-MEALPLAN-LOCAL-DAY-M-1 B1 (B-TEST, fails at b81f274b, passes at main 73d77a42): a plan the server put on its own
 * (UTC) day still opens by its assignment id.
 *
 * Two doors open the meal plan page by assignment id with no date, and both name an assignment the SERVER chose by its
 * own day, which is her tomorrow every evening in the Americas:
 *  - a delivered meal plan (a package bought in the evening): backend main's MealPlanAssetResolver stamps the new
 *    assignment's starts_on with todayUtcDate() (packages/asset-resolvers/meal-plan.resolver.ts:110 and :144, at
 *    checkout and on each drip), and the Deliverables and purchase rows open it with { assignmentId }
 *    (deliverables/dropRow.tsx:226-230, routeForDrop);
 *  - her coach's "New meal plan" notice: the link is tgp://meal-plan/<id> when the assignment is in force on the
 *    server's day (real-meal-plans/meal-plan-notice.ts:13-15, inForceToday with planDay()), so a plan starting
 *    tomorrow, assigned in her evening, gets its own link (incomingLinks.ts:61 -> { assignmentId }).
 * At the head the page reads her day only (ClientDailyMealPlanScreen.tsx:120-122), the assignment is not in force on
 * it, and the page shows "This plan is not available for this day" until her midnight. Main read the server's day and
 * showed the plan. The fake server answers as backend main does: ?date's day, or with no ?date the server's UTC day.
 * Phone: 18:30 on Friday 27 November in America/Los_Angeles (UTC is already Saturday 28 November). Names are fictional.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
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
jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: new Proxy({}, { get: () => jest.fn(async () => undefined) }),
}));
let mockParams: { date?: string; assignmentId?: string } | undefined;
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: mockParams }),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useFocusEffect: () => undefined,
}));
jest.mock('../../../hooks/useMacros', () => ({ useCurrentMacrosForSelf: () => ({ data: null }) }));
const mockToday = jest.fn();
jest.mock('../../../api/mealTemplatesApi', () => ({
  SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack', 'preworkout', 'postworkout'],
  mealTemplatesApi: { todayForClient: (date?: string) => mockToday(date) },
}));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: () => Promise.resolve({ data: [] }), post: jest.fn() },
  logApi: { getDaily: () => Promise.resolve({ data: { entries: [] } }), logFood: jest.fn(), deleteEntry: jest.fn() },
  foodApi: { create: jest.fn() },
}));
jest.mock('../../../services/foodLogQueue', () => ({ ...jest.requireActual('../../../services/foodLogQueue'), enqueue: jest.fn() }));
jest.mock('../../../services/foodLogSync', () => ({ notifyPendingFoodLogs: jest.fn() }));
jest.mock('../../../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
const mockStore = { selectedDate: '2026-11-27', queuedFoods: [], sentFoods: [] };
jest.mock('../../../store/clientStore', () => ({
  useClientStore: Object.assign((pick?: (s: unknown) => unknown) => (pick ? pick(mockStore) : mockStore), { getState: () => mockStore }),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));

import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';
import { routeForDrop } from '../deliverables/dropRow';
import { incomingLinkPath, resolveAppLink } from '../../../navigation/incomingLinks';
import type { ClientTodayResponse, DailyMealPlanAssignmentWithPlan } from '../../../api/mealTemplatesApi';
import type { ScheduledDropView } from '../../../api/clientPaymentsApi';

jest.setTimeout(30_000);

const KEPT = '5c2e8a10-4f6b-4a3d-8e1c-2b7d9f0a6c01';
const BOUGHT = '5c2e8a10-4f6b-4a3d-8e1c-2b7d9f0a6c02';
const NEW_PLAN = '5c2e8a10-4f6b-4a3d-8e1c-2b7d9f0a6c03';
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
// Her plan in force today; the package's plan, stamped with the server's UTC day at checkout; and a plan her coach
// assigned this evening to start tomorrow (Assign > Starts).
const RUNS = [
  run(KEPT, 'Everyday plan', 'Chicken rice bowl', '2026-11-01', null),
  run(BOUGHT, 'Lean start', 'Turkey chilli', '2026-11-28', null),
  run(NEW_PLAN, 'Cut, week 2', 'Salmon and greens', '2026-11-28', null),
];
const AT = '2026-11-28T02:30:00Z'; // 18:30 Friday 27 November in Los Angeles
const serverDay = () => new Date().toISOString().slice(0, 10);
/** Backend main's GET /me/meal-plan/today: ?date's day, or with no ?date the server's UTC day at the test's clock. */
function server(date?: string): ClientTodayResponse {
  const day = date ?? serverDay();
  const runs = RUNS.filter((a) => a.starts_on <= day && (!a.ends_on || a.ends_on >= day)).reverse();
  return { date: day, assignments: runs, changes_today: [] };
}
/** meal-plan-notice.ts's link rule: in force on the server's day -> tgp://meal-plan/<id>, else tgp://plan. */
const noticeLink = (id: string) => (server().assignments.some((a) => a.id === id) ? `tgp://meal-plan/${id}` : 'tgp://plan');

const RealDateTimeFormat = Intl.DateTimeFormat;
let zoneSpy: jest.SpyInstance | undefined;
let client: QueryClient;
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  jest.setSystemTime(new Date(AT));
  zoneSpy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(((locale, options) =>
    new RealDateTimeFormat(locale, { ...options, timeZone: options?.timeZone ?? 'America/Los_Angeles' })) as typeof Intl.DateTimeFormat);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockParams = undefined;
  mockToday.mockReset().mockImplementation((date?: string) => Promise.resolve({ data: server(date) }));
});
afterEach(() => {
  client.clear();
  zoneSpy?.mockRestore();
  jest.useRealTimers();
});

async function openPage(params: typeof mockParams) {
  mockParams = params;
  return render(<QueryClientProvider client={client}><ClientDailyMealPlanScreen /></QueryClientProvider>);
}

it('a meal plan bought this evening opens from its Deliverables row (assignment id), not "not available"', async () => {
  const drop = { id: 'drop-1', asset_type: 'meal_plan', asset_id: `plan-${BOUGHT}`, status: 'fired', materialised_ref: BOUGHT } as ScheduledDropView;
  const navigate = jest.fn();
  routeForDrop(drop, { navigate } as never);
  expect(navigate).toHaveBeenCalledWith('ClientDailyMealPlan', { assignmentId: BOUGHT });
  await openPage(navigate.mock.calls[0][1]);
  expect(await screen.findByText('Turkey chilli')).toBeTruthy();
  expect(screen.queryByTestId('meal-plan-ended')).toBeNull();
});

it('her coach\'s "New meal plan" notice, sent this evening for a plan starting tomorrow, opens that plan', async () => {
  const link = noticeLink(NEW_PLAN);
  expect(link).toBe(`tgp://meal-plan/${NEW_PLAN}`); // the server's own day already holds it
  const target = resolveAppLink(incomingLinkPath(link) as string, 'student');
  expect(target?.screen).toBe('ClientDailyMealPlan');
  await openPage(target?.params);
  expect(await screen.findByText('Salmon and greens')).toBeTruthy();
  expect(screen.queryByTestId('meal-plan-ended')).toBeNull();
});
