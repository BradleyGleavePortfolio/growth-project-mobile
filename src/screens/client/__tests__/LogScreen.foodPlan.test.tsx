// UI-3 with the flag on: a coached client's plan checklist logs the plan meal in one tap, and
// "Something else" opens the food search with recent foods (until a coach swap list exists). A client
// with no coach repeats their usual meal with the saved portions.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../LogScreen';
import { foodApi, logApi } from '../../../services/api';
import { addDays, getTodayString } from '../../../utils/date';

const mockToday = getTodayString();
const mockStore = {
  selectedDate: mockToday, foodLogs: [], hasLoadedDay: true, dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  waterOz: 0, isLoading: false, loadError: null, setSelectedDate: jest.fn(), loadDayData: jest.fn().mockResolvedValue(undefined),
  logWater: jest.fn(), removeFoodLogLocally: jest.fn(),
};
const mockPlan = { date: mockToday, assignments: [{ daily_meal_plan: { name: 'Lean week 2', slots: [{ id: 's', slot_label: 'snack', order: 0,
  meal_template: { name: 'Greek yogurt bowl', calories_kcal: 210, protein_g: 30, carbs_g: 20, fats_g: 5, items: [] } }] } }] };
jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  return { ...real, featureFlags: { ...real.featureFlags, foodPlanChecklist: true } };
});
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../store/clientStore', () => ({ useClientStore: () => mockStore }));
const mockUser: { id: string; coach_id?: string } = { id: 'user', coach_id: 'coach' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => true }));
jest.mock('../../../hooks/useFoodBrowse', () => ({ useFoodBrowse: () => ({
  recentFoods: [{ id: 'f1', name: 'Rolled oats', calories: 379, protein: 13, carbs: 68, fat: 6.5, serving_size_grams: 40, nutrient_basis: 'PER_100G', supports_volume_units: false }], frequentFoods: [], lastMeals: {},
  loadBrowseFoods: jest.fn().mockResolvedValue(undefined) }) }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async (url: string) => ({ data: url.startsWith('/me/meal-plan') ? mockPlan : { name: 'Jordan Hale' } })) },
  foodApi: { search: jest.fn(() => new Promise(() => {})), create: jest.fn().mockResolvedValue({ data: { id: 'food-new' } }) },
  logApi: { logFood: jest.fn().mockResolvedValue({ data: { id: 'entry-new' } }), updateEntry: jest.fn(), deleteEntry: jest.fn(), getDaily: jest.fn() },
}));
jest.mock('../../../services/foodLogQueue', () => ({ flush: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

const show = () => render(<QueryClientProvider client={new QueryClient()}><LogScreen /></QueryClientProvider>);

it('logs the plan meal in one tap', async () => {
  await show();
  await fireEvent.press(await screen.findByText('Ate it as planned'));
  await waitFor(() => expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({ meal_type: 'snack', food_item_id: 'food-new' })));
  expect(foodApi.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Greek yogurt bowl' }));
  expect(await screen.findByText('Greek yogurt bowl added to Snacks.')).toBeTruthy();
});

it('opens the food search with recent foods from Something else', async () => {
  await show();
  await fireEvent.press(await screen.findByText('Something else'));
  expect(await screen.findByText('Rolled oats')).toBeTruthy();
  expect(screen.getByPlaceholderText('Search foods...')).toBeTruthy();
});

it('repeats the usual meal of a client with no coach with the saved portions', async () => {
  delete mockUser.coach_id;
  const apple = { meal_type: 'snack', food_item_id: 'apple', quantity_multiplier: 1, original_quantity: 1, original_unit: 'medium',
    food_item: { id: 'apple', name: 'Apple, medium', calories_per_serving: 95, nutrient_basis: 'PER_SERVING' } };
  const usual = [addDays(mockToday, -1), addDays(mockToday, -3)];
  jest.mocked(logApi.getDaily).mockImplementation(async (date: string) => ({ data: { entries: usual.includes(date) ? [apple] : [] } }) as never);
  await show();
  await fireEvent.press(await screen.findByText("Repeat yesterday's snack"));
  await waitFor(() => expect(logApi.logFood).toHaveBeenCalledWith({
    date: mockToday, meal_type: 'snack', food_item_id: 'apple', quantity_multiplier: 1, original_quantity: 1, original_unit: 'medium',
  }));
  expect(await screen.findByText('1 food added to Snacks.')).toBeTruthy();
});
