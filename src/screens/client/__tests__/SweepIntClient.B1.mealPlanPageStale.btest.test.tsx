/**
 * SWEEP-INT-CLIENT B1 (B-TEST, red at main ee0e082a): the meal plan page (You > Meal plan) stays mounted in the You
 * stack while she logs on the Food tab. "Ate it as planned" on the Food day writes the entry and refreshes only the
 * day store (LogScreen.tsx:607-629 logPlanned -> refreshShownDay); the meal plan page reads the day's log under
 * ['food','log',day] (ClientDailyMealPlanScreen.tsx:153 useTodayLog) and nothing re-reads it on her way back
 * (no focus read; queryClient.ts refetchOnWindowFocus false). Back on the page, the meal she just logged is still
 * "up next" with the forest "Ate it as planned", and one tap logs it a second time.
 *
 * Real pieces: LogScreen with FoodDayView (switch on, featureFlags.foodPlanChecklist), ClientDailyMealPlanScreen,
 * LogPlannedMealButton, utils/log/logSubmit and saveKey, the app's queryClient singleton. Stand-ins: the network (a
 * fake server that keeps what is logged), the day store, the food log queue, navigation (a focus the test fires when
 * she taps the You tab again). Names are fictional.
 */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../LogScreen';
import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';
import { queryClient } from '../../../services/queryClient';
import { foodApi, logApi } from '../../../services/api';
import { getTodayString } from '../../../utils/date';

const mockDay = getTodayString();
const mockStore = {
  selectedDate: mockDay, selectedOn: mockDay, foodLogs: [], hasLoadedDay: true,
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  waterOz: 0, waterEntries: [], isLoading: false, loadError: null, queuedFoods: [], sentFoods: [],
  setSelectedDate: jest.fn(), loadDayData: jest.fn().mockResolvedValue(undefined),
  refreshShownDay: jest.fn().mockResolvedValue(undefined),
  logWater: jest.fn(), removeWaterEntry: jest.fn(), removeFoodLogLocally: jest.fn(),
};
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

// The fake server: what POST /log/food stores, GET /log/daily answers.
type Entry = { id: string; food_item_id: string; user_id: string; meal_type: string; quantity_multiplier: number;
  original_quantity: number; original_unit: string; plan_slot_id: string | null;
  food_item: { id: string; name: string; calories: number; protein_g: number; carbs_g: number; fat_g: number;
    nutrient_basis: string; serving_size_grams: number } };
const mockServer = { foods: new Map<string, Entry['food_item']>(), entries: [] as Entry[] };

jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  return { ...real, featureFlags: { ...real.featureFlags, foodPlanChecklist: true, offlineFoodInDay: true } };
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
jest.mock('../../../store/clientStore', () => ({
  useClientStore: Object.assign((pick?: (s: object) => unknown) => (pick ? pick(mockStore) : mockStore), { getState: () => mockStore }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client', coach_id: 'coach' }) }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../hooks/useMacros', () => ({ useCurrentMacrosForSelf: () => ({ data: null }) }));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => true }));
