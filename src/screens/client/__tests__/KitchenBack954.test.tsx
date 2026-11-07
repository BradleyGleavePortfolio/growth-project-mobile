import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GroceryListScreen from '../GroceryListScreen';
import ShoppingListScreen from '../ShoppingListScreen';
import PrepGuideScreen from '../PrepGuideScreen';
import RecipesScreen from '../RecipesScreen';
import RecipeDetailScreen from '../RecipeDetailScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
  useRoute: () => ({ params: { recipeId: 'soup' } }),
}));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: jest.requireActual('../../../constants/colors').default,
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  }),
}));
jest.mock('../../../components/FadeInView', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client', profile: { diet_restrictions: [] } }),
}));
jest.mock('../../../lib/recipeAllergens', () => ({
  ...jest.requireActual('../../../lib/recipeAllergens'),
  useRecipeAllergenGuide: () => ({ hiddenNames: [], settled: true }),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../services/api', () => {
  const recipe = {
    id: 'soup', title: 'Lentil soup', tags: [], ingredients: [], instructions: [],
    calories: 420, protein: 20, carbs: 40, fat: 12,
    prep_time_min: 10, cook_time_min: 20, servings: 2, isSaved: false,
  };
  return {
    listsApi: { getList: async () => ({ data: [] }) },
    prepGuideApi: { getWeeklyGuide: async () => ({ data: {
      source: 'plan', recipes: [recipe], aggregated_ingredients: [], prep_day_suggestions: [],
    } }) },
    recipesApi: { list: async () => ({ data: [recipe] }), getById: async () => ({ data: recipe }) },
    profileApi: { update: jest.fn() },
  };
});

type Host = { type: unknown; props: { style?: unknown }; parent: Host | null };
const flat = (node: Host) => (StyleSheet.flatten(
  node.props.style as Parameters<typeof StyleSheet.flatten>[0],
) ?? {}) as Record<string, unknown>;
const number = (value: unknown) => typeof value === 'number' ? value : 0;

// Real consumers, not a standalone masthead: a negative offset anywhere on
// its first-child path would put part of Back above a clipping scroll host.
it.each([
  ['Grocery', GroceryListScreen, 'Grocery list', 'Back'],
  ['Shopping', ShoppingListScreen, 'Shopping list', 'Back'],
  ['Prep', PrepGuideScreen, 'Prep guide', 'Back'],
  ['Recipes', RecipesScreen, 'Recipes', 'Go back'],
  ['RecipeDetail', RecipeDetailScreen, 'Lentil soup', 'Go back'],
] as const)('%s keeps the complete 44pt Back target inside every scroll host', async (_name, Screen, title, label) => {
  const spy = jest.spyOn(Dimensions, 'get').mockReturnValue({
    width: 320, height: 568, scale: 1, fontScale: 1.3,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const ui = await render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
  try {
    await waitFor(() => expect(ui.getByRole('header', { name: title })).toBeTruthy());
    const back = ui.getByRole('button', { name: label }) as unknown as Host;
    expect(flat(back).minHeight).toBeGreaterThanOrEqual(44);
    let offset = 0;
    for (let node: Host | null = back; node; node = node.parent) {
      if (typeof node.type !== 'string') continue;
      const style = flat(node);
      offset += number(style.marginTop ?? style.marginVertical ?? style.margin);
      if (node !== back) offset += number(style.paddingTop ?? style.paddingVertical ?? style.padding);
      if (/ScrollView/.test(node.type)) expect(offset).toBeGreaterThanOrEqual(0);
    }
    // Also cover the fixed Recipes masthead, which has no scroll ancestor.
    const masthead = back.parent?.parent as Host;
    expect(number(flat(masthead).marginTop)).toBeGreaterThanOrEqual(0);
    if (_name === 'RecipeDetail') {
      const save = ui.getByRole('button', { name: 'Save recipe' });
      expect(StyleSheet.flatten(save.props.style).height).toBeGreaterThanOrEqual(44);
    }
  } finally {
    await ui.unmount();
    client.clear();
    spy.mockRestore();
  }
});
