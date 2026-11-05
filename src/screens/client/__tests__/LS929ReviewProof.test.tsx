// Independent LS-929 review probes. Not a product fix.
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RecipesScreen from '../RecipesScreen';
import GroceryListScreen from '../GroceryListScreen';
import ShoppingListScreen from '../ShoppingListScreen';
import PrepGuideScreen from '../PrepGuideScreen';

const mockList = jest.fn(), mockSaved = jest.fn(), mockGuide = jest.fn(), mockLists = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
    colors: jest.requireActual('../../../constants/colors').default,
  }),
}));
jest.mock('../../../components/FadeInView', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'review-client', profile: { diet_restrictions: [] } }),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: { error: jest.fn(), selection: jest.fn(), softImpact: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../services/api', () => ({
  recipesApi: {
    list: () => mockList(), listSaved: () => mockSaved(),
    allergens: async () => ({ data: { allergens: [], your_allergens: [] } }),
  },
  prepGuideApi: { getWeeklyGuide: (week: string) => mockGuide(week) },
  listsApi: { getList: (kind: string) => mockLists(kind) },
}));
const recipe = {
  id: 'r1', title: 'Review soup', prep_time_min: 10, cook_time_min: 20,
  servings: 2, calories: 420, protein: 20, carbs: 50, fat: 10, tags: [],
  ingredients: ['Lentils'], instructions: ['Simmer.'],
};
function mount(Component: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><Component /></QueryClientProvider>);
}
beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue({ data: [] });
  mockSaved.mockResolvedValue({ data: [] });
  mockLists.mockResolvedValue({ data: [] });
});

it('empty-list mount and awaited teardown do not poison later screen reads', async () => {
  const grocery = await mount(GroceryListScreen);
  await grocery.findByText('Your grocery list is empty');
  await grocery.unmount();
  const shopping = await mount(ShoppingListScreen);
  await shopping.findByText('Your shopping list is empty');
  await shopping.unmount();
});

it.each(['All', 'Saved'])('%s retry repeats only the failed active Recipes read', async (mode) => {
  if (mode === 'All') mockList.mockRejectedValue(new Error('offline'));
  else mockSaved.mockRejectedValue(new Error('offline'));
  const ui = await mount(RecipesScreen);
  if (mode === 'Saved') await fireEvent.press(ui.getByRole('button', { name: 'Saved' }));
  await ui.findByText(mode === 'All' ? "Couldn't load recipes" : "Couldn't load saved recipes");
  const listBefore = mockList.mock.calls.length;
  const savedBefore = mockSaved.mock.calls.length;
  (mode === 'All' ? mockList : mockSaved).mockResolvedValue({ data: [recipe] });
  await fireEvent.press(ui.getByRole('button', { name: 'Try again' }));
  await ui.findByText('Review soup');
  expect(mockList).toHaveBeenCalledTimes(listBefore + (mode === 'All' ? 1 : 0));
  expect(mockSaved).toHaveBeenCalledTimes(savedBefore + (mode === 'Saved' ? 1 : 0));
});

it('prep retry preserves the failed read week and shows its successful answer', async () => {
  mockGuide.mockRejectedValue(new Error('offline'));
  const ui = await mount(PrepGuideScreen);
  await ui.findByText("Couldn't load prep guide");
  const failedWeek = mockGuide.mock.calls[0][0];
  mockGuide.mockResolvedValue({ data: {
    recipes: [recipe], aggregated_ingredients: [], prep_day_suggestions: [], source: 'library',
  } });
  await fireEvent.press(ui.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(ui.getByText('Review soup')).toBeTruthy());
  expect(mockGuide).toHaveBeenCalledTimes(2);
  expect(mockGuide.mock.calls[1][0]).toBe(failedWeek);
});
