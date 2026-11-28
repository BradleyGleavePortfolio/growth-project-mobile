/**
 * KITCHEN-DOOR-M (PICK #ALM-P2 "door from food", DOORS frame 2) on the real Food tab: LogScreen, its store and its add
 * sheet, with only the network mocked at the api module's edge (LogScreen.foodJourney.switchOn's way). A sheet opened
 * with no link has a third tab, Saved meals (R2, R3); a tap adds the meal to the sheet's meal and day in one send
 * through the Kitchen's own add step, with one key per intended save shared with the Kitchen (R6); every answer that
 * added nothing keeps the sheet open with its line (D7); with no connection nothing is sent or queued (R7); a sheet with
 * a plan or usual-meal link has no Saved meals tab and reads none (R3); Open Kitchen closes the sheet and opens the
 * Kitchen in the You stack, never a second one (R8). Fixtures are KITCHEN-M's (fictional: client Jordan, coach Sam).
 */
import React from 'react';
import { AccessibilityInfo, Dimensions, Platform } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../LogScreen';
import { logApi, waterApi } from '../../../services/api';
import { enqueue } from '../../../services/foodLogQueue';
import { useClientStore } from '../../../store/clientStore';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { track } from '../../../lib/analytics';
import { AnalyticsEvents } from '../../../analytics/events';
import { forgetSaveKeys } from '../../../utils/log/saveKey';
import { addSavedMeal } from '../kitchen/kitchenAdd';
import { addDays, getTodayString } from '../../../utils/date';
import { closeMealPhoto, mealPhotoAfterSave } from '../../../utils/log/mealPhoto';

// A fixed clock (Thursday 5 November 2026, 8:00 am) with real timers: only Date is faked.
jest.useFakeTimers({ now: new Date('2026-11-05T08:00:00'), advanceTimers: true, doNotFake: ['nextTick', 'setImmediate',
  'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime',
  'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());

jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, foodPlanChecklist: true, youTabV2: true, clientTimelineV2: true,
    clientPathCopilot: true, romanChat: true } };
});
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const R = jest.requireActual('react');
  return {
    NavigationContext: R.createContext({ navigate: (...a: unknown[]) => mockNavigate(...a) }),
    useNavigation: () => ({ navigate: (...a: unknown[]) => mockNavigate(...a) }),
    useFocusEffect: jest.fn(),
  };
});
const mockUser: { id: string; coach_id?: string } = { id: 'jordan' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../lib/packagePromptGate', () => ({ shouldOfferPackagePrompt: async () => false }));
jest.mock('../../../components/PackageSelectionSheet', () => () => null);
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
let mockOnline = true;
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => mockOnline }));
jest.mock('../../../hooks/useFoodLogQueueSync', () => ({ usePendingFoodLogCount: () => 0 }));
jest.mock('../../../services/foodLogSync', () => ({ syncFoodLogQueue: jest.fn(), notifyPendingFoodLogs: jest.fn() }));
jest.mock('../../../services/foodLogQueue', () => ({ ...jest.requireActual('../../../services/foodLogQueue'), enqueue: jest.fn() }));
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { getDaily: jest.fn(), logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn() },
  waterApi: { getDaily: jest.fn(), log: jest.fn() },
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));
// The sheet's kept meal photo, watched at its two doors: the hand-off to a saved food and the let-go at close.
jest.mock('../../../utils/log/mealPhoto', () => ({ ...jest.requireActual('../../../utils/log/mealPhoto'),
  mealPhotoAfterSave: jest.fn(), closeMealPhoto: jest.fn() }));

const TODAY = getTodayString();
const YESTERDAY = addDays(TODAY, -1);

// ---------- fixtures (KITCHEN-M's world: client Jordan, coach Sam) ----------
let k = 0;
const food = (name: string, calories: number, protein: number, m: number, qty: number | null, unit: string | null, truth: string | null = 'ok') => {
  k += 1;
  return { id: `i${k}`, saved_meal_id: 'm', food_item_id: `f${k}`, quantity_multiplier: m, original_quantity: qty, original_unit: unit,
    position: k, food_item: { id: `f${k}`, name, calories, protein_g: protein, carbs_g: 0, fat_g: 0 }, ...(truth === null ? {} : { food_truth: truth }) };
};
const meal = (id: string, name: string, items: unknown[] | undefined) =>
  ({ id, user_id: 'jordan', name, created_at: '2026-10-01', updated_at: '2026-10-01', ...(items ? { items } : {}) });
