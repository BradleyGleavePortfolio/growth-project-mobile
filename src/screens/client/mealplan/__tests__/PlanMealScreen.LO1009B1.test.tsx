// LO-PLAN-SWAPS-M-1 B1 (LO lens, growth-project-mobile#1009 @ b14e1008): React Navigation 7's stack reuses the route on
// top when `navigate` names the screen already shown (StackRouter NAVIGATE: "If the route matches the current one,
// then navigate to it"). The Food tab's door is navigate('MoreTab', { screen: 'PlanMeal', params }), so with one plan
// meal's page still on top of the You stack (she left it by the tab bar, not Back), a second meal's link changes the
// params of the same mounted page. The page must then show the second meal's own state: its status line when it is
// already eaten (no second "Ate it as planned"), its button when it is not. Harness copied from PlanMealScreen.test.tsx.
import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PlanMealScreen from '../PlanMealScreen';
import { StackRouter, CommonActions } from '@react-navigation/routers';

jest.mock('../../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, foodPlanChecklist: true, youTabV2: true, clientTimelineV2: true, romanChat: true } };
});
let mockParams: { date: string; slotId: string } = { date: '2026-11-24', slotId: 's-din' };
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: mockParams }),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
const mockGet = jest.fn();
const mockRecipe = jest.fn();
const mockBulkAdd = jest.fn();
const mockDaily = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a) },
  recipesApi: { getById: (...a: unknown[]) => mockRecipe(...a) },
  listsApi: { bulkAdd: (...a: unknown[]) => mockBulkAdd(...a) },
  logApi: { getDaily: (...a: unknown[]) => mockDaily(...a), deleteEntry: jest.fn(), logFood: jest.fn() },
  foodApi: { create: jest.fn() },
}));
// The [R41] phone sizes: 390 x 844 at 100% and 320 x 568 at 130%.
let mockWindow = { width: 390, height: 844, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));

// A fixed clock: Tuesday 24 November 2026, 3:10 pm (only Date is faked).
jest.useFakeTimers({ now: new Date('2026-11-24T15:10:00'), advanceTimers: true, doNotFake: ['nextTick', 'setImmediate',
  'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime',
  'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());

const TODAY = '2026-11-24';
const dinnerTpl = {
  id: 'm-din', coach_id: 'sam', name: 'Salmon, potatoes and green beans', description: 'Swap the potatoes for rice if you prefer. Same amount.',
  calories_kcal: 620, protein_g: 42, carbs_g: 55, fats_g: 22, fiber_g: null, items: null, created_at: '', archived_at: null,
};
const preTpl = {
  id: 'm-pre', coach_id: 'sam', name: 'Banana and whey shake', description: null, calories_kcal: 250, protein_g: 27, carbs_g: 30, fats_g: 2,
  fiber_g: null, items: [{ name: 'Banana', portion: '1 medium' }, { name: 'Whey protein', grams: 30 }, { name: 'Water' }], created_at: '', archived_at: null,
};
const slots = (over: Record<string, unknown> = {}) => [
  { id: 's-pre', daily_meal_plan_id: 'p1', meal_template_id: 'm-pre', slot_label: 'preworkout', order: 0, time_of_day: '17:30', meal_template: preTpl, swaps: [], recipe_id: null },
  { id: 's-din', daily_meal_plan_id: 'p1', meal_template_id: 'm-din', slot_label: 'dinner', order: 0, time_of_day: '19:30', meal_template: dinnerTpl, swaps: [], recipe_id: 'r1', ...over },
];
const today = (s = slots()) => ({
  date: TODAY, changes_today: [],
  assignments: [{ id: 'a1', daily_meal_plan: { id: 'p1', coach_id: 'sam', name: 'Training day', notes: 'Protein at every meal. Water before coffee.', slots: s } }],
});
const recipe = {
  id: 'r1', title: 'Salmon traybake', calories: 700, protein: 50, carbs: 60, fat: 30, servings: 2, prep_time_min: 10, cook_time_min: 27,
  ingredients: ['Salmon fillet 160 g', 'Baby potatoes 200 g', 'Green beans 120 g', 'Olive oil 1 tsp'],
  instructions: ['Heat the oven to 200 C. Halve the potatoes and roast 15 minutes.', 'Add the salmon and beans, brush with the oil, roast 12 minutes more.', 'Rest 2 minutes. Season to taste.'],
  tags: [], allergens: ['fish'], allergens_declared: true,
};
const err = (status: number, code?: string) => Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status, data: code ? { error: code } : {} } });

