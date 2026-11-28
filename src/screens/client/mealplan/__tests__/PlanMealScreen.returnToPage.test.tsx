// FIX-PSM-2 (growth-project-mobile#1009, fix round 2): a return to the plan meal page (a tab switch and back). The
// focus hook runs here as React Navigation runs it (the effect on focus, its cleanup on blur, the effect again on the
// next focus); every other PlanMeal suite stubs it (LO-PLAN-SWAPS-M-2 C1).
// (a) a return keeps the last decision and LogPlannedMealButton with it, closed to taps while the return's read is out;
//     only a read that answers replaces the decision (LS-PLAN-SWAPS-M-2 C1 is the running save).
// (b) this meal's foods saved on the phone count as eaten, with main's waiting line (OFFLINE-FOOD-M), on an open and
//     on a return (the round-1 C: a meal saved offline on the Food day).
// Fictional data (client Jordan, coach Sam).
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import PlanMealScreen from '../PlanMealScreen';
import { submitManualLogOffline } from '../../../../utils/log/logSubmit';
import { notifyPendingFoodLogs } from '../../../../services/foodLogSync';
import { clearQueue } from '../../../../services/foodLogQueue';
import { useClientStore } from '../../../../store/clientStore';

jest.mock('../../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, foodPlanChecklist: true, youTabV2: true, clientTimelineV2: true, romanChat: true, offlineFoodInDay: true } };
});
const mockFocus: { cb: (() => void | (() => void)) | null; undo: (() => void) | null } = { cb: null, undo: null };
jest.mock('@react-navigation/native', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  return {
    useRoute: () => ({ params: { date: '2026-11-24', slotId: 's-din' } }),
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      R.useEffect(() => {
        mockFocus.cb = cb;
        const undo = cb();
        mockFocus.undo = typeof undo === 'function' ? undo : null;
        return () => mockFocus.undo?.();
      }, [cb]);
    },
  };
});
const mockGet = jest.fn();
const mockDaily = jest.fn();
const mockCreate = jest.fn();
const mockLogFood = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a) },
  recipesApi: { getById: jest.fn(async () => ({ data: { id: 'r1', ingredients: ['Salmon fillet 160 g'], instructions: [], allergens: [], allergens_declared: true } })) },
  listsApi: { bulkAdd: jest.fn() },
  logApi: { getDaily: (...a: unknown[]) => mockDaily(...a), deleteEntry: jest.fn(), logFood: (...a: unknown[]) => mockLogFood(...a) },
  foodApi: { create: (...a: unknown[]) => mockCreate(...a) },
}));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
}));
jest.useFakeTimers({
  now: new Date('2026-11-24T19:40:00'),
  advanceTimers: true,
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
    'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'],
});
afterAll(() => jest.useRealTimers());

const TODAY = '2026-11-24';
const dinner = {
  id: 'm-din', coach_id: 'sam', name: 'Salmon, potatoes and green beans', description: null,
  calories_kcal: 620, protein_g: 42, carbs_g: 55, fats_g: 22, fiber_g: null, items: null, created_at: '', archived_at: null,
};
const plan = {
  date: TODAY,
  changes_today: [],
  assignments: [{
    id: 'a1',
    daily_meal_plan: {
      id: 'p1', coach_id: 'sam', name: 'Training day', notes: null,
      slots: [{ id: 's-din', daily_meal_plan_id: 'p1', meal_template_id: 'm-din', slot_label: 'dinner', order: 0,
        time_of_day: '19:30', meal_template: dinner, swaps: [], recipe_id: 'r1' }],
    },
  }],
};
// The server's day once Dinner is logged as planned.
const dinnerLogged = {
  entries: [{
    id: 'e1', meal_type: 'dinner', plan_slot_id: 's-din', quantity_multiplier: 1, original_quantity: 1, original_unit: 'serving',
    food_item: { name: dinner.name, calories: 620, protein_g: 42, carbs_g: 55, fat_g: 22, nutrient_basis: 'PER_SERVING' },
  }],
};
const WAITING = `Saved offline. ${dinner.name} will sync when you reconnect.`;
const netinfo = NetInfo as unknown as { __setState: (s: object) => void; __reset: () => void };
const noConnection = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
const offline = () => {
  netinfo.__setState({ isConnected: false, isInternetReachable: false });
  mockDaily.mockRejectedValue(noConnection());
};
// The Food day's "Ate it as planned" with no connection (LogScreen logPlanned): main's offline write, then the count.
const savedOfflineOnFoodDay = () => act(async () => {
  await submitManualLogOffline({
    foodName: dinner.name, calories: '620', protein: '42', carbs: '55', fat: '22', quantity: '1', unit: 'serving',
    date: TODAY, mealType: 'dinner', link: { planSlotId: 's-din' },
  });
  await notifyPendingFoodLogs();
});
const leave = () => act(async () => {
  mockFocus.undo?.();
  mockFocus.undo = null;
});
const comeBack = () => act(async () => {
  const undo = mockFocus.cb?.();
  mockFocus.undo = typeof undo === 'function' ? undo : null;
});
const settle = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
});
const deferred = <T,>() => {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

let client: QueryClient | null = null;
const open = async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: 10 * 60_000 } } });
  await render(
    <QueryClientProvider client={client}>
      <PlanMealScreen />
    </QueryClientProvider>,
  );
};
// Every read the page has sent so far has answered (the open sends two: the mount read and the visit's).
const reads = () => waitFor(() => expect(client?.isFetching()).toBe(0), { timeout: 5000 });
beforeEach(async () => {
  jest.clearAllMocks();
  await clearQueue();
  useClientStore.getState().reset();
  netinfo.__reset();
  mockGet.mockImplementation(async (url: string) => {
    if (url.startsWith('/me/meal-plan/today')) return { data: plan };
    if (url === '/v1/clients/me/coach') return { data: { name: 'Sam Reid' } };
    throw new Error(`unexpected GET ${url}`);
  });
  mockDaily.mockResolvedValue({ data: { entries: [] } });
  mockCreate.mockResolvedValue({ data: { id: 'f1' } });
  mockLogFood.mockResolvedValue({ data: { id: 'e-new' } });
});
afterEach(() => {
  client?.clear();
  client = null;
});

