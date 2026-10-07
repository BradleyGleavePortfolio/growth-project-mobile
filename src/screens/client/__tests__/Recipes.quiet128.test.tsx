import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import RecipesScreen from '../RecipesScreen';
import RecipeDetailScreen from '../RecipeDetailScreen';
import { lightTokens } from '../../../theme/tokens';
import { recipesApi, profileApi } from '../../../services/api';

const mockBack = jest.fn(), mockNavigate = jest.fn(), mockRefetch = jest.fn();
const recipe = { id: 'r1', title: 'Lentil soup', calories: 320, protein: 24, carbs: 40, fat: 8, prep_time_min: 5, cook_time_min: 20, servings: 2, tags: ['vegan'], ingredients: ['Lentils'], instructions: ['Simmer gently.'], isSaved: false };
let mockData: unknown, mockError = false, mockLoading = false, mockRestrictions: string[] | undefined = [];
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: mockBack, navigate: mockNavigate }), useRoute: () => ({ params: { recipeId: 'r1' } }) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mockData, isError: mockError, isLoading: mockLoading, refetch: mockRefetch }), useQueryClient: () => ({ getQueryData: () => undefined }) }));
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({ semanticColors: require('../../../theme/tokens').lightTokens, colors: new Proxy({}, { get: () => 'legacy' }) }) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client', profile: { diet_restrictions: mockRestrictions } }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../services/api', () => ({ recipesApi: { save: jest.fn(async () => ({})), unsave: jest.fn(async () => ({})) }, profileApi: { update: jest.fn(async () => ({})) } }));
jest.mock('../../../components/FadeInView', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
beforeEach(() => { jest.clearAllMocks(); mockError = false; mockLoading = false; mockRestrictions = []; });

it('keeps list navigation, all filters, search/clear, and refresh reachable as text rows', async () => {
  mockData = [recipe];
  const ui = await render(<RecipesScreen />);
  expect(StyleSheet.flatten(ui.getByText('Lentil soup').props.style).fontFamily).toBe('Inter_500Medium');
  expect(ui.getByText('320 kcal · 24 g protein per serving')).toBeTruthy();
  expect(ui.getByText('40 g carbs · 8 g fat per serving')).toBeTruthy();
  await fireEvent.press(ui.getByRole('button', { name: 'Open Lentil soup' }));
  expect(mockNavigate).toHaveBeenCalledWith('RecipeDetail', { recipeId: 'r1' });
  await fireEvent.press(ui.getByRole('button', { name: 'Go back' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
  for (const tag of ['All', 'breakfast', 'lunch', 'dinner', 'high-protein', 'low-carb', 'meal-prep', 'quick', 'vegan', 'gluten-free']) {
    await fireEvent.press(ui.getByRole('button', { name: tag }));
    expect(Boolean(ui.queryByText('Lentil soup'))).toBe(tag === 'All' || tag === 'vegan');
  }
  await fireEvent.press(ui.getByRole('button', { name: 'All' }));
  await fireEvent.changeText(ui.getByPlaceholderText('Search recipes…'), 'toast');
  expect(ui.getByText('No matches')).toBeTruthy();
  await fireEvent.changeText(ui.getByPlaceholderText('Search recipes…'), '');
  expect(ui.getByText('Lentil soup')).toBeTruthy();
  await act(() => ui.getByTestId('recipes-list').props.refreshControl.props.onRefresh());
  expect(mockRefetch).toHaveBeenCalledTimes(1);
});
it('uses neutral empty copy and does not invent absent list nutrition or time', async () => {
  mockData = [];
  const ui = await render(<RecipesScreen />);
  expect(ui.getByText('Recipes available to this account appear here.')).toBeTruthy();
  mockData = [{ ...recipe, calories: null, protein: null, carbs: null, fat: null, prep_time_min: null }];
  await ui.rerender(<RecipesScreen />);
  expect(ui.queryByText(/kcal|protein per serving|min/)).toBeNull();
});
it('retains detail data, numbered method, save/unsave, and back with semantic colours', async () => {
  mockData = recipe;
  const ui = await render(<RecipeDetailScreen />);
  for (const text of ['INGREDIENTS', 'METHOD', 'PER SERVING', 'Lentils', 'Simmer gently.', '1']) expect(ui.getByText(text)).toBeTruthy();
  const method = StyleSheet.flatten(ui.getByText('Simmer gently.').props.style);
  expect(method).toMatchObject({ fontFamily: 'Inter_400Regular', fontSize: 16, color: lightTokens.textPrimary });
  await fireEvent.press(ui.getByRole('button', { name: 'Save recipe' }));
  expect(recipesApi.save).toHaveBeenCalledWith('r1');
  await waitFor(() => expect(ui.getByRole('button', { name: 'Remove from saved recipes' })).toBeTruthy());
  await fireEvent.press(ui.getByRole('button', { name: 'Remove from saved recipes' }));
  expect(recipesApi.unsave).toHaveBeenCalledWith('r1');
  await fireEvent.press(ui.getByRole('button', { name: 'Go back' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
it('retains recoverable detail errors and bookmark failure feedback', async () => {
  mockData = undefined; mockError = true;
  const ui = await render(<RecipeDetailScreen />);
  await fireEvent.press(ui.getByRole('button', { name: 'Retry recipe' }));
  expect(mockRefetch).toHaveBeenCalledTimes(1);
  await fireEvent.press(ui.getByText('Go back'));
  expect(mockBack).toHaveBeenCalledTimes(1);
  mockData = recipe; mockError = false;
  await ui.rerender(<RecipeDetailScreen />);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(recipesApi.save).mockRejectedValueOnce(new Error('offline'));
  await fireEvent.press(ui.getByRole('button', { name: 'Save recipe' }));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Could not update saved recipe', expect.stringContaining('Check your connection')));
  alert.mockRestore();
});
it.each(['save', 'later'])('retains allergy prompt %s and dismiss callbacks', async (action) => {
  mockData = []; mockRestrictions = undefined;
  const getItem = jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key) => key === 'lean_onboarding_done' ? 'true' : null);
  const setItem = jest.spyOn(AsyncStorage, 'setItem');
  const ui = await render(<RecipesScreen />);
  await ui.findByRole('button', { name: 'Set this up later' });
  if (action === 'save') {
    await fireEvent.press(ui.getByRole('button', { name: 'None' }));
    await fireEvent.press(ui.getByRole('button', { name: 'Save restrictions' }));
    expect(profileApi.update).toHaveBeenCalledWith({ diet_restrictions: [] });
  } else await fireEvent.press(ui.getByRole('button', { name: 'Set this up later' }));
  await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith('allergy_prompt_shown', 'true'));
  await waitFor(() => expect(ui.queryByRole('button', { name: 'Set this up later' })).toBeNull());
  getItem.mockRestore(); setItem.mockRestore();
});
it('shows loading and list failure honestly and keeps stored zero nutrition', async () => {
  mockData = []; mockLoading = true;
  const ui = await render(<RecipesScreen />);
  expect(ui.getByText('Loading recipes…')).toBeTruthy();
  mockLoading = false; mockError = true;
  await ui.rerender(<RecipesScreen />);
  expect(ui.getByText("Couldn't load recipes")).toBeTruthy();
  mockError = false; mockData = [{ ...recipe, calories: 0, protein: 0 }];
  await ui.rerender(<RecipesScreen />);
  expect(ui.getByText('0 kcal · 0 g protein per serving')).toBeTruthy();
  mockData = { ...recipe, calories: null, protein: null, carbs: null, fat: null, prep_time_min: null };
  await ui.rerender(<RecipeDetailScreen />);
  expect(ui.queryByText(/kcal|min total|Calories|Protein|Carbs|Fat/)).toBeNull();
});
