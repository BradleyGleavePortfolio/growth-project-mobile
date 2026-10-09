import React from 'react';
import { Alert, StyleSheet } from 'react-native';
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
  selectedDate: '2026-10-06', foodLogs: [mockLog], hasLoadedDay: true,
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
  it('uses a themed scrim and a bottom sheet with rounded top corners (owner 17:07, radius.sheet)', async () => {
    await openEdit();
    const { lightTokens: theme, radius } = require('../../../theme/tokens');
    expect(StyleSheet.flatten(screen.getByTestId('log-edit-backdrop').props.style)).toMatchObject({
      backgroundColor: theme.overlay, justifyContent: 'flex-end',
    });
    expect(StyleSheet.flatten(screen.getByTestId('log-edit-sheet').props.style)).toMatchObject({
      backgroundColor: theme.bgPrimary,
      borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
      borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    });
  });

  it('keeps the saved almonds multiplier when saving an unchanged entry', async () => {
    await openEdit();
    await act(async () => fireEvent.press(screen.getByLabelText('Save changes')));
    await waitFor(() => expect(logApi.updateEntry).toHaveBeenCalledWith('entry', {
      quantity_multiplier: 0.28, original_quantity: 1, original_unit: 'serving', meal_type: 'lunch',
    }));
  });

  it('moves an entry to another meal without changing its nutrition', async () => {
    await openEdit();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Dinner' })));
    await act(async () => fireEvent.press(screen.getByLabelText('Save changes')));
    await waitFor(() => expect(logApi.updateEntry).toHaveBeenCalledWith('entry', expect.objectContaining({
      meal_type: 'dinner', quantity_multiplier: 0.28,
    })));
  });

  it('offers a visible delete action that still requires confirmation', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await openEdit();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Delete entry' })));
    expect(alert).toHaveBeenCalledWith('Delete food', 'Remove Almonds?', expect.any(Array));
    expect(logApi.deleteEntry).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('keeps unsaved portion edits when the client cancels the delete confirmation', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await openEdit();
    await fireEvent.changeText(screen.getByLabelText('Edit quantity'), '2');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete entry' }));
    const buttons = alert.mock.calls[0][2];
    await act(async () => buttons?.find((button) => button.text === 'Cancel')?.onPress?.());
    expect(screen.getByLabelText('Edit quantity').props.value).toBe('2');
    expect(logApi.deleteEntry).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('shows no target rather than a made-up 2,000-calorie allowance', async () => {
    await render(<LogScreen />);
    expect(screen.getByText('No target')).toBeTruthy();
    expect(screen.queryByText('1838')).toBeNull();
  });
});
