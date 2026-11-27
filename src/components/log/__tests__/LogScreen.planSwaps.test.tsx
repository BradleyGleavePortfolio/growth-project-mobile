// PLAN-SWAPS-M (C2 Style C C_something and C_portion; operator rulings R2, R4, R5, R7, R12): Something else for a plan
// meal lists the coach's swaps; a swap opens main's portion sheet on one serving and logs as one food for that meal
// through the add sheet's own path; "Recipe and grocery list" on the Food tab opens the plan meal page in the You stack.
// Fictional data (client Jordan, coach Sam).
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../../../screens/client/LogScreen';
import { enqueue } from '../../../services/foodLogQueue';
import { foodApi, logApi } from '../../../services/api';
import { featureFlags } from '../../../config/featureFlags';
import type { FoodLog } from '../../../types';

let mockOnline = true;
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, foodPlanChecklist: true, youTabV2: true, clientTimelineV2: true, romanChat: true } };
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
// A fixed clock: Tuesday 24 November 2026, 3:10 pm (only Date is faked).
jest.useFakeTimers({ now: new Date('2026-11-24T15:10:00'), advanceTimers: true, doNotFake: ['nextTick', 'setImmediate',
  'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime',
  'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());
const TODAY = '2026-11-24';

const logOf = (id: string, mealType: FoodLog['mealType'], foodName: string, calories: number, hhmm: string, planSlotId?: string): FoodLog => ({
  id, userId: 'user', coachId: 'sam', date: TODAY, mealType, foodName, calories, protein: 30, carbs: 10, fat: 5, quantity: 1, unit: 'serving',
  createdAt: `${TODAY}T${hhmm}:00.000`, planSlotId,
});
const eaten = [logOf('1', 'breakfast', 'Greek yoghurt, oats and berries', 420, '07:40', 's-b'), logOf('3', 'lunch', 'Chicken, rice and greens', 680, '12:35', 's-l')];
const mockStore = {
  selectedDate: TODAY, foodLogs: eaten as FoodLog[], hasLoadedDay: true,
  dailyTotals: { calories: 1100, protein: 60, carbs: 20, fat: 10 }, waterOz: 0,
  isLoading: false, loadError: null, setSelectedDate: jest.fn(),
  loadDayData: jest.fn().mockResolvedValue(undefined),
  refreshShownDay: jest.fn().mockResolvedValue(undefined),
  logWater: jest.fn(), removeFoodLogLocally: jest.fn(),
};
jest.mock('../../../store/clientStore', () => ({ useClientStore: () => mockStore }));
let mockUser: { id: string; coach_id?: string } = { id: 'user', coach_id: 'sam' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => ({ calories: 1850, protein: 150, carbs: 180, fat: 60 }) }));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => mockOnline }));
jest.mock('../../../hooks/useFoodBrowse', () => ({
  useFoodBrowse: () => ({
    recentFoods: [{ id: 'oats', name: 'Rolled oats', calories: 379, protein: 13, carbs: 68, fat: 6.5, serving_size_grams: 40, nutrient_basis: 'PER_100G', supports_volume_units: false }],
    frequentFoods: [], lastMeals: {}, loadBrowseFoods: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('../../../hooks/useFoodLogQueueSync', () => ({ usePendingFoodLogCount: () => 0 }));
jest.mock('../../../services/foodLogSync', () => ({ notifyPendingFoodLogs: jest.fn().mockResolvedValue(1), syncFoodLogQueue: jest.fn() }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
const tpl = (id: string, name: string, kcal: number, p: number, c: number, f: number) => ({
  id, coach_id: 'sam', name, description: null, calories_kcal: kcal, protein_g: p, carbs_g: c, fats_g: f, fiber_g: null,
  items: [{ name: 'Banana', portion: '1 medium' }, { name: 'Whey protein', grams: 30 }], created_at: '', archived_at: null,
});
const SWAPS = [
  { id: 'm-rice', name: 'Rice cakes, honey and whey', calories_kcal: 240, protein_g: 26, carbs_g: 30, fats_g: 2 },
  { id: 'm-gran', name: 'Greek yoghurt and granola', calories_kcal: 260, protein_g: 22, carbs_g: 34, fats_g: 5 },
  { id: 'm-bar', name: 'Protein bar', calories_kcal: 200, protein_g: 20 },
];
let mockSwaps: unknown[] = SWAPS;
const mockGet = jest.fn(async (url: string) => {
  if (url.startsWith('/me/meal-plan/today')) {
    return { data: { date: TODAY, changes_today: [], assignments: [{ daily_meal_plan: { id: 'p1', name: 'Training day', notes: null, slots: [
      { id: 's-b', slot_label: 'breakfast', order: 0, time_of_day: '07:30', meal_template_id: 'm-b', meal_template: tpl('m-b', 'Greek yoghurt, oats and berries', 420, 35, 48, 9), swaps: [], recipe_id: null },
      { id: 's-l', slot_label: 'lunch', order: 0, time_of_day: '12:30', meal_template_id: 'm-l', meal_template: tpl('m-l', 'Chicken, rice and greens', 680, 45, 60, 14), swaps: [], recipe_id: null },
      { id: 's-pre', slot_label: 'preworkout', order: 0, time_of_day: '17:30', meal_template_id: 'm-pre', meal_template: tpl('m-pre', 'Banana and whey shake', 250, 27, 30, 2), swaps: mockSwaps, recipe_id: null },
      { id: 's-d', slot_label: 'dinner', order: 0, time_of_day: '19:30', meal_template_id: 'm-d', meal_template: tpl('m-d', 'Salmon, potatoes and green beans', 620, 42, 55, 22), swaps: [], recipe_id: 'r1' },
    ] } }] } };
  }
  if (url === '/v1/clients/me/coach') return { data: { name: 'Sam Reid' } };
  if (url.startsWith('/assignments/me')) return { data: { items: [], nextCursor: null } };
  return { data: {} };
});
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (url: string) => mockGet(url) },
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn(), getDaily: jest.fn().mockResolvedValue({ data: { entries: [] } }) },
}));
jest.mock('../../../services/foodLogQueue', () => ({ enqueue: jest.fn().mockResolvedValue(undefined), getQueueLength: jest.fn().mockResolvedValue(0) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

function tree() {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LogScreen /></QueryClientProvider>;
}
const planReads = () => mockGet.mock.calls.filter(([u]) => String(u).startsWith('/me/meal-plan/today')).length;
async function openSomethingElse() {
  await render(tree());
  const next = await screen.findByTestId('food-day-next');
  await within(next).findByText('Banana and whey shake');
  await fireEvent.press(screen.getByTestId('food-day-something-else'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockSwaps = SWAPS;
  mockUser = { id: 'user', coach_id: 'sam' };
  mockStore.foodLogs = eaten;
  featureFlags.foodPlanChecklist = true;
  (foodApi.create as jest.Mock).mockResolvedValue({ data: { id: 'f-new' } });
  (logApi.logFood as jest.Mock).mockResolvedValue({ data: { id: 'e-new' } });
});

describe('case 5: S3 and S4, Something else for a plan meal', () => {
  it('S3: the title, "Instead of", the coach\'s swaps with four numbers, the search field, the footnote, Recent and Frequent; no request', async () => {
    await openSomethingElse();
    const before = planReads();
    expect(await screen.findByTestId('food-search-title')).toHaveTextContent('Something else');
    expect(screen.getByTestId('food-search-instead')).toHaveTextContent('Instead of Banana and whey shake, 250 kcal.');
    expect(screen.getByTestId('food-search-swaps-heading')).toHaveTextContent('SWAPS FROM SAM');
    expect(screen.getByTestId('food-search-swaps-heading').props.accessibilityRole).toBe('header');
    const rows = screen.getAllByTestId(/^food-search-swap-/);
    expect(rows.map((r) => r.props.testID)).toEqual(['food-search-swap-m-rice', 'food-search-swap-m-gran']);
    expect(within(rows[0]).getByText('240 kcal, 26 g protein')).toBeTruthy();
    expect(rows[0].props.accessibilityLabel).toBe('Rice cakes, honey and whey, 240 kcal, 26 g protein');
    expect(rows[0].props.accessibilityHint).toBe('Opens the amount for Pre-workout');
    expect(screen.queryByText('Protein bar')).toBeNull();
    expect(screen.getByPlaceholderText('Search foods...')).toBeTruthy();
    expect(screen.getByTestId('food-search-footnote')).toHaveTextContent('What you log here fills the pre-workout meal. Extras never tick a plan meal.');
    expect(screen.getByTestId('food-search-tabs')).toBeTruthy();
    expect(screen.getByLabelText('Close food search')).toBeTruthy();
    expect(planReads()).toBe(before);
    expect(screen.queryByText(/Roman|Use this/)).toBeNull();
  });

  it('S4: with no swap that has all four numbers there is no heading and no row (today\'s server)', async () => {
    mockSwaps = [{ id: 'm-a', name: 'Rice cakes, honey and whey', calories_kcal: 240, protein_g: 26 }];
    await openSomethingElse();
    expect(await screen.findByTestId('food-search-title')).toHaveTextContent('Something else');
    expect(screen.getByTestId('food-search-instead')).toBeTruthy();
    expect(screen.queryByTestId('food-search-swaps-heading')).toBeNull();
    expect(screen.queryAllByTestId(/^food-search-swap-/)).toHaveLength(0);
    expect(screen.getByTestId('food-search-footnote')).toBeTruthy();
  });
});

describe('case 6: S5 and S6, a swap logged as one food for its plan meal', () => {
  it('online: one serving, C2-C-09\'s line, one food with the swap\'s numbers, linked to the pre-workout meal', async () => {
    await openSomethingElse();
    await fireEvent.press(await screen.findByTestId('food-search-swap-m-rice'));
    expect(await screen.findByText('For Pre-workout')).toBeTruthy();
    expect(screen.getByLabelText('Rice cakes, honey and whey')).toBeTruthy();
    expect(screen.getByLabelText('Portion unit serving')).toBeTruthy();
    expect(screen.queryByLabelText('Portion unit g')).toBeNull();
    expect(screen.getByTestId('portion-summary')).toHaveTextContent('240 kcal, 26 g protein, 30 g carbs, 2 g fat.');
    // A second tap while the save is still in flight sends nothing more (main's foodSaving guard).
    let release: () => void = () => undefined;
    (foodApi.create as jest.Mock).mockImplementation(() => new Promise((done) => { release = () => done({ data: { id: 'f-new' } }); }));
    await fireEvent.press(screen.getByTestId('quantity-log-food'));
    await fireEvent.press(screen.getByTestId('quantity-log-food'));
    release();
    await waitFor(() => expect(logApi.logFood).toHaveBeenCalledTimes(1));
    expect(foodApi.create).toHaveBeenCalledTimes(1);
    expect(foodApi.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Rice cakes, honey and whey', calories: 240, protein_g: 26, carbs_g: 30, fat_g: 2, nutrient_basis: 'PER_SERVING', serving_size_grams: 0,
    }));
    expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({
      food_item_id: 'f-new', meal_type: 'snack', quantity_multiplier: 1, original_quantity: 1, original_unit: 'serving', plan_slot_id: 's-pre', date: TODAY,
    }));
    expect(enqueue).not.toHaveBeenCalled();
    // The day's log now holds the swap for that meal: "Logged with a change", never "Logged as planned".
    mockStore.foodLogs = [...eaten, { ...logOf('9', 'snack', 'Rice cakes, honey and whey', 240, '15:11', 's-pre'), protein: 26, carbs: 30, fat: 2 }];
    await screen.rerender(tree());
    const pre = await screen.findByTestId('food-day-slot-s-pre');
    expect(within(pre).getByText('Logged with a change: Rice cakes, honey and whey')).toBeTruthy();
    expect(within(pre).queryByText('Logged as planned')).toBeNull();
  });

  it('offline: the swap queues exactly as the add sheet does, with its plan link', async () => {
    mockOnline = false;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await openSomethingElse();
    await fireEvent.press(await screen.findByTestId('food-search-swap-m-gran'));
    await fireEvent.press(await screen.findByTestId('quantity-log-food'));
    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    expect(logApi.logFood).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'search', food: expect.objectContaining({ name: 'Greek yoghurt and granola', calories: 260, protein_g: 22, carbs_g: 34, fat_g: 5 }),
      log: expect.objectContaining({ plan_slot_id: 's-pre', meal_type: 'snack', quantity_multiplier: 1 }),
    }), expect.anything());
    alert.mockRestore();
  });
});

