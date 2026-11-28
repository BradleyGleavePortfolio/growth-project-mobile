/**
 * FOODDAY-PLAN-KEEP-M (SWEEP-INT-CLIENT C1, raised to fix now by the OPERATOR TRIAGE, ctx#559 7234916044): a re-read
 * of today's plan that fails keeps the plan on her Food day. One class, one rule with SWEEP-KITCHEN B1 (m#1040) and
 * m#1008 LS-KWM-2 C1 (FIX-KWM-2): "a re-read that fails keeps the last good answer".
 *
 * The Food day's plan read (FoodDayView.tsx, ['meal-plan', 'today', day]) is shared with the Kitchen, the plan meal page
 * and Food this week, and each of them reads it again on its own. react-query 5 puts the shared query in 'error' when a
 * re-read fails and keeps its data; the app wires no onlineManager, so offline the read runs and fails. At main the Food
 * day then drew "Your meal plan could not load" with Try again in place of her plan, and Dinner's "Ate it as planned"
 * (an offline-capable write) was gone. Its error block is for a plan with no answer yet.
 *
 * Real pieces: LogScreen and FoodDayView (the Food tab), KitchenScreen, PlanMealScreen and FoodWeekScreen, on the app's
 * queryClient (as App.tsx provides it), the persister's serializer for the cold start. Stand-ins: the network
 * (services/api, every read goes through its get), the day store, the food log queue, navigation (one stand-in whose
 * focus listeners the test fires), and the clock (Date only: Tuesday 24 November 2026, 3:10 pm). The app's two read
 * retries are cut to none here; with them the same happens a few seconds later. Every switch is on ([R27]). Names are
 * fictional (client Jordan, coach Sam).
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClientProvider, dehydrate, hydrate } from '@tanstack/react-query';
import LogScreen from '../LogScreen';
import KitchenScreen from '../kitchen/KitchenScreen';
import PlanMealScreen from '../mealplan/PlanMealScreen';
import FoodWeekScreen from '../foodweek/FoodWeekScreen';
import { queryClient, serializePersistedClient } from '../../../services/queryClient';

const TODAY = '2026-11-24';
const KEY = ['meal-plan', 'today', TODAY];

jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  return { ...real, featureFlags: Object.fromEntries(Object.keys(real.featureFlags).map((k) => [k, true])) };
});
jest.mock('@react-navigation/native', () => {
  const React = require('react');
  const listeners: Record<string, Array<() => void>> = {};
  const nav = {
    navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), isFocused: () => true,
    getParent: () => nav, listeners,
    addListener: jest.fn((event: string, cb: () => void) => {
      (listeners[event] ??= []).push(cb);
      return () => { listeners[event] = listeners[event].filter((x) => x !== cb); };
    }),
  };
  return {
    ...jest.requireActual('@react-navigation/native'),
    NavigationContext: React.createContext(nav),
    useNavigation: () => nav,
    useRoute: () => ({ params: { date: '2026-11-24', slotId: 's-din' } }),
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
    __nav: nav,
  };
});
const mockStore = {
  selectedDate: '2026-11-24', foodLogs: [], hasLoadedDay: true, queuedFoods: [], sentFoods: [],
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  waterOz: 0, isLoading: false, loadError: null,
  setSelectedDate: jest.fn(), loadDayData: jest.fn(async () => undefined),
  refreshShownDay: jest.fn(async () => undefined),
  logWater: jest.fn(), removeFoodLogLocally: jest.fn(),
};
jest.mock('../../../store/clientStore', () => ({
  useClientStore: Object.assign((pick?: (s: typeof mockStore) => unknown) => (pick ? pick(mockStore) : mockStore),
    { getState: () => mockStore }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'jordan', coach_id: 'sam' }) }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
let mockNet = { isOnline: true, isInternetReachable: true as boolean | null };
jest.mock('../../../hooks/useNetworkStatus', () => ({
  ...jest.requireActual('../../../hooks/useNetworkStatus'), useNetworkStatus: () => mockNet,
}));
jest.mock('../../../hooks/useFoodBrowse', () => ({ useFoodBrowse: () => ({
  recentFoods: [], frequentFoods: [], lastMeals: {}, loadBrowseFoods: jest.fn(),
}) }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
// The network's edge: every read is one GET, so offline is one switch (mockOffline).
let mockOffline = false;
const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: jest.fn() },
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: {
    logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn(),
    getDaily: (d: string) => mockGet(`/log/daily/${d}`), getWeekly: (s: string) => mockGet(`/log/weekly/${s}`),
  },
  recipesApi: { list: () => mockGet('/recipes'), getById: (id: string) => mockGet(`/recipes/${id}`) },
  listsApi: { getList: (t: string) => mockGet(`/lists/${t}`), bulkAdd: jest.fn() },
}));
jest.mock('../../../services/foodLogQueue', () => ({ ...jest.requireActual('../../../services/foodLogQueue'), flush: jest.fn() }));
jest.mock('../../../services/foodLogSync', () => ({
  syncFoodLogQueue: jest.fn(async () => 0), notifyPendingFoodLogs: jest.fn(),
  readPendingFoodLogCount: jest.fn(async () => 0), subscribePendingFoodLogs: jest.fn(() => () => undefined),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));

// A fixed clock: Tuesday 24 November 2026, 3:10 pm (only Date is faked; react-query's and waitFor's timers stay real).
jest.useFakeTimers({ now: new Date('2026-11-24T15:10:00'), advanceTimers: true, doNotFake: ['nextTick', 'setImmediate',
  'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime',
  'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());

const nav = jest.requireMock('@react-navigation/native').__nav as { listeners: Record<string, Array<() => void>> };
const focus = async () => { await act(async () => { [...(nav.listeners.focus ?? [])].forEach((cb) => cb()); }); };
const later = (minutes: number) => jest.setSystemTime(new Date(Date.now() + minutes * 60 * 1000));

const dinner = {
  id: 'm-din', coach_id: 'sam', name: 'Salmon, potatoes and green beans', description: null, calories_kcal: 620,
  protein_g: 42, carbs_g: 55, fats_g: 22, fiber_g: null, items: [{ name: 'Salmon fillet', grams: 150 }], created_at: '',
  archived_at: null,
};
const planFor = (date: string) => ({
  date, changes_today: [],
  assignments: [{ id: 'a1', daily_meal_plan_id: 'p1', client_id: 'jordan', assigned_by_coach_id: 'sam',
    starts_on: '2026-11-01', ends_on: null, created_at: '2026-11-01', daily_meal_plan: {
      id: 'p1', coach_id: 'sam', name: 'Training day', notes: null, slots: [
        { id: 's-din', daily_meal_plan_id: 'p1', meal_template_id: 'm-din', slot_label: 'dinner', order: 0,
          time_of_day: '19:00', meal_template: dinner, swaps: [], recipe_id: null },
      ] } }],
});
// UI-3b: a coached client whose plan answer holds no plan gets her usual day, built from the week's log: the same snack
// yesterday and on Friday makes it her usual snack (foodDay.ts usualMeal, two days or more).
let mockNoPlan = false;
const snackEntry = (id: string, name: string, kcal: number) => ({
  meal_type: 'snack', food_item_id: id, quantity_multiplier: 1, original_quantity: 1, original_unit: 'serving',
  food_item: { id, name, calories_per_serving: kcal, protein: 4, carbs: 20, fat: 8, nutrient_basis: 'PER_SERVING' },
});
const SNACK_DAYS = ['/2026-11-23', '/2026-11-20'];
const YESTERDAY_SNACK = [snackEntry('apple', 'Apple, medium', 95), snackEntry('pb', 'Peanut butter', 95)];
// What a phone with no connection gets from axios: no response, code ERR_NETWORK.
const offline = () => Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
async function answer(url: string) {
  if (mockOffline) throw offline();
  if (url.startsWith('/me/meal-plan/today') && mockNoPlan) return { data: { date: TODAY, changes_today: [], assignments: [] } };
  if (url.startsWith('/me/meal-plan/today')) return { data: planFor(new URLSearchParams(url.split('?')[1]).get('date') ?? TODAY) };
  if (url === '/v1/clients/me/coach') return { data: { name: 'Sam Reid' } };
  if (url.startsWith('/log/daily/')) return { data: { entries: mockNoPlan && SNACK_DAYS.some((d) => url.endsWith(d)) ? YESTERDAY_SNACK : [] } };
  if (url.startsWith('/log/weekly/')) return { data: [] };
  if (url === '/recipes' || url.startsWith('/lists/') || url === '/me/foods/saved-meals') return { data: [] };
  return { data: { items: [], nextCursor: null } };
}
const planReads = () => mockGet.mock.calls.filter(([u]) => String(u) === `/me/meal-plan/today?date=${TODAY}`).length;

const tree = (other?: React.ReactNode) => (
  <QueryClientProvider client={queryClient}><LogScreen />{other ?? null}</QueryClientProvider>
);
// The query is 'error' at once; react-query tells the screens on a setTimeout(0) (notifyManager), so a screen is drawn
// from that state only after it: wait for both before reading the screen.
async function planFailed(since: number) {
  await waitFor(() => expect(queryClient.getQueryState(KEY)?.errorUpdatedAt ?? 0).toBeGreaterThan(since));
  expect(queryClient.getQueryState(KEY)?.status).toBe('error');
  expect(queryClient.getQueryData(KEY)).toBeDefined(); // react-query kept the plan it had
  await act(async () => { await new Promise((done) => setTimeout(done, 30)); });
}
/** Her Food day still holds tonight's dinner and its one-tap "Ate it as planned", with no plan error. */
function foodDayKeepsPlan() {
  expect(screen.queryByTestId('food-day-plan-error')).toBeNull();
  const next = screen.getByTestId('food-day-next');
  expect(within(next).getByText('Salmon, potatoes and green beans')).toBeTruthy();
  expect(within(next).getByTestId('food-day-primary')).toBeTruthy();
  expect(within(next).getByText('Ate it as planned')).toBeTruthy();
}
/** Online in the morning: the Food day reads today's plan once and shows Dinner as up next. */
async function morning(other?: React.ReactNode) {
  const view = await render(tree(other));
  await waitFor(() => expect(screen.getByTestId('food-day-next')).toBeTruthy());
  foodDayKeepsPlan();
  return view;
}
const goOffline = () => { mockOffline = true; mockNet = { isOnline: false, isInternetReachable: false }; };

