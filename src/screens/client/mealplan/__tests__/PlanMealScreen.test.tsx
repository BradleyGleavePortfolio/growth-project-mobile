// PLAN-SWAPS-M (C2 Style C C_recipe; operator rulings R6, R8, R9; states S7 to S13): a plan meal's own page. Fictional
// data (client Jordan, coach Sam). Mounted at 390 x 844 at 100% and at 320 x 568 at 130%.
import React from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PlanMealScreen from '../PlanMealScreen';

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
const err = (status: number, code?: string) => Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status, data: code ? { code } : {} } });

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

describe('case 7: S7 to S9, the page with a recipe', () => {
  it('S7: the overline, the title, the quoted note, the plan meal\'s own four numbers, the three sections and the footer', async () => {
    serve();
    await show();
    expect(await screen.findByText("DINNER, FROM SAM'S PLAN")).toBeTruthy();
    expect(screen.getByText('Salmon, potatoes and green beans')).toBeTruthy();
    expect(screen.getByText('“Swap the potatoes for rice if you prefer. Same amount.”')).toBeTruthy();
    // The plan meal's numbers (what "Ate it as planned" logs), never the recipe's 700 kcal.
    expect(screen.getByTestId('plan-meal-per-serving')).toHaveTextContent('Per serving: 620 kcal, 42 g protein, 55 g carbs, 22 g fat.');
    expect(screen.queryByText(/700 kcal/)).toBeNull();
    const ingredients = await screen.findByTestId('plan-meal-ingredients');
    expect(within(ingredients).getByText('INGREDIENTS')).toBeTruthy();
    for (const line of recipe.ingredients) expect(within(ingredients).getByText(line)).toBeTruthy();
    expect(within(screen.getByTestId('plan-meal-allergens')).getByText(/Check the ingredients below before you cook\./)).toBeTruthy();
    const method = screen.getByTestId('plan-meal-method');
    expect(within(method).getByText('METHOD')).toBeTruthy();
    expect(within(method).getByText('3')).toBeTruthy();
    expect(within(method).getByText('Rest 2 minutes. Season to taste.')).toBeTruthy();
    expect(screen.getByText('Ate it as planned')).toBeTruthy();
    expect(screen.getByText('Add ingredients to grocery list')).toBeTruthy();
    expect(screen.queryByText(/Roman/)).toBeNull();
  });

  it('S8: once the meal is eaten its status line takes the button\'s place; the grocery link stays', async () => {
    serve();
    mockDaily.mockResolvedValue({ data: { entries: [{ id: 'e1', meal_type: 'dinner', plan_slot_id: 's-din', quantity_multiplier: 1,
      original_quantity: 1, original_unit: 'serving', food_item: { name: 'Salmon, potatoes and green beans', calories: 620, protein_g: 42, carbs_g: 55, fat_g: 22, nutrient_basis: 'PER_SERVING' },
      calories: 620, protein_g: 42, carbs_g: 55, fat_g: 22 }] } });
    await show();
    expect(await screen.findByTestId('plan-meal-status')).toHaveTextContent('Logged as planned');
    expect(screen.queryByText('Ate it as planned')).toBeNull();
    expect(screen.getByText('Add ingredients to grocery list')).toBeTruthy();
  });

  it('S9: another day shows no button; the grocery link stays', async () => {
    mockParams = { date: '2026-11-25', slotId: 's-din' };
    serve({ ...today(), date: '2026-11-25' });
    await show();
    expect(await screen.findByText('Salmon, potatoes and green beans')).toBeTruthy();
    await screen.findByTestId('plan-meal-ingredients');
    expect(screen.queryByText('Ate it as planned')).toBeNull();
    expect(screen.getByText('Add ingredients to grocery list')).toBeTruthy();
  });
});

