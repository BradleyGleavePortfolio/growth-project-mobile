/**
 * ALL-ON-GREEN-M (R1, R3): the switch-on proof of LogScreen.offlinePending.test.tsx (FU-FOODLOG-126). That file pins
 * featureFlags.foodPlanChecklist off and proves the classic Food log; this file pins it on: on the Style C day a
 * food saved offline is never invisible.
 *   - The day says how many foods are waiting and that the totals leave them out (the notes LogScreen hands the
 *     Style C day, drawn on its page).
 *   - Saving a food offline from the Style C day's add sheet updates that count at once.
 *   - Offline, the add sheet does not claim "No foods logged in the last 7 days" when the week could not be read.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SearchResult } from '../../../utils/log/types';
import LogScreen from '../LogScreen';
import { enqueue } from '../../../services/foodLogQueue';
import { getTodayString } from '../../../utils/date';

// A fixed clock, never the real date (FIX-930R2 LO-930R2 B1 class). Only Date is faked (and keeps ticking).
jest.useFakeTimers({ now: new Date('2026-11-05T12:00:00'), advanceTimers: true, doNotFake: ['nextTick', 'setImmediate',
  'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime',
  'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());
const mockToday = getTodayString();
const mockOats: SearchResult = {
  id: 'food-oats', name: 'Rolled oats', calories: 379, protein: 13, carbs: 68, fat: 6.5,
  serving_size_grams: 40, nutrient_basis: 'PER_100G', supports_volume_units: false,
  last_quantity: 60, last_unit: 'g',
};
const mockStore = {
  selectedDate: mockToday, foodLogs: [], hasLoadedDay: true,
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 }, waterOz: 0,
  isLoading: false, loadError: null as string | null,
  setSelectedDate: jest.fn(), loadDayData: jest.fn().mockResolvedValue(undefined),
  // Like the store: reads the day again only while it is the day on screen.
  refreshShownDay: jest.fn((u: string, d: string): Promise<void> => (d === mockStore.selectedDate ? mockStore.loadDayData(u, d) : Promise.resolve())),
  logWater: jest.fn(),
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

jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  return { ...real, featureFlags: { ...real.featureFlags, foodPlanChecklist: true } };
});
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }), useFocusEffect: jest.fn() }));
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
  __esModule: true,
  // The Style C day's own reads: the day's workout from Train (none) and the week before (nothing).
  default: { get: jest.fn(async () => ({ data: { items: [], nextCursor: null } })) },
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn(), getDaily: jest.fn(async () => ({ data: { entries: [] } })) },
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

const show = (onSaved?: () => void) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <LogScreen onSaved={onSaved} />
  </QueryClientProvider>,
);
/** The Style C day's page, once its first reads settle; the notes sit on it. */
const page = async () => screen.findByTestId('food-day-page');

describe('Food Log with foods saved offline, on the Style C day', () => {
  it('says the waiting food is not in the totals yet and when it syncs', async () => {
    mockPending = 1;
    await show();
    expect(within(await page()).getByTestId('log-offline-pending').props.children).toBe(
      '1 food saved offline is not in this log or its totals yet. It syncs when the connection returns.',
    );
  });

  it('offers pull to sync once back online, for several foods', async () => {
    mockPending = 2;
    mockOnline = true;
    await show();
    expect(within(await page()).getByTestId('log-offline-pending').props.children).toBe(
      '2 foods saved offline are not in this log or its totals yet. Pull down to sync them now.',
    );
  });

  it('shows no notice when nothing is waiting', async () => {
    await show();
    await page();
    expect(screen.queryByTestId('log-offline-pending')).toBeNull();
  });

  it('updates the waiting count as soon as a food is saved offline', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onSaved = jest.fn();
    await show(onSaved);
    await act(async () => {
      fireEvent.press(await screen.findByTestId('food-day-first-breakfast'));
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Rolled oats'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('quantity-log-food'));
    });
    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    // What waits is the food at its last portion, for the day shown and the meal tapped.
    const [queued] = jest.mocked(enqueue).mock.calls[0];
    expect(queued).toMatchObject({ kind: 'search', foodItemId: 'food-oats', log: {
      date: mockToday, meal_type: 'breakfast', original_quantity: 60, original_unit: 'g',
    } });
    expect(queued.log.quantity_multiplier).toBeCloseTo(0.6, 10);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Saved offline', 'Rolled oats will sync to your log when you reconnect.');
    alert.mockRestore();
  });

  it('does not claim nothing was logged when the week could not be read offline', async () => {
    mockBrowse.recentFoods = [];
    mockBrowse.frequentFoods = [];
    mockBrowse.browseUnavailable = true;
    await show();
    await act(async () => {
      fireEvent.press(await screen.findByTestId('food-day-first-breakfast'));
    });
    expect(screen.getByText('Recent foods could not load')).toBeTruthy();
    expect(screen.queryByText('No foods logged in the last 7 days')).toBeNull();
  });
});