describe('FIX-PSM-2: a return to the plan meal page', () => {
  it('online (LO C1): Dinner logged on the Food day while the page was away; back on the page it reads "Logged as planned"', async () => {
    await open();
    expect(await screen.findByText('Ate it as planned')).toBeTruthy();
    await reads();

    await leave();
    mockDaily.mockResolvedValue({ data: dinnerLogged });
    await comeBack();

    expect(await screen.findByText('Logged as planned', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByText('Ate it as planned', { includeHiddenElements: true })).toBeNull();
  });

  it('(a) online (LS C1): back on the page while "Ate it as planned" is still saving, the button keeps its save and its Undo', async () => {
    await open();
    await reads();
    const save = deferred<{ data: { id: string } }>();
    mockLogFood.mockReturnValueOnce(save.promise);
    fireEvent.press(await screen.findByText('Ate it as planned'));
    expect(await screen.findByText('Saving…')).toBeTruthy();

    // The return's read answers before the save lands: Dinner is not on the server yet.
    await leave();
    await comeBack();
    await reads();
    await settle();
    expect(screen.getByText('Saving…')).toBeTruthy();
    expect(screen.queryByText('Ate it as planned', { includeHiddenElements: true })).toBeNull();

    await act(async () => {
      save.resolve({ data: { id: 'e-new' } });
    });
    expect(await screen.findByText("Added to today's dinner.")).toBeTruthy();
    expect(screen.getByText('Undo')).toBeTruthy();
    expect(mockLogFood).toHaveBeenCalledTimes(1);
  });

  it('(a) while the return\'s read is out the button stays on screen, closed to taps; once the read answers one tap saves once', async () => {
    await open();
    expect(await screen.findByText('Ate it as planned')).toBeTruthy();
    await reads();

    await leave();
    const read = deferred<{ data: { entries: never[] } }>();
    mockDaily.mockImplementation(() => read.promise);
    await comeBack();
    const held = screen.getByText('Ate it as planned', { includeHiddenElements: true });
    expect(screen.getByTestId('plan-meal-log', { includeHiddenElements: true }).props.pointerEvents).toBe('none');
    fireEvent.press(held);
    await settle();
    expect(mockCreate).not.toHaveBeenCalled();

    await act(async () => {
      read.resolve({ data: { entries: [] } });
    });
    await waitFor(() => expect(screen.getByTestId('plan-meal-log').props.pointerEvents).toBe('auto'), { timeout: 5000 });
    fireEvent.press(screen.getByText('Ate it as planned'));
    expect(await screen.findByText("Added to today's dinner.")).toBeTruthy();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('(b) offline: Dinner saved offline on the Food day, then its page opened: main\'s waiting line, no "Ate it as planned"', async () => {
    offline();
    await savedOfflineOnFoodDay();
    await open();

    expect(await screen.findByText(WAITING, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByText('Ate it as planned', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByText('Logged as planned')).toBeNull();
  });

  it('(b) offline: Dinner saved offline on the Food day while the page was away; back on the page: the waiting line', async () => {
    await open();
    expect(await screen.findByText('Ate it as planned')).toBeTruthy();
    await reads();

    await leave();
    offline();
    await savedOfflineOnFoodDay();
    await comeBack();
    await reads();

    expect(await screen.findByText(WAITING, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByText('Ate it as planned', { includeHiddenElements: true })).toBeNull();
  });
});
