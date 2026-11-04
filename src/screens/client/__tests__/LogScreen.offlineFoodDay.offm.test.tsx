/**
 * OFFLINE-FOOD-M (owner #191-E3) on the Food Log:
 *   - a food saved offline is in the day, marked "Saved offline", and the note says it is counted (W1,
 *     behind featureFlags.offlineFoodInDay);
 *   - a food the server refused stays in the day, marked "Couldn't log food", out of the meal's total,
 *     and Remove takes it off the phone;
 *   - Repeat with no signal queues each food;
 *   - search with no signal says so at once and does not search.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import type { FoodLog } from '../../../types';
import LogScreen from '../LogScreen';
import { enqueue } from '../../../services/foodLogQueue';
import { foodApi } from '../../../services/api';
import { getTodayString, addDays } from '../../../utils/date';

jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, offlineFoodInDay: true, foodPlanChecklist: false } };
});

const mockToday = getTodayString();
const row = (over: Partial<FoodLog>): FoodLog => ({
  id: 'srv-1', userId: 'user', coachId: '', date: mockToday, mealType: 'breakfast', foodName: 'Egg',
  calories: 70, protein: 6, carbs: 0, fat: 5, quantity: 1, unit: 'serving', createdAt: '', ...over,
} as FoodLog);
const mockStore = {
  selectedDate: mockToday, foodLogs: [] as FoodLog[], hasLoadedDay: true,
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 }, waterOz: 0,
  isLoading: false, loadError: null as string | null,
  queuedFoods: [] as { id: string; parkedAt?: number }[],
  setSelectedDate: jest.fn(), loadDayData: jest.fn().mockResolvedValue(undefined),
  refreshShownDay: jest.fn().mockResolvedValue(undefined),
  logWater: jest.fn(),
  removeFoodLogLocally: jest.fn(),
};
const mockBrowse = {
  recentFoods: [] as unknown[],
  frequentFoods: [] as unknown[],
  lastMeals: {} as Record<string, unknown>,
  browseUnavailable: true,
  loadBrowseFoods: jest.fn().mockResolvedValue(undefined),
};
let mockPending = 0;
let mockOnline = false;
const mockNotify = jest.fn(async () => 1);

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
  syncFoodLogQueue: jest.fn(async () => 0),
}));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../services/api', () => ({
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn() },
}));
jest.mock('../../../services/foodLogQueue', () => ({
  enqueue: jest.fn(async () => undefined),
  dropQueued: jest.fn(async () => undefined),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

const { dropQueued } = jest.requireMock('../../../services/foodLogQueue') as { dropQueued: jest.Mock };
const { logApi } = jest.requireMock('../../../services/api') as { logApi: { deleteEntry: jest.Mock } };

beforeEach(() => {
  jest.clearAllMocks();
  mockPending = 0;
  mockOnline = false;
  mockStore.foodLogs = [];
  mockStore.queuedFoods = [];
  mockStore.dailyTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  mockBrowse.recentFoods = [];
  mockBrowse.frequentFoods = [];
  mockBrowse.lastMeals = {};
});

describe('Food Log: foods saved offline count in the day', () => {
  it('a waiting food is in the day, marked, and the note says it is counted (W1)', async () => {
    mockPending = 1;
    mockStore.queuedFoods = [{ id: 'pfl_1' }];
    mockStore.foodLogs = [row({}), row({ id: 'pfl_1', clientUuid: 'pfl_1', offline: 'waiting', foodName: 'Rolled oats', calories: 150 })];
    mockStore.dailyTotals = { calories: 220, protein: 11, carbs: 27, fat: 8 };
    await render(<LogScreen />);
    expect(screen.getByText('Rolled oats')).toBeTruthy();
    expect(screen.getByTestId('food-offline-pfl_1').props.children).toBe('Saved offline. Rolled oats will sync when you reconnect.');
    expect(screen.queryByTestId('log-offline-pending')).toBeNull();
    expect(screen.getByTestId('log-offline-pending-in-day').props.children).toBe(
      '1 food saved offline is in this log and its totals. It syncs when the connection returns.',
    );
  });

  it('a waiting food on another day keeps today\'s words (C2-S-17) for that food', async () => {
    mockPending = 2;
    mockStore.queuedFoods = [{ id: 'pfl_1' }, { id: 'pfl_2' }];
    mockStore.foodLogs = [row({ id: 'pfl_1', clientUuid: 'pfl_1', offline: 'waiting', foodName: 'Rolled oats', calories: 150 })];
    await render(<LogScreen />);
    expect(screen.getByTestId('log-offline-pending').props.children).toBe(
      '1 food saved offline is not in this log or its totals yet. It syncs when the connection returns.',
    );
  });

  it('a refused food stays in the day, marked, out of the meal total, and Remove drops it from the phone', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockStore.queuedFoods = [{ id: 'pfl_9', parkedAt: 1 }];
    mockStore.foodLogs = [row({}), row({ id: 'pfl_9', clientUuid: 'pfl_9', offline: 'refused', foodName: 'Rolled oats', calories: 150 })];
    mockStore.dailyTotals = { calories: 70, protein: 6, carbs: 0, fat: 5 };
    await render(<LogScreen />);
    expect(screen.getByTestId('food-offline-pfl_9').props.children).toBe("Couldn't log food");
    expect(screen.getAllByText('70 kcal').length).toBeGreaterThan(0);
    expect(screen.queryByText('220 kcal')).toBeNull();
    await act(async () => {
      fireEvent(screen.getByLabelText("Rolled oats, one serving. Couldn't log food. Long-press to delete."), 'longPress');
    });
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => Promise<void> }[];
    await act(async () => {
      await buttons.find((b) => b.text === 'Delete')?.onPress?.();
    });
    expect(mockStore.removeFoodLogLocally).toHaveBeenCalledWith('pfl_9');
    expect(dropQueued).toHaveBeenCalledWith('pfl_9');
    expect(logApi.deleteEntry).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('Repeat with no signal queues each food of the meal', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockBrowse.lastMeals = {
      breakfast: {
        date: addDays(mockToday, -1),
        calories: 250,
        entries: [
          { foodItemId: 'food-oats', name: 'Rolled oats', calories: 150, quantityMultiplier: 1 },
          { foodItemId: 'food-milk', name: 'Milk', calories: 100, quantityMultiplier: 1 },
        ],
      },
    };
    await render(<LogScreen />);
    await act(async () => {
      fireEvent.press(screen.getAllByText('Add food')[0]);
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Repeat yesterday's breakfast: add all 2 foods"));
    });
    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2));
    const keys = (enqueue as jest.Mock).mock.calls.map((c) => c[1]);
    expect(new Set(keys).size).toBe(2);
    expect(alert).toHaveBeenCalledWith('Saved offline', '2 foods will sync when you reconnect.');
    expect(alert).not.toHaveBeenCalledWith('Connection needed', expect.anything());
    alert.mockRestore();
  });

  it('search with no signal says so at once and does not search', async () => {
    await render(<LogScreen />);
    await act(async () => {
      fireEvent.press(screen.getAllByText('Add food')[0]);
    });
    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText(/Search/i), 'oats');
    });
    expect(screen.getByText('Search unavailable. Check your connection.')).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(foodApi.search).not.toHaveBeenCalled();
  });
});