describe('case 8: S10 to S12', () => {
  it('S10: a meal with no recipe lists its items with amounts, and no allergen or method section', async () => {
    mockParams = { date: TODAY, slotId: 's-pre' };
    serve();
    await show();
    const ingredients = await screen.findByTestId('plan-meal-ingredients');
    expect(within(ingredients).getByText('Banana')).toBeTruthy();
    expect(within(ingredients).getByText('1 medium')).toBeTruthy();
    expect(within(ingredients).getByText('30 g')).toBeTruthy();
    expect(within(ingredients).getByText('Water')).toBeTruthy();
    expect(screen.queryByTestId('plan-meal-allergens')).toBeNull();
    expect(screen.queryByTestId('plan-meal-method')).toBeNull();
    expect(mockRecipe).not.toHaveBeenCalled();
    expect(screen.getByText('Add ingredients to grocery list')).toBeTruthy();
  });

  it('S10: with neither recipe nor items there is no ingredients section and no grocery link', async () => {
    mockParams = { date: TODAY, slotId: 's-din' };
    serve(today(slots({ recipe_id: null })));
    await show();
    expect(await screen.findByText('Salmon, potatoes and green beans')).toBeTruthy();
    expect(screen.queryByTestId('plan-meal-ingredients')).toBeNull();
    expect(screen.queryByText('Add ingredients to grocery list')).toBeNull();
  });

  it('S11: the recipe loading, failing with Try again that reads again, gone, and hidden for an allergen', async () => {
    serve();
    let fail = true;
    mockRecipe.mockImplementation(async () => { if (fail) throw err(503); return { data: recipe }; });
    await show();
    expect(await screen.findByText('Could not load this recipe. Check your connection and try again.')).toBeTruthy();
    expect(screen.getByText('Salmon, potatoes and green beans')).toBeTruthy();
    expect(screen.getByText('Ate it as planned')).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('plan-meal-ingredients')).toBeTruthy();
    expect(mockRecipe).toHaveBeenCalledTimes(2);
  });

  it.each([
    [err(404, 'RECIPE_NOT_FOUND'), 'This recipe is no longer available.'],
    [err(404, 'RECIPE_HIDDEN_FOR_ALLERGENS'), 'This recipe is hidden because it lists an allergen saved on your profile.'],
  ])('S11: a 404 says why (%#)', async (e, words) => {
    serve();
    mockRecipe.mockRejectedValue(e);
    await show();
    expect(await screen.findByText(words)).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
    expect(screen.queryByText('Add ingredients to grocery list')).toBeNull();
  });

  it('S11: while the recipe loads the sections are still lines labelled Loading', async () => {
    serve();
    mockRecipe.mockImplementation(() => new Promise(() => undefined));
    await show();
    expect(await screen.findByTestId('plan-meal-recipe-loading')).toBeTruthy();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('S12: the plan read failed: the meal plan failure line and Try again', async () => {
    serve(undefined, true);
    await show();
    expect(await screen.findByTestId('plan-meal-plan-error')).toBeTruthy();
    expect(screen.getByText(/Your meal plan/)).toBeTruthy();
    serve();
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('Salmon, potatoes and green beans')).toBeTruthy();
  });

  it('S12 / H10: a meal the coach removed since: the line, no button, no grocery link', async () => {
    mockParams = { date: TODAY, slotId: 's-gone' };
    serve();
    await show();
    expect(await screen.findByText('This meal is no longer in your plan for this day.')).toBeTruthy();
    expect(screen.queryByText('Ate it as planned')).toBeNull();
    expect(screen.queryByText('Add ingredients to grocery list')).toBeNull();
  });
});

describe('case 9: S13, the grocery add', () => {
  it('sends one bulkAdd with the four recipe lines and the recipe id, no plan slot id; then the drawn sheet', async () => {
    serve();
    await show();
    await screen.findByTestId('plan-meal-ingredients');
    await fireEvent.press(screen.getByText('Add ingredients to grocery list'));
    await waitFor(() => expect(mockBulkAdd).toHaveBeenCalledTimes(1));
    const [type, items] = mockBulkAdd.mock.calls[0];
    expect(type).toBe('grocery');
    expect(items).toEqual(recipe.ingredients.map((name) => ({ name, source_recipe_id: 'r1' })));
    for (const item of items) expect(item).not.toHaveProperty('source_plan_slot_id');
    expect(await screen.findByText('Added to Grocery List')).toBeTruthy();
    expect(screen.getByText('4 ingredients added to your grocery list.')).toBeTruthy();
    await fireEvent.press(screen.getByText('View List'));
    expect(mockNavigate).toHaveBeenCalledWith('GroceryList');
  });

  it('a failed add says so and claims nothing', async () => {
    serve();
    mockBulkAdd.mockRejectedValue(err(403));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await show();
    await screen.findByTestId('plan-meal-ingredients');
    await fireEvent.press(screen.getByText('Add ingredients to grocery list'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Could not add the ingredients', 'Nothing was added to your grocery list. Try again.'));
    expect(screen.queryByText('Added to Grocery List')).toBeNull();
    alert.mockRestore();
  });
});

describe('case 11: 320 x 568 at 130%', () => {
  it('no new text is cut and every new control is at least 44 pt', async () => {
    mockWindow = { width: 320, height: 568, scale: 2, fontScale: 1.3 };
    serve();
    await show();
    await screen.findByTestId('plan-meal-ingredients');
    for (const t of screen.UNSAFE_queryAllByType(Text)) expect(t.props.numberOfLines).toBeUndefined();
    const link = screen.getByTestId('plan-meal-grocery');
    expect(StyleSheet.flatten(link.props.style).minHeight).toBeGreaterThanOrEqual(44);
  });
});
