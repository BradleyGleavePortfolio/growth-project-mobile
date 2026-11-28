/**
 * FIX-MPF-1 (OPERATOR RULING 7235584848 on m#1043 round 1): the day's log is marked for its other readers only after a
 * change the server took, a re-read that fails keeps the last good answer, and the meal plan page counts the foods
 * saved on this phone.
 *
 * (a) No mark of ['food','log',<day>] (and so no read by the open meal plan page) for: the Food tab's pull to refresh,
 *     online or with no signal; its "Try again"; a Remove the server refused or never got; a food only the phone's
 *     queue holds; a send of glasses and weigh-ins alone; a glass whose answer lands after she opened another day.
 * (b) The meal plan page and Macro targets keep the day log they already read when a later read fails (a write the
 *     server took, then a re-read on a weak signal); opened with no signal and no answer yet, both keep main's rule.
 * (c) C1: offline, a meal she saved on the Food tab shows as eaten on the page, and the page's "Ate it as planned"
 *     moves on to the next meal, never that meal again (the join FIX-PSM-2 (b) gave the plan meal page).
 *
 * Harness: the PR's own (MealPlanPageFresh.foodTabWrites.test.tsx) with LO's network switch (the round-1 B-TEST), plus
 * a phone queue that keeps what is saved, a server that can refuse reads or writes, and Macro targets. Names are
 * fictional.
 */
import React from 'react';
import { Alert, View } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../LogScreen';
import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';
import ClientMacrosScreen from '../ClientMacrosScreen';
import { queryClient } from '../../../services/queryClient';
import { foodApi, logApi, waterApi } from '../../../services/api';
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
const mockTarget = { id: 't1', client_id: 'client', coach_id: 'coach', calories_kcal: 2000, protein_g: 150, carbs_g: 200,
  fats_g: 60, fiber_g: 30, notes: null, effective_from: '2026-10-01', macro_display_mode: 'full' };

// The fake server: what POST /log/food stores, GET /log/daily answers (each entry counts 420 kcal and 24 g protein),
// PATCH and DELETE change. `mockServer.reads` / `.writes` false: that call fails as a lost connection does.
type Food = { id: string; name: string; calories: number; protein_g: number; carbs_g: number; fat_g: number;
  nutrient_basis: string; serving_size_grams: number };
type Entry = { id: string; date: string; food_item_id: string; user_id: string; meal_type: string; quantity_multiplier: number;
  original_quantity?: number; original_unit?: string; plan_slot_id: string | null; client_uuid?: string; food_item: Food };