describe('case 4: "Recipe and grocery list" from the Food tab', () => {
  it('opens the plan meal page in the You stack for the shown day', async () => {
    await render(tree());
    await fireEvent.press(await screen.findByTestId('food-day-recipe-s-d'));
    expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'PlanMeal', params: { date: TODAY, slotId: 's-d' }, initial: false });
  });
});

describe('case 10: S15, main\'s sheet everywhere else', () => {
  it('a coachless client\'s Something else is main\'s sheet: no Instead of, no swaps, no footnote', async () => {
    mockUser = { id: 'user' };
    mockStore.foodLogs = [];
    await render(tree());
    await fireEvent.press(await screen.findByTestId('food-day-first-breakfast'));
    expect(await screen.findByTestId('food-search-title')).toHaveTextContent(/^Add (at|to) /);
    expect(screen.queryByTestId('food-search-instead')).toBeNull();
    expect(screen.queryByTestId('food-search-swaps-heading')).toBeNull();
    expect(screen.queryByTestId('food-search-footnote')).toBeNull();
    expect(screen.queryByText(/Sam|coach|Roman|plan meal/)).toBeNull();
  });

  it('the checklist switch off: the classic log and main\'s sheet, with no plan word', async () => {
    featureFlags.foodPlanChecklist = false;
    await render(tree());
    await fireEvent.press(await screen.findByLabelText('Add food to snacks'));
    expect(await screen.findByTestId('food-search-title')).toHaveTextContent(/^Add (at|to) /);
    expect(screen.queryByTestId('food-search-footnote')).toBeNull();
    expect(screen.queryByText('Recipe and grocery list')).toBeNull();
    expect(screen.queryByText(/Swaps from|Instead of|updated today's plan/)).toBeNull();
  });
});
