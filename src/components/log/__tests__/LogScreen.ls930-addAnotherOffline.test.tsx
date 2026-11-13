import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../../../screens/client/LogScreen';
import { enqueue } from '../../../services/foodLogQueue';
import { getTodayString } from '../../../utils/date';

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
  useNetworkStatus: () => ({}), isEffectivelyOnline: () => false,
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

it('LS-930 B3: Add another food saves offline and returns to the same open add sheet', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    await render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LogScreen />
      </QueryClientProvider>,
    );
    await fireEvent.press(await screen.findByTestId('food-day-first-breakfast'));
    await fireEvent.press(await screen.findByText('Rolled oats'));
    await fireEvent.press(await screen.findByTestId('quantity-add-another'));
    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(
      'Saved offline', 'Rolled oats will sync to your log when you reconnect.',
    ));
    // This action is explicitly different from Log food: it must not dismiss
    // the sheet after the plate has successfully been queued.
    expect(screen.getByTestId('food-search-meal')).toHaveTextContent('Breakfast');
    expect(screen.getByText('Rolled oats')).toBeTruthy();
    expect(screen.queryByTestId('quantity-add-another')).toBeNull();
  } finally {
    alert.mockRestore();
  }
});
