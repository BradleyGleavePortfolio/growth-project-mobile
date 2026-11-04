import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import LogScreen from '../LogScreen';
import { logApi } from '../../../services/api';
import { addDays, getTodayString } from '../../../utils/date';
import { forgetSaveKeys } from '../../../utils/log/saveKey';

const mockDay = getTodayString();
const mockYesterday = addDays(mockDay, -1);
const mockStore = {
  selectedDate: mockDay, selectedOn: mockDay, foodLogs: [], hasLoadedDay: true,
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 }, waterOz: 0,
  isLoading: false, loadError: null, setSelectedDate: jest.fn(),
  loadDayData: jest.fn(async () => undefined), refreshShownDay: jest.fn(async () => undefined),
  logWater: jest.fn(), removeFoodLogLocally: jest.fn(),
};
let mockPastRows: Array<Record<string, unknown>> = [];
const mockSaved = new Map<string, Record<string, unknown>>();
let mockLoseAt = 1;
let mockAttempt = 0;

jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  return { ...real, featureFlags: { ...real.featureFlags, foodPlanChecklist: false } };
});
jest.mock('../../../store/clientStore', () => ({ useClientStore: () => mockStore }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'viewer' }) }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({}), isEffectivelyOnline: () => true,
}));
jest.mock('../../../hooks/useFoodLogQueueSync', () => ({ usePendingFoodLogCount: () => 0 }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../services/api', () => ({
  __esModule: true, default: { get: jest.fn(async () => ({ data: {} })) },
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: {
    getDaily: jest.fn(async (date: string) => ({
      data: { entries: date === mockYesterday ? mockPastRows : [] },
    })),
    logFood: jest.fn(async (body: Record<string, unknown>) => {
      const key = String(body.client_uuid);
      if (!mockSaved.has(key)) mockSaved.set(key, { ...body, id: key });
      if (++mockAttempt === mockLoseAt) throw new Error('Answer lost after food was stored');
      return { data: mockSaved.get(key) };
    }),
    updateEntry: jest.fn(), deleteEntry: jest.fn(),
  },
}));
jest.mock('../../../services/foodLogQueue', () => ({ flush: jest.fn() }));
jest.mock('../../../services/foodLogSync', () => ({ notifyPendingFoodLogs: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  forgetSaveKeys();
  mockSaved.clear();
  mockAttempt = 0;
  mockLoseAt = 1;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it.each([
  { name: 'older food with no original portion', basis: 'PER_100G', quantity: 0.6, original: null, unit: null, copies: 1, loseAt: 1 },
  { name: 'custom food whose nutrition describes two servings', basis: 'PER_SERVING', quantity: 1, original: 2, unit: 'serving', copies: 1, loseAt: 1 },
  { name: 'second identical food in a repeated meal', basis: 'PER_100G', quantity: 0.6, original: 60, unit: 'g', copies: 2, loseAt: 2 },
])('LS-916R2 B1: $name recovers once through the real Recent portion', async (c) => {
  mockLoseAt = c.loseAt;
  mockPastRows = Array.from({ length: c.copies }, (_, index) => ({
    id: `past-${index}`, meal_type: 'breakfast', food_item_id: 'oats',
    quantity_multiplier: c.quantity, original_quantity: c.original, original_unit: c.unit,
    food_item: {
      id: 'oats', name: 'Oats', calories: 100, protein_g: 4, carbs_g: 15, fat_g: 2,
      nutrient_basis: c.basis, serving_size_grams: 100, supports_volume_units: false,
    },
  }));
  // No useFoodBrowse mock: stored entry -> real last-portion conversion -> picker -> save.
  await render(<LogScreen />);
  await fireEvent.press(screen.getAllByText('Add food')[0]);
  await fireEvent.press(await screen.findByText('Add all'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(
    expect.any(String), expect.stringContaining('then add it from Recent.'),
  ));
  expect(mockSaved.size).toBe(c.copies);
  await fireEvent.press(await screen.findByText('Oats'));
  await fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
  await waitFor(() => expect(logApi.logFood).toHaveBeenCalledTimes(c.copies + 1));
  expect(mockSaved.size).toBe(c.copies);
});
