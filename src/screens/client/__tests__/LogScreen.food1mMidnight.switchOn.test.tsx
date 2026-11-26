/**
 * ALL-ON-GREEN-M (R1, R3): the switch-on proof of LogScreen.food1mMidnight.test.tsx and
 * LogScreen.ls916-zone-change.test.tsx (both hold the same FOOD-1-M R2 cases). Those files pin
 * featureFlags.foodPlanChecklist off and prove the classic Food log; this file pins it on and proves the same
 * promises on the Style C day (FoodDayView): a food or a glass logged on a Food tab left open past midnight goes
 * to the new day, coming back moves the day, a day chosen before midnight keeps its log, and a live zone change
 * logs water to the new local day. Real screen, store and submitters; only the network and the clock are faked.
 */
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import LogScreen from '../LogScreen';
import { foodApi, logApi, waterApi } from '../../../services/api';
import { useClientStore } from '../../../store/clientStore';

jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  return { ...real, featureFlags: { ...real.featureFlags, foodPlanChecklist: true } };
});
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }), useFocusEffect: jest.fn() }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client' }) }));
jest.mock('../../../services/firstWinApi', () => ({ firstWinApi: { complete: jest.fn() } }));
jest.mock('../../../lib/packagePromptGate', () => ({ shouldOfferPackagePrompt: async () => false }));
jest.mock('../../../components/PackageSelectionSheet', () => () => null);
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
  __esModule: true,
  // The Style C day's own read: the day's workout from Train (none here).
  default: { get: jest.fn(async () => ({ data: { items: [], nextCursor: null } })) },
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { getDaily: jest.fn(), logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn() },
  waterApi: { getDaily: jest.fn(), log: jest.fn(), deleteEntry: jest.fn() },
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

const appStateListeners = new Set<(s: AppStateStatus) => void>();
const ok: AxiosResponse = { data: {}, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } };
const oats = {
  id: 'oats', name: 'Rolled oats', calories: 379, protein_g: 13, carbs_g: 68, fat_g: 6.5,
  serving_size_grams: 40, nutrient_basis: 'PER_100G' as const, supports_volume_units: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  appStateListeners.clear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateListeners.add(handler as (s: AppStateStatus) => void);
    return { remove: () => appStateListeners.delete(handler as (s: AppStateStatus) => void) } as ReturnType<typeof AppState.addEventListener>;
  });
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
      'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'hrtime', 'performance'],
  });
  jest.setSystemTime(new Date(2026, 9, 29, 22, 30)); // Thursday 10:30 pm, local time
  useClientStore.getState().reset();
  jest.mocked(waterApi.getDaily).mockResolvedValue({ ...ok, data: { total_ml: 0 } });
  jest.mocked(logApi.getDaily).mockResolvedValue({ ...ok, data: { entries: [] } });
  jest.mocked(logApi.logFood).mockResolvedValue(ok);
  jest.mocked(foodApi.create).mockResolvedValue({ ...ok, data: { id: 'custom' } });
  jest.mocked(waterApi.log).mockResolvedValue({ ...ok, data: { id: 'glass', amount_ml: 237, logged_at: '2026-10-30T15:00:00.000Z' } });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const nextMorning = () => jest.setSystemTime(new Date(2026, 9, 30, 8, 0));
const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <LogScreen />
  </QueryClientProvider>,
);

/** The Style C day is drawn once its first reads settle (FoodDayView's skeleton goes). */
async function styleCDay() {
  expect(await screen.findByTestId('food-day-masthead')).toBeTruthy();
  expect(screen.queryByText('Food log')).toBeNull();
}

async function fillManualAndLog() {
  await fireEvent.changeText(await screen.findByPlaceholderText('Food name'), 'Breakfast bowl');
  for (const [index, value] of ['400', '25', '45', '13'].entries()) {
    await fireEvent.changeText(screen.getAllByPlaceholderText('0')[index], value);
  }
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
  });
  await waitFor(() => expect(logApi.logFood).toHaveBeenCalledTimes(1));
  return jest.mocked(logApi.logFood).mock.calls[0][0];
}

