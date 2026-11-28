/**
 * LO-KD-1 B1 (OPERATOR RULING 7232387348 item 2, KITCHEN-M's C1 class on this tab, ruled "fix now" at 7230339688 and
 * 7231048695): one log per intent across a lost answer. After a lost answer (no reply: the server may have written the
 * meal), the same saved meal sent again from the add sheet must carry the SAME key with the SAME meal the lost save used,
 * however she got there: Try again after changing the sheet's meal, a tap on the row after changing it, or the sheet
 * closed and opened again on another meal. A new key for that saved meal before its answer is known can log it twice.
 * The real LogScreen and sheet, the network mocked at the api module's edge (LogScreen.kitchenDoor.test.tsx's way).
 * Fixtures fictional (client Jordan).
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../LogScreen';
import { logApi, waterApi } from '../../../services/api';
import { useClientStore } from '../../../store/clientStore';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { forgetSaveKeys } from '../../../utils/log/saveKey';
import { getTodayString } from '../../../utils/date';

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
const food = (id: string, name: string, calories: number, protein: number) => ({ id: `i-${id}`, saved_meal_id: 'm1',
  food_item_id: id, quantity_multiplier: 1, original_quantity: null, original_unit: null, position: 1,
  food_item: { id, name, calories, protein_g: protein, carbs_g: 0, fat_g: 0 }, food_truth: 'ok' });
const MEALS = () => [{ id: 'm1', user_id: 'jordan', name: 'Usual breakfast', created_at: '2026-10-01', updated_at: '2026-10-01',
  items: [food('f1', 'Rolled oats', 190, 7), food('f2', 'Blueberries', 46, 1)] }];
const logged = () => ({ data: [{ id: 'e1', client_uuid: 'k:0' }, { id: 'e2', client_uuid: 'k:1' }] });
const lostAnswer = () => Object.assign(new Error('Network Error'), { response: undefined });
type Send = [string, { date: string; meal_type: string; client_uuid: string }, { headers: Record<string, string> }];
const logSends = () => mockPost.mock.calls.filter(([u]) => String(u).startsWith('/me/foods/saved-meals/')) as Send[];

let client: QueryClient;
const tree = () => <QueryClientProvider client={client}><LogScreen /></QueryClientProvider>;

beforeEach(() => {
  jest.clearAllMocks();
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
  // The first send's answer never comes (lost); every later one is answered.
  mockPost.mockRejectedValueOnce(lostAnswer()).mockResolvedValue(logged());
  jest.mocked(waterApi.getDaily).mockResolvedValue({ data: { total_ml: 0 } } as never);
  jest.mocked(logApi.getDaily).mockResolvedValue({ data: { entries: [], total_calories: 0, total_protein_g: 0,
    total_carbs_g: 0, total_fat_g: 0 } } as never);
});
afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

const chooseMeal = async (meal: 'Breakfast' | 'Lunch') => fireEvent.press(screen.getByRole('radio', { name: meal }));
const openSavedTab = async (meal: 'Breakfast' | 'Lunch') => {
  await fireEvent.press(await screen.findByTestId('food-day-add'));
  await screen.findByTestId('food-search-title');
  await chooseMeal(meal);
  await fireEvent.press(within(screen.getByTestId('food-search-tabs')).getByText('Saved meals'));
  await screen.findByTestId('saved-meal-m1');
};
/** A first send at Breakfast whose answer is lost: KK-6 with Try again; returns that send's key. */
const lostAtBreakfast = async (): Promise<string> => {
  await render(tree());
  await openSavedTab('Breakfast');
  await fireEvent.press(screen.getByTestId('saved-meal-m1'));
  await screen.findByText('This meal was not added. Check the connection and try again.');
  expect(logSends()).toHaveLength(1);
  expect(logSends()[0][1]).toMatchObject({ date: TODAY, meal_type: 'breakfast' });
  return logSends()[0][1].client_uuid;
};
/** Every send of this saved meal after the lost one is that same save: the same key and the same meal, or no send. */
const expectOneIntent = (key: string) => {
  for (const [url, body, config] of logSends().slice(1)) {
    expect(url).toBe('/me/foods/saved-meals/m1/log');
    expect({ key: body.client_uuid, header: config.headers['Idempotency-Key'], meal_type: body.meal_type })
      .toEqual({ key, header: key, meal_type: 'breakfast' });
  }
};

describe('LO-KD-1 B1: a lost save of a saved meal is resent as the same save, never as a new key', () => {
  it('Try again after the sheet\'s meal was changed to Lunch resends the lost Breakfast save with its key', async () => {
    const key = await lostAtBreakfast();
    await chooseMeal('Lunch');
    const retry = screen.queryByTestId('saved-meals-try-again');
    await fireEvent.press(retry ?? screen.getByTestId('saved-meal-m1'));
    await waitFor(() => expect(screen.queryByTestId('saved-meal-busy')).toBeNull());
    expectOneIntent(key);
  });

  it('a tap on the same saved meal after the sheet\'s meal was changed to Lunch sends no new key', async () => {
    const key = await lostAtBreakfast();
    await chooseMeal('Lunch');
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    await waitFor(() => expect(screen.queryByTestId('saved-meal-busy')).toBeNull());
    expectOneIntent(key);
  });

  it('the sheet closed and opened again on Lunch: a tap on the same saved meal sends no new key', async () => {
    const key = await lostAtBreakfast();
    await fireEvent.press(screen.getByRole('button', { name: 'Close food search' }));
    await waitFor(() => expect(screen.queryByTestId('food-search-title')).toBeNull());
    await openSavedTab('Lunch');
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    await waitFor(() => expect(screen.queryByTestId('saved-meal-busy')).toBeNull());
    expectOneIntent(key);
  });
});
