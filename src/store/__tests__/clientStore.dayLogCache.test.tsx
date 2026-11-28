/**
 * MEALPLAN-STORE-DAY-M (LS-MEALPLAN-OFFLINE-JOIN-M-1 C1, OPERATOR RULING 7237750248; the sweep's N5): the meal plan page
 * and the plan meal page know what the Food tab already read from the server about her day. At main 89a4e7f9 the Food
 * tab's store (clientStore.loadDayData, logApi.getDaily) and the pages' day log (['food','log',d], useTodayLog, the same
 * route) never share an answer, so a meal she logged ONLINE on the Food tab is unknown to a page that has not read the
 * day itself. Offline, that page's read fails: breakfast shows as not eaten, and one tap logs it a second time.
 *
 * The rule: a good day read of the store, for this session and this day, is every reader's answer for that day, held
 * while the store shows the day. A failed read writes nothing; another session's read writes nothing; a newer reader's
 * answer, or a change marked since the read began, is never replaced by the older answer.
 *
 * Harness: the LS probe (alm/notes-ls-mealplan-offline-join-m-1, LS-MEALPLAN-OFFLINE-JOIN-M-1.probe-C1.tsx.txt), from
 * MealPlanPageFresh.noMarkHeld's: the real Food tab, pages, store and app query client; the server and the phone's
 * queue are fakes. Names are fictional.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../../screens/client/LogScreen';
import ClientDailyMealPlanScreen from '../../screens/client/ClientDailyMealPlanScreen';
import PlanMealScreen from '../../screens/client/mealplan/PlanMealScreen';
import { queryClient } from '../../services/queryClient';
import { foodApi, logApi } from '../../services/api';
import { useClientStore } from '../clientStore';
import { getTodayString } from '../../utils/date';

const mockDay = getTodayString();
const OTHER_DAY = '2026-10-01';
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
// call fails as a lost connection does. `mockServer.hold`: the next day read waits until it is let go.
type Food = { id: string; name: string; calories: number; protein_g: number; carbs_g: number; fat_g: number;
  nutrient_basis: string; serving_size_grams: number };
type Entry = { id: string; date: string; food_item_id: string; user_id: string; meal_type: string; quantity_multiplier: number;
  plan_slot_id: string | null; client_uuid?: string; food_item: Food };
const mockServer = { foods: new Map<string, Food>(), entries: [] as Entry[], reads: true, writes: true, user: 'client' };
const lost = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', isAxiosError: true });

jest.mock('../../config/featureFlags', () => {
  const real = jest.requireActual('../../config/featureFlags');
  const on = Object.fromEntries(Object.keys(real.featureFlags).map((k) => [k, true]));
  return { ...real, featureFlags: on };
});
const mockFocus = new Set<() => void>();
const mockRoute: { params: undefined | { date: string; slotId: string } } = { params: undefined };
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
    useRoute: () => mockRoute,
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
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client', coach_id: 'coach' }) }));
jest.mock('../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../hooks/useMacros', () => ({
  useCurrentMacrosForSelf: () => ({ data: mockTarget, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false }),
}));
// The Food tab's and the pages' send decision (LogScreen `online`, LogPlannedMealButton's NetInfo check).
const mockNet = { online: true };
jest.mock('../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => mockNet.online }));
jest.mock('../../hooks/useFoodBrowse', () => ({ useFoodBrowse: () => ({
  recentFoods: [], frequentFoods: [], lastMeals: {}, loadBrowseFoods: jest.fn().mockResolvedValue(undefined),
}) }));
jest.mock('../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full', reportMacroDisplay: jest.fn() }));
jest.mock('../../services/api', () => ({
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
jest.mock('../../services/foodLogQueue', () => ({
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
jest.mock('../../lib/userCache', () => ({
  ...jest.requireActual('../../lib/userCache'), readUserCacheSync: () => ({ id: 'client' }),
}));
jest.mock('../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
/** The app's retries for a read (queryClient.ts: two, 1 s then 2 s) run out. */
const retriesRunOut = () => act(async () => { await new Promise((r) => setTimeout(r, 3600)); });
/** The signal goes: the Food tab and the pages decide offline (after their next render), and the server is out of reach. */
const signalGone = async () => {
  mockNet.online = false;
  mockServer.reads = false;
  mockServer.writes = false;
  await act(async () => { useClientStore.setState({}); });
};
type Page = 'meal-plan' | 'plan-meal';
let openPage: (page: Page | null) => void = () => undefined;
function App() {
  const [page, setPage] = React.useState<Page | null>(null);
  openPage = setPage;
  return (
    <QueryClientProvider client={queryClient}>
      <LogScreen />
      {page === 'meal-plan' ? <View testID="meal-plan-page"><ClientDailyMealPlanScreen /></View> : null}
      {page === 'plan-meal' ? <View testID="plan-meal-page"><PlanMealScreen /></View> : null}
    </QueryClientProvider>
  );
}
const page = () => within(screen.getByTestId('meal-plan-page'));
const planMeal = () => within(screen.getByTestId('plan-meal-page'));
const DAY_KEY = ['food', 'log', mockDay];
const OTHER_KEY = ['food', 'log', OTHER_DAY];
/** A meal's gutter mark is filled (eaten) when its fill is its ring's colour (planStyleC TimelineRow). */
const markFilled = (slotId: string) => {
  const st = StyleSheet.flatten(page().getByTestId(`daily-meal-plan-mark-${slotId}`, { includeHiddenElements: true }).props.style);
  return st.backgroundColor === st.borderColor;
};
/** What GET /log/daily answers for a day now (the shape useTodayLog's queryFn returns: `(await getDaily(d)).data`). */
const serverAnswer = (date: string) => {
  const entries = mockServer.entries.filter((e) => e.date === date && e.user_id === mockServer.user).map((e) => ({ ...e }));
  return { entries, total_calories: entries.length * 420, total_protein_g: entries.length * 24 };
};
/** A day read the test lets go of by hand (it answers with the server as it is at that moment). */
const heldReads: Array<{ date: string; go: () => void; fail: () => void }> = [];
let holdNextRead = false;