describe('FOOD-1-M R2 the Food tab after midnight, on the Style C day', () => {
  it('a food entered by hand on a tab left open overnight, with no app switch, is saved to the new day', async () => {
    await show();
    await styleCDay();
    nextMorning();
    // C_first's Enter manually (FoodDayView.tsx:338) opens the same sheet on its manual form.
    await act(async () => {
      fireEvent.press(screen.getByTestId('food-day-first-manual'));
    });
    expect(await fillManualAndLog()).toMatchObject({ date: '2026-10-30' });
    expect(useClientStore.getState().selectedDate).toBe('2026-10-30');
  });

  it('a glass of water added on a tab left open overnight is saved to the new day', async () => {
    await show();
    await styleCDay();
    nextMorning();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Add 8 ounces of water'));
    });
    await waitFor(() => expect(waterApi.log).toHaveBeenCalledTimes(1));
    expect(jest.mocked(waterApi.log).mock.calls[0][0]).toMatchObject({ date: '2026-10-30' });
    expect(useClientStore.getState().selectedDate).toBe('2026-10-30');
  });

  it('coming back to the app after midnight moves the shown day to the new day and reads it', async () => {
    await show();
    await styleCDay();
    nextMorning();
    await act(async () => {
      appStateListeners.forEach((h) => h('background'));
      appStateListeners.forEach((h) => h('active'));
    });
    expect(useClientStore.getState().selectedDate).toBe('2026-10-30');
    await waitFor(() => expect(logApi.getDaily).toHaveBeenCalledWith('2026-10-30'));
  });

  it('a day the member chose before midnight stays chosen: its log goes to that day', async () => {
    // A usual breakfast (the same food on two days before 10-28), so 10-28 draws the Style C usual day,
    // not the classic fallback of a day with nothing (FoodDayView.tsx:234).
    const breakfast = { id: 'b', food_item_id: 'oats', meal_type: 'breakfast', quantity_multiplier: 1, food_item: oats };
    jest.mocked(logApi.getDaily).mockImplementation(async (date: string) => (
      { ...ok, data: { entries: date === '2026-10-26' || date === '2026-10-27' ? [breakfast] : [] } }));
    await show();
    await styleCDay();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Previous day'));
    });
    expect(useClientStore.getState().selectedDate).toBe('2026-10-28');
    expect(await screen.findByText('Your usual day')).toBeTruthy();
    nextMorning();
    await act(async () => {
      appStateListeners.forEach((h) => h('active'));
    });
    // Another day has no now line: its Add sits under the day (FoodDayView.tsx:500).
    await act(async () => {
      fireEvent.press(screen.getByTestId('food-day-add'));
    });
    await fireEvent.press(await screen.findByText('Quick add'));
    expect(await fillManualAndLog()).toMatchObject({ date: '2026-10-28' });
  });
});

it('LS-916 B5: the Style C Food tab logs water to the new local day after a live UTC-to-Tokyo zone change', async () => {
  // The lane's UTC process starts the date module's default formatter in UTC.
  jest.setSystemTime(new Date('2026-10-29T18:30:00Z'));
  useClientStore.getState().reset();
  expect(useClientStore.getState().selectedDate).toBe('2026-10-29');
  await show();
  await styleCDay();
  const DateTimeFormat = Intl.DateTimeFormat;
  jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(((locale, options) =>
    new DateTimeFormat(locale, { ...options, timeZone: options?.timeZone ?? 'Asia/Tokyo' })
  ) as typeof Intl.DateTimeFormat);
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Add 8 ounces of water'));
  });
  await waitFor(() => expect(waterApi.log).toHaveBeenCalledTimes(1));
  expect(jest.mocked(waterApi.log).mock.calls[0][0]).toMatchObject({ date: '2026-10-30' });
  expect(useClientStore.getState().selectedDate).toBe('2026-10-30');
});
