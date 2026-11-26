/**
 * ALL-ON-GREEN-M (R1, R3): the switch-on proof of LogScreen.dayLoading.test.tsx. That file pins
 * featureFlags.foodPlanChecklist off and proves the classic Food log; this file pins it on and proves the same day
 * promises on the Style C day (FoodDayView): its skeleton until the first day arrives, no old foods while another day
 * loads, the classic log's retry when a day cannot be read (FoodDayView.tsx:222), the day kept while it refreshes,
 * and the water card the Style C day draws: a removal is confirmed and changes only water, a failed one keeps the
 * glass, and a glass just added is removable and went to the day shown. Real screen and store; only the network is
 * mocked. The week before today is empty, so today draws the Style C first day (C_first).
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import LogScreen from '../LogScreen';
import { logApi, waterApi } from '../../../services/api';
import { useClientStore } from '../../../store/clientStore';
import { addDays, getTodayString } from '../../../utils/date';

// A fixed clock, never the real date (FIX-930R2 LO-930R2 B1 class). Only Date is faked (and keeps ticking).
jest.useFakeTimers({ now: new Date('2026-11-05T12:00:00'), advanceTimers: true, doNotFake: ['nextTick', 'setImmediate',
  'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime',
  'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());

jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  return { ...real, featureFlags: { ...real.featureFlags, foodPlanChecklist: true } };
});
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }), useFocusEffect: jest.fn() }));
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
  __esModule: true,
  // The Style C day's own read: the day's workout from Train (none here).
  default: { get: jest.fn(async () => ({ data: { items: [], nextCursor: null } })) },
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { getDaily: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn() },
  waterApi: { getDaily: jest.fn(), log: jest.fn(), deleteEntry: jest.fn() },
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../utils/logger', () => ({ logger: { error: jest.fn() } }));

const date = getTodayString();
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
const emptyDay = { ...ok, data: { entries: [] } };
const waterEntries = [
  { id: 'water-1', amount_ml: 237, logged_at: `${date}T00:00:00.000Z` },
  { id: 'water-2', amount_ml: 473, logged_at: `${date}T00:00:00.000Z` },
];
/** Today has the oats; every other day (the week the Style C day reads) is empty, unless a test holds a day. */
const days = new Map<string, Promise<AxiosResponse>>();

beforeEach(() => {
  jest.clearAllMocks();
  days.clear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  useClientStore.getState().reset();
  useClientStore.getState().setSelectedDate(date);
  jest.mocked(logApi.getDaily).mockImplementation((d: string) => days.get(d) ?? Promise.resolve(d === date ? foodDay : emptyDay));
  jest.mocked(waterApi.getDaily).mockResolvedValue({ ...ok, data: { total_ml: 591.47 } });
});

afterEach(() => jest.restoreAllMocks());

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <LogScreen />
  </QueryClientProvider>,
);

it('shows the Style C skeleton, not empty-meal claims, until the first day arrives', async () => {
  let resolveDay: ((value: AxiosResponse) => void) | undefined;
  days.set(date, new Promise((resolve) => { resolveDay = resolve; }));
  await show();
  expect(screen.getByTestId('food-day-loading')).toBeTruthy();
  expect(screen.getByLabelText("Loading today's meals")).toBeTruthy();
  expect(screen.queryByText('Nothing yet')).toBeNull();
  expect(screen.queryByText(/No foods logged/)).toBeNull();
  expect(screen.queryByText(/Water/)).toBeNull();
  await act(async () => resolveDay?.(foodDay));
  await waitFor(() => expect(screen.queryByTestId('food-day-loading')).toBeNull());
  expect(await screen.findByText('Rolled oats')).toBeTruthy();
  expect(screen.getByTestId('food-day-masthead')).toBeTruthy();
});

it('removes old foods on a day change, then offers retry and all meal actions after failure', async () => {
  await show();
  expect(await screen.findByText('Rolled oats')).toBeTruthy();
  const yesterday = addDays(date, -1);
  let rejectDay: ((error: Error) => void) | undefined;
  days.set(yesterday, new Promise((_resolve, reject) => { rejectDay = reject; }));
  await fireEvent.press(screen.getByLabelText('Previous day'));
  expect(useClientStore.getState().selectedDate).toBe(yesterday);
  expect(screen.getByTestId('food-day-loading')).toBeTruthy();
  expect(screen.queryByText('Rolled oats')).toBeNull();
  days.delete(yesterday);
  await act(async () => rejectDay?.(new Error('Network Error')));
  // The day itself could not load: the Style C day hands over to the classic log and its retry.
  expect(await screen.findByTestId('log-day-data-error')).toBeTruthy();
  expect(screen.queryByTestId('food-day-loading')).toBeNull();
  expect(screen.queryByText(/No foods logged/)).toBeNull();
  expect(screen.getAllByText(/^Add food$/i)).toHaveLength(4);
  days.set(yesterday, Promise.resolve(foodDay));
  await fireEvent.press(screen.getByTestId('log-day-data-error-retry'));
  await waitFor(() => expect(screen.getByText('Rolled oats')).toBeTruthy());
  expect(logApi.getDaily).toHaveBeenCalledWith(yesterday);
});

