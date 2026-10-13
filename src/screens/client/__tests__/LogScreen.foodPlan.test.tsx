// UI-3 with the flag on: a coached client's plan checklist logs the plan meal in one tap, and
// "Something else" opens the food search with recent foods (until a coach swap list exists).
// FOODLINK: every write made for a plan meal carries its plan_slot_id, online and queued; no other write does.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../LogScreen';
import { foodApi, logApi } from '../../../services/api';
import { enqueue } from '../../../services/foodLogQueue';
import { getTodayString } from '../../../utils/date';

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
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'user', coach_id: 'coach' }) }));
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
  logApi: { logFood: jest.fn().mockResolvedValue({ data: { id: 'entry-new' } }), updateEntry: jest.fn(), deleteEntry: jest.fn() },
}));
jest.mock('../../../services/foodLogQueue', () => ({ flush: jest.fn(), enqueue: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../../services/foodLogSync', () => ({ ...jest.requireActual('../../../services/foodLogSync'), notifyPendingFoodLogs: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

const show = () => render(<QueryClientProvider client={new QueryClient()}><LogScreen /></QueryClientProvider>);
const linked = expect.objectContaining({ meal_type: 'snack', plan_slot_id: 's' });
const lastWrite = () => {
  const calls = (logApi.logFood as jest.Mock).mock.calls;
  return calls[calls.length - 1]?.[0];
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  delete mockLastMeals.snack;
});

it('logs the plan meal in one tap', async () => {
  await show();
  await fireEvent.press(await screen.findByText('Ate it as planned'));
  await waitFor(() => expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({ meal_type: 'snack', food_item_id: 'food-new', plan_slot_id: 's' })));
  expect(foodApi.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Greek yogurt bowl' }));
  expect(await screen.findByText('Greek yogurt bowl added to Snacks.')).toBeTruthy();
});

it('opens the food search with recent foods from Something else', async () => {
  await show();
  await fireEvent.press(await screen.findByText('Something else'));
  expect(await screen.findByText('Rolled oats')).toBeTruthy();
  expect(screen.getByPlaceholderText('Search foods...')).toBeTruthy();
});

it('queues the plan meal offline with its plan_slot_id, so it survives a relaunch before sync', async () => {
  mockOnline = false;
  await show();
  await fireEvent.press(await screen.findByText('Ate it as planned'));
  await waitFor(() => expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'manual', log: linked })));
  expect(logApi.logFood).not.toHaveBeenCalled();
});

it('links a recent food, a manual entry and a Repeat logged from Something else', async () => {
  mockLastMeals.snack = { date: '2026-10-01', calories: 120, entries: [{ foodItemId: 'f9', name: 'Apple', calories: 120, quantityMultiplier: 1 }] };
  await show();
  await fireEvent.press(await screen.findByText('Something else'));
  await fireEvent.press(await screen.findByText('Rolled oats'));
  await fireEvent.press(await screen.findByTestId('quantity-log-food'));
  await waitFor(() => expect(lastWrite()).toEqual(expect.objectContaining({ food_item_id: 'f1', plan_slot_id: 's' })));

  await fireEvent.press(await screen.findByText('Something else'));
  await fireEvent.press(await screen.findByLabelText(/add all 1 food/));
  await waitFor(() => expect(lastWrite()).toEqual(expect.objectContaining({ food_item_id: 'f9', plan_slot_id: 's' })));

  await fireEvent.press(await screen.findByText('Something else'));
  await fireEvent.press(await screen.findByText('Enter manually'));
  await fireEvent.changeText(screen.getByPlaceholderText('Food name'), 'Toast');
  for (const input of screen.getAllByPlaceholderText('0')) await fireEvent.changeText(input, '5');
  await fireEvent.press(screen.getByTestId('manual-log-food'));
  await waitFor(() => expect(lastWrite()).toEqual(expect.objectContaining({ food_item_id: 'food-new', plan_slot_id: 's' })));
});

it('never links Extras "Add", or a sheet opened after a cancelled Something else', async () => {
  await show();
  await fireEvent.press(await screen.findByText('Something else'));
  await fireEvent.press(await screen.findByLabelText('Close food search'));
  await fireEvent.press(await screen.findByTestId('food-day-add'));
  await fireEvent.press(await screen.findByText('Rolled oats'));
  await fireEvent.press(await screen.findByTestId('quantity-log-food'));
  await waitFor(() => expect(logApi.logFood).toHaveBeenCalledTimes(1));
  expect(lastWrite()).not.toHaveProperty('plan_slot_id');
  expect(lastWrite()).not.toHaveProperty('fills_usual_meal');
});
