/**
 * LS-KD-1 B1 (OPERATOR RULING 7232387348 item 2, KITCHEN-M's C1 class on this tab, fix now): one log per intended save
 * across a lost answer. While a lost save's key is kept for a saved meal (kitchenAdd.ts keptAddMeal), the next send for
 * that saved meal from the Food tab's add sheet is the SAME save: the same key and the SAME meal the lost save used,
 * however the sheet's meal was changed since (the meal choice, a close and reopen at another meal, or a lost add on the
 * Kitchen's own sheet at another meal). A new key for that meal before the lost save's answer is known can log it twice.
 * At the reviewed head (aca11fe6) LogScreen's addSavedMealTo sends the sheet's current meal (activeMealType) on every
 * tap and Try again, so each of these sends a new key with the new meal.
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

let k = 0;
const food = (name: string, calories: number, protein: number, m: number) => {
  k += 1;
  return { id: `i${k}`, saved_meal_id: 'm', food_item_id: `f${k}`, quantity_multiplier: m, original_quantity: null, original_unit: null,
    position: k, food_item: { id: `f${k}`, name, calories, protein_g: protein, carbs_g: 0, fat_g: 0 }, food_truth: 'ok' };
};
const MEALS = () => [
  { id: 'm1', user_id: 'jordan', name: 'Usual breakfast', created_at: '2026-10-01', updated_at: '2026-10-01',
    items: [food('Greek yoghurt, plain', 59, 12, 2.0), food('Rolled oats', 379, 13.2, 0.5)] },
];
const logged = () => ({ data: [{ id: 'e1', client_uuid: 'k:0' }, { id: 'e2', client_uuid: 'k:1' }] });
const lostAnswer = () => Object.assign(new Error('Network Error'), { response: undefined });
type Sent = [string, { date: string; meal_type: string; client_uuid: string }, { headers: Record<string, string> }];
const logSends = () => mockPost.mock.calls.filter(([u]) => String(u).startsWith('/me/foods/saved-meals/')) as Sent[];

let client: QueryClient;
const tree = () => <QueryClientProvider client={client}><LogScreen /></QueryClientProvider>;

beforeEach(() => {
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

const chooseMeal = async (meal: 'Breakfast' | 'Lunch') => { await fireEvent.press(screen.getByRole('radio', { name: meal })); };
const chooseSaved = async () => {
  await fireEvent.press(within(screen.getByTestId('food-search-tabs')).getByText('Saved meals'));
  await screen.findByTestId('saved-meal-m1');
};
/** The Food day's Add (no link), the sheet's meal set to `meal`, then the Saved meals tab. */
async function openSheetAt(meal: 'Breakfast' | 'Lunch') {
  await fireEvent.press(await screen.findByTestId('food-day-add'));
  await screen.findByTestId('food-search-title');
  await chooseMeal(meal);
  await chooseSaved();
}
/** The next send for Usual breakfast: a tap on its row, or, where the row holds the lost save, its Try again. */
async function sendAgain(sendsBefore: number) {
  await fireEvent.press(screen.getByTestId('saved-meal-m1'));
  if (logSends().length === sendsBefore) {
    const again = screen.queryByTestId('saved-meals-try-again');
    if (again) await fireEvent.press(again);
  }
  await waitFor(() => expect(logSends()).toHaveLength(sendsBefore + 1));
}
const expectOneSave = (meal: 'breakfast' | 'lunch') => {
  const sends = logSends();
  expect(sends.length).toBeGreaterThanOrEqual(2);
  expect(new Set(sends.map(([, body]) => body.client_uuid)).size).toBe(1);
  expect(new Set(sends.map(([, , config]) => config.headers['Idempotency-Key'])).size).toBe(1);
  expect(sends.map(([, body]) => body.meal_type)).toEqual(sends.map(() => meal));
};

describe('LS-KD-1 B1: a lost add of a saved meal, then the sheet\'s meal changed: the next send is the same save', () => {
  it('lost at Breakfast, the sheet moved to Lunch, Usual breakfast again: the same key and Breakfast', async () => {
    mockPost.mockRejectedValueOnce(lostAnswer());
    await render(tree());
    await openSheetAt('Breakfast');
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    await screen.findByText('This meal was not added. Check the connection and try again.');
    expect(logSends()).toHaveLength(1);
    await chooseMeal('Lunch');
    await sendAgain(1);
    expectOneSave('breakfast');
  });

  it('lost at Breakfast, the sheet closed and opened again at Lunch, Usual breakfast again: the same key and Breakfast', async () => {
    mockPost.mockRejectedValueOnce(lostAnswer());
    await render(tree());
    await openSheetAt('Breakfast');
    await fireEvent.press(screen.getByTestId('saved-meal-m1'));
    await screen.findByText('This meal was not added. Check the connection and try again.');
    await fireEvent.press(screen.getByRole('button', { name: 'Close food search' }));
    await openSheetAt('Lunch');
    await sendAgain(1);
    expectOneSave('breakfast');
  });

  it('lost on the Kitchen\'s own sheet at Lunch, then Usual breakfast on the add sheet at Breakfast: the same key and Lunch', async () => {
    mockPost.mockRejectedValueOnce(lostAnswer());
    expect(await addSavedMeal('m1', TODAY, 'lunch')).toBe('lost');
    await render(tree());
    await openSheetAt('Breakfast');
    await sendAgain(1);
    expectOneSave('lunch');
  });
});
