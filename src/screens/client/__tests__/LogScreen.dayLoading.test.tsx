import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import LogScreen from '../LogScreen';
import { logApi, waterApi } from '../../../services/api';
import { useClientStore } from '../../../store/clientStore';

jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client' }) }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({}), isEffectivelyOnline: () => true,
}));
jest.mock('../../../hooks/useFoodLogQueueSync', () => ({ usePendingFoodLogCount: () => 0 }));
jest.mock('../../../hooks/useFoodBrowse', () => ({
  useFoodBrowse: () => ({
    recentFoods: [], frequentFoods: [], lastMeals: {}, loadBrowseFoods: jest.fn(),
  }),
}));
jest.mock('../../../services/foodLogSync', () => ({ syncFoodLogQueue: jest.fn() }));
jest.mock('../../../services/api', () => ({
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { getDaily: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn() },
  waterApi: { getDaily: jest.fn(), log: jest.fn() },
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../utils/logger', () => ({ logger: { error: jest.fn() } }));

const date = '2026-10-06';
const ok: AxiosResponse = {
  data: {}, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() },
};
const foodDay = {
  ...ok,
  data: {
    entries: [{
      id: 'entry', user_id: 'client', food_item_id: 'oats', meal_type: 'breakfast',
      quantity_multiplier: 1, food_item: { id: 'oats', name: 'Rolled oats', calories: 420 },
    }],
    total_calories: 420,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  useClientStore.getState().reset();
  useClientStore.getState().setSelectedDate(date);
  jest.mocked(logApi.getDaily).mockResolvedValue(foodDay);
  jest.mocked(waterApi.getDaily).mockResolvedValue({ ...ok, data: { total_ml: 591.47 } });
});

it('shows a skeleton, not zero totals or empty-meal claims, until the first day arrives', async () => {
  let resolveDay: ((value: AxiosResponse) => void) | undefined;
  jest.mocked(logApi.getDaily).mockReturnValue(new Promise((resolve) => { resolveDay = resolve; }));
  await render(<LogScreen />);
  expect(screen.getByTestId('log-day-loading')).toBeTruthy();
  expect(screen.queryByText('Calories eaten')).toBeNull();
  expect(screen.queryByText(/No foods logged/)).toBeNull();
  expect(screen.queryByText(/Water/)).toBeNull();
  expect(screen.getByLabelText('Previous day')).toBeTruthy();
  await act(async () => resolveDay?.(foodDay));
  expect(screen.queryByTestId('log-day-loading')).toBeNull();
  expect(screen.getByText('Rolled oats')).toBeTruthy();
  expect(screen.getByText('Calories eaten')).toBeTruthy();
});

it('removes old foods and numbers on a day change, then offers retry and all meal actions after failure', async () => {
  await render(<LogScreen />);
  expect(await screen.findByText('Rolled oats')).toBeTruthy();
  let rejectDay: ((error: Error) => void) | undefined;
  jest.mocked(logApi.getDaily).mockReturnValueOnce(new Promise((_resolve, reject) => { rejectDay = reject; }));
  await fireEvent.press(screen.getByLabelText('Previous day'));
  expect(useClientStore.getState().selectedDate).toBe('2026-10-05');
  expect(screen.getByTestId('log-day-loading')).toBeTruthy();
  expect(screen.queryByText('Rolled oats')).toBeNull();
  expect(screen.queryByText('Calories eaten')).toBeNull();
  await act(async () => rejectDay?.(new Error('Network Error')));
  expect(screen.queryByTestId('log-day-loading')).toBeNull();
  expect(screen.getByTestId('log-day-data-error')).toBeTruthy();
  expect(screen.queryByText(/No foods logged/)).toBeNull();
  expect(screen.queryByText('Calories eaten')).toBeNull();
  expect(screen.getAllByText(/^Add food$/i)).toHaveLength(4);
  await fireEvent.press(screen.getByTestId('log-day-data-error-retry'));
  await waitFor(() => expect(screen.getByText('Rolled oats')).toBeTruthy());
  expect(logApi.getDaily).toHaveBeenLastCalledWith('2026-10-05');
});

it('shows one empty-day instruction only after a successful empty read', async () => {
  jest.mocked(logApi.getDaily).mockResolvedValue({ ...ok, data: { entries: [] } });
  await render(<LogScreen />);
  expect(await screen.findAllByText(/No foods logged/)).toHaveLength(1);
  expect(screen.getAllByText(/^Add food$/i)).toHaveLength(4);
});

it('retains verified foods and totals while refreshing the same day', async () => {
  await render(<LogScreen />);
  expect(await screen.findByText('Rolled oats')).toBeTruthy();
  let resolveDay: ((value: AxiosResponse) => void) | undefined;
  jest.mocked(logApi.getDaily).mockReturnValueOnce(new Promise((resolve) => { resolveDay = resolve; }));
  let reload: Promise<void> | undefined;
  await act(async () => { reload = useClientStore.getState().loadDayData('client', date); });
  expect(screen.queryByTestId('log-day-loading')).toBeNull();
  expect(screen.getByText('Rolled oats')).toBeTruthy();
  expect(screen.getByText('Calories eaten')).toBeTruthy();
  await act(async () => {
    resolveDay?.(foodDay);
    await reload;
  });
});
