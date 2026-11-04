// STYLE-KITCHEN-M: the Style C look must not hide a control or cut a number at 130% text.
// React Native tests cannot measure layout, so this pins what would cut or hide: no text in these
// screens is clamped to a line count or capped below 130%, every count and amount is on screen, and
// every control is still a reachable button with its words on main.
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { listsApi, prepGuideApi, recipesApi } from '../../../services/api';
import { lightTokens } from '../../../theme/tokens';
import GroceryListScreen from '../GroceryListScreen';
import ShoppingListScreen from '../ShoppingListScreen';
import PrepGuideScreen from '../PrepGuideScreen';
import RecipeDetailScreen from '../RecipeDetailScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
  useRoute: () => ({ params: { recipeId: 'r1' } }),
}));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../../constants/colors').default, semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../components/FadeInView', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' }, NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('../../../services/api', () => ({
  listsApi: { getList: jest.fn(), addItem: jest.fn(), bulkAdd: jest.fn(), updateItem: jest.fn(), deleteItem: jest.fn(), clearChecked: jest.fn() },
  prepGuideApi: { getWeeklyGuide: jest.fn() },
  recipesApi: { getById: jest.fn(), save: jest.fn(), unsave: jest.fn() },
}));

const longName = 'Wholegrain sourdough sandwich loaf, sliced thick for the week';
const items = [
  { id: 'milk', name: 'Milk', quantity: 2, unit: 'litres', is_checked: false },
  { id: 'bread', name: longName, quantity: 1250, unit: 'grams', is_checked: false },
  { id: 'oats', name: 'Oats', quantity: 1, is_checked: true },
];
const recipe = {
  id: 'r1', title: 'Slow-cooked chickpea, spinach and roasted red pepper stew with lemon yoghurt', calories: 1234, protein: 56,
  carbs: 140, fat: 38, prep_time_min: 15, cook_time_min: 45, servings: 4, tags: ['dinner'], ingredients: ['400 g chickpeas'],
  instructions: ['Simmer gently.'], isSaved: false,
};
function mount(Screen: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
}
type Ui = ReturnType<typeof render>;
/** No text is clamped (numberOfLines) or held below 130% (maxFontSizeMultiplier under 1.3), except the masthead title at 120% like the client file. */
type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };
function texts(node: Node | Node[] | string | null): Node[] {
  if (!node || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(texts);
  return [...(node.type === 'Text' ? [node] : []), ...(node.children ?? []).flatMap(texts)];
}
function expectNothingClamped(ui: Ui) {
  const found = texts(ui.toJSON() as Node | Node[] | null);
  expect(found.length).toBeGreaterThan(5);
  for (const node of found) {
    expect(node.props.numberOfLines).toBeUndefined();
    const cap = node.props.maxFontSizeMultiplier;
    if (typeof cap === 'number' && node.props.accessibilityRole !== 'header') expect(cap).toBeGreaterThanOrEqual(1.3);
  }
}
const bg = (ui: Ui, testID: string) => StyleSheet.flatten(ui.getByTestId(testID).props.style).backgroundColor;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listsApi.getList).mockResolvedValue({ data: items } as Awaited<ReturnType<typeof listsApi.getList>>);
});

it.each([
  ['Grocery list', GroceryListScreen],
  ['Shopping list', ShoppingListScreen],
])('%s keeps the count, every amount and every control at 130%%', async (title, Screen) => {
  const ui = await mount(Screen);
  await waitFor(() => expect(ui.getByText('2 to get.')).toBeTruthy());
  expect(ui.getByRole('header', { name: title })).toBeTruthy();
  expect(ui.getByText('2 litres')).toBeTruthy();
  expect(ui.getByText('1250 grams')).toBeTruthy();
  expect(ui.getByText(longName)).toBeTruthy();
  for (const name of ['Back', 'Add item', 'Check Milk', 'Remove Milk', `Check ${longName}`, 'Uncheck Oats', 'Clear checked']) {
    expect(['button', 'checkbox']).toContain(ui.getByLabelText(name).props.accessibilityRole);
  }
  expect(StyleSheet.flatten(ui.getByLabelText('Check Milk').props.style).width).toBe(44);
  expect(StyleSheet.flatten(ui.getByLabelText('Remove Milk').props.style).width).toBe(44);
  expect(bg(ui, 'grocery-prep-screen')).toBe(lightTokens.bgPrimary);
  expectNothingClamped(ui);
});

it('the list error is one alert region with Try again as the primary button', async () => {
  jest.mocked(listsApi.getList).mockRejectedValue(new Error('offline'));
  const ui = await mount(GroceryListScreen);
  await waitFor(() => expect(ui.getByRole('alert')).toBeTruthy());
  expect(ui.getByText("Couldn't load grocery list.")).toBeTruthy();
  expect(ui.getByRole('button', { name: 'Try again' })).toBeTruthy();
});

it('the prep guide keeps Add all, the counts and the amounts at 130%', async () => {
  jest.mocked(prepGuideApi.getWeeklyGuide).mockResolvedValue({ data: {
    source: 'plan', prep_day_suggestions: ['Sunday'],
    recipes: [{ ...recipe, id: 'soup' }],
    aggregated_ingredients: [{ name: 'Chickpeas', quantity: 2.5, unit: 'kg' }],
  } } as Awaited<ReturnType<typeof prepGuideApi.getWeeklyGuide>>);
  const ui = await mount(PrepGuideScreen);
  await waitFor(() => expect(ui.getByText('Add all')).toBeTruthy());
  expect(ui.getByRole('button', { name: 'Add all ingredients' })).toBeTruthy();
  expect(ui.getByRole('button', { name: `Open ${recipe.title}` })).toBeTruthy();
  expect(ui.getByText('1234 kcal')).toBeTruthy();
  expect(ui.getByText(/2\.5 kg/)).toBeTruthy();
  expect(ui.getByText('Ingredients (1)')).toBeTruthy();
  expectNothingClamped(ui);
});

it('the recipe keeps Save, the long title and every per-serving number at 130%', async () => {
  jest.mocked(recipesApi.getById).mockResolvedValue({ data: recipe } as Awaited<ReturnType<typeof recipesApi.getById>>);
  const ui = await mount(RecipeDetailScreen);
  await waitFor(() => expect(ui.getByRole('button', { name: 'Save recipe' })).toBeTruthy());
  expect(ui.getByRole('header', { name: recipe.title })).toBeTruthy();
  expect(ui.getByRole('button', { name: 'Go back' })).toBeTruthy();
  for (const text of ['1234 kcal', '56 g', '140 g', '38 g', '60 min total', '4 servings', '15 min prep']) expect(ui.getByText(text)).toBeTruthy();
  expect(StyleSheet.flatten(ui.getByRole('button', { name: 'Save recipe' }).props.style).width).toBe(44);
  expectNothingClamped(ui);
});
