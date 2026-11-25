// GOAL-930-M (D4, C2 Style C C_error; owner #203-E50 "op 1 to all"): on the Style C day (featureFlags.foodPlanChecklist)
// a failed save from the portion sheet shows as the drawn card in the sheet, in place of main's two system alerts
// (LogScreen.tsx:361-364 offline enqueue, :383-388 online). The portion and unit stay; the primary reads "Try again" and
// repeats the action that failed through the same handleConfirmLog, so what is sent, its key and the retry rule are
// main's. Haptics as main: one error haptic on the online failure, none on the offline one. Switch off: main's alerts.
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../LogScreen';
import { enqueue } from '../../../services/foodLogQueue';
import { logApi } from '../../../services/api';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { errorMessage } from '../../../types/common';
import { getTodayString } from '../../../utils/date';

let mockOnline = true;
let mockStyleC = true;
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  const flags = { ...actual.featureFlags };
  Object.defineProperty(flags, 'foodPlanChecklist', { get: () => mockStyleC, enumerable: true });
  return { ...actual, featureFlags: flags };
});
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }), useFocusEffect: jest.fn() }));
// A fixed clock, never the real date (FIX-930R2 LO-930R2 B1 class). Only Date is faked.
jest.useFakeTimers({ now: new Date('2026-11-05T12:00:00'), advanceTimers: true, doNotFake: ['nextTick', 'setImmediate',
  'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime',
  'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());
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
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => mockOnline }));
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
jest.mock('../../../services/foodLogSync', () => ({ notifyPendingFoodLogs: jest.fn().mockResolvedValue(1), syncFoodLogQueue: jest.fn() }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: async (url: string) => ({ data: url.startsWith('/assignments/me') ? { items: [], nextCursor: null } : { assignments: [] } }) },
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn(), getDaily: jest.fn().mockResolvedValue({ data: { entries: [] } }) },
}));
jest.mock('../../../services/foodLogQueue', () => ({ enqueue: jest.fn(), getQueueLength: jest.fn().mockResolvedValue(0) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

const logFood = logApi.logFood as jest.Mock;
const enqueueMock = enqueue as jest.Mock;
const lost = () => Object.assign(new Error('Connection lost after server commit'), { code: 'ERR_SOMETHING' });
let alert: jest.SpyInstance;
let hapticError: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockStyleC = true;
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  hapticError = jest.spyOn(HapticService, 'error').mockImplementation(() => undefined as never);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

async function openPortion(fromClassic = false) {
  await render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LogScreen />
    </QueryClientProvider>,
  );
  await fireEvent.press(fromClassic ? await screen.findByLabelText('Add food to breakfast') : await screen.findByTestId('food-day-first-breakfast'));
  await fireEvent.press(await screen.findByText('Rolled oats'));
  await fireEvent.press(await screen.findByLabelText('Portion unit g'));
  await fireEvent.changeText(screen.getByLabelText('Food quantity'), '80');
}

describe('GOAL-930-M D4 on the Style C day: the card in the portion sheet, never a system alert', () => {
  it('Log food fails online: the card, no Alert, one error haptic, the portion and unit kept; Try again sends the same key once more', async () => {
    const err = lost();
    logFood.mockRejectedValueOnce(err).mockResolvedValueOnce({ data: { id: 'entry-1' } });
    await openPortion();
    await fireEvent.press(screen.getByTestId('quantity-log-food'));
    const card = await screen.findByTestId('portion-save-failure');
    expect(within(card).getByText("Couldn't log food")).toBeTruthy();
    expect(within(card).getByText(errorMessage(err, 'This food was not added. Check the connection and try again.'))).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
    expect(hapticError).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Food quantity').props.value).toBe('80');
    expect(screen.getByLabelText('Portion unit g').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(screen.queryByRole('button', { name: 'Log food' })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(logFood).toHaveBeenCalledTimes(2));
    const [first, second] = logFood.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(typeof first.client_uuid).toBe('string');
    expect(second.client_uuid).toBe(first.client_uuid);
    expect(second).toEqual(first);
    // Log food's own choice: the add sheet closes after the save that worked.
    await waitFor(() => expect(screen.queryAllByText('Rolled oats')).toHaveLength(0));
    expect(alert).not.toHaveBeenCalled();
  });

  it('Add another food fails: Try again repeats Add another food, and the add sheet stays open once it works', async () => {
    logFood.mockRejectedValueOnce(lost()).mockResolvedValueOnce({ data: { id: 'entry-1' } });
    await openPortion();
    await fireEvent.press(screen.getByTestId('quantity-add-another'));
    expect(await screen.findByTestId('portion-save-failure')).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(logFood).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('quantity-log-food')).toBeNull());
    expect(screen.getAllByText('Rolled oats').length).toBeGreaterThan(0);
  });

  it('a second failure shows the card again, and a new try clears it while it runs', async () => {
    logFood.mockRejectedValueOnce(lost()).mockRejectedValueOnce(lost());
    await openPortion();
    await fireEvent.press(screen.getByTestId('quantity-log-food'));
    expect(await screen.findByTestId('portion-save-failure')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(logFood).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('portion-save-failure')).toBeTruthy();
    expect(hapticError).toHaveBeenCalledTimes(2);
    expect(alert).not.toHaveBeenCalled();
  });

  it('closing the portion sheet clears the card; the food chosen again opens with no card and main\'s Log food', async () => {
    logFood.mockRejectedValueOnce(lost());
    await openPortion();
    await fireEvent.press(screen.getByTestId('quantity-log-food'));
    expect(await screen.findByTestId('portion-save-failure')).toBeTruthy();
    // The sheet's own close (FoodSearchModal's onRequestClose: back on Android, the swipe on iOS) closes the portion first.
    await fireEvent(screen.getByTestId('food-search-sheet'), 'requestClose');
    await waitFor(() => expect(screen.queryByTestId('quantity-log-food')).toBeNull());
    await fireEvent.press(await screen.findByText('Rolled oats'));
    expect(await screen.findByTestId('quantity-log-food')).toBeTruthy();
    expect(screen.queryByTestId('portion-save-failure')).toBeNull();
    expect(screen.getByRole('button', { name: 'Log food' })).toBeTruthy();
  });

  it('the offline enqueue fails: "Couldn\'t save food" in the card, no Alert, no haptic (as main)', async () => {
    mockOnline = false;
    const err = new Error('Storage is full');
    enqueueMock.mockRejectedValueOnce(err).mockResolvedValueOnce(undefined);
    await openPortion();
    await fireEvent.press(screen.getByTestId('quantity-log-food'));
    const card = await screen.findByTestId('portion-save-failure');
    expect(within(card).getByText("Couldn't save food")).toBeTruthy();
    expect(within(card).getByText(errorMessage(err, 'Keep this portion open and try saving again.'))).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
    expect(hapticError).not.toHaveBeenCalled();
    expect(logFood).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(enqueueMock).toHaveBeenCalledTimes(2));
    expect(logFood).not.toHaveBeenCalled();
  });
});

describe('GOAL-930-M D4 with the switch off: the classic log keeps main\'s alerts', () => {
  it('a failed save shows Alert "Couldn\'t log food" and no card', async () => {
    mockStyleC = false;
    const err = lost();
    logFood.mockRejectedValueOnce(err);
    await openPortion(true);
    await fireEvent.press(screen.getByTestId('quantity-log-food'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith("Couldn't log food", errorMessage(err, 'This food was not added. Check the connection and try again.')));
    expect(screen.queryByTestId('portion-save-failure')).toBeNull();
    expect(screen.getByRole('button', { name: 'Log food' })).toBeTruthy();
  });
});