const mockServer = { foods: new Map<string, Food>(), entries: [] as Entry[], reads: true, writes: true };
const oats: Food = { id: 'f1', name: 'Rolled oats', calories: 379, protein_g: 13, carbs_g: 68, fat_g: 6.5,
  nutrient_basis: 'PER_100G', serving_size_grams: 40 };
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
jest.mock('../../../hooks/useMacros', () => ({
  useCurrentMacrosForSelf: () => ({ data: mockTarget, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false }),
}));
// The Food tab's and the page's send decision (LogScreen `online`, LogPlannedMealButton's NetInfo check).
const mockNet = { online: true };
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => mockNet.online }));
const mockLastMeals: Record<string, unknown> = {};
jest.mock('../../../hooks/useFoodBrowse', () => ({ useFoodBrowse: () => ({
  recentFoods: [{ id: 'f1', name: 'Rolled oats', calories: 379, protein: 13, carbs: 68, fat: 6.5, serving_size_grams: 40,
    nutrient_basis: 'PER_100G', supports_volume_units: false }],
  frequentFoods: [], lastMeals: mockLastMeals, loadBrowseFoods: jest.fn().mockResolvedValue(undefined),
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
// The phone's queue keeps what is saved offline; its flush is set per case.
const mockQueue: Array<Record<string, unknown> & { id: string; log: { plan_slot_id?: string } }> = [];
const mockFlush = jest.fn();
jest.mock('../../../services/foodLogQueue', () => ({
  flush: (...a: unknown[]) => mockFlush(...a),
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
/** She taps the You tab again: the You stack (still on the meal plan page) gains focus. */
const backToYouTab = async () => {
  await act(async () => { [...mockFocus].forEach((cb) => cb()); });
  await settle();
};
/** The signal goes: the Food tab and the page decide offline (after their next render), and the server is out of reach. */
const signalGone = async () => {
  mockNet.online = false;
  mockServer.reads = false;
  mockServer.writes = false;
  await act(async () => { useClientStore.setState({}); });
};
let openPage: (open: boolean) => void = () => undefined;
function App({ pageOpen = true, macros = false }: { pageOpen?: boolean; macros?: boolean }) {
  const [open, setOpen] = React.useState(pageOpen);
  openPage = setOpen;
  return (
    <QueryClientProvider client={queryClient}>
      <LogScreen />
      {open ? <View testID="meal-plan-page"><ClientDailyMealPlanScreen /></View> : null}
      {macros ? <View testID="macro-targets"><ClientMacrosScreen /></View> : null}
    </QueryClientProvider>
  );
}
const page = () => within(screen.getByTestId('meal-plan-page'));
const macroTargets = () => within(screen.getByTestId('macro-targets'));
const nextCard = () => page().getByTestId('daily-meal-plan-next-card');
/** The open readers' read of today's log: how many answers and failures it has had, and whether it was marked. */
const DAY_KEY = ['food', 'log', mockDay];
const pageReads = () => {
  const st = queryClient.getQueryState(DAY_KEY);
  return (st?.dataUpdateCount ?? 0) + (st?.errorUpdateCount ?? 0);
};
let marks: jest.SpyInstance;
const foodLogMarks = () => marks.mock.calls.filter(([f]) => {
  const key = (f as { queryKey?: unknown[] } | undefined)?.queryKey ?? [];
  return key[0] === 'food' && key[1] === 'log';
}).length;
/** The page reads breakfast as eaten and lunch is up next with "Ate it as planned". */
const pageShowsBreakfastEaten = () => {
  expect(page().getByText('Logged as planned')).toBeTruthy();
  expect(within(nextCard()).getByLabelText('Log this meal: Chicken salad')).toBeTruthy();
  expect(within(nextCard()).getByText('Ate it as planned')).toBeTruthy();
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
  mockNet.online = true;
  mockQueue.length = 0;
  Object.assign(mockServer, { reads: true, writes: true, entries: [] });
  mockServer.foods.clear();
  mockServer.foods.set(oats.id, oats);
  delete mockLastMeals.breakfast;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  // Remove asks first; she confirms.
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.text === 'Delete')?.onPress?.();
  });
  marks = jest.spyOn(queryClient, 'invalidateQueries');
  mockFlush.mockResolvedValue({ flushed: 0, remaining: 0, parked: 0, days: [] });
  let n = 0;
  jest.mocked(foodApi.create).mockImplementation((async (food: Omit<Food, 'id'>) => {
    if (!mockServer.writes) throw lost();
    const id = `food-${++n}`;
    mockServer.foods.set(id, { id, name: food.name, calories: food.calories, protein_g: food.protein_g, carbs_g: food.carbs_g,
      fat_g: food.fat_g, nutrient_basis: food.nutrient_basis, serving_size_grams: food.serving_size_grams });
    return { data: { id } };
  }) as unknown as typeof foodApi.create);
  jest.mocked(logApi.logFood).mockImplementation((async (log: Parameters<typeof serverTakes>[0]) => {
    if (!mockServer.writes) throw lost();
    return { data: { id: serverTakes(log) } };
  }) as unknown as typeof logApi.logFood);
  jest.mocked(logApi.updateEntry).mockImplementation((async (id: string, change: Partial<Entry>) => {
    if (!mockServer.writes) throw lost();
    Object.assign(mockServer.entries.find((x) => x.id === id)!, change);
    return { data: { id } };
  }) as unknown as typeof logApi.updateEntry);
  jest.mocked(logApi.deleteEntry).mockImplementation((async (id: string) => {
    if (!mockServer.writes) throw lost();
    mockServer.entries = mockServer.entries.filter((x) => x.id !== id);
    return { data: {} };
  }) as unknown as typeof logApi.deleteEntry);
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

/** Online, breakfast eaten on the Food tab, then she opens You > Meal plan (and Macro targets): both read it. */
async function breakfastThenThePage(macros = false) {
  await render(<App pageOpen={false} macros={macros} />);
  await settle();
  await fireEvent.press(await screen.findByTestId('food-day-primary'));
  await settle();
  expect(breakfastSlots()).toHaveLength(1);
  await act(async () => { openPage(true); });
  await settle();
  pageShowsBreakfastEaten();
}
/** On the Food tab: open the eaten breakfast, then its one food's edit sheet. */
async function openBreakfastFood() {
  await fireEvent.press(await screen.findByTestId('food-day-slot-s-bre'));
  await fireEvent.press(await screen.findByLabelText(/^Overnight oats, /));
  await screen.findByTestId('log-edit-save');
}
const pullOnTheFoodTab = async () => {
  await act(async () => { await screen.getByTestId('log-screen-scroll').props.refreshControl.props.onRefresh(); });
};

describe('FIX-MPF-1 (B1 a): no mark of the day log, and no read by the open page, without a change the server took', () => {
  const noChange: [string, () => Promise<void>][] = [
    ['her pull to refresh on the Food tab, online', pullOnTheFoodTab],
    ['her pull to refresh on the Food tab with no signal', async () => {
      await signalGone();
      await pullOnTheFoodTab();
    }],
    ['the Food tab\'s "Try again" after its day did not load', async () => {
      await signalGone();
      await pullOnTheFoodTab();
      await settle();
      marks.mockClear();
      await fireEvent.press(await screen.findByTestId('log-day-data-error-retry'));
    }],
    ['a Remove the server refused', async () => {
      jest.mocked(logApi.deleteEntry).mockRejectedValueOnce(Object.assign(new Error('Server error'), { response: { status: 500 } }));
      await openBreakfastFood();
      await fireEvent.press(screen.getByText('Delete entry'));
    }],
    ['a Remove the server never got (no signal)', async () => {
      await openBreakfastFood();
      mockServer.writes = false;
      mockServer.reads = false;
      await fireEvent.press(screen.getByText('Delete entry'));
    }],
    ['a food only the phone\'s queue holds (saved with no signal)', async () => {
      await signalGone();
      await fireEvent.press(await screen.findByTestId('food-day-primary'));
      expect(mockQueue).toHaveLength(1);
    }],
    ['a send of glasses and weigh-ins alone, on reconnect', async () => {
      mockFlush.mockResolvedValueOnce({ flushed: 2, remaining: 0, parked: 0, days: [] });
      await act(async () => { await syncFoodLogQueue(); });
    }],
    ['a glass of water whose answer lands after she opened yesterday', async () => {
      let answer: (v: unknown) => void = () => undefined;
      jest.mocked(waterApi.log).mockImplementationOnce((() => new Promise((r) => { answer = r; })) as unknown as typeof waterApi.log);
      let glass: Promise<void> = Promise.resolve();
      await act(async () => { glass = useClientStore.getState().logWater('client', '', 8); });
      await act(async () => { await useClientStore.getState().loadDayData('client', yesterday); });
      await act(async () => { answer({ data: { id: 'w1', amount_ml: 237 } }); await glass; });
    }],
  ];
  it.each(noChange)('FIX-MPF-1: %s marks no day log and the page reads nothing; breakfast stays eaten', async (_name, step) => {
    await breakfastThenThePage();
    marks.mockClear();
    const reads = pageReads();
    await step();
    await settle();
    await retriesRunOut();
    expect(foodLogMarks()).toBe(0);
    expect(queryClient.getQueryState(DAY_KEY)?.isInvalidated).toBe(false);
    expect(pageReads()).toBe(reads);
    await backToYouTab();
    expect(page().getAllByText('Logged as planned').length).toBeGreaterThan(0);
  }, 20000);
});

describe('FIX-MPF-1 (B1 b): a re-read that fails keeps the last good answer; no answer yet keeps main\'s rule', () => {
  /** A food the server takes (a coffee, in no plan meal), then every read of the day fails: a weak signal. */
  const coffeeThenNoReads = async () => {
    mockServer.reads = false;
    await act(async () => {
      await useClientStore.getState().logFood({ userId: 'client', date: mockDay, mealType: 'snack', foodItemId: 'f1' });
    });
    await settle();
    await retriesRunOut();
    expect(mockServer.entries).toHaveLength(2);
    // The write marked the day, the open readers read it again, and that read failed.
    expect(queryClient.getQueryState(DAY_KEY)?.status).toBe('error');
    await backToYouTab();
  };

  it('FIX-MPF-1: the meal plan page keeps breakfast eaten, lunch up next and what is left when its re-read fails', async () => {
    await breakfastThenThePage();
    expect(page().getByText('1,580 kcal and 126 g protein left.')).toBeTruthy();
    await coffeeThenNoReads();
    pageShowsBreakfastEaten();
    expect(page().getByText('1,580 kcal and 126 g protein left.')).toBeTruthy();
  }, 20000);

  it('FIX-MPF-1: Macro targets keeps what she ate today when its re-read fails, and says nothing failed', async () => {
    await breakfastThenThePage(true);
    expect(macroTargets().getByText('420 kcal eaten today')).toBeTruthy();
    await coffeeThenNoReads();
    expect(macroTargets().getByText('420 kcal eaten today')).toBeTruthy();
    expect(macroTargets().queryByText("Today's food totals did not load. Pull to retry.")).toBeNull();
  }, 20000);

  it('FIX-MPF-1: opened with no signal and no answer yet, the page claims no next meal and keeps every "Log this meal"', async () => {
    mockServer.reads = false;
    await render(<App />);
    await settle();
    await retriesRunOut();
    expect(page().queryByTestId('daily-meal-plan-next-card')).toBeNull();
    expect(page().queryByText('Ate it as planned')).toBeNull();
    expect(page().queryByText('Logged as planned')).toBeNull();
    expect(page().getAllByText('Log this meal')).toHaveLength(2);
  }, 20000);

  it('FIX-MPF-1: opened with no signal and no answer yet, Macro targets says the totals did not load and shows none', async () => {
    mockServer.reads = false;
    await render(<App macros />);
    await settle();
    await retriesRunOut();
    expect(macroTargets().getByText("Today's food totals did not load. Pull to retry.")).toBeTruthy();
    expect(macroTargets().queryByText(/kcal eaten today/)).toBeNull();
  }, 20000);
});

describe('FIX-MPF-1 (C1): offline, the page counts the foods saved on this phone for its day', () => {
  it('FIX-MPF-1: breakfast saved on the Food tab with no signal shows as eaten, and the page\'s "Ate it as planned" queues lunch, never breakfast again', async () => {
    await render(<App />);
    await settle();
    expect(within(nextCard()).getByLabelText('Log this meal: Overnight oats')).toBeTruthy();
    await signalGone();
    await fireEvent.press(await screen.findByTestId('food-day-primary'));
    await settle();
    expect(mockQueue.map((q) => q.log.plan_slot_id)).toEqual(['s-bre']);
    await backToYouTab();
    pageShowsBreakfastEaten();
    await fireEvent.press(within(nextCard()).getByText('Ate it as planned'));
    await settle();
    // At main the page still offered breakfast: ['s-bre', 's-bre'], and both land on reconnect.
    expect(mockQueue.map((q) => q.log.plan_slot_id)).toEqual(['s-bre', 's-lun']);
  }, 20000);

  it('FIX-MPF-1: with no signal, the page\'s own "Ate it as planned" moves the page on to lunch', async () => {
    await render(<App />);
    await settle();
    await signalGone();
    await fireEvent.press(within(nextCard()).getByText('Ate it as planned'));
    await settle();
    expect(mockQueue.map((q) => q.log.plan_slot_id)).toEqual(['s-bre']);
    expect(page().getByText('Logged as planned')).toBeTruthy();
    expect(within(nextCard()).getByLabelText('Log this meal: Chicken salad')).toBeTruthy();
    expect(logApi.logFood).not.toHaveBeenCalled();
  }, 20000);
});