it('shows each meal as Nothing yet only after a successful empty read', async () => {
  days.set(date, Promise.resolve(emptyDay));
  await show();
  expect(await screen.findAllByText('Nothing yet')).toHaveLength(3);
  expect(screen.queryByText(/No foods logged/)).toBeNull();
});

it('retains verified foods while refreshing the same day', async () => {
  await show();
  expect(await screen.findByText('Rolled oats')).toBeTruthy();
  let resolveDay: ((value: AxiosResponse) => void) | undefined;
  days.set(date, new Promise((resolve) => { resolveDay = resolve; }));
  let reload: Promise<void> | undefined;
  await act(async () => { reload = useClientStore.getState().loadDayData('client', date); });
  expect(screen.queryByTestId('food-day-loading')).toBeNull();
  expect(screen.getByText('Rolled oats')).toBeTruthy();
  await act(async () => {
    resolveDay?.(foodDay);
    await reload;
  });
  expect(screen.getByText('Rolled oats')).toBeTruthy();
});

it('confirms water removal, keeps the entry while pending, and updates only water on success', async () => {
  jest.mocked(waterApi.getDaily).mockResolvedValue({ ...ok, data: { total_ml: 710, logs: waterEntries } });
  let resolveDelete: ((value: AxiosResponse) => void) | undefined;
  jest.mocked(waterApi.deleteEntry).mockReturnValue(new Promise((resolve) => { resolveDelete = resolve; }));
  await show();
  await screen.findByTestId('food-day-masthead');
  await fireEvent.press(await screen.findByTestId('remove-water-water-2'));
  expect(Alert.alert).toHaveBeenLastCalledWith(
    'Remove water entry?', expect.any(String),
    expect.arrayContaining([expect.objectContaining({ text: 'Cancel', style: 'cancel' })]),
  );
  expect(waterApi.deleteEntry).not.toHaveBeenCalled();
  const remove = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find((button) => button.text === 'Remove');
  await act(async () => { remove?.onPress?.(); });
  expect(waterApi.deleteEntry).toHaveBeenCalledWith('water-2');
  expect(useClientStore.getState().waterOz).toBe(24);
  expect(screen.getByTestId('remove-water-water-1').props.accessibilityState.disabled).toBe(true);
  await act(async () => resolveDelete?.({ ...ok, data: { id: 'water-2', deleted: true } }));
  await waitFor(() => expect(screen.queryByTestId('remove-water-water-2')).toBeNull());
  expect(useClientStore.getState()).toMatchObject({
    selectedDate: date, waterOz: 8, waterEntries: [waterEntries[0]],
    dailyTotals: { calories: 420 }, foodLogs: [expect.objectContaining({ id: 'entry' })],
  });
  expect(screen.getByText('Rolled oats')).toBeTruthy();
  for (const meal of ['breakfast', 'lunch', 'dinner']) expect(screen.getByTestId(`food-day-first-${meal}`)).toBeTruthy();
  expect(screen.getByLabelText('Previous day')).toBeTruthy();
});

it('keeps saved water and its total after a failed removal, and permits another attempt', async () => {
  jest.mocked(waterApi.getDaily).mockResolvedValue({ ...ok, data: { total_ml: 710, logs: waterEntries } });
  jest.mocked(waterApi.deleteEntry).mockRejectedValueOnce(new Error('Offline'));
  await show();
  await screen.findByTestId('food-day-masthead');
  await fireEvent.press(await screen.findByTestId('remove-water-water-1'));
  const remove = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find((button) => button.text === 'Remove');
  await act(async () => { await remove?.onPress?.(); });
  expect(Alert.alert).toHaveBeenLastCalledWith(
    "Couldn't remove water", 'The water entry could not be removed. Check the connection and try again.',
  );
  expect(useClientStore.getState()).toMatchObject({ waterOz: 24, waterEntries });
  expect(screen.getByTestId('remove-water-water-1').props.accessibilityState.disabled).toBe(false);
});

it('makes a newly saved quick add removable without another day read, and clears entries on day change/reset', async () => {
  const newEntry = { id: 'water-new', amount_ml: 237, logged_at: `${date}T00:00:00.000Z` };
  jest.mocked(waterApi.log).mockResolvedValue({ ...ok, data: newEntry });
  await show();
  await screen.findByText('Rolled oats');
  await fireEvent.press(screen.getByLabelText('Add 8 ounces of water'));
  await screen.findByTestId('remove-water-water-new');
  expect(waterApi.log).toHaveBeenCalledWith({ date, amount_ml: 237 }, expect.stringMatching(/^pfl_/));
  await act(async () => useClientStore.getState().setSelectedDate(addDays(date, -1)));
  expect(useClientStore.getState().waterEntries).toEqual([]);
  await act(async () => useClientStore.setState({ waterEntries: [newEntry] }));
  await act(async () => useClientStore.getState().reset());
  expect(useClientStore.getState().waterEntries).toEqual([]);
});