const MEALS = () => [
  meal('m1', 'Usual breakfast', [food('Greek yoghurt, plain', 59, 12, 2.0, 200, 'g'), food('Rolled oats', 379, 13.2, 0.5, 50, 'g'),
    food('Blueberries', 57, 0.7, 0.8, 80, 'g'), food('Honey', 314, 0.3, 0.21, 1, 'tsp')]),
  meal('m2', 'Post-gym shake', [food('Whey', 240, 26, 1, 1, 'scoop'), food('Banana', 100, 4, 1, 1, 'medium')]),
  meal('m3', 'Friday wrap', [food('Chicken wrap', 565, 38, 1, null, null)]),
  meal('m4', 'Pantry bar', [food('Oat bar', 190, 6, 1, null, null), food('Mystery bar', 250, 9, 1, null, null, 'held')]),
  meal('m5', 'Old cereal', [food('Old flakes', 0, 0, 1, 40, 'g', 'legacy_zero')]),
  meal('m6', 'Gone lunch', []),
];
const oats = { id: 'oats', name: 'Rolled oats', calories: 379, protein_g: 13, carbs_g: 68, fat_g: 6.5, serving_size_grams: 40,
  nutrient_basis: 'PER_100G', supports_volume_units: false };
const entry = (id: string, date: string, meal_type: string) => ({ id, food_item_id: 'oats', user_id: 'jordan', meal_type,
  quantity_multiplier: 0.6, original_quantity: 60, original_unit: 'g', food_item: oats, logged_at: `${date}T07:40:00` });
// The server's answer to a saved meal's log: one entry per food, the first carrying position 0.
const logged = (n = 4) => ({ data: Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, client_uuid: `k:${i}` })) });
const lostAnswer = () => Object.assign(new Error('Network Error'), { response: undefined });
const refusal = (status: number, message: string) => Object.assign(new Error(message), { response: { status, data: { message } } });

let mockDays: Record<string, unknown[]> = {};
let mockPlan: unknown = { assignments: [] };
const listReads = () => mockGet.mock.calls.filter(([u]) => u === '/me/foods/saved-meals').length;
const logSends = () => mockPost.mock.calls.filter(([u]) => String(u).startsWith('/me/foods/saved-meals/'));

let client: QueryClient;
const onSaved = jest.fn();
const tree = () => <QueryClientProvider client={client}><LogScreen onSaved={onSaved} /></QueryClientProvider>;

beforeEach(() => {
  jest.clearAllMocks();
  k = 0;
  mockOnline = true;
  mockUser.coach_id = undefined;
  mockDays = { [YESTERDAY]: [entry('past', YESTERDAY, 'breakfast')] };
  mockPlan = { assignments: [] };
  forgetSaveKeys();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useClientStore.getState().reset();
  useClientStore.getState().setSelectedDate(TODAY);
  jest.spyOn(HapticService, 'success').mockImplementation(async () => undefined);
  jest.spyOn(HapticService, 'error').mockImplementation(async () => undefined);
  mockGet.mockImplementation(async (url: string) => {
    if (url === '/me/foods/saved-meals') return { data: MEALS() };
    if (url.startsWith('/me/meal-plan')) return { data: mockPlan };
    if (url === '/v1/clients/me/coach') return { data: { name: 'Sam Reid' } };
    return { data: { items: [], nextCursor: null } };
  });
  mockPost.mockResolvedValue(logged());
  jest.mocked(waterApi.getDaily).mockResolvedValue({ data: { total_ml: 0 } } as never);
  jest.mocked(logApi.getDaily).mockImplementation(async (date: string) => {
    const entries = mockDays[date] ?? [];
    return { data: { entries, total_calories: 0, total_protein_g: 0, total_carbs_g: 0, total_fat_g: 0 } } as never;
  });
});
afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

/** The Food day's Add (no link), the sheet's meal set to `meal`, then the Saved meals tab with her meals read. */
async function openSaved(meal: 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks' = 'Breakfast') {
  await render(tree());
  await fireEvent.press(await screen.findByTestId('food-day-add'));
  await screen.findByTestId('food-search-title');
  await fireEvent.press(screen.getByRole('radio', { name: meal }));
  await fireEvent.press(within(screen.getByTestId('food-search-tabs')).getByText('Saved meals'));
  await screen.findByTestId('saved-meal-m1');
}
const sheetOpen = () => screen.queryByTestId('food-search-title') !== null;
const tabWords = () => within(screen.getByTestId('food-search-tabs')).getAllByRole('tab').map((t) => within(t).getByText(/./).props.children);

