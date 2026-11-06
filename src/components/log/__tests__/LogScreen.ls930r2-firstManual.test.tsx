import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../../../screens/client/LogScreen';
import { getTodayString } from '../../../utils/date';

let mockOnline = true;
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
    recentFoods: [], frequentFoods: [], lastMeals: {},
    loadBrowseFoods: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('../../../hooks/useFoodLogQueueSync', () => ({ usePendingFoodLogCount: () => 0 }));
jest.mock('../../../services/foodLogSync', () => ({
  notifyPendingFoodLogs: jest.fn().mockResolvedValue(0), syncFoodLogQueue: jest.fn(),
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
  enqueue: jest.fn(), getQueueLength: jest.fn().mockResolvedValue(0),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

it.each([true, false])('LS-930R2 B2: first-day Enter manually opens manual entry directly, online=%s', async (online) => {
  mockOnline = online;
  await render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LogScreen />
    </QueryClientProvider>,
  );
  await fireEvent.press(await screen.findByTestId('food-day-first-manual'));
  expect(await screen.findByPlaceholderText('Food name')).toBeTruthy();
});
