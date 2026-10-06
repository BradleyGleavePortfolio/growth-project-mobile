/**
 * FOOD-SPEED-124: the fast paths of the Food Log, rendered.
 *   - Repeat yesterday's breakfast in two taps (Add Food, Add all) with the
 *     same saved portions.
 *   - A recent food opens the picker at the portion logged last time.
 *   - Foods from the client's log appear the moment a search is typed.
 *   - Delete takes the entry off the day at once.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import type { FoodLog } from '../../../types';
import type { SearchResult } from '../../../utils/log/types';
import LogScreen from '../LogScreen';
import { foodApi, logApi } from '../../../services/api';
import { addDays, getTodayString } from '../../../utils/date';

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
  selectedDate: mockToday, foodLogs: [mockLog],
  dailyTotals: { calories: 248, protein: 47, carbs: 0, fat: 5 }, waterOz: 0,
  isLoading: false, loadError: null as string | null,
  setSelectedDate: jest.fn(), loadDayData: jest.fn().mockResolvedValue(undefined), logWater: jest.fn(),
  removeFoodLogLocally: jest.fn(),
};
const mockLoadBrowseFoods = jest.fn().mockResolvedValue(undefined);

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
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn() },
}));
jest.mock('../../../services/foodLogQueue', () => ({ flush: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

const ok: AxiosResponse = { data: {}, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } };

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.loadError = null;
  mockStore.isLoading = false;
  jest.mocked(logApi.logFood).mockResolvedValue(ok);
  jest.mocked(logApi.deleteEntry).mockResolvedValue(ok);
  // The catalog search never answers here: local matches must not wait for it.
  jest.mocked(foodApi.search).mockReturnValue(new Promise<never>(() => {}));
});

describe('Food Log day-data failure state', () => {
  it('shows a failed read with retry while Add Food remains available', async () => {
    mockStore.loadError = 'Food and water data could not refresh. Check your connection and try again.';
    await render(<LogScreen />);
    expect(screen.getByText(mockStore.loadError)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('log-day-data-error-retry'));
    expect(mockStore.loadDayData).toHaveBeenCalledWith('user', mockToday);
    expect(mockStore.loadDayData).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText('Add Food')).not.toHaveLength(0);
  });

  it('keeps retry disabled while day data is loading', async () => {
    mockStore.loadError = 'Water data could not refresh. Check your connection and try again.';
    mockStore.isLoading = true;
    await render(<LogScreen />);
    expect(screen.getByTestId('log-day-data-error-retry').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
});

async function openBreakfast() {
  await render(<LogScreen />);
  await act(async () => {
    fireEvent.press(screen.getAllByText('Add Food')[0]);
  });
  expect(mockLoadBrowseFoods).toHaveBeenCalledTimes(1);
}

describe('Food Log fast paths', () => {
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
      quantity_multiplier: 0.6, original_quantity: 60, original_unit: 'g',
    });
    expect(logApi.logFood).toHaveBeenCalledWith({
      date: mockToday, meal_type: 'breakfast', food_item_id: 'food-banana',
      quantity_multiplier: 1.18, original_quantity: 1, original_unit: 'serving',
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
    expect(screen.getByText('From your log · Last time 60 g')).toBeTruthy();
  });

  it('takes a deleted entry off the day before the server answers', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const del = buttons?.find((b) => b.text === 'Delete');
      void del?.onPress?.();
    });
    let finishDelete: (v: AxiosResponse) => void = () => {};
    jest.mocked(logApi.deleteEntry).mockReturnValue(new Promise<AxiosResponse>((resolve) => { finishDelete = resolve; }));
    await render(<LogScreen />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText(/Chicken breast.*Tap to edit/));
    });
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Delete entry' })));
    expect(mockStore.removeFoodLogLocally).toHaveBeenCalledWith('entry-1');
    expect(mockStore.loadDayData).not.toHaveBeenCalledWith('user', mockToday);
    await act(async () => finishDelete(ok));
    await waitFor(() => expect(mockStore.loadDayData).toHaveBeenCalledWith('user', mockToday));
    alert.mockRestore();
  });
});