describe.each([[390, 844, 1], [320, 568, 1.3]])('case 1 at %i x %i, text %f: the tabs in LogScreen\'s sheet', (width, height, fontScale) => {
  beforeEach(() => { jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height, scale: 2, fontScale }); });
  it('opened from the Food day\'s Add: Recent, Frequent, Saved meals; every open starts on Recent', async () => {
    await render(tree());
    await fireEvent.press(await screen.findByTestId('food-day-add'));
    expect(tabWords()).toEqual(['Recent', 'Frequent', 'Saved meals']);
    const tabs = within(screen.getByTestId('food-search-tabs')).getAllByRole('tab');
    expect(tabs.map((t) => t.props.accessibilityState?.selected)).toEqual([true, false, false]);
    await fireEvent.press(tabs[2]);
    await screen.findByTestId('saved-meal-m1');
    await fireEvent.press(screen.getByRole('button', { name: 'Close food search' }));
    await fireEvent.press(screen.getByTestId('food-day-add'));
    const again = within(screen.getByTestId('food-search-tabs')).getAllByRole('tab');
    expect(again.map((t) => t.props.accessibilityState?.selected)).toEqual([true, false, false]);
  });
});

describe.each([[390, 844, 1], [320, 568, 1.3]])('case 4 at %i x %i, text %f: the add (R6)', (width, height, fontScale) => {
  beforeEach(() => { jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height, scale: 2, fontScale }); });
  it('a sheet on today at Breakfast: one send with the day, the meal and one key; then haptic, MEAL_LOGGED, the day read, the sheet closed and its line', async () => {
    await openSaved('Breakfast');
    const daysBefore = jest.mocked(logApi.getDaily).mock.calls.filter(([d]) => d === TODAY).length;
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(logSends()).toHaveLength(1);
    const [url, body, config] = logSends()[0] as [string, { date: string; meal_type: string; client_uuid: string }, { headers: Record<string, string> }];
    expect(url).toBe('/me/foods/saved-meals/m1/log');
    expect(body).toEqual({ date: TODAY, meal_type: 'breakfast', client_uuid: expect.any(String) });
    expect(config.headers['Idempotency-Key']).toBe(body.client_uuid);
    expect(HapticService.success).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(AnalyticsEvents.MEAL_LOGGED, { meal_type: 'breakfast', source: 'saved_meal' });
    expect(jest.mocked(logApi.getDaily).mock.calls.filter(([d]) => d === TODAY).length).toBeGreaterThan(daysBefore);
    expect(await screen.findByText('Usual breakfast added to Breakfast.')).toBeTruthy();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('the added line is read once on iOS', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const say = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    await openSaved('Breakfast');
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    await screen.findByText('Usual breakfast added to Breakfast.');
    expect(say.mock.calls.filter(([w]) => w === 'Usual breakfast added to Breakfast.')).toHaveLength(1);
  });

  it('a sheet on yesterday\'s Lunch ("Add to Lunch", the day\'s own meal Add) sends yesterday and lunch', async () => {
    useClientStore.getState().setSelectedDate(YESTERDAY);
    await render(tree());
    await fireEvent.press(await screen.findByLabelText('Add food to lunch'));
    expect(await screen.findByTestId('food-search-title')).toHaveTextContent('Add to Lunch');
    await fireEvent.press(within(screen.getByTestId('food-search-tabs')).getByText('Saved meals'));
    await screen.findByTestId('saved-meal-m3');
    await fireEvent.press(screen.getByTestId('saved-meal-m3'));
    await waitFor(() => expect(logSends()).toHaveLength(1));
    expect(logSends()[0][1]).toMatchObject({ date: YESTERDAY, meal_type: 'lunch' });
    expect(await screen.findByText('Friday wrap added to Lunch.')).toBeTruthy();
  });

  it('while it sends: the Repeat card keeps "Add all" with no spinner, the tapped row spins, Close does nothing', async () => {
    let answer: (v: unknown) => void = () => undefined;
    mockPost.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    await openSaved('Breakfast');
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    expect(await screen.findByTestId('saved-meal-busy')).toBeTruthy();
    expect(screen.getByText('Add all')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Close food search' }));
    expect(sheetOpen()).toBe(true);
    await act(async () => { answer(logged()); });
    await waitFor(() => expect(sheetOpen()).toBe(false));
  });
});

