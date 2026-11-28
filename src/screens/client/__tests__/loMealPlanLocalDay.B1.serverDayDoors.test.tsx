/**
 * LO-MEALPLAN-LOCAL-DAY-M-1 B1 (lens B-TEST, m#1038): a door the server opens by ITS day must still open.
 *
 * Two server rules pick the assignment a door names by the server's own day (TZ=UTC), not hers:
 *  - a package's meal plan is delivered as an assignment that starts on the server's UTC day
 *    (packages/asset-resolvers/meal-plan.resolver.ts materialise: starts_on = todayUtcDate()), and the Deliverables
 *    row opens it by id (deliverables/dropRow.tsx routeForDrop: { assignmentId });
 *  - a meal plan notice links tgp://meal-plan/<id> when that assignment is in force on the server's day
 *    (real-meal-plans/meal-plan-notice.ts tellMealPlanChange: inForceToday, planDay() with no date).
 * From 16:30 on Friday in Los Angeles the server's day is already Saturday. The page now reads her day (Friday), so an
 * assignment that starts on the server's Saturday is not in her day's answer, and both doors open "This plan is not
 * available for this day". Before m#1038 the page read the server's day and opened the plan she bought or was told of.
 * A Brisbane morning (UTC+10, the server still on Friday) is the control: there the server's day is before hers.
 *
 * Real: ClientDailyMealPlanScreen, useMealPlanToday, routeForDrop and the notice link rules (incomingLinkPath,
 * resolveAppLink). Fake server: backend main's GET /me/meal-plan/today (in force on ?date's day, or with no ?date on the
 * server's UTC day). Every switch is on. Names and ids are fictional.
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
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' }, NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: new Proxy({}, { get: () => jest.fn(async () => undefined) }),
}));
let mockParams: { date?: string; assignmentId?: string } | undefined;
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: mockParams }),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), getParent: jest.fn(), addListener: jest.fn(() => () => undefined) }),
  useFocusEffect: () => undefined,
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1', coach_id: 'coach-1' }) }));
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
const mockStore = { selectedDate: '', setSelectedDate: jest.fn(), loadDayData: jest.fn(async () => undefined), refreshShownDay: jest.fn(),
  queuedFoods: [], sentFoods: [] };
jest.mock('../../../store/clientStore', () => ({
  useClientStore: Object.assign((pick?: (s: unknown) => unknown) => (pick ? pick(mockStore) : mockStore), { getState: () => mockStore }),
}));
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'client-1' }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));

import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';
import { routeForDrop } from '../deliverables/dropRow';
import { incomingLinkPath, resolveAppLink } from '../../../navigation/incomingLinks';
import type { ClientTodayResponse, DailyMealPlanAssignmentWithPlan } from '../../../api/mealTemplatesApi';
import type { ScheduledDropView } from '../../../api/clientPaymentsApi';

jest.setTimeout(30_000);

const DELIVERED = '7c2e9d41-5a3b-4f10-8e6d-2b9a0c4d1e01';
const ASSIGNED = '7c2e9d41-5a3b-4f10-8e6d-2b9a0c4d1e02';
function run(id: string, name: string, meal: string, starts: string): DailyMealPlanAssignmentWithPlan {
  return {
    id, daily_meal_plan_id: `plan-${id}`, client_id: 'client-1', assigned_by_coach_id: 'coach-1',
    starts_on: starts, ends_on: null, created_at: starts,
    daily_meal_plan: { id: `plan-${id}`, coach_id: 'coach-1', name, notes: null, created_at: starts,
      archived_at: null, slots: [{ id: `slot-${id}`, daily_meal_plan_id: `plan-${id}`, meal_template_id: `m-${id}`,
        slot_label: 'dinner', order: 0, meal_template: { id: `m-${id}`, coach_id: 'coach-1', name: meal,
          calories_kcal: 600, protein_g: 40, carbs_g: 60, fats_g: 20, fiber_g: null, items: null,
          description: null, created_at: starts, archived_at: null } }] },
  };
}

/** The server's own day (planDay() / todayUtcDate() on a TZ=UTC server) at the test's clock. */
const serverDay = () => new Date().toISOString().slice(0, 10);
let runs: DailyMealPlanAssignmentWithPlan[] = [];
/** Backend main's GET /me/meal-plan/today: in force on ?date's day, or with no ?date on the server's day. */
function server(date?: string): ClientTodayResponse {
  const day = date ?? serverDay();
  return { date: day, assignments: runs.filter((a) => a.starts_on <= day && (!a.ends_on || a.ends_on >= day)), changes_today: [] };
}

const PHONES = [
  { phone: '16:30 Friday in Los Angeles (server already on Saturday)', zone: 'America/Los_Angeles', at: '2026-11-28T00:30:00Z' },
  { phone: '08:30 Saturday in Brisbane (server still on Friday; control)', zone: 'Australia/Brisbane', at: '2026-11-27T22:30:00Z' },
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
}

let client: QueryClient;
async function openPage(params: typeof mockParams) {
  mockParams = params;
  return render(<QueryClientProvider client={client}><ClientDailyMealPlanScreen /></QueryClientProvider>);
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockParams = undefined;
  runs = [];
  mockToday.mockReset().mockImplementation((date?: string) => Promise.resolve({ data: server(date) }));
  (jest.requireMock('@react-native-community/netinfo') as { __reset: () => void }).__reset();
});
afterEach(() => {
  client.clear();
  zoneSpy?.mockRestore();
  jest.useRealTimers();
});

describe.each(PHONES)('$phone', (p) => {
  beforeEach(() => onPhone(p));

  it('the meal plan she just bought opens from its Deliverables row, not "This plan is not available for this day"', async () => {
    // The checkout's day-0 drop fires now: meal-plan.resolver.ts starts the assignment on the server's day.
    runs = [run(DELIVERED, 'Package bulk plan', 'Turkey chilli', serverDay())];
    const drop: ScheduledDropView = {
      id: 'drop-1', asset_type: 'meal_plan', asset_id: `plan-${DELIVERED}`, asset_revision_id: null, cadence_kind: 'immediate',
      display_title: 'Package bulk plan', display_caption: null, fire_at: p.at, fired_at: p.at, status: 'fired', materialised_ref: DELIVERED,
    };
    const navigate = jest.fn();
    routeForDrop(drop, { navigate } as unknown as Parameters<typeof routeForDrop>[1]);
    expect(navigate).toHaveBeenCalledWith('ClientDailyMealPlan', { assignmentId: DELIVERED });
    await openPage(navigate.mock.calls[0][1]);
    expect(await screen.findByText('Turkey chilli')).toBeTruthy();
    expect(screen.queryByTestId('meal-plan-ended')).toBeNull();
  });

  it('a "New meal plan" notice the server linked to that plan (tgp://meal-plan/:id) opens it', async () => {
    // Her coach assigns next week's plan to start on the server's day; tellMealPlanChange links it by id because it
    // is in force on the server's day (inForceToday).
    runs = [run(ASSIGNED, 'Cut, week 2', 'Salmon and greens', serverDay())];
    const inForceOnServerDay = server().assignments.some((a) => a.id === ASSIGNED);
    expect(inForceOnServerDay).toBe(true);
    const target = resolveAppLink(incomingLinkPath(`tgp://meal-plan/${ASSIGNED}`) as string, 'student');
    expect(target?.screen).toBe('ClientDailyMealPlan');
    await openPage(target?.params);
    expect(await screen.findByText('Salmon and greens')).toBeTruthy();
    expect(screen.queryByTestId('meal-plan-ended')).toBeNull();
  });
});
