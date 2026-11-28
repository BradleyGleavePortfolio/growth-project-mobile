/**
 * FIX-KD-1 (round 1 on m#1034; OPERATOR RULING 7232387348 item 2 and the round-1 ruling 7233641979): one log per intent
 * across a lost answer, and the row says so. While a lost add of a saved meal keeps its key (kitchenAdd.ts keptAddMeal,
 * KITCHEN-M's export), its row on the add sheet's Saved meals tab holds it in the Kitchen's held words (KK-6 and Try
 * again, SavedMealSheet's) with its hint naming the meal the lost add went to, and its tap resends that same save. The
 * held day goes with it, so Try again after midnight is the same save too (LO C1). An answer that lets the key go frees
 * the row. The B-TESTs (LO-KD-1, LS-KD-1) pin the sends; this file pins what the row shows and the day.
 * The real LogScreen, its store and its add sheet, with only the network mocked at the api module's edge (the PR's own
 * LogScreen.kitchenDoor.test.tsx harness). Fixtures are fictional (client Jordan).
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../LogScreen';
import { logApi, waterApi } from '../../../services/api';
import { useClientStore } from '../../../store/clientStore';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { forgetSaveKeys } from '../../../utils/log/saveKey';
import { addSavedMeal } from '../kitchen/kitchenAdd';
import { getTodayString } from '../../../utils/date';

// A fixed clock (Thursday 5 November 2026, 8:00 am) with real timers: only Date is faked.
const MORNING = new Date('2026-11-05T08:00:00');
jest.useFakeTimers({ now: MORNING, advanceTimers: true, doNotFake: ['nextTick', 'setImmediate',
  'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime',
  'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());

jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, foodPlanChecklist: true, youTabV2: true, clientTimelineV2: true,
    clientPathCopilot: true, romanChat: true } };
});
jest.mock('@react-navigation/native', () => {
  const R = jest.requireActual('react');
  return {
    NavigationContext: R.createContext({ navigate: () => undefined }),
    useNavigation: () => ({ navigate: () => undefined }),
    useFocusEffect: jest.fn(),
  };
});
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'jordan' }) }));
jest.mock('../../../lib/packagePromptGate', () => ({ shouldOfferPackagePrompt: async () => false }));
jest.mock('../../../components/PackageSelectionSheet', () => () => null);
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => true }));
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
jest.mock('../../../utils/log/mealPhoto', () => ({ ...jest.requireActual('../../../utils/log/mealPhoto'),
  mealPhotoAfterSave: jest.fn(), closeMealPhoto: jest.fn() }));

const TODAY = getTodayString();
const KK6 = 'This meal was not added. Check the connection and try again.';

let k = 0;
const food = (name: string, calories: number, protein: number) => {
  k += 1;
  return { id: `i${k}`, saved_meal_id: 'm', food_item_id: `f${k}`, quantity_multiplier: 1, original_quantity: null, original_unit: null,
    position: k, food_item: { id: `f${k}`, name, calories, protein_g: protein, carbs_g: 0, fat_g: 0 }, food_truth: 'ok' };
};
const meal = (id: string, name: string, items: unknown[]) =>
  ({ id, user_id: 'jordan', name, created_at: '2026-10-01', updated_at: '2026-10-01', items });
const MEALS = () => [
  meal('m1', 'Usual breakfast', [food('Rolled oats', 190, 7), food('Blueberries', 46, 1)]),
  meal('m2', 'Post-gym shake', [food('Whey', 240, 26), food('Banana', 100, 4)]),
  meal('m3', 'Gone lunch', []),
];
const logged = () => ({ data: [{ id: 'e1', client_uuid: 'k:0' }, { id: 'e2', client_uuid: 'k:1' }] });
const lostAnswer = () => Object.assign(new Error('Network Error'), { response: undefined });
const refusal = (status: number, message: string) => Object.assign(new Error(message), { response: { status, data: { message } } });
type Sent = [string, { date: string; meal_type: string; client_uuid: string }, { headers: Record<string, string> }];
const logSends = () => mockPost.mock.calls.filter(([u]) => String(u).startsWith('/me/foods/saved-meals/')) as Sent[];

let client: QueryClient;
const tree = () => <QueryClientProvider client={client}><LogScreen /></QueryClientProvider>;

beforeEach(() => {
  jest.setSystemTime(MORNING);
  jest.clearAllMocks();
  k = 0;
  forgetSaveKeys();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useClientStore.getState().reset();
  useClientStore.getState().setSelectedDate(TODAY);
  jest.spyOn(HapticService, 'success').mockImplementation(async () => undefined);
  jest.spyOn(HapticService, 'error').mockImplementation(async () => undefined);
  mockGet.mockImplementation(async (url: string) => {
    if (url === '/me/foods/saved-meals') return { data: MEALS() };
    if (url.startsWith('/me/meal-plan')) return { data: { assignments: [] } };
    return { data: { items: [], nextCursor: null } };
  });
  mockPost.mockResolvedValue(logged());
  jest.mocked(waterApi.getDaily).mockResolvedValue({ data: { total_ml: 0 } } as never);
  jest.mocked(logApi.getDaily).mockResolvedValue(
    { data: { entries: [], total_calories: 0, total_protein_g: 0, total_carbs_g: 0, total_fat_g: 0 } } as never);
});
afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

type Meal = 'Breakfast' | 'Lunch';
const chooseMeal = async (m: Meal) => { await fireEvent.press(screen.getByRole('radio', { name: m })); };
async function openSheetAt(m: Meal) {
  await fireEvent.press(await screen.findByTestId('food-day-add'));
  await screen.findByTestId('food-search-title');
  await chooseMeal(m);
  await fireEvent.press(within(screen.getByTestId('food-search-tabs')).getByText('Saved meals'));
  await screen.findByTestId('saved-meal-m1');
}
const closeSheet = async () => {
  await fireEvent.press(screen.getByRole('button', { name: 'Close food search' }));
  await waitFor(() => expect(screen.queryByTestId('food-search-title')).toBeNull());
};
/** Usual breakfast tapped at Breakfast on the sheet, its answer lost: the line above the list says so. */
async function lostAtBreakfast() {
  mockPost.mockRejectedValueOnce(lostAnswer());
  await render(tree());
  await openSheetAt('Breakfast');
  await fireEvent.press(screen.getByTestId('saved-meal-m1'));
  await screen.findByTestId('saved-meals-try-again');
}
const row = (id: string) => screen.getByTestId(`saved-meal-${id}`);

