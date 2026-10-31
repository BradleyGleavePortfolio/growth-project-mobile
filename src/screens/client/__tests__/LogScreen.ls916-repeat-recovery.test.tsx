import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { logApi } from '../../../services/api';
import { getTodayString } from '../../../utils/date';
import { forgetSaveKeys } from '../../../utils/log/saveKey';
import LogScreen from '../LogScreen';

const mockDay = getTodayString();
const mockFood = {
  id: 'milk', name: 'Milk', calories: 50, protein: 3.5, carbs: 5, fat: 2,
  nutrient_basis: 'PER_100G', serving_size_grams: 100,
  last_quantity: 1, last_unit: 'serving', supports_volume_units: false,
};
const mockMeal = {
  date: '2026-10-29', mealType: 'breakfast', calories: 200,
  entries: [
    { foodItemId: 'oats', name: 'Oats', quantityMultiplier: 1, originalQuantity: 1, originalUnit: 'serving' },
    { foodItemId: 'milk', name: 'Milk', quantityMultiplier: 1, originalQuantity: 1, originalUnit: 'serving' },
  ],
};
const mockStore = {
  selectedDate: mockDay, selectedOn: mockDay, foodLogs: [], hasLoadedDay: true,
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  waterOz: 0, isLoading: false, loadError: null,
  setSelectedDate: jest.fn(), loadDayData: jest.fn().mockResolvedValue(undefined),
  refreshShownDay: jest.fn().mockResolvedValue(undefined),
  logWater: jest.fn(), removeFoodLogLocally: jest.fn(),
};
const mockRows: Array<Record<string, unknown>> = [];
let mockLoseMilkReply = true;

jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  return { ...real, featureFlags: { ...real.featureFlags, foodPlanChecklist: false } };
});
jest.mock('../../../store/clientStore', () => ({ useClientStore: () => mockStore }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'viewer' }) }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => true }));
jest.mock('../../../hooks/useFoodLogQueueSync', () => ({ usePendingFoodLogCount: () => 0 }));
jest.mock('../../../hooks/useFoodBrowse', () => ({ useFoodBrowse: () => ({
  recentFoods: [mockFood], frequentFoods: [mockFood], lastMeals: { breakfast: mockMeal }, loadBrowseFoods: jest.fn(),
}) }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async () => ({ data: {} })) },
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: {
    logFood: jest.fn(async (body: Record<string, unknown>) => {
      const prior = mockRows.find((row) => row.client_uuid === body.client_uuid);
      if (!prior) mockRows.push({ ...body, id: `entry-${mockRows.length + 1}` });
      if (body.food_item_id === 'milk' && mockLoseMilkReply) {
        mockLoseMilkReply = false;
        throw new Error('Connection lost after server commit');
      }
      return { data: prior ?? mockRows[mockRows.length - 1] };
    }),
    updateEntry: jest.fn(), deleteEntry: jest.fn(), getDaily: jest.fn(),
  },
}));
jest.mock('../../../services/foodLogQueue', () => ({ flush: jest.fn() }));
jest.mock('../../../services/foodLogSync', () => ({ notifyPendingFoodLogs: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  forgetSaveKeys();
  mockRows.length = 0;
  mockLoseMilkReply = true;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('LS-916 B2: the real repeat error path sends its existing key when the member follows Add from Recent', async () => {
  await render(<LogScreen />);
  await fireEvent.press(screen.getAllByText('Add food')[0]);
  await fireEvent.press(await screen.findByText('Add all'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(
    'Some foods were not added',
    expect.stringContaining('then add it from Recent.'),
  ));
  expect(mockRows).toHaveLength(2);
  await fireEvent.press(await screen.findByText('Milk'));
  await fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
  await waitFor(() => expect(logApi.logFood).toHaveBeenCalledTimes(3));
  expect(mockRows).toHaveLength(2);
});
