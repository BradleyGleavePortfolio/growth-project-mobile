/**
 * B-403-1 (FOOD-SPEED-124 round 2): logging a food again from Recent at the
 * prefilled last portion saves the same nutrition as the entry it came from.
 * Real browse hook, real LogScreen, real quantity picker and portion math,
 * real search-log submitter; only the network is mocked.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import LogScreen from '../LogScreen';
import { logApi } from '../../../services/api';
import { addDays, getTodayString } from '../../../utils/date';

const mockToday = getTodayString();
const mockYesterday = addDays(mockToday, -1);

// A manual food: 400 kcal for the whole "2 serving" portion, saved with
// multiplier 1 and the description 2 serving (the manual submit contract).
const customLunch = {
  id: 'food-custom-lunch', name: 'Custom lunch', calories: 400, protein_g: 12, carbs_g: 60, fat_g: 12,
  serving_size_grams: 0, serving_description: '2 serving', nutrient_basis: 'PER_SERVING', supports_volume_units: false,
};
// A catalog food weighed in grams.
const oats = {
  id: 'food-oats', name: 'Rolled oats', calories: 379, protein_g: 13, carbs_g: 68, fat_g: 6.5,
  serving_size_grams: 40, nutrient_basis: 'PER_100G', supports_volume_units: false,
};
const mockDays: Record<string, unknown[]> = {
  [mockYesterday]: [
    { id: 'y1', food_item_id: oats.id, meal_type: 'breakfast', quantity_multiplier: 0.6, original_quantity: 60, original_unit: 'g', food_item: oats },
    { id: 'y2', food_item_id: customLunch.id, meal_type: 'lunch', quantity_multiplier: 1, original_quantity: 2, original_unit: 'serving', food_item: customLunch },
  ],
};

const mockStore = {
  selectedDate: mockToday, foodLogs: [], hasLoadedDay: true,
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 }, waterOz: 0,
  setSelectedDate: jest.fn(), loadDayData: jest.fn().mockResolvedValue(undefined), logWater: jest.fn(),
  removeFoodLogLocally: jest.fn(),
};
jest.mock('../../../store/clientStore', () => ({ useClientStore: () => mockStore }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'user' }) }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({}), isEffectivelyOnline: () => true,
}));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../services/api', () => ({
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { getDaily: jest.fn(), logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn() },
}));
jest.mock('../../../services/foodLogQueue', () => ({ flush: jest.fn(), enqueue: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

const ok: AxiosResponse = { data: {}, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(logApi.getDaily).mockImplementation(async (date: string) => ({ ...ok, data: { entries: mockDays[date] ?? [] } }));
  jest.mocked(logApi.logFood).mockResolvedValue(ok);
});

async function logFromRecent(name: string) {
  await render(<LogScreen />);
  await act(async () => {
    fireEvent.press(screen.getAllByText('Add food')[0]);
  });
  await waitFor(() => expect(screen.getByText(name)).toBeTruthy());
  await act(async () => {
    fireEvent.press(screen.getByText(name));
  });
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
  });
  await waitFor(() => expect(logApi.logFood).toHaveBeenCalledTimes(1));
  return jest.mocked(logApi.logFood).mock.calls[0][0];
}

describe('logging again from Recent saves the same nutrition as last time', () => {
  it('a custom whole-portion food saves one portion (400 kcal), not two', async () => {
    const payload = await logFromRecent('Custom lunch');
    expect(payload).toMatchObject({ food_item_id: 'food-custom-lunch', meal_type: 'breakfast', date: mockToday });
    expect(payload.quantity_multiplier).toBe(1);
    expect(Math.round(customLunch.calories * (payload.quantity_multiplier as number))).toBe(400);
    expect((payload.quantity_multiplier as number) * customLunch.protein_g).toBe(12);
  });

  it('a gram-weighed food saves the same grams and multiplier as last time', async () => {
    const payload = await logFromRecent('Rolled oats');
    expect(payload).toMatchObject({ food_item_id: 'food-oats', original_quantity: 60, original_unit: 'g' });
    expect(payload.quantity_multiplier).toBeCloseTo(0.6, 10);
  });
});
