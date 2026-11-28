/**
 * MEALPLAN-OFFLINE-JOIN-M (SWEEP-FINAL-OFFLINE B1, OPERATOR TRIAGE 7237179575): the meal plan page counts the foods saved
 * on this phone whether or not it holds a day log. At main 89a4e7f9 it joins them only with a day log held
 * (ClientDailyMealPlanScreen.tsx:205, `checklist && log ? withQueuedFoods(...) : []`), so offline, on a day the page has
 * not read online yet, a meal she saved on this phone shows as not eaten and a tap on its "Log this meal" queues it a
 * second time. The plan meal page and the Food day already join them with no day log (PlanMealScreen.tsx:99-101,
 * clientStore.ts:315-336); OPERATOR RULING 7235584848 C1 asked for the same join here.
 *
 * With no day log held the page still claims no next meal (ruled in 7235584848) and shows no "kcal left" line; a refused
 * food counts nowhere; with nothing saved on the phone the page keeps main's rule (every "Log this meal").
 *
 * Harness: btest/SWEEP-FINAL-OFFLINE-B1 @ 42d98492 (MealPlanPageFresh.noMarkHeld.test.tsx's), its two cases kept as
 * written. Names are fictional.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../LogScreen';
import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';
import { queryClient } from '../../../services/queryClient';
import { foodApi, logApi } from '../../../services/api';
import { useClientStore } from '../../../store/clientStore';
import { getTodayString } from '../../../utils/date';

const mockDay = getTodayString();
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
const mockTarget = { id: 't1', client_id: 'client', coach_id: 'coach', calories_kcal: 2000, protein_g: 150, carbs_g: 200,
  fats_g: 60, fiber_g: 30, notes: null, effective_from: '2026-10-01', macro_display_mode: 'full' };

// The fake server: what POST /log/food stores and GET /log/daily answers. `mockServer.reads` / `.writes` false: that
// call fails as a lost connection does.
type Food = { id: string; name: string; calories: number; protein_g: number; carbs_g: number; fat_g: number;
  nutrient_basis: string; serving_size_grams: number };
type Entry = { id: string; date: string; food_item_id: string; user_id: string; meal_type: string; quantity_multiplier: number;
  plan_slot_id: string | null; client_uuid?: string; food_item: Food };
const mockServer = { foods: new Map<string, Food>(), entries: [] as Entry[], reads: true, writes: true };
const lost = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', isAxiosError: true });

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
jest.mock('../../../hooks/useMacros', () => ({
  useCurrentMacrosForSelf: () => ({ data: mockTarget, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false }),
}));
// The Food tab's and the page's send decision (LogScreen `online`, LogPlannedMealButton's NetInfo check).
const mockNet = { online: true };
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => mockNet.online }));
jest.mock('../../../hooks/useFoodBrowse', () => ({ useFoodBrowse: () => ({
  recentFoods: [], frequentFoods: [], lastMeals: {}, loadBrowseFoods: jest.fn().mockResolvedValue(undefined),
}) }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full', reportMacroDisplay: jest.fn() }));
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
// The phone's queue keeps what is saved offline; nothing is sent (the signal stays gone).
const mockQueue: Array<Record<string, unknown> & { id: string; log: { plan_slot_id?: string } }> = [];
jest.mock('../../../services/foodLogQueue', () => ({
  flush: jest.fn(async () => ({ flushed: 0, remaining: 0, parked: 0, days: [] })),
  enqueue: jest.fn(async (entry: { log: { plan_slot_id?: string } }, id = `pfl_${mockQueue.length + 1}`) => {
    mockQueue.push({ ...entry, id, createdAt: Date.now() });
  }),
  dropQueued: jest.fn(async () => undefined), enqueueWaterWeight: jest.fn(),
  readQueue: jest.fn(async () => mockQueue.map((q) => ({ ...q }))), readSent: jest.fn(async () => []),
  readWaterWeight: jest.fn(async () => ({ queue: [], sent: [] })),
  settleSent: jest.fn(async () => undefined), settleSentWater: jest.fn(async () => undefined),
  getQueueLength: jest.fn(async () => mockQueue.length),
}));
jest.mock('../../../lib/userCache', () => ({
  ...jest.requireActual('../../../lib/userCache'), readUserCacheSync: () => ({ id: 'client' }),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
/** The app's retries for a read (queryClient.ts: two, 1 s then 2 s) run out. */
const retriesRunOut = () => act(async () => { await new Promise((r) => setTimeout(r, 3600)); });
/** The signal goes: the Food tab and the page decide offline (after their next render), and the server is out of reach. */
const signalGone = async () => {
  mockNet.online = false;
  mockServer.reads = false;
  mockServer.writes = false;
  await act(async () => { useClientStore.setState({}); });
};
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
const page = () => within(screen.getByTestId('meal-plan-page'));
const DAY_KEY = ['food', 'log', mockDay];
/** A meal's gutter mark is filled (eaten) when its fill is its ring's colour (planStyleC TimelineRow). */
const markFilled = (slotId: string) => {
  const st = StyleSheet.flatten(page().getByTestId(`daily-meal-plan-mark-${slotId}`, { includeHiddenElements: true }).props.style);
  return st.backgroundColor === st.borderColor;
};
/** Breakfast reads as eaten; lunch is not eaten and keeps its "Log this meal"; with no day log no meal is "up next". */
const pageShowsBreakfastSavedWithNoLog = () => {
  expect(page().getByText('Logged as planned')).toBeTruthy();
  expect(markFilled('s-bre')).toBe(true);
  expect(markFilled('s-lun')).toBe(false);
  expect(page().getByLabelText('Log this meal: Chicken salad')).toBeTruthy();
  // Ruled in 7235584848: no next meal with no answer; and "kcal left" still needs the day log.
  expect(page().queryByTestId('daily-meal-plan-next-card')).toBeNull();
  expect(page().queryByText('Ate it as planned')).toBeNull();
  expect(page().queryByTestId('daily-meal-plan-seg')).toBeNull();
  expect(page().queryByText(/kcal and .* g protein left\./)).toBeNull();
  // Nothing was queued again: the one breakfast she saved.
  expect(mockQueue.map((q) => q.log.plan_slot_id)).toEqual(['s-bre']);
};

