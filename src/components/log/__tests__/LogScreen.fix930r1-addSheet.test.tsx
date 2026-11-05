// FIX-930R1 (LS-930 B3, class-first): on the Style C day the add sheet's close-or-keep choice is the same after an
// online and an offline save. "Log food" closes the add sheet; "Add another food" keeps it open on the same meal.
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../../../screens/client/LogScreen';
import { enqueue } from '../../../services/foodLogQueue';
import { logApi } from '../../../services/api';
import { getTodayString } from '../../../utils/date';

let mockOnline = false;
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, foodPlanChecklist: true } };
});
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
const mockStore = {
  selectedDate: getTodayString(), foodLogs: [], hasLoadedDay: true,
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 }, waterOz: 0,
  isLoading: false, loadError: null, setSelectedDate: jest.fn(),
  loadDayData: jest.fn().mockResolvedValue(undefined),
  refreshShownDay: jest.fn().mockResolvedValue(undefined),
  logWater: jest.fn(), removeFoodLogLocally: jest.fn(),
};
jest.mock('../../../store/clientStore', () => ({ useClientStore: () => mockStore }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'user' }) }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({}), isEffectivelyOnline: () => mockOnline,
}));
jest.mock('../../../hooks/useFoodBrowse', () => ({
  useFoodBrowse: () => ({
    recentFoods: [{
      id: 'oats', name: 'Rolled oats', calories: 379, protein: 13, carbs: 68, fat: 6.5,
      serving_size_grams: 40, nutrient_basis: 'PER_100G', supports_volume_units: false,
    }],
    frequentFoods: [], lastMeals: {}, loadBrowseFoods: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('../../../hooks/useFoodLogQueueSync', () => ({ usePendingFoodLogCount: () => 0 }));
jest.mock('../../../services/foodLogSync', () => ({
  notifyPendingFoodLogs: jest.fn().mockResolvedValue(1), syncFoodLogQueue: jest.fn(),
}));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: async (url: string) => ({
      data: url.startsWith('/assignments/me') ? { items: [], nextCursor: null } : { assignments: [] },
    }),
  },
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: {
    logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn(),
    getDaily: jest.fn().mockResolvedValue({ data: { entries: [] } }),
  },
}));
jest.mock('../../../services/foodLogQueue', () => ({
  enqueue: jest.fn().mockResolvedValue(undefined), getQueueLength: jest.fn().mockResolvedValue(0),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

beforeEach(() => jest.clearAllMocks());

it.each([
  ['offline', 'quantity-add-another', true, false],
  ['offline', 'quantity-log-food', false, false],
  ['online', 'quantity-add-another', true, true],
  ['online', 'quantity-log-food', false, true],
] as const)('FIX-930R1: saved %s with %s, add sheet still open: %s', async (_label, button, open, online) => {
  mockOnline = online;
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    await render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LogScreen />
      </QueryClientProvider>,
    );
    await fireEvent.press(await screen.findByTestId('food-day-first-breakfast'));
    await fireEvent.press(await screen.findByText('Rolled oats'));
    await fireEvent.press(await screen.findByTestId(button));
    // One write per tap, on the path the connection picks.
    if (online) await waitFor(() => expect(logApi.logFood).toHaveBeenCalledTimes(1));
    else await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    expect(online ? enqueue : logApi.logFood).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId(button)).toBeNull());
    if (open) expect(screen.getByText('Add to Breakfast')).toBeTruthy();
    else expect(screen.queryByText('Add to Breakfast')).toBeNull();
  } finally {
    alert.mockRestore();
  }
});
