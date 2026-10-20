// UI-3b + UI-3d through the real LogScreen (flag on): a coached client with no plan for the day gets the usual day with no
// join-a-coach card; Extras "Add" opens the search sheet with the meal pills on the meal up next and files the food under the
// pill picked; "Something else" and the classic Add food keep their meal and show no pills.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../../../screens/client/LogScreen';
import { logApi } from '../../../services/api';
import { addDays, getTodayString } from '../../../utils/date';

const mockToday = getTodayString();
const mockStore = {
  selectedDate: mockToday, foodLogs: [], hasLoadedDay: true, dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  waterOz: 0, isLoading: false, loadError: null, setSelectedDate: jest.fn(), loadDayData: jest.fn().mockResolvedValue(undefined),
  logWater: jest.fn(), removeFoodLogLocally: jest.fn(),
};
let mockPlan: unknown = { date: mockToday, assignments: [{ daily_meal_plan: { name: 'Lean week 2', slots: [{ id: 's', slot_label: 'snack', order: 0,
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
let mockOnline = true;
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => mockOnline }));
const mockLastMeals: Record<string, unknown> = {};
jest.mock('../../../hooks/useFoodBrowse', () => ({ useFoodBrowse: () => ({
  recentFoods: [{ id: 'f1', name: 'Rolled oats', calories: 379, protein: 13, carbs: 68, fat: 6.5, serving_size_grams: 40, nutrient_basis: 'PER_100G', supports_volume_units: false }], frequentFoods: [], lastMeals: mockLastMeals,
  loadBrowseFoods: jest.fn().mockResolvedValue(undefined) }) }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async (url: string) => ({ data: url.startsWith('/me/meal-plan') ? mockPlan : { name: 'Jordan Hale' } })) },
  foodApi: { search: jest.fn(() => new Promise(() => {})), create: jest.fn().mockResolvedValue({ data: { id: 'food-new' } }) },
  logApi: { logFood: jest.fn().mockResolvedValue({ data: { id: 'entry-new' } }), updateEntry: jest.fn(), deleteEntry: jest.fn(), getDaily: jest.fn() },
}));
jest.mock('../../../services/foodLogQueue', () => ({ flush: jest.fn(), enqueue: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../../services/foodLogSync', () => ({ ...jest.requireActual('../../../services/foodLogSync'), notifyPendingFoodLogs: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));


const show = () => render(<QueryClientProvider client={new QueryClient()}><LogScreen /></QueryClientProvider>);
const apple = { meal_type: 'snack', food_item_id: 'apple', quantity_multiplier: 1, original_quantity: 1, original_unit: 'medium',
  food_item: { id: 'apple', name: 'Apple, medium', calories_per_serving: 95, nutrient_basis: 'PER_SERVING' } };
const usualSnack = () => {
  const days = [addDays(mockToday, -1), addDays(mockToday, -3)];
  jest.mocked(logApi.getDaily).mockImplementation(async (date: string) => ({ data: { entries: days.includes(date) ? [apple] : [] } }) as never);
};
const pill = (meal: string) => within(screen.getByTestId('food-search-meals')).getByLabelText(meal);
const noPlan = { date: mockToday, assignments: [] };
const lastWrite = () => {
  const calls = (logApi.logFood as jest.Mock).mock.calls;
  return calls[calls.length - 1]?.[0];
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockUser.coach_id = 'coach';
  mockPlan = noPlan;
  delete mockLastMeals.snack;
  jest.mocked(logApi.getDaily).mockResolvedValue({ data: { entries: [] } } as never);
});

it('UI-3b: a coached client with no plan sees the usual day, repeats it, and is never asked to join a coach', async () => {
  usualSnack();
  await show();
  expect(await screen.findByText('Your usual day')).toBeTruthy();
  expect(screen.queryByText('MEAL PLANS COME FROM A COACH')).toBeNull();
  expect(screen.queryByText('Join a coach')).toBeNull();
  await fireEvent.press(screen.getByText("Repeat yesterday's snack"));
  await waitFor(() => expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({ meal_type: 'snack', food_item_id: 'apple', fills_usual_meal: true })));
  expect(await screen.findByText('1 food added to Snacks.')).toBeTruthy();
});

it('UI-3b: a coached client with no plan and no usual meal keeps the classic Food log', async () => {
  await show();
  expect(await screen.findByLabelText('Add food to breakfast')).toBeTruthy();
  await waitFor(() => expect(logApi.getDaily).toHaveBeenCalledTimes(7));
  expect(screen.queryByTestId('food-day')).toBeNull();
  // The classic section Add keeps its own meal: no pills.
  await fireEvent.press(screen.getByLabelText('Add food to dinner'));
  expect(await screen.findByText('Add to Dinner')).toBeTruthy();
  expect(screen.queryByTestId('food-search-meals')).toBeNull();
});

it('UI-3d: Extras Add opens on the meal up next with the four meal pills, and files the food under the pill picked', async () => {
  usualSnack();
  await show();
  await fireEvent.press(await screen.findByTestId('food-day-add'));
  expect(await screen.findByText('Add to Snacks')).toBeTruthy();
  expect(pill('Snacks').props.accessibilityState.selected).toBe(true);
  expect(['Breakfast', 'Lunch', 'Dinner', 'Snacks'].map((m) => !!pill(m))).toEqual([true, true, true, true]);
  await fireEvent.press(pill('Lunch'));
  expect(screen.getByText('Add to Lunch')).toBeTruthy();
  expect(pill('Lunch').props.accessibilityState.selected).toBe(true);
  expect(pill('Snacks').props.accessibilityState.selected).toBe(false);
  await fireEvent.press(await screen.findByText('Rolled oats'));
  await fireEvent.press(await screen.findByTestId('quantity-log-food'));
  await waitFor(() => expect(logApi.logFood).toHaveBeenCalledTimes(1));
  expect(lastWrite()).toEqual(expect.objectContaining({ meal_type: 'lunch', food_item_id: 'f1' }));
  expect(lastWrite()).not.toHaveProperty('plan_slot_id');
  expect(lastWrite()).not.toHaveProperty('fills_usual_meal');
  expect(await screen.findByText('Rolled oats added to Lunch.')).toBeTruthy();
});

it('UI-3d: the pills also work on a coached plan day, and a manual entry follows the pill picked', async () => {
  mockPlan = { date: mockToday, assignments: [{ daily_meal_plan: { id: 'p', name: 'Lean week 2', slots: [{ id: 's', slot_label: 'snack', order: 0,
    meal_template: { name: 'Greek yogurt bowl', calories_kcal: 210, protein_g: 30, carbs_g: 20, fats_g: 5, items: [] } }] } }] };
  await show();
  await fireEvent.press(await screen.findByTestId('food-day-add'));
  expect(await screen.findByText('Add to Snacks')).toBeTruthy();
  await fireEvent.press(pill('Dinner'));
  await fireEvent.press(await screen.findByText('Enter manually'));
  expect(pill('Dinner').props.accessibilityState.selected).toBe(true);
  await fireEvent.changeText(screen.getByPlaceholderText('Food name'), 'Toast');
  for (const input of screen.getAllByPlaceholderText('0')) await fireEvent.changeText(input, '5');
  await fireEvent.press(screen.getByTestId('manual-log-food'));
  await waitFor(() => expect(lastWrite()).toEqual(expect.objectContaining({ meal_type: 'dinner', food_item_id: 'food-new' })));
  expect(lastWrite()).not.toHaveProperty('plan_slot_id');
});

it('UI-3d: Something else keeps the plan meal and shows no pills, and the next Extras Add shows them again', async () => {
  mockPlan = { date: mockToday, assignments: [{ daily_meal_plan: { id: 'p', name: 'Lean week 2', slots: [{ id: 's', slot_label: 'snack', order: 0,
    meal_template: { name: 'Greek yogurt bowl', calories_kcal: 210, protein_g: 30, carbs_g: 20, fats_g: 5, items: [] } }] } }] };
  await show();
  await fireEvent.press(await screen.findByText('Something else'));
  expect(await screen.findByText('Add to Snacks')).toBeTruthy();
  expect(screen.queryByTestId('food-search-meals')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Close food search'));
  await fireEvent.press(await screen.findByTestId('food-day-add'));
  expect(await screen.findByTestId('food-search-meals')).toBeTruthy();
  expect(pill('Snacks').props.accessibilityState.selected).toBe(true);
});

it('UI-3d: a sheet reopened from Extras starts again on the meal up next, not the last pill picked', async () => {
  usualSnack();
  await show();
  await fireEvent.press(await screen.findByTestId('food-day-add'));
  await fireEvent.press(pill('Breakfast'));
  expect(screen.getByText('Add to Breakfast')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Close food search'));
  await fireEvent.press(await screen.findByTestId('food-day-add'));
  expect(await screen.findByText('Add to Snacks')).toBeTruthy();
});