beforeEach(() => {
  jest.clearAllMocks();
  queryClient.clear();
  useClientStore.getState().reset();
  mockFocus.clear();
  mockNet.online = true;
  mockQueue.length = 0;
  Object.assign(mockServer, { reads: true, writes: true, entries: [] });
  mockServer.foods.clear();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  let n = 0;
  jest.mocked(foodApi.create).mockImplementation((async (food: Omit<Food, 'id'>) => {
    if (!mockServer.writes) throw lost();
    const id = `food-${++n}`;
    mockServer.foods.set(id, { ...food, id });
    return { data: { id } };
  }) as unknown as typeof foodApi.create);
  jest.mocked(logApi.logFood).mockImplementation((async (log: Omit<Entry, 'id' | 'user_id' | 'food_item'>) => {
    if (!mockServer.writes) throw lost();
    const id = `entry-${mockServer.entries.length + 1}`;
    mockServer.entries.push({ ...log, id, user_id: 'client', plan_slot_id: log.plan_slot_id ?? null,
      food_item: mockServer.foods.get(log.food_item_id)! });
    return { data: { id } };
  }) as unknown as typeof logApi.logFood);
  jest.mocked(logApi.getDaily).mockImplementation((async (date: string) => {
    if (!mockServer.reads) throw lost();
    const entries = mockServer.entries.filter((e) => e.date === date).map((e) => ({ ...e }));
    return { data: { entries, total_calories: entries.length * 420, total_protein_g: entries.length * 24 } };
  }) as unknown as typeof logApi.getDaily);
});
afterEach(() => {
  jest.restoreAllMocks();
  queryClient.clear();
});

/**
 * MEALPLAN-STORE-DAY-M: the Food tab's good day read is every reader's day log now, so these cases (the phone's foods
 * with no day log held) drop it, as a cache that no longer holds the day would.
 */
const noDayLogHeld = () => {
  queryClient.removeQueries({ queryKey: DAY_KEY, exact: true });
  expect(queryClient.getQueryState(DAY_KEY)).toBeUndefined();
};
/** Online, she opens the app on the Food tab (the day and the plan load); the page has not read today's day log. */
async function foodTabOnlineThenSignalGone() {
  await render(<App pageOpen={false} />);
  await settle();
  noDayLogHeld();
  await signalGone();
}
/** She opens More > Meal plan with no signal: its day log read fails after the app's retries. */
async function openThePageOffline() {
  await act(async () => { openPage(true); });
  await settle();
  await retriesRunOut();
  expect(queryClient.getQueryState(DAY_KEY)?.data).toBeUndefined();
  expect(queryClient.getQueryState(DAY_KEY)?.status).toBe('error');
}
const saveBreakfastOnTheFoodDay = async () => {
  await fireEvent.press(await screen.findByTestId('food-day-primary'));
  await settle();
  expect(mockQueue.map((q) => q.log.plan_slot_id)).toEqual(['s-bre']);
};