beforeEach(() => {
  jest.clearAllMocks();
  queryClient.clear();
  useClientStore.getState().reset();
  mockFocus.clear();
  mockRoute.params = undefined;
  mockNet.online = true;
  mockQueue.length = 0;
  heldReads.length = 0;
  holdNextRead = false;
  Object.assign(mockServer, { reads: true, writes: true, entries: [], user: 'client' });
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
    mockServer.entries.push({ ...log, id, user_id: mockServer.user, plan_slot_id: log.plan_slot_id ?? null,
      food_item: mockServer.foods.get(log.food_item_id)! });
    return { data: { id } };
  }) as unknown as typeof logApi.logFood);
  jest.mocked(logApi.getDaily).mockImplementation((async (date: string) => {
    if (holdNextRead) {
      holdNextRead = false;
      return new Promise((resolve, reject) => {
        heldReads.push({ date, go: () => resolve({ data: serverAnswer(date) }), fail: () => reject(lost()) });
      });
    }
    if (!mockServer.reads) throw lost();
    return { data: serverAnswer(date) };
  }) as unknown as typeof logApi.getDaily);
});
afterEach(() => {
  jest.restoreAllMocks();
  queryClient.clear();
});

/** Online, she opens the app on the Food tab and taps "Ate it as planned" on breakfast: the server takes it. */
async function breakfastLoggedOnlineOnTheFoodTab() {
  await render(<App />);
  await settle();
  await fireEvent.press(await screen.findByTestId('food-day-primary'));
  await settle();
  expect(mockServer.entries.map((e) => e.plan_slot_id)).toEqual(['s-bre']);
  expect(mockQueue).toHaveLength(0);
}
/** She opens a page with no signal: its own day log read fails after the app's retries. */
async function openOffline(which: Page) {
  if (which === 'plan-meal') mockRoute.params = { date: mockDay, slotId: 's-bre' };
  await act(async () => { openPage(which); });
  await settle();
  await retriesRunOut();
}
/** A reader's own read of a day's log (useTodayLog's queryFn, under its key). */
const readerRead = (date: string) =>
  queryClient.fetchQuery({ queryKey: ['food', 'log', date], queryFn: async () => (await logApi.getDaily(date)).data });
