/**
 * ALL-ON-GREEN-M (R1, R3): the switch-on proof of LogScreen.foodSpeed.test.tsx (FOOD-SPEED-124). That file pins
 * featureFlags.foodPlanChecklist off and proves the classic Food log; this file pins it on and proves the same fast
 * paths from the Style C day (its first day, C_first, with today's lunch logged):
 *   - Repeat yesterday's breakfast from the add sheet in one tap, with the same saved portions.
 *   - A recent food opens the picker at the portion logged last time.
 *   - Foods from the client's log appear the moment a search is typed.
 *   - Delete (from the lunch row's edit sheet) takes the entry off the day at once.
 *   - A day that could not be read keeps the retry, on the classic log the Style C day falls back to.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import type { FoodLog } from '../../../types';
import type { SearchResult } from '../../../utils/log/types';
import LogScreen from '../LogScreen';
import { foodApi, logApi } from '../../../services/api';
import { addDays, getTodayString } from '../../../utils/date';

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
const mockBreakfast = {
  date: addDays(mockToday, -1),
  calories: 332.4,
  entries: [
    { foodItemId: 'food-oats', name: 'Rolled oats', calories: 227.4, quantityMultiplier: 0.6, originalQuantity: 60, originalUnit: 'g' },
    { foodItemId: 'food-banana', name: 'Banana', calories: 105, quantityMultiplier: 1.18, originalQuantity: 1, originalUnit: 'serving' },
  ],
};
const mockLog: FoodLog = {
  id: 'entry-1', userId: 'user', coachId: '', date: mockToday, mealType: 'lunch',
  foodName: 'Chicken breast', calories: 248, protein: 47, carbs: 0, fat: 5,
  quantity: 150, unit: 'g', originalQuantity: 150, originalUnit: 'g',
  quantityMultiplier: 1.5, createdAt: `${mockToday}T12:00:00Z`,
};
const mockStore = {
  selectedDate: mockToday, foodLogs: [mockLog], hasLoadedDay: true,
  dailyTotals: { calories: 248, protein: 47, carbs: 0, fat: 5 }, waterOz: 0,
  isLoading: false, loadError: null as string | null,
  setSelectedDate: jest.fn(), loadDayData: jest.fn().mockResolvedValue(undefined),
  // Like the store: reads the day again only while it is the day on screen.
  refreshShownDay: jest.fn((u: string, d: string): Promise<void> => (d === mockStore.selectedDate ? mockStore.loadDayData(u, d) : Promise.resolve())),
  logWater: jest.fn(),
  removeFoodLogLocally: jest.fn(),
};
const mockLoadBrowseFoods = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  return { ...real, featureFlags: { ...real.featureFlags, foodPlanChecklist: true } };
});
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }), useFocusEffect: jest.fn() }));
jest.mock('../../../store/clientStore', () => ({ useClientStore: () => mockStore }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'user' }) }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({}), isEffectivelyOnline: () => true,
}));
jest.mock('../../../hooks/useFoodBrowse', () => ({
  useFoodBrowse: () => ({
    recentFoods: [mockOats],
    frequentFoods: [mockOats],
    lastMeals: { breakfast: mockBreakfast },
    loadBrowseFoods: mockLoadBrowseFoods,
  }),
}));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  // The Style C day's own reads: the day's workout from Train (none) and the week before (nothing, so no usual day).
  default: { get: jest.fn(async () => ({ data: { items: [], nextCursor: null } })) },
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn(), getDaily: jest.fn(async () => ({ data: { entries: [] } })) },
}));
jest.mock('../../../services/foodLogQueue', () => ({ flush: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

const ok: AxiosResponse = { data: {}, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } };
const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <LogScreen />
  </QueryClientProvider>,
);

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.loadError = null;
  mockStore.isLoading = false;
  jest.mocked(logApi.logFood).mockResolvedValue(ok);
  jest.mocked(logApi.deleteEntry).mockResolvedValue(ok);
  // The catalog search never answers here: local matches must not wait for it.
  jest.mocked(foodApi.search).mockReturnValue(new Promise<never>(() => {}));
});

describe('Food Log day-data failure state, with the Style C switch on', () => {
  it('shows a failed read with retry while Add Food remains available', async () => {
    mockStore.loadError = 'Food and water data could not refresh. Check your connection and try again.';
    await show();
    // The day itself could not load: the Style C day hands over to the classic log and its retry (FoodDayView.tsx:222).
    expect(await screen.findByText(mockStore.loadError)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('log-day-data-error-retry'));
    expect(mockStore.loadDayData).toHaveBeenCalledWith('user', mockToday);
    expect(mockStore.loadDayData).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText('Add food')).not.toHaveLength(0);
  });

  it('keeps retry disabled while day data is loading', async () => {
    mockStore.loadError = 'Water data could not refresh. Check your connection and try again.';
    mockStore.isLoading = true;
    await show();
    expect((await screen.findByTestId('log-day-data-error-retry')).props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
});

async function openBreakfast() {
  await show();
  // C_first's Breakfast row (nothing logged yet) opens the add sheet on Breakfast (FoodDayView.tsx:296-299).
  await act(async () => {
    fireEvent.press(await screen.findByTestId('food-day-first-breakfast'));
  });
  expect(mockLoadBrowseFoods).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('food-search-meal')).toHaveTextContent('Breakfast');
}

describe('Food Log fast paths, from the Style C day', () => {
  it("repeats yesterday's breakfast in one tap with the exact saved portions", async () => {
    await openBreakfast();
    expect(screen.getByText("Repeat yesterday's breakfast")).toBeTruthy();
    expect(screen.getByText('Rolled oats, Banana · 332 kcal')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Repeat yesterday's breakfast: add all 2 foods"));
    });

    await waitFor(() => expect(logApi.logFood).toHaveBeenCalledTimes(2));
    expect(logApi.logFood).toHaveBeenCalledWith({
      date: mockToday, meal_type: 'breakfast', food_item_id: 'food-oats',
      quantity_multiplier: 0.6, original_quantity: 60, original_unit: 'g', client_uuid: expect.stringMatching(/^pfl_/),
    });
    expect(logApi.logFood).toHaveBeenCalledWith({
      date: mockToday, meal_type: 'breakfast', food_item_id: 'food-banana',
      quantity_multiplier: 1.18, original_quantity: 1, original_unit: 'serving', client_uuid: expect.stringMatching(/^pfl_/),
    });
    expect(mockStore.loadDayData).toHaveBeenCalledWith('user', mockToday);
    expect(await screen.findByText('2 foods added to Breakfast.')).toBeTruthy();
  });

  it('opens a recent food at the portion logged last time', async () => {
    await openBreakfast();
    expect(screen.getByText('Recent')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText('Rolled oats'));
    });
    expect(screen.getByLabelText('Food quantity').props.value).toBe('60');
    expect(screen.getByLabelText('Portion unit g').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('shows foods from the log as soon as a search is typed, before the catalog answers', async () => {
    await openBreakfast();
    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('Search foods...'), 'oats');
    });
    expect(screen.getByText('Rolled oats')).toBeTruthy();
    // STYLEC-916: a food from the log shows its last portion on the row's one line.
    expect(screen.getByText(/^60 g, .* g protein$/)).toBeTruthy();
  });

  it('takes a deleted entry off the day before the server answers', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const del = buttons?.find((b) => b.text === 'Delete');
      void del?.onPress?.();
    });
    let finishDelete: (v: AxiosResponse) => void = () => {};
    jest.mocked(logApi.deleteEntry).mockReturnValue(new Promise<AxiosResponse>((resolve) => { finishDelete = resolve; }));
    await show();
    // C_first's Lunch row holds one food: a tap opens its edit sheet (FoodDayView.tsx:299, onEditFood).
    await act(async () => {
      fireEvent.press(await screen.findByLabelText('Lunch. Chicken breast'));
    });
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Delete entry' })));
    expect(alert).toHaveBeenCalledWith('Delete food', 'Remove Chicken breast?', expect.any(Array));
    expect(mockStore.removeFoodLogLocally).toHaveBeenCalledWith('entry-1');
    expect(logApi.deleteEntry).toHaveBeenCalledWith('entry-1');
    expect(mockStore.loadDayData).not.toHaveBeenCalledWith('user', mockToday);
    await act(async () => finishDelete(ok));
    await waitFor(() => expect(mockStore.loadDayData).toHaveBeenCalledWith('user', mockToday));
    alert.mockRestore();
  });
});