describe('MEALPLAN-OFFLINE-JOIN-M: offline, with no day log held, the meal plan page counts the foods saved on this phone', () => {
  // The sweep's B-TEST (btest/SWEEP-FINAL-OFFLINE-B1 @ 42d98492), case 1 as written.
  it('B1: breakfast saved on the Food tab offline shows as eaten on the meal plan page opened after', async () => {
    await render(<App pageOpen={false} />);
    await settle();
    // The Food tab read the day and the plan online; the page has not read today's day log.
    noDayLogHeld();
    await signalGone();
    await fireEvent.press(await screen.findByTestId('food-day-primary'));
    await settle();
    expect(mockQueue.map((q) => q.log.plan_slot_id)).toEqual(['s-bre']);
    await act(async () => { openPage(true); });
    await settle();
    await retriesRunOut();
    // At main the page shows breakfast not eaten, with its one-tap "Log this meal" (a tap queues it a second time).
    expect(page().getByText('Logged as planned')).toBeTruthy();
  }, 30000);

  // The sweep's B-TEST, case 2 as written.
  it('B1: her own "Log this meal" offline, then the page closed and opened again, shows breakfast eaten', async () => {
    await render(<App pageOpen={false} />);
    await settle();
    await signalGone();
    await act(async () => { openPage(true); });
    await settle();
    await retriesRunOut();
    await fireEvent.press(page().getByLabelText('Log this meal: Overnight oats'));
    await settle();
    expect(mockQueue.map((q) => q.log.plan_slot_id)).toEqual(['s-bre']);
    await act(async () => { openPage(false); });
    await settle();
    await act(async () => { openPage(true); });
    await settle();
    await retriesRunOut();
    // At main breakfast is not eaten again on the page she saved it from.
    expect(page().getByText('Logged as planned')).toBeTruthy();
  }, 30000);

  it.each([
    ['the Food day\'s "Ate it as planned", then she opens the page', async () => {
      await saveBreakfastOnTheFoodDay();
      await openThePageOffline();
    }],
    ['the Food day\'s "Ate it as planned" while the page is open with no day log', async () => {
      await openThePageOffline();
      expect(page().queryByText('Logged as planned')).toBeNull();
      await saveBreakfastOnTheFoodDay();
    }],
    ['the page\'s own "Log this meal", then the page closed and opened again', async () => {
      await openThePageOffline();
      await fireEvent.press(page().getByLabelText('Log this meal: Overnight oats'));
      await settle();
      await act(async () => { openPage(false); });
      await settle();
      await openThePageOffline();
    }],
  ])('%s: breakfast is eaten, lunch is not, no next meal and no kcal left', async (_path, steps) => {
    await foodTabOnlineThenSignalGone();
    await steps();
    pageShowsBreakfastSavedWithNoLog();
  }, 30000);

  it('a food the server refused (parked on the phone) counts nowhere: breakfast stays not eaten', async () => {
    await foodTabOnlineThenSignalGone();
    await saveBreakfastOnTheFoodDay();
    const parkedAt = Date.now();
    mockQueue.forEach((q) => { q.parkedAt = parkedAt; });
    await act(async () => {
      useClientStore.setState((st) => ({ queuedFoods: st.queuedFoods.map((q) => ({ ...q, parkedAt })) }));
    });
    await openThePageOffline();
    expect(page().queryByText('Logged as planned')).toBeNull();
    expect(markFilled('s-bre')).toBe(false);
    expect(page().getByLabelText('Log this meal: Overnight oats')).toBeTruthy();
  }, 30000);

  it('nothing saved on the phone and no day log: main\'s rule, every "Log this meal" and no next meal', async () => {
    await foodTabOnlineThenSignalGone();
    await openThePageOffline();
    expect(page().queryByText('Logged as planned')).toBeNull();
    expect(markFilled('s-bre')).toBe(false);
    expect(markFilled('s-lun')).toBe(false);
    expect(page().getAllByText('Log this meal')).toHaveLength(2);
    expect(page().queryByTestId('daily-meal-plan-next-card')).toBeNull();
    expect(page().queryByText('Ate it as planned')).toBeNull();
    expect(page().queryByTestId('daily-meal-plan-seg')).toBeNull();
  }, 30000);
});
