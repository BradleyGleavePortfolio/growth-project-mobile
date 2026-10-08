import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RecipesScreen from '../RecipesScreen';
import RecipeDetailScreen from '../RecipeDetailScreen';

// NUTR-AUD-128 U5: the saved state comes from the server, never from the list
// cache, and the Saved filter is backed by GET /recipes/saved.
const mockNavigate = jest.fn(), mockList = jest.fn(), mockListSaved = jest.fn(), mockGetById = jest.fn();
const mockSave = jest.fn(async (_id: string) => ({}));
const base = { calories: 320, protein: 24, carbs: 40, fat: 8, prep_time_min: 5, cook_time_min: 20, servings: 2, ingredients: ['Lentils'], instructions: ['Simmer.'], is_public: true, created_by_id: 'coach', _count: { saved_by: 1 } };
const soup = { ...base, id: 'r1', title: 'Lentil soup', tags: ['vegan'] };
const toast = { ...base, id: 'r2', title: 'Egg toast', tags: ['breakfast'] };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn(), navigate: mockNavigate }), useRoute: () => ({ params: { recipeId: 'r1' } }) }));
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({ semanticColors: require('../../../theme/tokens').lightTokens, colors: new Proxy({}, { get: () => 'legacy' }) }) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client', profile: { diet_restrictions: [] } }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../services/api', () => ({
  recipesApi: {
    list: () => mockList(), listSaved: () => mockListSaved(), getById: (id: string) => mockGetById(id),
    save: (id: string) => mockSave(id), unsave: async () => ({}),
  },
  profileApi: { update: jest.fn(async () => ({})) },
}));
jest.mock('../../../components/FadeInView', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const wrap = (client: QueryClient, el: React.ReactElement) => <QueryClientProvider client={client}>{el}</QueryClientProvider>;
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue({ data: [soup, toast] });
  mockListSaved.mockResolvedValue({ data: [soup] });
  mockGetById.mockResolvedValue({ data: { ...soup, isSaved: true } });
});

it('opens a saved recipe from the list as saved, using the server answer instead of the list cache', async () => {
  const client = newClient();
  client.setQueryData(['recipes'], [soup, toast]);
  const ui = await render(wrap(client, <RecipeDetailScreen />));
  expect(ui.getByText('Lentil soup')).toBeTruthy();
  expect(ui.queryByRole('button', { name: 'Save recipe' })).toBeNull();
  await waitFor(() => expect(ui.getByRole('button', { name: 'Remove from saved recipes' })).toBeTruthy());
  expect(mockGetById).toHaveBeenCalledWith('r1');
});

it('keeps the new saved state when the recipe is reopened, and refreshes the Saved list', async () => {
  mockGetById.mockResolvedValue({ data: { ...soup, isSaved: false } });
  const client = newClient();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const first = await render(wrap(client, <RecipeDetailScreen />));
  await fireEvent.press(await first.findByRole('button', { name: 'Save recipe' }));
  await waitFor(() => expect(first.getByRole('button', { name: 'Remove from saved recipes' })).toBeTruthy());
  expect(mockSave).toHaveBeenCalledWith('r1');
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['recipes', 'saved'] });
  await first.unmount();
  const again = await render(wrap(client, <RecipeDetailScreen />));
  expect(again.getByRole('button', { name: 'Remove from saved recipes' })).toBeTruthy();
});

it('shows only saved recipes under Saved, from GET /recipes/saved, with honest empty copy', async () => {
  const client = newClient();
  const ui = await render(wrap(client, <RecipesScreen />));
  await ui.findByText('Egg toast');
  expect(mockListSaved).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByRole('button', { name: 'Saved' }));
  expect(await ui.findByText('Lentil soup')).toBeTruthy();
  expect(ui.queryByText('Egg toast')).toBeNull();
  expect(mockListSaved).toHaveBeenCalledTimes(1);
  await fireEvent.press(ui.getByRole('button', { name: 'Open Lentil soup' }));
  expect(mockNavigate).toHaveBeenCalledWith('RecipeDetail', { recipeId: 'r1' });
  mockListSaved.mockResolvedValue({ data: [] });
  await client.invalidateQueries({ queryKey: ['recipes', 'saved'] });
  await waitFor(() => expect(ui.getByText('No saved recipes')).toBeTruthy());
  expect(ui.getByText('Recipes you save from a recipe page appear here.')).toBeTruthy();
  await fireEvent.press(ui.getByRole('button', { name: 'All' }));
  expect(await ui.findByText('Egg toast')).toBeTruthy();
});

it('says so when the saved list cannot load', async () => {
  mockListSaved.mockRejectedValue(new Error('offline'));
  const ui = await render(wrap(newClient(), <RecipesScreen />));
  await ui.findByText('Egg toast');
  await fireEvent.press(ui.getByRole('button', { name: 'Saved' }));
  expect(await ui.findByText("Couldn't load saved recipes")).toBeTruthy();
});