const breakfastOnServer = (date = mockDay, user = 'client') => {
  mockServer.foods.set('food-b', { id: 'food-b', name: 'Overnight oats', calories: 420, protein_g: 24, carbs_g: 55, fat_g: 12,
    nutrient_basis: 'PER_SERVING', serving_size_grams: 100 });
  mockServer.entries.push({ id: `entry-${mockServer.entries.length + 1}`, date, food_item_id: 'food-b', user_id: user,
    meal_type: 'breakfast', quantity_multiplier: 1, plan_slot_id: 's-bre', food_item: mockServer.foods.get('food-b')! });
};
const load = (date: string, user = 'client') => act(async () => { await useClientStore.getState().loadDayData(user, date); });

describe('MEALPLAN-STORE-DAY-M: a meal logged online on the Food tab is known to the meal plan pages offline', () => {
  it('(1) the LS probe: the meal plan page opened offline with no read of its own shows breakfast eaten, as online', async () => {
    await breakfastLoggedOnlineOnTheFoodTab();
    await signalGone();
    await openOffline('meal-plan');
    // The page's own read failed; it holds the Food tab's last good answer for the day.
    expect(queryClient.getQueryState(DAY_KEY)?.fetchStatus).toBe('idle');
    expect(page().getByText('Logged as planned')).toBeTruthy();
    expect(markFilled('s-bre')).toBe(true);
    expect(markFilled('s-lun')).toBe(false);
    // GOAL-927 keeps "Log this meal" under an eaten meal (ruling 7237750248 N1): a tap is a deliberate choice, as online.
    expect(page().getByLabelText('Log this meal: Overnight oats')).toBeTruthy();
    expect(page().getByLabelText('Log this meal: Chicken salad')).toBeTruthy();
    // Nothing was queued: the one breakfast is the server's.
    expect(mockQueue).toHaveLength(0);
  }, 30000);

  it('(1b) the same when the page is opened long after the Food tab\'s read (past the app\'s cache time for a reader-less day)', async () => {
    const gcTime = queryClient.getDefaultOptions().queries?.gcTime;
    queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, gcTime: 100 } });
    try {
      await breakfastLoggedOnlineOnTheFoodTab();
      await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
      expect(queryClient.getQueryData(DAY_KEY)).toEqual(serverAnswer(mockDay));
      await signalGone();
      await openOffline('meal-plan');
      expect(page().getByText('Logged as planned')).toBeTruthy();
      expect(markFilled('s-bre')).toBe(true);
    } finally {
      queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, gcTime } });
    }
  }, 30000);

  it('(2) the plan meal page opened offline does not offer "Ate it as planned" for the breakfast she logged online', async () => {
    await breakfastLoggedOnlineOnTheFoodTab();
    await signalGone();
    await openOffline('plan-meal');
    expect(planMeal().getByText('Logged as planned')).toBeTruthy();
    expect(planMeal().queryByText('Ate it as planned', { includeHiddenElements: true })).toBeNull();
    expect(mockQueue).toHaveLength(0);
  }, 30000);
});