jest.mock('../../../hooks/useFoodBrowse', () => ({ useFoodBrowse: () => ({
  recentFoods: [], frequentFoods: [], lastMeals: {}, loadBrowseFoods: jest.fn(),
}) }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async (url: string) => ({
    data: url.startsWith('/me/meal-plan/today') ? mockPlan
      : url === '/v1/clients/me/coach' ? { name: 'Maya Brooks' } : { items: [], nextCursor: null },
  })) },
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn(), getDaily: jest.fn() },
  listsApi: { bulkAdd: jest.fn() },
  recipesApi: { getById: jest.fn() },
}));
jest.mock('../../../services/foodLogQueue', () => ({ flush: jest.fn(), enqueue: jest.fn(), dropQueued: jest.fn() }));
jest.mock('../../../services/foodLogSync', () => ({
  syncFoodLogQueue: jest.fn(async () => 0), notifyPendingFoodLogs: jest.fn(),
  readPendingFoodLogCount: jest.fn(async () => 0), subscribePendingFoodLogs: jest.fn(() => () => undefined),
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
const app = () => (
  <QueryClientProvider client={queryClient}>
    <LogScreen />
    <ClientDailyMealPlanScreen />
  </QueryClientProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  queryClient.clear();
  mockFocus.clear();
  mockServer.foods.clear();
  mockServer.entries = [];
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  let n = 0;
  jest.mocked(foodApi.create).mockImplementation((async (food: { name: string; calories: number; protein_g: number; carbs_g: number; fat_g: number;
    nutrient_basis: string; serving_size_grams: number }) => {
    const id = `food-${++n}`;
    mockServer.foods.set(id, { id, name: food.name, calories: food.calories, protein_g: food.protein_g, carbs_g: food.carbs_g,
      fat_g: food.fat_g, nutrient_basis: food.nutrient_basis, serving_size_grams: food.serving_size_grams });
    return { data: { id } };
  }) as unknown as typeof foodApi.create);
  jest.mocked(logApi.logFood).mockImplementation((async (log: { food_item_id: string; meal_type: string; quantity_multiplier: number;
    original_quantity: number; original_unit: string; plan_slot_id?: string }) => {
    const id = `entry-${mockServer.entries.length + 1}`;
    mockServer.entries.push({ id, food_item_id: log.food_item_id, user_id: 'client', meal_type: log.meal_type,
      quantity_multiplier: log.quantity_multiplier, original_quantity: log.original_quantity, original_unit: log.original_unit,
      plan_slot_id: log.plan_slot_id ?? null, food_item: mockServer.foods.get(log.food_item_id)! });
    return { data: { id } };
  }) as unknown as typeof logApi.logFood);
  jest.mocked(logApi.getDaily).mockImplementation((async () => ({
    data: { entries: mockServer.entries.map((e) => ({ ...e })), total_calories: 0, total_protein_g: 0 },
  })) as unknown as typeof logApi.getDaily);
});
afterEach(() => {
  jest.restoreAllMocks();
  queryClient.clear();
});

/** Morning: the meal plan page is open in the You stack (breakfast up next), she goes to the Food tab and eats it as planned. */
async function breakfastOnTheFoodTab() {
  await render(app());
  await settle();
  const card = await screen.findByTestId('daily-meal-plan-next-card');
  expect(within(card).getByLabelText('Log this meal: Overnight oats')).toBeTruthy();

  await fireEvent.press(await screen.findByTestId('food-day-primary'));
  await settle();
  expect(logApi.logFood).toHaveBeenCalledTimes(1);
  expect(mockServer.entries).toHaveLength(1);
  expect(mockServer.entries[0].plan_slot_id).toBe('s-bre');

  await backToYouTab();
}

it('SWEEP-INT-CLIENT B1: back on the meal plan page, the breakfast she just ate on the Food tab reads as eaten, not up next', async () => {
  await breakfastOnTheFoodTab();
  expect(screen.getByText('Logged as planned')).toBeTruthy();
  const next = screen.getByTestId('daily-meal-plan-next-card');
  expect(within(next).queryByLabelText('Log this meal: Overnight oats')).toBeNull();
  expect(within(next).getByLabelText('Log this meal: Chicken salad')).toBeTruthy();
});

it('SWEEP-INT-CLIENT B1: the page\'s "Ate it as planned" after that logs the next meal, never breakfast a second time', async () => {
  await breakfastOnTheFoodTab();
  const next = screen.getByTestId('daily-meal-plan-next-card');
  await fireEvent.press(within(next).getByText('Ate it as planned'));
  await settle();
  expect(logApi.logFood).toHaveBeenCalledTimes(2);
  // At main: 's-bre' again, so her day holds Overnight oats twice and counts 840 kcal for one breakfast.
  expect(mockServer.entries.map((e) => e.plan_slot_id)).toEqual(['s-bre', 's-lun']);
});
