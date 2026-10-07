import React from 'react';
import { Alert, Platform } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import LogScreen from '../LogScreen';
import { foodApi, logApi, waterApi } from '../../../services/api';
import { useClientStore } from '../../../store/clientStore';
import type { MealType } from '../../../types';

jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client' }) }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({}), isEffectivelyOnline: () => true,
}));
jest.mock('../../../hooks/useFoodLogQueueSync', () => ({ usePendingFoodLogCount: () => 0 }));
jest.mock('../../../services/foodLogSync', () => ({
  syncFoodLogQueue: jest.fn(), notifyPendingFoodLogs: jest.fn(),
}));
jest.mock('../../../services/api', () => ({
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { getDaily: jest.fn(), logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn() },
  waterApi: { getDaily: jest.fn(), log: jest.fn() },
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

const mockDate = '2026-10-06';
const mockFood = {
  id: 'oats', name: 'Rolled oats', calories: 379, protein_g: 13, carbs_g: 68, fat_g: 6.5,
  serving_size_grams: 40, nutrient_basis: 'PER_100G' as const, supports_volume_units: false,
};
const mockBanana = { ...mockFood, id: 'banana', name: 'Banana', calories: 89 };
interface Entry {
  id: string;
  food_item_id: string;
  user_id: string;
  meal_type: MealType;
  quantity_multiplier: number;
  original_quantity?: number;
  original_unit?: string;
  food_item: typeof mockFood;
}
const mockPastEntry: Entry = {
  id: 'past', food_item_id: 'oats', user_id: 'client', meal_type: 'breakfast',
  quantity_multiplier: 0.6, original_quantity: 60, original_unit: 'g', food_item: mockFood,
};
let mockEntries: Entry[] = [];
const ok: AxiosResponse = {
  data: {}, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEntries = [];
  useClientStore.getState().reset();
  useClientStore.getState().setSelectedDate(mockDate);
  jest.mocked(waterApi.getDaily).mockResolvedValue({ ...ok, data: { total_ml: 0 } });
  jest.mocked(waterApi.log).mockResolvedValue(ok);
  jest.mocked(foodApi.create).mockResolvedValue({ ...ok, data: { id: 'manual' } });
  jest.mocked(foodApi.search).mockResolvedValue({
    ...ok, data: { results: [mockFood], parsed_quantity: 60, parsed_unit: 'g' },
  });
  jest.mocked(logApi.getDaily).mockImplementation(async (date) => {
    const entries = date === mockDate ? mockEntries : date === '2026-10-05' ? [mockPastEntry] : [];
    const total = (key: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g') =>
      entries.reduce((sum, e) => sum + e.food_item[key] * e.quantity_multiplier, 0);
    return { ...ok, data: {
      entries, total_calories: total('calories'), total_protein_g: total('protein_g'),
      total_carbs_g: total('carbs_g'), total_fat_g: total('fat_g'),
    } };
  });
  jest.mocked(logApi.logFood).mockImplementation(async (data) => {
    mockEntries.push({
      id: 'entry', food_item_id: String(data.food_item_id), user_id: 'client',
      meal_type: data.meal_type as MealType, quantity_multiplier: data.quantity_multiplier ?? 1,
      original_quantity: data.original_quantity, original_unit: data.original_unit,
      food_item: data.food_item_id === 'banana' ? mockBanana : mockFood,
    });
    return ok;
  });
  jest.mocked(logApi.updateEntry).mockImplementation(async (id, data) => {
    mockEntries = mockEntries.map((e) => e.id === id ? { ...e, ...data } : e);
    return ok;
  });
  jest.mocked(logApi.deleteEntry).mockImplementation(async (id) => {
    mockEntries = mockEntries.filter((e) => e.id !== id);
    return ok;
  });
});

afterEach(() => jest.restoreAllMocks());

describe.each(['ios', 'android'] as const)('%s client food journey (real screen, store and portion math)', (os) => {
  beforeEach(() => jest.replaceProperty(Platform, 'OS', os));

  it('searches, picks a portion in one sheet, cancels back, adds, edits, deletes and repeats', async () => {
    await render(<LogScreen />);
    await fireEvent.press(screen.getAllByText('Add Food')[0]);
    await fireEvent.changeText(screen.getByPlaceholderText('Search foods...'), '60 g oats');
    await waitFor(() => expect(foodApi.search).toHaveBeenCalledWith('60 g oats', 50));
    await fireEvent.press(screen.getByText('Rolled oats'));
    expect(screen.getByLabelText('Food quantity').props.value).toBe('60');
    expect(screen.getByLabelText('Portion unit g').props.accessibilityState.selected).toBe(true);
    // A single native sheet replaces search with the portion picker.
    expect(screen.queryByPlaceholderText('Search foods...')).toBeNull();
    await fireEvent.press(screen.getByText('Cancel'));
    expect(screen.getByPlaceholderText('Search foods...').props.value).toBe('60 g oats');
    expect(screen.queryByLabelText('Food quantity')).toBeNull();
    await fireEvent.press(screen.getByText('Rolled oats'));
    await fireEvent(screen.getByTestId('food-search-sheet'), 'requestClose');
    expect(screen.getByPlaceholderText('Search foods...').props.value).toBe('60 g oats');
    await fireEvent.press(screen.getByText('Rolled oats'));
    await fireEvent.press(screen.getByRole('button', { name: 'Log Food' }));
    await waitFor(() => expect(useClientStore.getState().foodLogs).toHaveLength(1));
    expect(logApi.logFood).toHaveBeenCalledWith({
      food_item_id: 'oats', date: mockDate, meal_type: 'breakfast',
      quantity_multiplier: 0.6, original_quantity: 60, original_unit: 'g',
    });
    expect(useClientStore.getState().dailyTotals.calories).toBeCloseTo(227.4);
    expect(screen.queryByLabelText('Food quantity')).toBeNull();
    expect(await screen.findByText('Added Rolled oats.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));

    await fireEvent.press(screen.getByLabelText(/Rolled oats.*Tap to edit/));
    await fireEvent.press(screen.getByRole('button', { name: 'Edit unit oz' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Edit unit g' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Lunch' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Breakfast' }));
    await fireEvent.changeText(screen.getByLabelText('Edit quantity'), '80');
    await fireEvent.press(screen.getByRole('button', { name: 'Save edit' }));
    await waitFor(() => expect(useClientStore.getState().dailyTotals.calories).toBeCloseTo(303.2));
    expect(logApi.updateEntry).toHaveBeenCalledWith('entry', {
      quantity_multiplier: 0.8, original_quantity: 80, original_unit: 'g', meal_type: 'breakfast',
    });
    await fireEvent.press(screen.getByLabelText(/Rolled oats.*Tap to edit/));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel edit' }));

    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await fireEvent.press(screen.getByLabelText(/Rolled oats.*Tap to edit/));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete entry' }));
    expect(alert).toHaveBeenCalledWith('Delete food', 'Remove Rolled oats?', expect.any(Array));
    expect(logApi.deleteEntry).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2];
    await act(async () => buttons?.find((button) => button.text === 'Delete')?.onPress?.());
    await waitFor(() => expect(useClientStore.getState().foodLogs).toHaveLength(0));
    expect(useClientStore.getState().dailyTotals.calories).toBe(0);
    alert.mockRestore();

    await fireEvent.press(screen.getAllByText('Add Food')[0]);
    await fireEvent.press(await screen.findByRole('button', { name: /Repeat .*breakfast: add all 1 food/ }));
    await waitFor(() => expect(useClientStore.getState().foodLogs).toHaveLength(1));
    expect(logApi.logFood).toHaveBeenLastCalledWith({
      date: mockDate, meal_type: 'breakfast', food_item_id: 'oats',
      quantity_multiplier: 0.6, original_quantity: 60, original_unit: 'g',
    });
    expect(useClientStore.getState().dailyTotals.calories).toBeCloseTo(227.4);
    expect(await screen.findByText('1 food added to Breakfast.')).toBeTruthy();
  });

  it('keeps the entered portion after failure, then returns to search after saving', async () => {
    jest.mocked(logApi.logFood).mockRejectedValueOnce(new Error('Network Error'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<LogScreen />);
    await fireEvent.press(screen.getAllByText('Add Food')[0]);
    await fireEvent.press(await screen.findByText('Rolled oats'));
    await fireEvent.changeText(screen.getByLabelText('Food quantity'), '85');
    await fireEvent.press(screen.getByRole('button', { name: 'Log Food' }));
    expect(alert).toHaveBeenCalledWith("Couldn't log food", expect.any(String));
    expect(screen.getByLabelText('Food quantity').props.value).toBe('85');
    expect(screen.getByLabelText('Portion unit g').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('food-search-sheet').props.visible).toBe(true);
    expect(screen.queryByText('Added Rolled oats.')).toBeNull();
    expect(screen.queryByPlaceholderText('Search foods...')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Log Food' }));
    expect(await screen.findByText('Added Rolled oats.')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search foods...')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Rolled oats added to Breakfast.')).toBeTruthy();
    expect(screen.queryByLabelText('Food quantity')).toBeNull();
  });

  it('adds two foods without reopening, updates totals and closes with Done', async () => {
    jest.mocked(foodApi.search).mockResolvedValue({ ...ok, data: { results: [mockFood, mockBanana] } });
    await render(<LogScreen />);
    await fireEvent.press(screen.getAllByText('Add Food')[0]);
    await fireEvent.changeText(screen.getByPlaceholderText('Search foods...'), 'foods');
    await fireEvent.press(await screen.findByText('Banana'));
    await fireEvent.press(screen.getByRole('button', { name: 'Portion unit g' }));
    await fireEvent.changeText(screen.getByLabelText('Food quantity'), '100');
    await fireEvent.press(screen.getByRole('button', { name: 'Log Food' }));
    expect(await screen.findByText('Added Banana.')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search foods...').props.value).toBe('foods');
    expect(useClientStore.getState().dailyTotals.calories).toBe(89);
    await fireEvent.press(screen.getByText('Rolled oats'));
    await fireEvent.press(screen.getByRole('button', { name: 'Portion unit g' }));
    await fireEvent.changeText(screen.getByLabelText('Food quantity'), '100');
    await fireEvent.press(screen.getByRole('button', { name: 'Log Food' }));
    expect(await screen.findByText('Added Rolled oats.')).toBeTruthy();
    expect(useClientStore.getState().foodLogs).toHaveLength(2);
    expect(useClientStore.getState().dailyTotals.calories).toBe(468);
    expect(logApi.logFood).toHaveBeenCalledTimes(2);
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByPlaceholderText('Search foods...')).toBeNull();
    await fireEvent.press(screen.getAllByText('Add Food')[0]);
    expect(screen.queryByText('Added Rolled oats.')).toBeNull();
  });

  it('retains browse tabs, retry, suggestions, clear, manual entry and close', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<LogScreen />);
    await fireEvent.press(screen.getAllByText('Add Food')[0]);
    await fireEvent.press(screen.getByText('Frequent'));
    expect(screen.getByText('Most logged, last 7 days')).toBeTruthy();
    await fireEvent.press(screen.getByText('Recent'));
    expect(screen.getByText('Recent foods, last 7 days')).toBeTruthy();
    jest.mocked(foodApi.search).mockRejectedValueOnce(new Error('Network Error'));
    await fireEvent.changeText(screen.getByPlaceholderText('Search foods...'), 'fruit');
    await fireEvent.press(await screen.findByText(/^(Retry Search|Try again)$/));
    await waitFor(() => expect(foodApi.search).toHaveBeenCalledTimes(2));
    await fireEvent.press(screen.getByLabelText('Clear food search'));
    jest.mocked(foodApi.search).mockResolvedValueOnce({ ...ok, data: { results: [], suggestions: [mockBanana] } });
    await fireEvent.changeText(screen.getByPlaceholderText('Search foods...'), 'bananna');
    await fireEvent.press(await screen.findByText('Banana'));
    await fireEvent.press(screen.getByText('Cancel'));
    await fireEvent.press(screen.getByLabelText('Clear food search'));
    await fireEvent.press(screen.getByText('Enter Manually'));
    for (const input of screen.getAllByPlaceholderText('0')) await fireEvent.changeText(input, '0');
    await fireEvent.press(screen.getByText('Log Food'));
    expect(alert).toHaveBeenCalledWith('Missing info', 'Enter at least a food name and calories.');
    await fireEvent.changeText(screen.getByPlaceholderText('Food name'), 'Lunch label');
    await fireEvent.changeText(screen.getByPlaceholderText('1'), '2');
    await fireEvent.changeText(screen.getByPlaceholderText('serving'), 'g');
    await fireEvent.press(screen.getByText('Log Food'));
    expect(foodApi.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Lunch label', serving_size_grams: 2 }));
    await fireEvent.press(screen.getAllByText('Add Food')[0]);
    await fireEvent.press(screen.getByText('Enter Manually'));
    await fireEvent.press(screen.getByText('Back to Search'));
    await fireEvent.press(screen.getByRole('button', { name: 'Close food search' }));
    expect(screen.queryByPlaceholderText('Search foods...')).toBeNull();
  });

  it('retains day selection, water, refresh and all four meal entry points', async () => {
    await render(<LogScreen />);
    await fireEvent.press(screen.getByLabelText('Previous day'));
    expect(useClientStore.getState().selectedDate).toBe('2026-10-05');
    await fireEvent.press(screen.getByLabelText('Next day'));
    expect(useClientStore.getState().selectedDate).toBe(mockDate);
    await fireEvent.press(screen.getByLabelText(/tap to go to today/));
    for (const oz of [8, 12, 16]) await fireEvent.press(screen.getByLabelText(`Add ${oz} ounces of water`));
    expect(waterApi.log).toHaveBeenCalledTimes(3);
    expect(useClientStore.getState().waterOz).toBe(36);
    const reads = jest.mocked(logApi.getDaily).mock.calls.length;
    let scroll = screen.getByText('Food Log').parent;
    while (scroll && !scroll.props.refreshControl) scroll = scroll.parent;
    expect(scroll?.props.refreshControl).toBeTruthy();
    await act(async () => scroll?.props.refreshControl.props.onRefresh());
    expect(jest.mocked(logApi.getDaily).mock.calls.length).toBeGreaterThan(reads);
    for (const [index, meal] of ['Breakfast', 'Lunch', 'Dinner', 'Snacks'].entries()) {
      await fireEvent.press(screen.getAllByText('Add Food')[index]);
      expect(screen.getByText(`Add to ${meal}`)).toBeTruthy();
      await fireEvent(screen.getByTestId('food-search-sheet'), 'requestClose');
    }
  });
});
