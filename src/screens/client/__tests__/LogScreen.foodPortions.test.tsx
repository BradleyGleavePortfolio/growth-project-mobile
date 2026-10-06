import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import type { FoodLog } from '../../../types';
import LogScreen from '../LogScreen';
import { logApi } from '../../../services/api';
import { AxiosHeaders, type AxiosResponse } from 'axios';

const mockLog: FoodLog = {
  id: 'entry', userId: 'user', coachId: '', date: '2026-10-06', mealType: 'lunch',
  foodName: 'Almonds', calories: 162, protein: 6, carbs: 6, fat: 14,
  quantity: 1, unit: 'serving', originalQuantity: 1, originalUnit: 'serving',
  quantityMultiplier: 0.28, createdAt: '2026-10-06T12:00:00Z',
  foodItem: {
    id: 'almonds', name: 'Almonds', calories: 579, protein: 21, carbs: 22, fat: 50,
    serving_size_grams: 28, nutrient_basis: 'PER_100G', supports_volume_units: false,
  },
};
const mockStore = {
  selectedDate: '2026-10-06', foodLogs: [mockLog],
  dailyTotals: { calories: 162, protein: 6, carbs: 6, fat: 14 }, waterOz: 0,
  setSelectedDate: jest.fn(), loadDayData: jest.fn().mockResolvedValue(undefined), logWater: jest.fn(),
};
jest.mock('../../../store/clientStore', () => ({ useClientStore: () => mockStore }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'user' }) }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({}), isEffectivelyOnline: () => true,
}));
jest.mock('../../../hooks/useFoodBrowse', () => ({
  useFoodBrowse: () => ({ recentFoods: [], frequentFoods: [], lastMeals: {}, loadBrowseFoods: jest.fn() }),
}));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../services/api', () => ({
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { updateEntry: jest.fn(), deleteEntry: jest.fn() },
}));
jest.mock('../../../services/foodLogQueue', () => ({ flush: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  const response: AxiosResponse = { data: {}, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } };
  jest.mocked(logApi.updateEntry).mockResolvedValue(response);
  jest.mocked(logApi.deleteEntry).mockResolvedValue(response);
});

async function openEdit() {
  await render(<LogScreen />);
  await act(async () => {
    fireEvent.press(screen.getByLabelText(/Almonds.*Tap to edit/));
  });
}

describe('food edit screen uses the retained portion metadata', () => {
  it('keeps the saved almonds multiplier when saving an unchanged entry', async () => {
    await openEdit();
    await act(async () => fireEvent.press(screen.getByLabelText('Save edit')));
    await waitFor(() => expect(logApi.updateEntry).toHaveBeenCalledWith('entry', {
      quantity_multiplier: 0.28, original_quantity: 1, original_unit: 'serving', meal_type: 'lunch',
    }));
  });

  it('moves an entry to another meal without changing its nutrition', async () => {
    await openEdit();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Dinner' })));
    await act(async () => fireEvent.press(screen.getByLabelText('Save edit')));
    await waitFor(() => expect(logApi.updateEntry).toHaveBeenCalledWith('entry', expect.objectContaining({
      meal_type: 'dinner', quantity_multiplier: 0.28,
    })));
  });

  it('offers a visible delete action that still requires confirmation', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await openEdit();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Delete entry' })));
    expect(alert).toHaveBeenCalledWith('Delete Food', 'Remove Almonds?', expect.any(Array));
    expect(logApi.deleteEntry).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('shows no target rather than a made-up 2,000-calorie allowance', async () => {
    await render(<LogScreen />);
    expect(screen.getByText('No target')).toBeTruthy();
    expect(screen.queryByText('1838')).toBeNull();
  });
});
