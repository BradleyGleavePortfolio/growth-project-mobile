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
  waterApi: { getDaily: jest.fn() },
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

const mockDate = '2026-10-06';
const mockFood = {
  id: 'oats', name: 'Rolled oats', calories: 379, protein_g: 13, carbs_g: 68, fat_g: 6.5,
  serving_size_grams: 40, nutrient_basis: 'PER_100G' as const, supports_volume_units: false,
};
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
  jest.mocked(foodApi.search).mockResolvedValue({
    ...ok, data: { results: [mockFood], parsed_quantity: 60, parsed_unit: 'g' },
  });
  jest.mocked(logApi.getDaily).mockImplementation(async (date) => {
    const entries = date === mockDate ? mockEntries : date === '2026-10-05' ? [mockPastEntry] : [];
    const multiplier = entries.reduce((sum, e) => sum + e.quantity_multiplier, 0);
    return { ...ok, data: {
      entries, total_calories: 379 * multiplier, total_protein_g: 13 * multiplier,
      total_carbs_g: 68 * multiplier, total_fat_g: 6.5 * multiplier,
    } };
  });
  jest.mocked(logApi.logFood).mockImplementation(async (data) => {
    mockEntries.push({
      id: 'entry', food_item_id: String(data.food_item_id), user_id: 'client',
      meal_type: data.meal_type as MealType, quantity_multiplier: data.quantity_multiplier ?? 1,
      original_quantity: data.original_quantity, original_unit: data.original_unit, food_item: mockFood,
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

    await fireEvent.press(screen.getByLabelText(/Rolled oats.*Tap to edit/));
    await fireEvent.changeText(screen.getByLabelText('Edit quantity'), '80');
    await fireEvent.press(screen.getByRole('button', { name: 'Save edit' }));
    await waitFor(() => expect(useClientStore.getState().dailyTotals.calories).toBeCloseTo(303.2));
    expect(logApi.updateEntry).toHaveBeenCalledWith('entry', {
      quantity_multiplier: 0.8, original_quantity: 80, original_unit: 'g', meal_type: 'breakfast',
    });

    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await fireEvent.press(screen.getByLabelText(/Rolled oats.*Tap to edit/));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete entry' }));
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

  it('leaves the portion visible when a save fails, then closes it after saving', async () => {
    jest.mocked(logApi.logFood).mockRejectedValueOnce(new Error('Network Error'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<LogScreen />);
    await fireEvent.press(screen.getAllByText('Add Food')[0]);
    await fireEvent.press(await screen.findByText('Rolled oats'));
    await fireEvent.press(screen.getByRole('button', { name: 'Log Food' }));
    expect(alert).toHaveBeenCalledWith("Couldn't log food", expect.any(String));
    expect(screen.getByLabelText('Food quantity').props.value).toBe('60');
    expect(screen.queryByPlaceholderText('Search foods...')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Log Food' }));
    expect(await screen.findByText('Rolled oats added to Breakfast.')).toBeTruthy();
    expect(screen.queryByLabelText('Food quantity')).toBeNull();
  });
});
