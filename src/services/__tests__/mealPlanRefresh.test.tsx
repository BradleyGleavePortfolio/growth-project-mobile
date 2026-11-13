/**
 * MEAL-PLAN-REFRESH-M (LO-1250R1 C2 = LS-1250R1 C6): a meal plan notice, received or tapped, refreshes the
 * client's cached plan, and the plan screen never shows "This plan is not available for this day" from an answer
 * read before it was asked for that assignment.
 *
 * Real pieces: the ClientDailyMealPlanScreen, the app's queryClient singleton, useMealPlanToday, pushTapRouter
 * (driven through a fake navigator), installNotificationResponseHandler (live and cold start),
 * installForegroundHandler's received listener and routeNotification (the inbox row). Stubbed: the HTTP read
 * (mealTemplatesApi.todayForClient, answered by hand), expo-notifications, the route params, icons and the theme.
 * The Food day's plan read is a stand-in with FoodDayView.tsx:154-159's key, read and staleTime.
 * The push data is b#1250's (CONTRACT 6846889982 item 4): { actionScreen: 'NotificationCenter', deepLink, kind }.
 * Ids and names are fictional.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, dehydrate, hydrate, useQuery } from '@tanstack/react-query';

const mockAddResponse = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
const mockAddReceived = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
const mockGetLast = jest.fn(() => Promise.resolve(null as unknown));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: (cb: unknown) => mockAddReceived(cb),
  addNotificationResponseReceivedListener: (cb: unknown) => mockAddResponse(cb),
  getLastNotificationResponseAsync: () => mockGetLast(),
  clearLastNotificationResponseAsync: () => Promise.resolve(),
  AndroidImportance: { MAX: 5 },
}));
jest.mock('../api', () => ({ __esModule: true, default: {}, logApi: {} }));
const mockToday = jest.fn();
jest.mock('../../api/mealTemplatesApi', () => ({
  SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack', 'preworkout', 'postworkout'],
  mealTemplatesApi: { todayForClient: (date?: string) => mockToday(date) },
}));
let mockParams: { date?: string; assignmentId?: string } | undefined;
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: mockParams }),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useFocusEffect: () => undefined,
}));
jest.mock('../../theme/ThemeProvider', () => {
  const sc = jest.requireActual('../../theme/tokens').lightTokens;
  return { useTheme: () => ({ semanticColors: sc, colors: { ...sc, background: sc.bgPrimary,
    primary: sc.accent, surface: sc.bgSurface, textSecondary: sc.textMuted } }) };
});
jest.mock('@expo/vector-icons', () => {
  const Icon = () => null;
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const R = require('react');
  return { __esModule: true, default: (props: object) => R.createElement(require('react-native').View, props) };
});
jest.mock('../../components/HapticPressable', () => require('react-native').Pressable);

import ClientDailyMealPlanScreen from '../../screens/client/ClientDailyMealPlanScreen';
import { routeNotification } from '../../screens/notifications/NotificationCenterScreen';
import type { AppNotification } from '../notificationsApi';
import type { ClientTodayResponse, DailyMealPlanAssignmentWithPlan } from '../../api/mealTemplatesApi';
import { queryClient } from '../queryClient';
import { installForegroundHandler, installNotificationResponseHandler } from '../pushNotifications';
import {
  __resetPushTapRouterForTests,
  attachPushNavigator,
  routePushTap,
  setPushSession,
  type PushSession,
} from '../pushTapRouter';
import { getTodayString } from '../../utils/date';

jest.setTimeout(30_000);

const A1 = '5f0c8e2a-1b3d-4c5e-8f70-a1b2c3d4e5f1';
const A2 = '6e1d9f3b-2c4e-4d6f-9a81-b2c3d4e5f6a2';
const WORKOUT = '7d2e0a4c-3d5f-4e7a-8b92-c3d4e5f6a7b3';
const CLIENT = { kind: 'app', userId: 'client-1', role: 'student' } as const satisfies PushSession;
const COACH = { kind: 'app', userId: 'coach-1', role: 'coach' } as const satisfies PushSession;
const CLIENT_TABS = ['Home', 'WorkoutTab', 'Log', 'MoreTab', 'CommunityTab'];
const COACH_TABS = ['CommandCenter', 'ClientsStack', 'Templates', 'Messages', 'CommunityStack', 'SettingsStack'];
const SCREEN_KEY = ['meal-plan', 'today', null];
const MINUTE = 60_000;

function assignment(id: string, name: string): DailyMealPlanAssignmentWithPlan {
  return {
    id, daily_meal_plan_id: `plan-${id}`, client_id: 'client-1', assigned_by_coach_id: 'coach-1',
    starts_on: '2026-11-01', ends_on: null, created_at: '2026-11-01',
    daily_meal_plan: { id: `plan-${id}`, coach_id: 'coach-1', name, notes: null, created_at: '2026-11-01',
      archived_at: null, slots: [{ id: `slot-${id}`, daily_meal_plan_id: `plan-${id}`, meal_template_id: 'm-1',
        slot_label: 'lunch', order: 0, meal_template: { id: 'm-1', coach_id: 'coach-1', name: 'Rice bowl',
          calories_kcal: 500, protein_g: 30, carbs_g: 60, fats_g: 12, fiber_g: null, items: null,
          description: null, created_at: '2026-11-01', archived_at: null } }] },
  };
}
const answer = (...assignments: DailyMealPlanAssignmentWithPlan[]): ClientTodayResponse =>
  ({ date: getTodayString(), assignments });
const PLAN_ONE = answer(assignment(A1, 'Plan one'));
const PLAN_ONE_NEW = answer(assignment(A1, 'Plan one, new'));
const BOTH = answer(assignment(A2, 'Plan two'), assignment(A1, 'Plan one'));

/** Reads answered by hand: each call waits until the test releases (or fails) it. */
type Read = { date?: string; release: (a: ClientTodayResponse) => void; fail: () => void };
let reads: Read[] = [];
let failEveryRead = false;
function offline(): Error {
  return Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
}
mockToday.mockImplementation((date?: string) => {
  if (failEveryRead) return Promise.reject(offline());
  return new Promise((resolve, reject) => {
    reads.push({ date, release: (a) => resolve({ data: a }), fail: () => reject(offline()) });
  });
});
const screenReads = () => reads.filter((r) => r.date === undefined);
const dayReads = () => reads.filter((r) => r.date !== undefined);

