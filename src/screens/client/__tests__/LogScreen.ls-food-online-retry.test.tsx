import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../LogScreen';
import { logApi } from '../../../services/api';
import { getTodayString } from '../../../utils/date';

const mockDay = getTodayString();
const mockStore = {
  selectedDate: mockDay, foodLogs: [], hasLoadedDay: true,
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  waterOz: 0, isLoading: false, loadError: null,
  setSelectedDate: jest.fn(), loadDayData: jest.fn().mockResolvedValue(undefined),
  logWater: jest.fn(), removeFoodLogLocally: jest.fn(),
};
const mockPlan = { date: mockDay, assignments: [{ daily_meal_plan: {
  name: 'Daily plan', slots: [{ id: 'slot', slot_label: 'breakfast', order: 0,
    meal_template: { name: 'Breakfast bowl', calories_kcal: 400, protein_g: 25, carbs_g: 45, fats_g: 13, items: [] } }],
} }] };
const mockFood = {
  id: 'banana', name: 'Banana', calories: 89, protein: 1.1, carbs: 23, fat: 0.3,
  serving_size_grams: 118, nutrient_basis: 'PER_100G', supports_volume_units: false,
};
const mockRows: Array<Record<string, unknown>> = [];
let mockLoseAck = true;

jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  return { ...real, featureFlags: { ...real.featureFlags, foodPlanChecklist: true } };
});
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../store/clientStore', () => ({ useClientStore: () => mockStore }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'viewer', coach_id: 'coach' }) }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => true }));
jest.mock('../../../hooks/useFoodLogQueueSync', () => ({ usePendingFoodLogCount: () => 0 }));
jest.mock('../../../hooks/useFoodBrowse', () => ({ useFoodBrowse: () => ({
  recentFoods: [mockFood], frequentFoods: [], lastMeals: {}, loadBrowseFoods: jest.fn(),
}) }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async (url: string) => ({ data: url.startsWith('/me/meal-plan') ? mockPlan : { name: 'Coach' } })) },
  foodApi: { search: jest.fn(), create: jest.fn(async () => ({ data: { id: 'custom' } })) },
  logApi: {
    logFood: jest.fn(async (body: Record<string, unknown>) => {
      // Retain the server's existing client_uuid uniqueness rule; do not make retries fail artificially.
      const prior = typeof body.client_uuid === 'string'
        ? mockRows.find((row) => row.client_uuid === body.client_uuid)
        : undefined;
      if (!prior) mockRows.push({ ...body, id: `entry-${mockRows.length + 1}` });
      if (mockLoseAck) { mockLoseAck = false; throw new Error('Connection lost after server commit'); }
      return { data: { id: String((prior || mockRows[mockRows.length - 1]).id) } };
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
  mockRows.length = 0;
  mockLoseAck = true;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('LS-FOOD B3: online retry after an acknowledgement is lost', () => {
  it.each(['recent', 'manual', 'plan'] as const)('%s retry from the real screen saves the intended meal once', async (path) => {
    await render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LogScreen />
    </QueryClientProvider>);
    if (path !== 'plan') {
      await fireEvent.press(await screen.findByText('Something else'));
      if (path === 'recent') {
        await fireEvent.press(await screen.findByText('Banana'));
      } else {
        await fireEvent.press(await screen.findByText('Enter manually'));
        await fireEvent.changeText(screen.getByPlaceholderText('Food name'), 'Breakfast bowl');
        for (const [index, value] of ['400', '25', '45', '13'].entries()) {
          await fireEvent.changeText(screen.getAllByPlaceholderText('0')[index], value);
        }
      }
    }
    const pressLog = async () => {
      await fireEvent.press(path === 'plan'
        ? screen.getByText('Ate it as planned')
        : screen.getByTestId(path === 'manual' ? 'manual-log-food' : 'quantity-log-food'));
    };
    await pressLog();
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(mockRows).toHaveLength(1); // The server did save before the response was lost.
    await pressLog(); // The screen's own error leaves this action available for retry.
    await waitFor(() => expect(logApi.logFood).toHaveBeenCalledTimes(2));
    expect(mockRows).toHaveLength(1);
  });
});
