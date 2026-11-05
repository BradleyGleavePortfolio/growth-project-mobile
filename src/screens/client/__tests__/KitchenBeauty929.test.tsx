// BEAUTY-929: the kitchen screens brought to the C2 Style C drawing (C_kitchen, C_recipe, C_grocery, C_error).
// Pins what the beauty pass changed: the page is the app's bone (#F7FAF7, owner "we keep the toothpaste color
// for v1"), every recipe row carries its picture tile, empty states carry their line drawing, the prep guide and
// recipe list failures are the warm notice with a working Try again, the recipe page keeps Back while it loads or
// fails, and prep ingredients read name then amount.
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { listsApi, prepGuideApi, recipesApi } from '../../../services/api';
import { lightTokens } from '../../../theme/tokens';
import { StyleCPaper } from '../../../ui/layout/StyleCPage';
import GroceryListScreen from '../GroceryListScreen';
import ShoppingListScreen from '../ShoppingListScreen';
import PrepGuideScreen from '../PrepGuideScreen';
import RecipeDetailScreen from '../RecipeDetailScreen';

const mockBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockBack, navigate: jest.fn() }),
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
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../services/api', () => ({
  listsApi: { getList: jest.fn(), addItem: jest.fn(), bulkAdd: jest.fn(), updateItem: jest.fn(), deleteItem: jest.fn(), clearChecked: jest.fn() },
  prepGuideApi: { getWeeklyGuide: jest.fn() },
  recipesApi: { getById: jest.fn(), save: jest.fn(), unsave: jest.fn() },
}));

function mount(Screen: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
}
const guide = {
  meal_plan_id: 'mp1', week_start: '2026-11-02',
  recipes: [{ id: 'r1', title: 'Lentil soup', prep_time_min: 10, cook_time_min: 20, servings: 2, calories: 420, allergens_declared: true, allergens: [] }],
  aggregated_ingredients: [{ name: 'Red lentils', quantity: 400, unit: 'g' }],
  prep_day_suggestions: ['Sunday'],
};
beforeEach(() => { jest.resetAllMocks(); });

it('the page is the bone bgPrimary, not the cream the frames draw', async () => {
  const ui = await render(<StyleCPaper />);
  const paper = ui.toJSON() as unknown as { props: { style: Parameters<typeof StyleSheet.flatten>[0] } };
  expect(StyleSheet.flatten(paper.props.style)).toMatchObject({ backgroundColor: lightTokens.bgPrimary });
  expect(lightTokens.bgPrimary).toBe('#F7FAF7');
});

it('a prep guide failure is the warm notice with a Try again that loads again', async () => {
  jest.mocked(prepGuideApi.getWeeklyGuide).mockRejectedValue(new Error('offline'));
  const ui = await mount(PrepGuideScreen);
  await waitFor(() => expect(ui.getByText("Couldn't load prep guide")).toBeTruthy(), { timeout: 4000 });
  expect(ui.getByRole('alert')).toBeTruthy();
  expect(ui.getByText("Couldn't load prep guide")).toBeTruthy();
  expect(ui.getByText('Pull down to try again.')).toBeTruthy();
  jest.mocked(prepGuideApi.getWeeklyGuide).mockResolvedValue({ data: guide } as Awaited<ReturnType<typeof prepGuideApi.getWeeklyGuide>>);
  await fireEvent.press(ui.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(ui.getByText('Lentil soup')).toBeTruthy(), { timeout: 4000 });
  expect(prepGuideApi.getWeeklyGuide).toHaveBeenCalledTimes(2);
});

it('prep rows carry the picture tile and ingredients read name then amount', async () => {
  jest.mocked(prepGuideApi.getWeeklyGuide).mockResolvedValue({ data: guide } as Awaited<ReturnType<typeof prepGuideApi.getWeeklyGuide>>);
  const ui = await mount(PrepGuideScreen);
  await waitFor(() => expect(ui.getByText('Lentil soup')).toBeTruthy(), { timeout: 4000 });
  expect(ui.getAllByTestId('stylec-thumb', { includeHiddenElements: true })).toHaveLength(1);
  expect(ui.getByText('Red lentils')).toBeTruthy();
  expect(ui.getByText('400 g')).toBeTruthy();
  expect(ui.getByRole('button', { name: 'Add all ingredients' })).toBeTruthy();
});

it('the recipe page keeps Back in the masthead while it loads and when it fails', async () => {
  let fail: (e: Error) => void = () => undefined;
  jest.mocked(recipesApi.getById).mockReturnValue(new Promise((_, reject) => { fail = reject; }) as ReturnType<typeof recipesApi.getById>);
  const ui = await mount(RecipeDetailScreen);
  await fireEvent.press(ui.getByLabelText('Go back'));
  expect(mockBack).toHaveBeenCalledTimes(1);
  fail(new Error('offline'));
  await waitFor(() => expect(ui.getByText('Could not load this recipe. Check your connection and try again.')).toBeTruthy());
  const backs = ui.getAllByRole('button', { name: 'Go back' });
  expect(backs).toHaveLength(2); // the masthead chevron and the quiet link under the notice
  await fireEvent.press(backs[0]);
  expect(mockBack).toHaveBeenCalledTimes(2);
});

it('empty lists show the line-drawing tile over the words on main', async () => {
  jest.mocked(listsApi.getList).mockResolvedValue({ data: [] } as Awaited<ReturnType<typeof listsApi.getList>>);
  const g = await mount(GroceryListScreen);
  await waitFor(() => expect(g.getByText('Your grocery list is empty')).toBeTruthy());
  expect(g.getByTestId('stylec-thumb', { includeHiddenElements: true })).toBeTruthy();
  g.unmount();
  const s = await mount(ShoppingListScreen);
  await waitFor(() => expect(s.getByText('Your shopping list is empty')).toBeTruthy());
  expect(s.getByTestId('stylec-thumb', { includeHiddenElements: true })).toBeTruthy();
});