/** The answer saved before the notice: read a minute ago unless a case says otherwise. */
function seed(key: readonly unknown[], data: ClientTodayResponse, age = MINUTE) {
  queryClient.setQueryData(key, data, { updatedAt: Date.now() - age });
}
/** The persisted cache as PersistedQueryCacheGate restores it (hydrate of a saved dehydrated client). */
function savedCache(data: ClientTodayResponse) {
  const saved = new QueryClient();
  saved.setQueryData(SCREEN_KEY, data, { updatedAt: Date.now() - MINUTE });
  const state = dehydrate(saved);
  saved.clear();
  return state;
}

const navigate = jest.fn();
function attach(routeNames = CLIENT_TABS) {
  attachPushNavigator({ isReady: () => true, navigate, getRootState: () => ({ routeNames, routes: [] }) } as never);
}
const pushData = (deepLink: string | undefined, kind = 'meal_plan_assigned') =>
  ({ actionScreen: 'NotificationCenter', ...(deepLink ? { deepLink } : {}), kind });
const response = (id: string, deepLink: string | undefined, kind?: string) =>
  ({ notification: { request: { identifier: id, content: { title: 'New meal plan', body: '', data: pushData(deepLink, kind) } } } });

/** The Food day's plan read (FoodDayView.tsx:154-159: same key, read and staleTime; enabled while coached). */
function FoodDayPlan({ day }: { day: string }) {
  useQuery({
    queryKey: ['meal-plan', 'today', day],
    queryFn: () => mockToday(day).then((r: { data: ClientTodayResponse }) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: true,
  });
  return null;
}

/** Where the router sent the client: the plan screen inside More, with the link's params. */
function landedParams(): { assignmentId?: string } | undefined {
  expect(navigate).toHaveBeenCalledTimes(1);
  const [root, nested] = navigate.mock.calls[0] as [string, { screen: string; params?: { assignmentId?: string } }];
  expect(root).toBe('MoreTab');
  expect(nested.screen).toBe('ClientDailyMealPlan');
  return nested.params;
}

async function openPlan(params: typeof mockParams, withFoodDay = false) {
  mockParams = params;
  return render(
    <QueryClientProvider client={queryClient}>
      <ClientDailyMealPlanScreen />
      {withFoodDay ? <FoodDayPlan day={getTodayString()} /> : null}
    </QueryClientProvider>,
  );
}
const refreshing = () => screen.getByTestId('daily-meal-plan-refresh').props.refreshing as boolean;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

/** While the read runs: the loading timeline, never "not available", and no pull spinner over it (R-d). */
function expectLoadingNotUnavailable() {
  expect(screen.getByTestId('daily-meal-plan-loading')).toBeTruthy();
  expect(screen.queryByTestId('meal-plan-ended')).toBeNull();
  expect(refreshing()).toBe(false);
}

let stops: (() => void)[] = [];
beforeEach(() => {
  queryClient.clear();
  __resetPushTapRouterForTests();
  reads = [];
  failEveryRead = false;
  mockParams = undefined;
  navigate.mockClear();
  mockToday.mockClear();
  mockAddResponse.mockClear();
  mockAddReceived.mockClear();
  mockGetLast.mockReset();
  mockGetLast.mockImplementation(() => Promise.resolve(null));
});
afterEach(() => {
  stops.forEach((stop) => stop());
  stops = [];
  queryClient.clear();
});

describe('a. "New meal plan" device tap', () => {
  it('opens on the loading timeline, reads once, then shows the new plan', async () => {
    seed(SCREEN_KEY, PLAN_ONE);
    attach();
    setPushSession(CLIENT);
    routePushTap('NotificationCenter', undefined, 'n-1', `tgp://meal-plan/${A2}`);
    await openPlan(landedParams());
    await waitFor(() => expect(screenReads()).toHaveLength(1));
    expectLoadingNotUnavailable();
    await act(async () => screenReads()[0].release(BOTH));
    expect(await screen.findByText('Plan two')).toBeTruthy();
    expect(screen.queryByTestId('meal-plan-ended')).toBeNull();
    await settle();
    expect(mockToday).toHaveBeenCalledTimes(1);
  });
});

describe('b. the inbox row', () => {
  it('routeNotification with the row link reads once and shows the new plan', async () => {
    seed(SCREEN_KEY, PLAN_ONE);
    attach();
    setPushSession(CLIENT);
    const row = { id: 'row-1', kind: 'system', title: 'New meal plan', body: '', read: false,
      createdAt: '2026-11-13T10:00:00Z', actionScreen: 'NotificationCenter', deepLink: `tgp://meal-plan/${A2}` } as AppNotification;
    routeNotification(row, { navigate: jest.fn() });
    await openPlan(landedParams());
    await waitFor(() => expect(screenReads()).toHaveLength(1));
    expectLoadingNotUnavailable();
    await act(async () => screenReads()[0].release(BOTH));
    expect(await screen.findByText('Plan two')).toBeTruthy();
    await settle();
    expect(mockToday).toHaveBeenCalledTimes(1);
  });
});

describe('c. cold start: the tap arrives before the saved cache is restored', () => {
  async function coldStart(id: string, link: string, kind: string, saved: ReturnType<typeof savedCache>) {
    mockGetLast.mockImplementation(() => Promise.resolve(response(id, link, kind)));
    stops.push(installNotificationResponseHandler(routePushTap));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    hydrate(queryClient, saved); // PersistedQueryCacheGate restores after the tap arrived
    attach();
    setPushSession(CLIENT);
  }

  it('c1 "New meal plan" (A2): loading, one read, then the new plan', async () => {
    await coldStart('n-c1', `tgp://meal-plan/${A2}`, 'meal_plan_assigned', savedCache(PLAN_ONE));
    await openPlan(landedParams());
    await waitFor(() => expect(screenReads()).toHaveLength(1));
    expectLoadingNotUnavailable();
    await act(async () => screenReads()[0].release(BOTH));
    expect(await screen.findByText('Plan two')).toBeTruthy();
    await settle();
    expect(mockToday).toHaveBeenCalledTimes(1);
  });

  it('c2 "Meal plan updated" (A1): the read happens and the old plan is gone once it lands', async () => {
    await coldStart('n-c2', `tgp://meal-plan/${A1}`, 'meal_plan_updated', savedCache(PLAN_ONE));
    await openPlan(landedParams());
    await waitFor(() => expect(screenReads()).toHaveLength(1));
    await act(async () => screenReads()[0].release(PLAN_ONE_NEW));
    expect(await screen.findByText('Plan one, new')).toBeTruthy();
    expect(screen.queryByText('Plan one')).toBeNull();
    await settle();
    expect(mockToday).toHaveBeenCalledTimes(1);
  });
});

describe('d. "Meal plan updated" device tap', () => {
  it('reads once and shows the changed plan', async () => {
    seed(SCREEN_KEY, PLAN_ONE);
    attach();
    setPushSession(CLIENT);
    stops.push(installNotificationResponseHandler(routePushTap));
    const tap = mockAddResponse.mock.calls[0][0] as (r: unknown) => void;
    tap(response('n-d', `tgp://meal-plan/${A1}`, 'meal_plan_updated'));
    await openPlan(landedParams());
    await waitFor(() => expect(screenReads()).toHaveLength(1));
    expect(screen.queryByTestId('meal-plan-ended')).toBeNull();
    await act(async () => screenReads()[0].release(PLAN_ONE_NEW));
    expect(await screen.findByText('Plan one, new')).toBeTruthy();
    expect(screen.queryByText('Plan one')).toBeNull();
    await settle();
    expect(mockToday).toHaveBeenCalledTimes(1);
  });
});

describe('e. tgp://plan tap', () => {
  it('the day re-reads (no assignmentId)', async () => {
    seed(SCREEN_KEY, PLAN_ONE);
    attach();
    setPushSession(CLIENT);
    routePushTap('NotificationCenter', undefined, 'n-e', 'tgp://plan');
    await openPlan(landedParams());
    await waitFor(() => expect(screenReads()).toHaveLength(1));
    await act(async () => screenReads()[0].release(BOTH));
    expect(await screen.findByText('Plan two')).toBeTruthy();
    await settle();
    expect(mockToday).toHaveBeenCalledTimes(1);
  });
});

function receive(id: string, deepLink: string | undefined, kind = 'meal_plan_updated') {
  stops.push(installForegroundHandler());
  const listener = mockAddReceived.mock.calls[mockAddReceived.mock.calls.length - 1][0] as (n: unknown) => void;
  return act(async () => listener(response(id, deepLink, kind).notification));
}

describe('f. received while the plan screen is open on A1', () => {
  it('the open screen re-reads once and shows the new plan in place', async () => {
    seed(SCREEN_KEY, PLAN_ONE);
    setPushSession(CLIENT);
    await openPlan({ assignmentId: A1 });
    expect(screen.getByText('Plan one')).toBeTruthy();
    await settle();
    expect(mockToday).not.toHaveBeenCalled();
    await receive('n-f', `tgp://meal-plan/${A1}`);
    await waitFor(() => expect(screenReads()).toHaveLength(1));
    // In place: the plan stays on screen while it reads (main's background refetch); never loading or "not available".
    expect(screen.getByText('Plan one')).toBeTruthy();
    expect(screen.queryByTestId('daily-meal-plan-loading')).toBeNull();
    expect(screen.queryByTestId('meal-plan-ended')).toBeNull();
    await act(async () => screenReads()[0].release(PLAN_ONE_NEW));
    expect(await screen.findByText('Plan one, new')).toBeTruthy();
    await settle();
    expect(mockToday).toHaveBeenCalledTimes(1);
  });
});

describe('g. received with the Food day for today mounted', () => {
  it('its own key re-reads once', async () => {
    const today = getTodayString();
    seed(['meal-plan', 'today', today], PLAN_ONE);
    setPushSession(CLIENT);
    await render(<QueryClientProvider client={queryClient}><FoodDayPlan day={today} /></QueryClientProvider>);
    await settle();
    expect(mockToday).not.toHaveBeenCalled();
    await receive('n-g', `tgp://meal-plan/${A2}`, 'meal_plan_assigned');
    await waitFor(() => expect(dayReads()).toHaveLength(1));
    expect(dayReads()[0].date).toBe(today);
    await act(async () => dayReads()[0].release(BOTH));
    await settle();
    expect(mockToday).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData<ClientTodayResponse>(['meal-plan', 'today', today])?.assignments).toHaveLength(2);
  });
});