describe('case 5: keys (one per intended save, shared with the Kitchen)', () => {
  it('a lost answer shows KK-6 with Try again, and Try again sends the same key', async () => {
    mockPost.mockRejectedValueOnce(lostAnswer());
    await openSaved('Breakfast');
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    expect(await screen.findByText('This meal was not added. Check the connection and try again.')).toBeTruthy();
    expect(sheetOpen()).toBe(true);
    await fireEvent.press(screen.getByTestId('saved-meals-try-again'));
    await waitFor(() => expect(logSends()).toHaveLength(2));
    expect(logSends()[1][1].client_uuid).toBe(logSends()[0][1].client_uuid);
  });

  it('a 500 keeps the key; a 404 lets it go, so the next tap sends a new one', async () => {
    mockPost.mockRejectedValueOnce(refusal(500, 'Internal server error')).mockRejectedValueOnce(refusal(404, 'Food not found'));
    await openSaved('Breakfast');
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    await screen.findByText('This meal was not added. Check the connection and try again.');
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    await screen.findByText('A food in this meal can no longer be logged, so nothing was added.');
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    await waitFor(() => expect(logSends()).toHaveLength(3));
    const keys = logSends().map((c) => c[1].client_uuid);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('two fast taps send once', async () => {
    await openSaved('Breakfast');
    const row = screen.getByTestId('saved-meal-m1');
    await act(async () => {
      fireEvent.press(row);
      fireEvent.press(row);
    });
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(logSends()).toHaveLength(1);
  });

  it('a lost answer on the Kitchen\'s own add step, then a tap here for the same meal, day and meal type: the same key', async () => {
    mockPost.mockRejectedValueOnce(lostAnswer());
    expect(await addSavedMeal('m1', TODAY, 'breakfast')).toBe('lost');
    await openSaved('Breakfast');
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    await waitFor(() => expect(logSends()).toHaveLength(2));
    expect(logSends()[1][1].client_uuid).toBe(logSends()[0][1].client_uuid);
  });
});

describe('case 6: refusals and offline (D7, R7)', () => {
  it('404 "Food not found": KK-5, nothing added, the sheet stays open, error haptic', async () => {
    mockPost.mockRejectedValueOnce(refusal(404, 'Food not found'));
    await openSaved('Breakfast');
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    expect(await screen.findByText('A food in this meal can no longer be logged, so nothing was added.')).toBeTruthy();
    expect(sheetOpen()).toBe(true);
    expect(screen.queryByText('Usual breakfast added to Breakfast.')).toBeNull();
    expect(HapticService.error).toHaveBeenCalledTimes(1);
    expect(HapticService.success).not.toHaveBeenCalled();
  });

  it('404 "Saved meal not found": KK-7 and her saved meals are read again', async () => {
    mockPost.mockRejectedValueOnce(refusal(404, 'Saved meal not found'));
    await openSaved('Breakfast');
    const before = listReads();
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    expect(await screen.findByText('This meal is no longer saved.')).toBeTruthy();
    await waitFor(() => expect(listReads()).toBe(before + 1));
  });

  it('an answer of [] (its foods were removed): KK-8b, no added line, saved meals read again', async () => {
    mockPost.mockResolvedValueOnce({ data: [] });
    await openSaved('Breakfast');
    const before = listReads();
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    expect(await screen.findByText('Its foods were removed, so there is nothing to add.')).toBeTruthy();
    expect(sheetOpen()).toBe(true);
    expect(screen.queryByText(/added to Breakfast/)).toBeNull();
    await waitFor(() => expect(listReads()).toBe(before + 1));
  });

  it('offline: KK-9, and neither the saved-meal log nor the food queue is ever called', async () => {
    await openSaved('Breakfast');
    mockOnline = false;
    await screen.rerender(tree());
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    expect(await screen.findByText('Adding a saved meal needs a connection. Nothing was added.')).toBeTruthy();
    expect(logSends()).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
    expect(sheetOpen()).toBe(true);
  });

  it('the line goes on a tab change', async () => {
    mockPost.mockRejectedValueOnce(refusal(404, 'Food not found'));
    await openSaved('Breakfast');
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    await screen.findByText('A food in this meal can no longer be logged, so nothing was added.');
    await fireEvent.press(within(screen.getByTestId('food-search-tabs')).getByText('Recent'));
    await fireEvent.press(within(screen.getByTestId('food-search-tabs')).getByText('Saved meals'));
    await screen.findByTestId('saved-meal-m1');
    expect(screen.queryByText('A food in this meal can no longer be logged, so nothing was added.')).toBeNull();
  });
});

describe('case 7: Gone lunch (items: [])', () => {
  it('KK-8a, no total, no button, and no request ever', async () => {
    await openSaved('Breakfast');
    const gone = screen.getByTestId('saved-meal-m6');
    expect(within(gone).getByText('No foods left in this meal')).toBeTruthy();
    expect(gone.props.accessibilityRole).toBeUndefined();
    await fireEvent.press(gone);
    expect(logSends()).toHaveLength(0);
  });
});

describe('case 9: a sheet with a link has no Saved meals tab (R3)', () => {
  const PLAN = { date: TODAY, changes_today: [], assignments: [{ daily_meal_plan: { id: 'p1', name: 'Training day', notes: null, slots: [
    { id: 's-b', slot_label: 'breakfast', order: 0, time_of_day: '07:30', meal_template_id: 'm-b', swaps: [], recipe_id: null,
      meal_template: { id: 'm-b', coach_id: 'sam', name: 'Eggs on toast', description: null, calories_kcal: 420, protein_g: 30, carbs_g: 40,
        fats_g: 14, fiber_g: null, items: [{ name: 'Eggs', portion: '2' }], created_at: '', archived_at: null } },
  ] } }] };

  it('a plan meal\'s Something else: Recent and Frequent only, and no saved-meal read', async () => {
    mockUser.coach_id = 'sam';
    mockPlan = PLAN;
    await render(tree());
    await fireEvent.press(await screen.findByTestId('food-day-something-else'));
    expect(await screen.findByTestId('food-search-title')).toHaveTextContent('Something else');
    expect(tabWords()).toEqual(['Recent', 'Frequent']);
    expect(listReads()).toBe(0);
  });

  it('the same with the plan meal missing from the cache (a link and no plan head)', async () => {
    mockUser.coach_id = 'sam';
    mockPlan = PLAN;
    await render(tree());
    const slot = await screen.findByTestId('food-day-something-else');
    const read = client.getQueryData.bind(client);
    jest.spyOn(client, 'getQueryData').mockImplementation(((key: readonly unknown[]) => (key[0] === 'meal-plan' ? undefined : read(key as never))) as never);
    await fireEvent.press(slot);
    expect(await screen.findByTestId('food-search-title')).not.toHaveTextContent('Something else');
    expect(tabWords()).toEqual(['Recent', 'Frequent']);
    expect(listReads()).toBe(0);
  });

  it('a usual meal\'s Something else (no coach, the same breakfast two days running)', async () => {
    mockDays = { [YESTERDAY]: [entry('y', YESTERDAY, 'breakfast')], [addDays(TODAY, -2)]: [entry('d', addDays(TODAY, -2), 'breakfast')] };
    await render(tree());
    await fireEvent.press(await screen.findByTestId('food-day-something-else'));
    await screen.findByTestId('food-search-title');
    expect(tabWords()).toEqual(['Recent', 'Frequent']);
    expect(listReads()).toBe(0);
  });
});

describe('case 10: Open Kitchen (R8)', () => {
  it('closes the sheet, then opens the Kitchen in the You stack, popping back to one already there', async () => {
    await openSaved('Breakfast');
    await fireEvent.press(screen.getByTestId('saved-meals-open-kitchen'));
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'Kitchen', initial: false, pop: true });
  });
});

