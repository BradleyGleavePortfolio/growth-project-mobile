/**
 * MEALPLAN-PAGE-FRESH-M (SWEEP-INT-CLIENT B1 and N1): a meal she logs on the Food tab shows as eaten on the meal plan
 * page (You > Meal plan, kept open in the You stack while she uses the Food tab), and the page's "Ate it as planned"
 * never logs it a second time.
 *
 * The page reads the day's log under ['food','log',day] (ClientDailyMealPlanScreen.tsx useTodayLog); the Food tab's
 * writes refresh the day store (clientStore.refreshShownDay) and the offline queue's flush refreshes it too
 * (foodLogSync.syncFoodLogQueue). Nothing told the page's read, and nothing re-reads it on her way back
 * (queryClient.ts refetchOnWindowFocus false; the You tab keeps its stack), so the page kept its first answer.
 *
 * Real pieces: LogScreen with FoodDayView (every switch on), ClientDailyMealPlanScreen, LogPlannedMealButton, the day
 * store (clientStore), foodLogSync, utils/log/logSubmit, quickLog and saveKey, the app's queryClient singleton.
 * Stand-ins: the network (a fake server that keeps what is logged), the phone's queue storage (foodLogQueue, empty;
 * its flush is the fake server taking what was waiting), navigation (a focus the test fires when she taps the You
 * tab again). Names are fictional.
 *
 * The sweep's proof (btest/SWEEP-INT-CLIENT-B1 @ 2f9127e3) stood the day store in with a jest.fn refreshShownDay; its
 * two cases run here on the real store, as the first two below.
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
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => true }));
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
  jest.mocked(logApi.getDaily).mockImplementation((async (date: string) => ({
    data: { entries: mockServer.entries.filter((e) => e.date === date).map((e) => ({ ...e })), total_calories: 0, total_protein_g: 0 },
  })) as unknown as typeof logApi.getDaily);
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

it('SWEEP-INT-CLIENT B1: back on the meal plan page, the breakfast she just ate on the Food tab reads as eaten, not up next', async () => {
  await breakfastOnTheFoodTab();
  pageShowsBreakfastEaten('Logged as planned');
});

it('SWEEP-INT-CLIENT B1: the page\'s "Ate it as planned" after that logs the next meal, never breakfast a second time', async () => {
  await breakfastOnTheFoodTab();
  await fireEvent.press(within(nextCard()).getByText('Ate it as planned'));
  await settle();
  expect(logApi.logFood).toHaveBeenCalledTimes(2);
  // At main: 's-bre' again, so her day holds Overnight oats twice and counts 840 kcal for one breakfast.
  expect(mockServer.entries.map((e) => e.plan_slot_id)).toEqual(['s-bre', 's-lun']);
});

// Every Food-tab write that logs the plan meal leaves the page right on her return.
const logsBreakfast: [string, () => Promise<void>][] = [
  ['"Something else", a Recent food (the search path)', async () => {
    await fireEvent.press(await screen.findByTestId('food-day-something-else'));
    await fireEvent.press(await screen.findByText('Rolled oats'));
    await fireEvent.press(await screen.findByTestId('quantity-log-food'));
  }],
  ['"Something else", Quick add', async () => {
    await fireEvent.press(await screen.findByTestId('food-day-something-else'));
    await fireEvent.press(await screen.findByText('Quick add'));
    await fireEvent.changeText(screen.getByPlaceholderText('Food name'), 'Toast');
    for (const input of screen.getAllByPlaceholderText('0')) await fireEvent.changeText(input, '5');
    await fireEvent.press(screen.getByTestId('manual-log-food'));
  }],
  ['"Something else", Repeat yesterday\'s breakfast', async () => {
    await fireEvent.press(await screen.findByTestId('food-day-something-else'));
    await fireEvent.press(await screen.findByLabelText(/add all 1 food/));
  }],
  ['the offline queue sends what waited, on reconnect (the day on the Food tab)', async () => {
    mockFlush.mockImplementationOnce(async () => {
      serverTakes({ date: mockDay, food_item_id: 'f1', meal_type: 'breakfast', quantity_multiplier: 1, plan_slot_id: 's-bre' });
      return { flushed: 1, remaining: 0, parked: 0, days: [mockDay] };
    });
    await act(async () => { await syncFoodLogQueue(); });
  }],
  ['the offline queue sends what waited, on reconnect, while the Food tab shows yesterday', async () => {
    await act(async () => { await useClientStore.getState().loadDayData('client', yesterday); });
    expect(useClientStore.getState().selectedDate).toBe(yesterday);
    mockFlush.mockImplementationOnce(async () => {
      serverTakes({ date: mockDay, food_item_id: 'f1', meal_type: 'breakfast', quantity_multiplier: 1, plan_slot_id: 's-bre' });
      return { flushed: 1, remaining: 0, parked: 0, days: [mockDay] };
    });
    await act(async () => { await syncFoodLogQueue(); });
  }],
];
it.each(logsBreakfast)('MEALPLAN-PAGE-FRESH-M: breakfast logged on the Food tab by %s reads as eaten on the page', async (_name, write) => {
  mockLastMeals.breakfast = { date: yesterday, calories: 152,
    entries: [{ foodItemId: 'f1', name: 'Rolled oats', calories: 152, quantityMultiplier: 1 }] };
  await morning();
  await write();
  await settle();
  expect(breakfastSlots()).toHaveLength(1);
  await backToYouTab();
  pageShowsBreakfastEaten();
});

// Every Food-tab write that takes the plan meal off leaves the page right on her return.
const undoesBreakfast: [string, () => Promise<void>][] = [
  ['Remove', async () => {
    await openBreakfastFood();
    await fireEvent.press(screen.getByText('Delete entry'));
  }],
  ['a move to another meal', async () => {
    await openBreakfastFood();
    await fireEvent.press(within(screen.getByTestId('log-edit-meals')).getByLabelText('Lunch'));
    await fireEvent.press(screen.getByTestId('log-edit-save'));
  }],
];
it.each(undoesBreakfast)('MEALPLAN-PAGE-FRESH-M: breakfast taken off on the Food tab by %s is up next again on the page', async (_name, write) => {
  await breakfastThenThePage();
  await write();
  await settle();
  expect(breakfastSlots()).toHaveLength(0);
  await backToYouTab();
  pageShowsBreakfastNext();
});

it('MEALPLAN-PAGE-FRESH-M: with nothing written, the page reads nothing on her return or on a Food-tab day change', async () => {
  await morning();
  const before = dayReads(mockDay);
  await backToYouTab();
  await backToYouTab();
  expect(dayReads(mockDay)).toBe(before);
  // She looks at yesterday on the Food tab, then comes back to today: the store reads each day; the page reads nothing.
  await act(async () => { await useClientStore.getState().loadDayData('client', yesterday); });
  const store = dayReads(mockDay);
  await act(async () => { await useClientStore.getState().loadDayData('client', mockDay); });
  await backToYouTab();
  expect(dayReads(mockDay)).toBe(store + 1);
  expect(dayReads(yesterday)).toBe(1);
  pageShowsBreakfastNext();
});