describe('h. negatives: a stray refresh would show as a read', () => {
  async function planAndFoodDayOpen(session: PushSession = CLIENT, tabs = CLIENT_TABS) {
    seed(SCREEN_KEY, PLAN_ONE);
    seed(['meal-plan', 'today', getTodayString()], PLAN_ONE);
    attach(tabs);
    setPushSession(session);
    await openPlan({ assignmentId: A1 }, true);
    expect(screen.getByText('Plan one')).toBeTruthy();
    await settle();
    expect(mockToday).not.toHaveBeenCalled();
  }
  const noRead = async () => { await settle(); await settle(); expect(mockToday).not.toHaveBeenCalled(); };

  it.each([
    ['a workout link', `tgp://workouts/${WORKOUT}`],
    ['a Messages link', 'tgp://messages'],
  ])('a tap whose link opens anything else (%s) re-reads nothing', async (_name, link) => {
    await planAndFoodDayOpen();
    routePushTap('NotificationCenter', undefined, 'x-1', link);
    expect(navigate).toHaveBeenCalledTimes(1);
    await noRead();
  });

  it('a Messages push with no link re-reads nothing', async () => {
    await planAndFoodDayOpen();
    routePushTap('Messages', undefined, 'x-2');
    expect(navigate).toHaveBeenCalledTimes(1);
    await noRead();
  });

  it('an inbox row whose link opens a workout re-reads nothing', async () => {
    await planAndFoodDayOpen();
    routeNotification({ id: 'row-2', kind: 'system', title: 'Workout', body: '', read: false,
      createdAt: '2026-11-13T10:00:00Z', deepLink: `tgp://workouts/${WORKOUT}` } as AppNotification, { navigate: jest.fn() });
    await noRead();
  });

  it.each([
    ['a workout link', `tgp://workouts/${WORKOUT}`],
    ['a Messages link', 'tgp://messages'],
    ['no link', undefined],
  ])('a push received with %s re-reads nothing', async (_name, link) => {
    await planAndFoodDayOpen();
    await receive('x-3', link, 'message_received');
    await noRead();
  });

  it('a meal plan tap while signed out re-reads nothing and opens nothing', async () => {
    await planAndFoodDayOpen();
    setPushSession({ kind: 'signedOut' });
    routePushTap('NotificationCenter', undefined, 'x-4', `tgp://meal-plan/${A2}`);
    expect(navigate).not.toHaveBeenCalled();
    await noRead();
  });

  it('a meal plan tap in a coach session re-reads nothing (no coach route for the link)', async () => {
    await planAndFoodDayOpen(COACH, COACH_TABS);
    routePushTap('NotificationCenter', undefined, 'x-5', `tgp://meal-plan/${A2}`);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0][1]).not.toEqual(expect.objectContaining({ screen: 'ClientDailyMealPlan' }));
    await noRead();
  });

  it('More > Meal plan opened inside the 5 minutes with no notice re-reads nothing', async () => {
    seed(SCREEN_KEY, PLAN_ONE);
    await openPlan(undefined);
    expect(screen.getByText('Plan one')).toBeTruthy();
    await noRead();
    expect(refreshing()).toBe(false);
  });

  it('one notification delivered twice (cold-start replay and the live listener) refreshes once', async () => {
    await planAndFoodDayOpen();
    const tapped = response('n-twice', `tgp://meal-plan/${A1}`, 'meal_plan_updated');
    mockGetLast.mockImplementation(() => Promise.resolve(tapped));
    stops.push(installNotificationResponseHandler(routePushTap));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const live = mockAddResponse.mock.calls[0][0] as (r: unknown) => void;
    live(tapped);
    await settle();
    expect(navigate).toHaveBeenCalledTimes(1);
    // One refresh: each open read (the plan screen's and the Food day's) once.
    await waitFor(() => expect(mockToday).toHaveBeenCalledTimes(2));
    expect(screenReads()).toHaveLength(1);
    expect(dayReads()).toHaveLength(1);
    await act(async () => { reads.forEach((r) => r.release(PLAN_ONE_NEW)); });
    await settle();
    expect(mockToday).toHaveBeenCalledTimes(2);
  });
});

