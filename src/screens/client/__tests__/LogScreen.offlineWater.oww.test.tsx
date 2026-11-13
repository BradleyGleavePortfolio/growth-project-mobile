/**
 * OFFLINE-WATER-WEIGHT-M (191-S5) on the Food log's water card:
 *   - +8 oz with no signal goes to the store as a glass saved offline (the call site's network state, food's rule);
 *   - a waiting glass shows the line a food saved offline shows, a refused one "Couldn't log water", and Remove
 *     takes either off the phone (the store's removeWaterEntry makes no server call for it);
 *   - a server glass removed with no signal keeps main's "Couldn't remove water";
 *   - a glass is never counted in the food notes; a glass the water total does not count gets the C2-S-17 note.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import type { FoodLog } from '../../../types';
import type { ShownWaterEntry } from '../../../utils/log/queuedDay';
import LogScreen from '../LogScreen';
import { getTodayString, addDays } from '../../../utils/date';

jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, offlineFoodInDay: true, foodPlanChecklist: false } };
});

const mockToday = getTodayString();
const mockStore = {
  selectedDate: mockToday, foodLogs: [] as FoodLog[], hasLoadedDay: true,
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 }, waterOz: 0,
  waterEntries: [] as ShownWaterEntry[],
  queuedWaterWeight: [] as { id: string; kind: string; parkedAt?: number }[],
  removeWaterEntry: jest.fn(async () => undefined),
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

const { logApi } = jest.requireMock('../../../services/api') as { logApi: { deleteEntry: jest.Mock } };

beforeEach(() => {
  jest.clearAllMocks();
  mockPending = 0;
  mockOnline = false;
  mockStore.foodLogs = [];
  mockStore.queuedFoods = [];
  mockStore.waterEntries = [];
  mockStore.queuedWaterWeight = [];
  mockStore.waterOz = 16;
  mockStore.dailyTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  mockBrowse.recentFoods = [];
  mockBrowse.frequentFoods = [];
  mockBrowse.lastMeals = {};
});

const waiting: ShownWaterEntry = { id: 'pfl_w1', amount_ml: 237, logged_at: '', offline: 'waiting' };
const refused: ShownWaterEntry = { id: 'pfl_w2', amount_ml: 355, logged_at: '', offline: 'refused' };
const onServer: ShownWaterEntry = { id: 'w-0', amount_ml: 473, logged_at: '' };

describe('Food log water card: glasses saved offline', () => {
  it('W1: +8 oz with no signal is a glass saved offline (logWater gets the network state)', async () => {
    await render(<LogScreen />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Add 8 ounces of water'));
    });
    expect(mockStore.logWater).toHaveBeenCalledWith('user', '', 8, false);
  });

  it('W1: with a signal it is the online send, as main', async () => {
    mockOnline = true;
    await render(<LogScreen />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Add 8 ounces of water'));
    });
    expect(mockStore.logWater).toHaveBeenCalledWith('user', '', 8);
  });

  it("W4, W10: a waiting glass carries food's waiting line, a refused one \"Couldn't log water\"; each is spoken; Remove takes it off the phone", async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockStore.waterEntries = [onServer, waiting, refused];
    mockStore.queuedWaterWeight = [{ id: 'pfl_w1', kind: 'water' }, { id: 'pfl_w2', kind: 'water', parkedAt: 1 }];
    await render(<LogScreen />);
    expect(screen.getByTestId('water-offline-pfl_w1').props.children).toBe('Saved offline. 8 oz of water will sync when you reconnect.');
    expect(screen.getByTestId('water-offline-pfl_w2').props.children).toBe("Couldn't log water");
    expect(screen.queryByTestId('water-offline-w-0')).toBeNull();
    expect(screen.getByLabelText('Remove water entry 2, ≈ 8 oz. Saved offline')).toBeTruthy();
    expect(screen.getByLabelText("Remove water entry 3, ≈ 12 oz. Couldn't log water")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('remove-water-pfl_w1'));
    });
    expect(alert.mock.calls[0][1]).toBe('This entry will be removed from this phone.');
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => Promise<void> }[];
    await act(async () => {
      await buttons.find((b) => b.text === 'Remove')?.onPress?.();
    });
    expect(mockStore.removeWaterEntry).toHaveBeenCalledWith('pfl_w1');
    // No food is in the notes: a glass is never counted as a food (M2).
    expect(screen.queryByTestId('log-offline-pending')).toBeNull();
    expect(screen.queryByTestId('log-offline-pending-in-day')).toBeNull();
    expect(screen.queryByTestId('log-offline-pending-water')).toBeNull();
    alert.mockRestore();
  });

  it("W10: a server glass removed with no signal keeps main's \"Couldn't remove water\"", async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockStore.waterEntries = [onServer];
    mockStore.removeWaterEntry.mockRejectedValueOnce(new Error('Network Error'));
    await render(<LogScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('remove-water-w-0'));
    });
    expect(alert.mock.calls[0][1]).toBe("This entry will be removed from this day's water total.");
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => Promise<void> }[];
    await act(async () => {
      await buttons.find((b) => b.text === 'Remove')?.onPress?.();
    });
    expect(alert.mock.calls[1][0]).toBe("Couldn't remove water");
    expect(logApi.deleteEntry).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('M6: a glass the water total does not count (switch off, or another day) gets the C2-S-17 note', async () => {
    mockStore.waterEntries = [onServer];
    mockStore.queuedWaterWeight = [{ id: 'pfl_w1', kind: 'water' }, { id: 'pfl_g1', kind: 'weight' }];
    await render(<LogScreen />);
    expect(screen.getByTestId('log-offline-pending-water').props.children).toBe(
      '1 water entry saved offline is not in this log or its totals yet. It syncs when the connection returns.',
    );
    expect(screen.queryByTestId('log-offline-pending')).toBeNull();
  });

  it('M6: two of them, with a signal back', async () => {
    mockOnline = true;
    mockStore.waterEntries = [onServer];
    mockStore.queuedWaterWeight = [{ id: 'pfl_w1', kind: 'water' }, { id: 'pfl_w3', kind: 'water' }];
    await render(<LogScreen />);
    expect(screen.getByTestId('log-offline-pending-water').props.children).toBe(
      '2 water entries saved offline are not in this log or its totals yet. Pull down to sync them now.',
    );
  });
});