function serve(body: unknown = today(), fail = false) {
  mockGet.mockImplementation(async (url: string) => {
    if (url.startsWith('/me/meal-plan/today')) {
      if (fail) throw Object.assign(new Error('Network Error'), { isAxiosError: true });
      return { data: body };
    }
    if (url === '/v1/clients/me/coach') return { data: { name: 'Sam Reid' } };
    throw new Error(`unexpected GET ${url}`);
  });
}
async function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PlanMealScreen /></QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWindow = { width: 390, height: 844, scale: 2, fontScale: 1 };
  mockParams = { date: TODAY, slotId: 's-din' };
  mockRecipe.mockResolvedValue({ data: recipe });
  mockDaily.mockResolvedValue({ data: { entries: [] } });
  mockBulkAdd.mockResolvedValue({ data: { added: 4 } });
});


const dinnerEaten = { data: { entries: [{ id: 'e1', meal_type: 'dinner', plan_slot_id: 's-din', quantity_multiplier: 1,
  original_quantity: 1, original_unit: 'serving', food_item: { name: 'Salmon, potatoes and green beans', calories: 620, protein_g: 42, carbs_g: 55, fat_g: 22, nutrient_basis: 'PER_SERVING' },
  calories: 620, protein_g: 42, carbs_g: 55, fat_g: 22 }] } };

async function showWithRerender() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><PlanMealScreen /></QueryClientProvider>;
  const view = await render(tree());
  return { again: () => view.rerender(tree()) };
}

describe('LO-PLAN-SWAPS-M-1 B1: a second plan meal opened onto the mounted page shows its own state', () => {
  it('proof: the stack keeps the same PlanMeal route (same key, so the same mounted page) when navigate names it again', () => {
    const router = StackRouter({});
    const options = { routeNames: ['MoreIndex', 'PlanMeal'], routeParamList: {}, routeGetIdList: {} };
    const state = router.getInitialState(options);
    const one = router.getStateForAction(state, CommonActions.navigate('PlanMeal', { date: TODAY, slotId: 's-pre' }), options);
    const two = router.getStateForAction(one as never, CommonActions.navigate('PlanMeal', { date: TODAY, slotId: 's-din' }), options);
    const top = (s: unknown) => (s as { routes: { key: string; params: unknown }[]; index: number });
    expect(top(two).routes).toHaveLength(2);
    expect(top(two).routes[1].key).toBe(top(one).routes[1].key);
    expect(top(two).routes[1].params).toEqual({ date: TODAY, slotId: 's-din' });
  });

  it('pre-workout (not eaten) then dinner (eaten as planned): dinner shows its status line and no "Ate it as planned"', async () => {
    serve();
    mockDaily.mockResolvedValue(dinnerEaten);
    mockParams = { date: TODAY, slotId: 's-pre' };
    const { again } = await showWithRerender();
    expect(await screen.findByText('Banana and whey shake')).toBeTruthy();
    expect(await screen.findByText('Ate it as planned')).toBeTruthy();
    mockParams = { date: TODAY, slotId: 's-din' };
    await again();
    expect(await screen.findByText('Salmon, potatoes and green beans')).toBeTruthy();
    await screen.findByTestId('plan-meal-ingredients');
    expect(await screen.findByTestId('plan-meal-status')).toHaveTextContent('Logged as planned');
    expect(screen.queryByText('Ate it as planned')).toBeNull();
  });

  it('dinner (eaten) then pre-workout (not eaten): pre-workout keeps its "Ate it as planned"', async () => {
    serve();
    mockDaily.mockResolvedValue(dinnerEaten);
    mockParams = { date: TODAY, slotId: 's-din' };
    const { again } = await showWithRerender();
    expect(await screen.findByTestId('plan-meal-status')).toHaveTextContent('Logged as planned');
    mockParams = { date: TODAY, slotId: 's-pre' };
    await again();
    expect(await screen.findByText('Banana and whey shake')).toBeTruthy();
    expect(await screen.findByText('Ate it as planned')).toBeTruthy();
    expect(screen.queryByTestId('plan-meal-status')).toBeNull();
  });
});