describe('case 11: the kept meal photo (FIX-992R2\'s class)', () => {
  it('a failed add keeps it: the sheet stays open, nothing takes it and nothing lets it go', async () => {
    mockPost.mockRejectedValueOnce(refusal(404, 'Food not found'));
    await openSaved('Breakfast');
    jest.mocked(closeMealPhoto).mockClear();
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    await screen.findByText('A food in this meal can no longer be logged, so nothing was added.');
    expect(sheetOpen()).toBe(true);
    expect(mealPhotoAfterSave).not.toHaveBeenCalled();
    expect(closeMealPhoto).not.toHaveBeenCalled();
  });
});

describe('case 12: reads', () => {
  it('no saved-meal read until the tab is chosen; one on the first choice; none on a second inside the fresh time', async () => {
    // The app's own fresh time for a read (queryClient.ts staleTime 30 s).
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    await render(tree());
    await fireEvent.press(await screen.findByTestId('food-day-add'));
    await screen.findByTestId('food-search-title');
    expect(listReads()).toBe(0);
    const tabs = () => within(screen.getByTestId('food-search-tabs'));
    await fireEvent.press(tabs().getByText('Saved meals'));
    await screen.findByTestId('saved-meal-m1');
    expect(listReads()).toBe(1);
    await fireEvent.press(tabs().getByText('Recent'));
    await fireEvent.press(tabs().getByText('Saved meals'));
    await screen.findByTestId('saved-meal-m1');
    expect(listReads()).toBe(1);
    expect(client.getQueryData(['me', 'foods', 'saved-meals'])).toEqual(MEALS().map((m) => expect.objectContaining({ id: m.id })));
  });
});
