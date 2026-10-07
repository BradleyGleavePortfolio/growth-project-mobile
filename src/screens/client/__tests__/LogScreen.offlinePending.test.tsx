/**
 * FU-FOODLOG-126: a food saved offline is never invisible on the Food Log.
 *   - The day says how many foods are waiting and that the totals leave them out.
 *   - Saving a food offline updates that count at once.
 *   - Offline, Add Food does not claim "No foods logged in the last 7 days"
 *     when the week simply could not be read.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import type { SearchResult } from '../../../utils/log/types';
import LogScreen from '../LogScreen';
import { enqueue } from '../../../services/foodLogQueue';
import { getTodayString } from '../../../utils/date';

const mockToday = getTodayString();
const mockOats: SearchResult = {
  id: 'food-oats', name: 'Rolled oats', calories: 379, protein: 13, carbs: 68, fat: 6.5,
  serving_size_grams: 40, nutrient_basis: 'PER_100G', supports_volume_units: false,
  last_quantity: 60, last_unit: 'g',
};
const mockStore = {
  selectedDate: mockToday, foodLogs: [],
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 }, waterOz: 0,
  isLoading: false, loadError: null as string | null,
  setSelectedDate: jest.fn(), loadDayData: jest.fn().mockResolvedValue(undefined), logWater: jest.fn(),
  removeFoodLogLocally: jest.fn(),
};
const mockBrowse = {
  recentFoods: [mockOats] as SearchResult[],
  frequentFoods: [mockOats] as SearchResult[],
  lastMeals: {},
  browseUnavailable: false,
  loadBrowseFoods: jest.fn().mockResolvedValue(undefined),
};
let mockPending = 0;
let mockOnline = false;
const mockNotify = jest.fn(async () => 1);
const mockSync = jest.fn(async () => 0);

jest.mock('../../../store/clientStore', () => ({ useClientStore: () => mockStore }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'user' }) }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({}), isEffectivelyOnline: () => mockOnline,
}));
jest.mock('../../../hooks/useFoodBrowse', () => ({ useFoodBrowse: () => mockBrowse }));
jest.mock('../../../hooks/useFoodLogQueueSync', () => ({ usePendingFoodLogCount: () => mockPending }));
jest.mock('../../../services/foodLogSync', () => ({
  notifyPendingFoodLogs: () => mockNotify(),
  syncFoodLogQueue: () => mockSync(),
}));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../services/api', () => ({
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn() },
}));
jest.mock('../../../services/foodLogQueue', () => ({ enqueue: jest.fn(async () => undefined) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  mockPending = 0;
  mockOnline = false;
  mockBrowse.recentFoods = [mockOats];
  mockBrowse.frequentFoods = [mockOats];
  mockBrowse.browseUnavailable = false;
});

describe('Food Log with foods saved offline', () => {
  it('says the waiting food is not in the totals yet and when it syncs', async () => {
    mockPending = 1;
    await render(<LogScreen />);
    expect(screen.getByTestId('log-offline-pending').props.children).toBe(
      '1 food saved offline is not in this log or its totals yet. It syncs when the connection returns.',
    );
  });

  it('offers pull to sync once back online, for several foods', async () => {
    mockPending = 2;
    mockOnline = true;
    await render(<LogScreen />);
    expect(screen.getByTestId('log-offline-pending').props.children).toBe(
      '2 foods saved offline are not in this log or its totals yet. Pull down to sync them now.',
    );
  });

  it('shows no notice when nothing is waiting', async () => {
    await render(<LogScreen />);
    expect(screen.queryByTestId('log-offline-pending')).toBeNull();
  });

  it('updates the waiting count as soon as a food is saved offline', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<LogScreen />);
    await act(async () => {
      fireEvent.press(screen.getAllByText('Add Food')[0]);
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Rolled oats'));
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Log Food'));
    });
    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('Saved offline', 'Rolled oats will sync to your log when you reconnect.');
    alert.mockRestore();
  });

  it('does not claim nothing was logged when the week could not be read offline', async () => {
    mockBrowse.recentFoods = [];
    mockBrowse.frequentFoods = [];
    mockBrowse.browseUnavailable = true;
    await render(<LogScreen />);
    await act(async () => {
      fireEvent.press(screen.getAllByText('Add Food')[0]);
    });
    expect(screen.getByText('Recent foods could not load')).toBeTruthy();
    expect(screen.queryByText('No foods logged in the last 7 days')).toBeNull();
  });
});
