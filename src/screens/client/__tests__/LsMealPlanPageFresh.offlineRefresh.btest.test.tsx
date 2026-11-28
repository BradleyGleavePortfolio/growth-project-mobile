/**
 * LS-MEALPLAN-PAGE-FRESH-M-1 B1 (B-TEST, growth-project-mobile#1043 @ 645a9b24): offline, a pull to refresh on the
 * Food tab must not wipe what the meal plan page already shows.
 *
 * At the head, clientStore.refreshShownDay marks ['food','log',day] stale on every call, and the Food tab's pull to
 * refresh (LogScreen.tsx onRefresh, also its "Try again") calls it with no signal too: only the queue's send is gated
 * on `online`. The meal plan page, open in the You stack, reads the day's log again; with no signal that read fails
 * after the app's retries, and the page treats a failed read as no log (ClientDailyMealPlanScreen.tsx:155
 * `!daily.isError`): breakfast's "Logged as planned" goes, lunch is no longer up next with "Ate it as planned", and
 * the kcal left line goes. At the base nothing re-read the page's log, so it kept what it showed.
 *
 * Harness: copied from the PR's MealPlanPageFresh.foodTabWrites.test.tsx (real LogScreen, real meal plan page, real
 * day store and the app's queryClient; a fake server), plus a switch for the signal and a stand-in RefreshControl
 * that carries a test id so the Food tab's pull to refresh can be fired.
 */
import React from 'react';
import { Alert, View } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../LogScreen';
import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';
import { queryClient } from '../../../services/queryClient';
import { foodApi, logApi } from '../../../services/api';
import { syncFoodLogQueue } from '../../../services/foodLogSync';
import { useClientStore } from '../../../store/clientStore';
import { addDays, getTodayString } from '../../../utils/date';

const mockDay = getTodayString();
const yesterday = addDays(mockDay, -1);
const tmpl = (id: string, name: string, kcal: number, p: number, c: number, f: number) => ({
  id, coach_id: 'coach', name, description: null, calories_kcal: kcal, protein_g: p, carbs_g: c, fats_g: f,
  fiber_g: null, items: null, created_at: '2026-10-01', archived_at: null,
});
const mockPlan = {
  date: mockDay,
  assignments: [{
    id: 'a1', daily_meal_plan_id: 'dp', client_id: 'client', assigned_by_coach_id: 'coach',
    starts_on: '2026-10-01', ends_on: null, created_at: '2026-10-01',
    daily_meal_plan: { id: 'dp', coach_id: 'coach', name: 'Weekday plan', notes: null, created_at: '2026-10-01', archived_at: null,
      slots: [
        { id: 's-bre', daily_meal_plan_id: 'dp', meal_template_id: 'm-bre', slot_label: 'breakfast', order: 0, time_of_day: null,
          meal_template: tmpl('m-bre', 'Overnight oats', 420, 24, 55, 12) },
        { id: 's-lun', daily_meal_plan_id: 'dp', meal_template_id: 'm-lun', slot_label: 'lunch', order: 1, time_of_day: null,
          meal_template: tmpl('m-lun', 'Chicken salad', 520, 42, 30, 22) },
      ] },
  }],
  changes_today: [],
};

// The fake server: what POST /log/food stores, GET /log/daily answers, PATCH and DELETE change.
type Food = { id: string; name: string; calories: number; protein_g: number; carbs_g: number; fat_g: number;
  nutrient_basis: string; serving_size_grams: number };
type Entry = { id: string; date: string; food_item_id: string; user_id: string; meal_type: string; quantity_multiplier: number;
  original_quantity?: number; original_unit?: string; plan_slot_id: string | null; client_uuid?: string; food_item: Food };
const mockServer = { foods: new Map<string, Food>(), entries: [] as Entry[] };
const oats: Food = { id: 'f1', name: 'Rolled oats', calories: 379, protein_g: 13, carbs_g: 68, fat_g: 6.5,
  nutrient_basis: 'PER_100G', serving_size_grams: 40 };

jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  const on = Object.fromEntries(Object.keys(real.featureFlags).map((k) => [k, true]));
  return { ...real, featureFlags: on };
});
const mockFocus = new Set<() => void>();
jest.mock('@react-navigation/native', () => {
  const React = require('react');
  const nav = {
    navigate: jest.fn(), goBack: jest.fn(), isFocused: () => true,
    addListener: (event: string, cb: () => void) => {
      if (event !== 'focus') return () => undefined;
      mockFocus.add(cb);
      return () => mockFocus.delete(cb);
    },
  };
  return {
    ...jest.requireActual('@react-navigation/native'),
    useNavigation: () => nav,
    useRoute: () => ({ params: undefined }),
    useIsFocused: () => true,
    // A screen's focus effect runs at mount and again on each focus the test fires.
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => {
        let undo = cb();
        const again = () => { if (typeof undo === 'function') undo(); undo = cb(); };
        mockFocus.add(again);
        return () => { mockFocus.delete(again); if (typeof undo === 'function') undo(); };
      }, [cb]);
    },
  };
});
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client', coach_id: 'coach' }) }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../hooks/useMacros', () => ({ useCurrentMacrosForSelf: () => ({ data: null }) }));
let mockOnline = true;
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => mockOnline }));
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const React = require('react');
  return { __esModule: true, default: (props: { testID?: string }) =>
    React.createElement(require('react-native').View, { ...props, testID: props.testID ?? 'mock-refresh-control' }) };
});
const mockLastMeals: Record<string, unknown> = {};
jest.mock('../../../hooks/useFoodBrowse', () => ({ useFoodBrowse: () => ({
  recentFoods: [{ id: 'f1', name: 'Rolled oats', calories: 379, protein: 13, carbs: 68, fat: 6.5, serving_size_grams: 40,
    nutrient_basis: 'PER_100G', supports_volume_units: false }],
  frequentFoods: [], lastMeals: mockLastMeals, loadBrowseFoods: jest.fn().mockResolvedValue(undefined),
}) }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async (url: string) => ({
    data: url.startsWith('/me/meal-plan/today') ? mockPlan
      : url === '/v1/clients/me/coach' ? { name: 'Maya Brooks' } : { items: [], nextCursor: null },
  })) },
  foodApi: { search: jest.fn(() => new Promise(() => undefined)), create: jest.fn() },
  logApi: { logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn(), getDaily: jest.fn() },
  waterApi: { getDaily: jest.fn(async () => ({ data: { total_ml: 0, logs: [] } })), log: jest.fn(), deleteEntry: jest.fn() },
  listsApi: { bulkAdd: jest.fn() },
  recipesApi: { getById: jest.fn() },
}));
// The phone's queue: empty, and its flush is the fake server taking what waited (set per case).
const mockFlush = jest.fn();
jest.mock('../../../services/foodLogQueue', () => ({
  flush: (...a: unknown[]) => mockFlush(...a),
  enqueue: jest.fn(), dropQueued: jest.fn(async () => undefined), enqueueWaterWeight: jest.fn(),
  readQueue: jest.fn(async () => []), readSent: jest.fn(async () => []),
  readWaterWeight: jest.fn(async () => ({ queue: [], sent: [] })),
  settleSent: jest.fn(async () => undefined), settleSentWater: jest.fn(async () => undefined),
  getQueueLength: jest.fn(async () => 0),
}));
jest.mock('../../../lib/userCache', () => ({
  ...jest.requireActual('../../../lib/userCache'), readUserCacheSync: () => ({ id: 'client' }),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
/** She taps the You tab again: the You stack (still on the meal plan page) gains focus. */
const backToYouTab = async () => {
  await act(async () => { [...mockFocus].forEach((cb) => cb()); });
  await settle();
};
/** The Food tab, and the meal plan page in the You stack: open from the start, or opened later (openPage). */
let openPage: (open: boolean) => void = () => undefined;
function App({ pageOpen = true }: { pageOpen?: boolean }) {
  const [open, setOpen] = React.useState(pageOpen);
  openPage = setOpen;
  return (
    <QueryClientProvider client={queryClient}>
      <LogScreen />
      {open ? <View testID="meal-plan-page"><ClientDailyMealPlanScreen /></View> : null}
    </QueryClientProvider>
  );
}
const app = () => <App />;
const dayReads = (day: string) => jest.mocked(logApi.getDaily).mock.calls.filter(([d]) => d === day).length;
const page = () => within(screen.getByTestId('meal-plan-page'));
const nextCard = () => page().getByTestId('daily-meal-plan-next-card');
/** The page reads breakfast as eaten (its done line: as planned, or with the change), and lunch is up next. */
const pageShowsBreakfastEaten = (line: string | RegExp = /^Logged (as planned|with a change: )/) => {
  expect(page().getByText(line)).toBeTruthy();
  expect(within(nextCard()).queryByLabelText('Log this meal: Overnight oats')).toBeNull();
  expect(within(nextCard()).getByLabelText('Log this meal: Chicken salad')).toBeTruthy();
};
/** The page reads breakfast as not eaten: up next again, and no meal has a done line. */
const pageShowsBreakfastNext = () => {
  expect(page().queryByText(/^Logged (as planned|with a change: )/)).toBeNull();
  expect(within(nextCard()).getByLabelText('Log this meal: Overnight oats')).toBeTruthy();
};
const serverTakes = (log: { date: string; food_item_id: string; meal_type: string; quantity_multiplier: number;
  original_quantity?: number; original_unit?: string; plan_slot_id?: string; client_uuid?: string }) => {
  const id = `entry-${mockServer.entries.length + 1}`;
  mockServer.entries.push({ id, date: log.date, food_item_id: log.food_item_id, user_id: 'client', meal_type: log.meal_type,
    quantity_multiplier: log.quantity_multiplier, original_quantity: log.original_quantity, original_unit: log.original_unit,
    plan_slot_id: log.plan_slot_id ?? null, client_uuid: log.client_uuid, food_item: mockServer.foods.get(log.food_item_id)! });
  return id;
};
const breakfastSlots = () => mockServer.entries.filter((e) => e.plan_slot_id === 's-bre' && e.meal_type === 'breakfast');

beforeEach(() => {
  jest.clearAllMocks();
  queryClient.clear();
  useClientStore.getState().reset();
  mockFocus.clear();
  mockServer.foods.clear();
  mockServer.foods.set(oats.id, oats);
  mockServer.entries = [];
  delete mockLastMeals.breakfast;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  // Remove asks first; she confirms.
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.text === 'Delete')?.onPress?.();
  });
  mockFlush.mockResolvedValue({ flushed: 0, remaining: 0, parked: 0, days: [] });
  let n = 0;
  jest.mocked(foodApi.create).mockImplementation((async (food: Omit<Food, 'id'>) => {
    const id = `food-${++n}`;
    mockServer.foods.set(id, { id, name: food.name, calories: food.calories, protein_g: food.protein_g, carbs_g: food.carbs_g,
      fat_g: food.fat_g, nutrient_basis: food.nutrient_basis, serving_size_grams: food.serving_size_grams });
    return { data: { id } };
  }) as unknown as typeof foodApi.create);
  jest.mocked(logApi.logFood).mockImplementation((async (log: Parameters<typeof serverTakes>[0]) =>
    ({ data: { id: serverTakes(log) } })) as unknown as typeof logApi.logFood);
  jest.mocked(logApi.updateEntry).mockImplementation((async (id: string, change: Partial<Entry>) => {
    const e = mockServer.entries.find((x) => x.id === id)!;
    Object.assign(e, change);
    return { data: { id } };
  }) as unknown as typeof logApi.updateEntry);
  jest.mocked(logApi.deleteEntry).mockImplementation((async (id: string) => {
    mockServer.entries = mockServer.entries.filter((x) => x.id !== id);
    return { data: {} };
  }) as unknown as typeof logApi.deleteEntry);
  mockOnline = true;
  jest.mocked(logApi.getDaily).mockImplementation((async (date: string) => mockOnline ? ({
    data: { entries: mockServer.entries.filter((e) => e.date === date).map((e) => ({ ...e })), total_calories: 0, total_protein_g: 0 },
  }) : Promise.reject(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', isAxiosError: true }))) as unknown as typeof logApi.getDaily);
});
afterEach(() => {
  jest.restoreAllMocks();
  queryClient.clear();
});

/** Morning: the meal plan page is open in the You stack, breakfast up next; then she goes to the Food tab. */
async function morning() {
  await render(app());
  await settle();
  expect(within(await screen.findByTestId('daily-meal-plan-next-card')).getByLabelText('Log this meal: Overnight oats')).toBeTruthy();
}
async function breakfastOnTheFoodTab() {
  await morning();
  await fireEvent.press(await screen.findByTestId('food-day-primary'));
  await settle();
  expect(logApi.logFood).toHaveBeenCalledTimes(1);
  expect(breakfastSlots()).toHaveLength(1);
  await backToYouTab();
}
/** Breakfast eaten on the Food tab, then she opens You > Meal plan: its first read shows breakfast eaten. */
async function breakfastThenThePage() {
  await render(<App pageOpen={false} />);
  await settle();
  await fireEvent.press(await screen.findByTestId('food-day-primary'));
  await settle();
  expect(breakfastSlots()).toHaveLength(1);
  await act(async () => { openPage(true); });
  await settle();
  pageShowsBreakfastEaten('Logged as planned');
}
/** On the Food tab: open the eaten breakfast, then its one food's edit sheet. */
async function openBreakfastFood() {
  await fireEvent.press(await screen.findByTestId('food-day-slot-s-bre'));
  await fireEvent.press(await screen.findByLabelText(/^Overnight oats, /));
  await screen.findByTestId('log-edit-save');
}


it('LS-MEALPLAN-PAGE-FRESH-M-1 B1: offline, a pull to refresh on the Food tab keeps breakfast eaten and lunch up next on the open meal plan page', async () => {
  // Online in the morning: breakfast eaten on the Food tab, then You > Meal plan opens and shows it (base and head).
  await breakfastThenThePage();
  expect(within(nextCard()).getByText('Ate it as planned')).toBeTruthy();
  // Later, no signal (the kitchen, the shop): she pulls to refresh on the Food tab, the page still open in the You stack.
  mockOnline = false;
  await act(async () => {
    await (screen.getByTestId('mock-refresh-control').props as { onRefresh: () => Promise<void> }).onRefresh();
  });
  // The app's own retries for a read (services/queryClient.ts: two, 1 s then 2 s) run out.
  await act(async () => { await new Promise((r) => setTimeout(r, 4500)); });
  await backToYouTab();
  // The page still shows what it knew: breakfast "Logged as planned", lunch up next with "Ate it as planned".
  pageShowsBreakfastEaten('Logged as planned');
  expect(within(nextCard()).getByText('Ate it as planned')).toBeTruthy();
}, 20000);