describe('FIX-KD-1 B1: a lost add holds its row in the Kitchen\'s held words until its answer is known', () => {
  it.each<[string, () => Promise<void>]>([
    ['the sheet closed and opened again at Lunch', async () => {
      await lostAtBreakfast();
      await closeSheet();
      await openSheetAt('Lunch');
    }],
    ['the Kitchen\'s own add lost at Breakfast, then the sheet opened at Lunch', async () => {
      mockPost.mockRejectedValueOnce(lostAnswer());
      expect(await addSavedMeal('m1', TODAY, 'breakfast')).toBe('lost');
      await render(tree());
      await openSheetAt('Lunch');
    }],
    ['the sheet moved to Lunch and another saved meal was tapped there and lost too (the line above is now that one\'s)', async () => {
      await lostAtBreakfast();
      await chooseMeal('Lunch');
      mockPost.mockRejectedValueOnce(lostAnswer());
      await fireEvent.press(row('m2'));
      await waitFor(() => expect(logSends()).toHaveLength(2));
      await screen.findByTestId('saved-meals-try-again');
    }],
  ])('%s: Usual breakfast shows KK-6 and Try again, its hint names breakfast, and its tap is the same save', async (_, reach) => {
    await reach();
    const first = logSends()[0][1].client_uuid;
    const kept = within(row('m1')).getByTestId('saved-meal-kept-m1');
    expect(within(kept).getByText(KK6)).toBeTruthy();
    expect(within(kept).getByText('Try again')).toBeTruthy();
    expect(row('m1').props.accessibilityRole).toBe('button');
    expect(row('m1').props.accessibilityLabel).toContain(`${KK6}, Try again`);
    expect(row('m1').props.accessibilityHint).toBe('Adds it to breakfast');
    // The other meal's row is not held by it, and still adds to the sheet's meal.
    expect(within(row('m2')).queryByTestId('saved-meal-kept-m2')).toBeNull();
    expect(row('m2').props.accessibilityHint).toBe('Adds it to lunch');
    const before = logSends().length;
    await fireEvent.press(row('m1'));
    await waitFor(() => expect(logSends()).toHaveLength(before + 1));
    const [url, body, config] = logSends()[before];
    expect({ url, key: body.client_uuid, header: config.headers['Idempotency-Key'], date: body.date, meal_type: body.meal_type })
      .toEqual({ url: '/me/foods/saved-meals/m1/log', key: first, header: first, date: TODAY, meal_type: 'breakfast' });
    expect(await screen.findByText('Usual breakfast added to Breakfast.')).toBeTruthy();
  });

  it('the answer just now: KK-6 shows once, in the line above the list, and the row adds no line of its own; its hint still names breakfast', async () => {
    await lostAtBreakfast();
    await chooseMeal('Lunch');
    expect(screen.getAllByText(KK6)).toHaveLength(1);
    expect(within(screen.getByTestId('saved-meals-failure')).getByText(KK6)).toBeTruthy();
    expect(screen.queryByTestId('saved-meal-kept-m1')).toBeNull();
    expect(row('m1').props.accessibilityHint).toBe('Adds it to breakfast');
    expect(row('m2').props.accessibilityHint).toBe('Adds it to lunch');
  });

  it('an answer that lets the key go (a 404 for a food) frees the row: no held words, and the next tap is a new save at the sheet\'s meal', async () => {
    await lostAtBreakfast();
    await closeSheet();
    await openSheetAt('Lunch');
    mockPost.mockRejectedValueOnce(refusal(404, 'Food not found'));
    await fireEvent.press(row('m1'));
    await screen.findByText('A food in this meal can no longer be logged, so nothing was added.');
    expect(screen.queryByTestId('saved-meal-kept-m1')).toBeNull();
    expect(row('m1').props.accessibilityHint).toBe('Adds it to lunch');
    await fireEvent.press(row('m1'));
    await waitFor(() => expect(logSends()).toHaveLength(3));
    const keys = logSends().map(([, body]) => body.client_uuid);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
    expect(logSends()[2][1].meal_type).toBe('lunch');
  });

  it('a meal whose foods were all removed since its lost add is never held: no Try again, not a button, nothing sent', async () => {
    mockPost.mockRejectedValueOnce(lostAnswer());
    expect(await addSavedMeal('m3', TODAY, 'breakfast')).toBe('lost');
    await render(tree());
    await openSheetAt('Breakfast');
    expect(within(row('m3')).queryByTestId('saved-meal-kept-m3')).toBeNull();
    expect(within(row('m3')).queryByText('Try again')).toBeNull();
    expect(row('m3').props.accessibilityRole).toBeUndefined();
    await fireEvent.press(row('m3'));
    expect(logSends()).toHaveLength(1);
  });
});

describe('FIX-KD-1 LO C1: the lost add\'s day is held, so Try again after midnight is the same save', () => {
  it('lost at 11:50 pm on the sheet on today, Try again at 12:10 am: the same key, the same day and meal', async () => {
    jest.setSystemTime(new Date('2026-11-05T23:50:00'));
    useClientStore.getState().setSelectedDate(TODAY);
    await lostAtBreakfast();
    const [, first] = logSends()[0];
    expect(first).toMatchObject({ date: '2026-11-05', meal_type: 'breakfast' });
    jest.setSystemTime(new Date('2026-11-06T00:10:00'));
    await fireEvent.press(screen.getByTestId('saved-meals-try-again'));
    await waitFor(() => expect(logSends()).toHaveLength(2));
    const [, again, config] = logSends()[1];
    expect({ key: again.client_uuid, header: config.headers['Idempotency-Key'], date: again.date, meal_type: again.meal_type })
      .toEqual({ key: first.client_uuid, header: first.client_uuid, date: '2026-11-05', meal_type: 'breakfast' });
  });
});