beforeEach(() => {
  jest.clearAllMocks();
  jest.setSystemTime(new Date('2026-11-24T15:10:00'));
  mockOffline = false;
  mockNoPlan = false;
  mockNet = { isOnline: true, isInternetReachable: true };
  mockGet.mockImplementation(answer);
  queryClient.clear();
  queryClient.setDefaultOptions({ ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false } });
  for (const k of Object.keys(nav.listeners)) delete nav.listeners[k];
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  queryClient.clear();
});

describe('FOODDAY-PLAN-KEEP-M: another screen reads today\'s plan again offline, and her Food day keeps it', () => {
  it('the sweep\'s probe: a re-read of the shared plan key that fails keeps the plan and Dinner\'s "Ate it as planned"', async () => {
    await morning();
    goOffline();
    const since = Date.now() - 1;
    await act(async () => { await queryClient.refetchQueries({ queryKey: KEY }); });
    await planFailed(since);
    foodDayKeepsPlan();
  });

  it('the Kitchen: she comes back to it offline (its focus reads every part again); the Food day keeps her plan', async () => {
    await morning(<KitchenScreen />);
    await focus(); // the Kitchen's first focus, when it opened, reads nothing new
    await waitFor(() => expect(screen.getByTestId('kitchen-meals')).toBeTruthy());
    const before = planReads();
    goOffline();
    const since = Date.now() - 1;
    await focus(); // back on the Kitchen from a recipe or the Grocery list, in the shop with no signal
    await planFailed(since);
    expect(planReads()).toBe(before + 1); // the Kitchen's readAll read the Food day's plan key again
    foodDayKeepsPlan();
  });

  it('the plan meal page: she opens Dinner\'s "Recipe and grocery list" offline ten minutes on; the Food day keeps her plan', async () => {
    const view = await morning();
    later(10); // past the plan read's five minutes, so the page's mount reads it again
    goOffline();
    const since = Date.now() - 1;
    await view.rerender(tree(<PlanMealScreen />));
    await planFailed(since);
    // The plan meal page keeps its meal (it shows its error only with no plan, PlanMealScreen.tsx `!plan.data`).
    expect(screen.queryByTestId('plan-meal-plan-error')).toBeNull();
    foodDayKeepsPlan();
  });

  it('Food this week: she opens it offline ten minutes on (its day reads run again); the Food day keeps her plan', async () => {
    const view = await morning();
    later(10);
    goOffline();
    const since = Date.now() - 1;
    await view.rerender(tree(<FoodWeekScreen />));
    await planFailed(since);
    foodDayKeepsPlan();
  });

  it('Food this week: a pull to refresh offline reads every day\'s plan again; the Food day keeps her plan', async () => {
    await morning(<FoodWeekScreen />);
    goOffline();
    const since = Date.now() - 1;
    await act(async () => { screen.getByTestId('food-week').props.refreshControl.props.onRefresh(); });
    await planFailed(since);
    foodDayKeepsPlan();
  });

  it('after the failed re-read her one tap still works offline: "Ate it as planned" saves Dinner on the phone, as before', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = await morning();
    goOffline();
    await view.rerender(tree()); // the phone's network status reaches LogScreen (useNetworkStatus re-renders it)
    const since = Date.now() - 1;
    await act(async () => { await queryClient.refetchQueries({ queryKey: KEY }); });
    await planFailed(since);
    await fireEvent.press(within(screen.getByTestId('food-day-next')).getByTestId('food-day-primary'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Saved offline', 'Salmon, potatoes and green beans will sync when you reconnect.'));
    expect(screen.queryByTestId('food-day-plan-error')).toBeNull();
  });

  it('her usual day (a plan answer with no plan): a failed re-read keeps the usual day and its Repeat', async () => {
    mockNoPlan = true;
    await render(tree());
    expect(await screen.findByText("Repeat yesterday's snack")).toBeTruthy();
    goOffline();
    const since = Date.now() - 1;
    await act(async () => { await queryClient.refetchQueries({ queryKey: KEY }); });
    await planFailed(since);
    expect(screen.queryByTestId('food-day-plan-error')).toBeNull();
    expect(screen.getByText("Repeat yesterday's snack")).toBeTruthy();
    expect(screen.getByText('Apple, medium and Peanut butter')).toBeTruthy();
  });
});

describe('FOODDAY-PLAN-KEEP-M: the plan error block stays for a plan with no answer', () => {
  it('offline from the start, no plan read has answered: the Food day says the plan could not load, with Try again', async () => {
    goOffline();
    await render(tree());
    expect(await screen.findByTestId('food-day-plan-error')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByTestId('food-day-next')).toBeNull();
  });

  it('Try again after a first read that failed, and the connection back: the plan shows', async () => {
    goOffline();
    await render(tree());
    expect(await screen.findByTestId('food-day-plan-error')).toBeTruthy();
    mockOffline = false;
    mockNet = { isOnline: true, isInternetReachable: true };
    await fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByTestId('food-day-next')).toBeTruthy());
    foodDayKeepsPlan();
  });
});

describe('FOODDAY-PLAN-KEEP-M: a cold start on a saved plan whose last re-read failed', () => {
  it('the app saved the plan query in error with its data (queryClient.ts saves a query in any state); the next start offline shows the plan', async () => {
    const view = await morning();
    goOffline();
    const since = Date.now() - 1;
    await act(async () => { await queryClient.refetchQueries({ queryKey: KEY }); });
    await planFailed(since);
    view.unmount();
    // What the persister writes, read back at the next start, ten minutes later (older than the read's five minutes).
    const saved = JSON.parse(serializePersistedClient({
      timestamp: Date.now(), buster: 'test', clientState: dehydrate(queryClient, { shouldDehydrateQuery: () => true }),
    }));
    const plan = saved.clientState.queries.find((q: { queryHash: string }) => q.queryHash === JSON.stringify(KEY));
    expect(plan.state.status).toBe('error');
    expect(plan.state.data).toBeDefined();
    queryClient.clear();
    later(10);
    hydrate(queryClient, saved.clientState);
    const coldSince = Date.now() - 1;
    await render(tree());
    await planFailed(coldSince); // the start's own read fails offline too
    foodDayKeepsPlan();
  });
});