describe('i. the screen rule alone (no notice)', () => {
  it('i1 the Deliverables row opens A2 over a cached answer lacking it: loading, one read, then A2', async () => {
    seed(SCREEN_KEY, PLAN_ONE);
    await openPlan({ assignmentId: A2 });
    await waitFor(() => expect(screenReads()).toHaveLength(1));
    expectLoadingNotUnavailable();
    await act(async () => screenReads()[0].release(BOTH));
    expect(await screen.findByText('Plan two')).toBeTruthy();
    await settle();
    expect(mockToday).toHaveBeenCalledTimes(1);
  });

  it('i2 the fresh answer still lacks A2: "not available" after exactly one read, no loop; i3 pull keeps main', async () => {
    seed(SCREEN_KEY, PLAN_ONE);
    await openPlan({ assignmentId: A2 });
    await waitFor(() => expect(screenReads()).toHaveLength(1));
    await act(async () => screenReads()[0].release(PLAN_ONE));
    expect(await screen.findByTestId('meal-plan-ended')).toBeTruthy();
    await settle();
    await settle();
    expect(mockToday).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('meal-plan-ended')).toBeTruthy();
    // i3: pull to refresh on the card: the card stays and main's spinner shows.
    await fireEvent(screen.getByTestId('daily-meal-plan-refresh'), 'refresh');
    await waitFor(() => expect(screenReads()).toHaveLength(2));
    expect(screen.getByTestId('meal-plan-ended')).toBeTruthy();
    expect(screen.queryByTestId('daily-meal-plan-loading')).toBeNull();
    await waitFor(() => expect(refreshing()).toBe(true));
    await act(async () => screenReads()[1].release(PLAN_ONE));
    await waitFor(() => expect(refreshing()).toBe(false));
    expect(screen.getByTestId('meal-plan-ended')).toBeTruthy();
    await settle();
    expect(mockToday).toHaveBeenCalledTimes(2);
  });

  it('i4 no assignmentId: main states and reads unchanged', async () => {
    seed(SCREEN_KEY, PLAN_ONE);
    await openPlan(undefined);
    expect(screen.getByText('Plan one')).toBeTruthy();
    expect(screen.queryByTestId('daily-meal-plan-loading')).toBeNull();
    await settle();
    expect(mockToday).not.toHaveBeenCalled();
    expect(refreshing()).toBe(false);
  });
});

describe('j. offline ([KT-11])', () => {
  it('a tap with every read failing ends on the error block and keeps the saved answer (R-b)', async () => {
    seed(SCREEN_KEY, PLAN_ONE);
    failEveryRead = true;
    attach();
    setPushSession(CLIENT);
    routePushTap('NotificationCenter', undefined, 'n-j', `tgp://meal-plan/${A2}`);
    await openPlan(landedParams());
    expect(await screen.findByText('Could not load this meal plan. Pull to retry.', {}, { timeout: 15_000 })).toBeTruthy();
    expect(screen.getByLabelText('Try again')).toBeTruthy();
    expect(screen.queryByTestId('meal-plan-ended')).toBeNull();
    // One read with the client's two retries (queryClient.ts retry), then no more: no loop.
    await act(async () => { await new Promise((r) => setTimeout(r, 1500)); });
    expect(mockToday).toHaveBeenCalledTimes(3);
    expect(queryClient.getQueryData(SCREEN_KEY)).toEqual(PLAN_ONE);
  });
});