describe('MEALPLAN-STORE-DAY-M: the store writes its good day answer into the day log every reader reads', () => {
  it('a good read writes exactly what useTodayLog\'s queryFn returns for that day, and sends no other read', async () => {
    breakfastOnServer();
    await load(mockDay);
    expect(logApi.getDaily).toHaveBeenCalledTimes(1);
    const written = queryClient.getQueryData(DAY_KEY);
    expect(written).toEqual((await logApi.getDaily(mockDay)).data);
    expect(queryClient.getQueryState(DAY_KEY)?.status).toBe('success');
    await settle();
    // setQueryData marks nothing stale and fetches nothing: the one read above, plus the comparison's own.
    expect(logApi.getDaily).toHaveBeenCalledTimes(2);
  });

  it('(3) a failed store read writes nothing: a reader keeps the answer it holds', async () => {
    breakfastOnServer();
    await act(async () => { await readerRead(mockDay); });
    const held = queryClient.getQueryState(DAY_KEY);
    mockServer.entries.length = 0;
    mockServer.reads = false;
    await load(mockDay);
    expect(useClientStore.getState().loadError).not.toBeNull();
    const after = queryClient.getQueryState(DAY_KEY);
    expect(after?.data).toEqual(held?.data);
    expect(after?.dataUpdatedAt).toBe(held?.dataUpdatedAt);
  });

  it('(3b) a failed store read with no answer anywhere writes nothing (no empty day for the pages)', async () => {
    mockServer.reads = false;
    await load(mockDay);
    expect(queryClient.getQueryState(DAY_KEY)).toBeUndefined();
  });

  it('(4) a store read for another day writes only that day', async () => {
    breakfastOnServer(OTHER_DAY);
    await load(OTHER_DAY);
    expect(queryClient.getQueryData(OTHER_KEY)).toEqual(serverAnswer(OTHER_DAY));
    expect(queryClient.getQueryState(DAY_KEY)).toBeUndefined();
  });

  it('(5) sign-out, then another client: the first client\'s late answer is never written into the next one\'s cache', async () => {
    breakfastOnServer();
    holdNextRead = true;
    let first: Promise<void> = Promise.resolve();
    await act(async () => { first = useClientStore.getState().loadDayData('client', mockDay); });
    expect(heldReads).toHaveLength(1);
    // Sign-out (authActions: the store reset, the query cache settled and cleared), then the next client signs in.
    await act(async () => {
      useClientStore.getState().reset();
      queryClient.clear();
    });
    heldReads[0].go();
    await act(async () => { await first; });
    expect(queryClient.getQueryState(DAY_KEY)).toBeUndefined();
    mockServer.user = 'client-2';
    await load(mockDay, 'client-2');
    expect(queryClient.getQueryData(DAY_KEY)).toEqual({ entries: [], total_calories: 0, total_protein_g: 0 });
  });

  it('(5b) sign-out lets go of the day the store held in the cache', async () => {
    await load(mockDay);
    const query = queryClient.getQueryCache().find({ queryKey: DAY_KEY });
    expect(query?.getObserversCount()).toBe(1);
    await act(async () => { useClientStore.getState().reset(); });
    expect(query?.getObserversCount()).toBe(0);
  });

  it('a newer reader answer for the same day is never replaced by an older store answer', async () => {
    holdNextRead = true;
    let store: Promise<void> = Promise.resolve();
    await act(async () => { store = useClientStore.getState().loadDayData('client', mockDay); });
    // The store's read began before breakfast reached the server; a page's read after it holds breakfast.
    breakfastOnServer();
    await act(async () => { await readerRead(mockDay); });
    const newer = queryClient.getQueryState(DAY_KEY);
    expect((newer?.data as { entries: unknown[] }).entries).toHaveLength(1);
    // The older read answers last (as it was when it began: nothing logged).
    mockServer.entries.length = 0;
    heldReads[0].go();
    await act(async () => { await store; });
    expect(queryClient.getQueryState(DAY_KEY)?.data).toEqual(newer?.data);
    expect(queryClient.getQueryState(DAY_KEY)?.dataUpdatedAt).toBe(newer?.dataUpdatedAt);
  });

  it('a change marked after the store read began (m#1043) keeps every reader due to read again', async () => {
    await act(async () => { await readerRead(mockDay); });
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    holdNextRead = true;
    let store: Promise<void> = Promise.resolve();
    await act(async () => { store = useClientStore.getState().loadDayData('client', mockDay); });
    // A write the server took, marked as refreshShownDay(changed) marks it; the read in flight began before it.
    breakfastOnServer();
    await act(async () => { await queryClient.invalidateQueries({ queryKey: DAY_KEY }); });
    mockServer.entries.length = 0;
    heldReads[0].go();
    await act(async () => { await store; });
    expect(queryClient.getQueryState(DAY_KEY)?.isInvalidated).toBe(true);
    expect((queryClient.getQueryData(DAY_KEY) as { entries: unknown[] }).entries).toHaveLength(0);
  });

  it('a read that began after the mark (refreshShownDay(changed) then loadDayData) is written and holds the change', async () => {
    await act(async () => { await readerRead(mockDay); });
    breakfastOnServer();
    await act(async () => { await useClientStore.getState().refreshShownDay('client', mockDay, true); });
    expect(queryClient.getQueryState(DAY_KEY)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryData(DAY_KEY)).toEqual(serverAnswer(mockDay));
  });
});
