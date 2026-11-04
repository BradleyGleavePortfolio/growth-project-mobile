/**
 * LO-FOOD B5 (audit of mobile main 585616c8): the Food log's day is the shared
 * store's selectedDate, set once when the store is created (clientStore.ts:47)
 * and read by LogScreen only on mount (LogScreen.tsx:154-158). Nothing on the
 * Food tab re-reads "today" when the app returns to the foreground; Home does
 * (HomeScreen.tsx:309-322) only while Home is focused. A client who leaves the
 * app on the Food tab at night and opens it the next morning logs breakfast to
 * yesterday. Real screen, store and submitter; only the network is mocked.
 */
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import LogScreen from '../LogScreen';
import { foodApi, logApi, waterApi } from '../../../services/api';
import { useClientStore } from '../../../store/clientStore';

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
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { getDaily: jest.fn(), logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn() },
  waterApi: { getDaily: jest.fn(), log: jest.fn() },
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
  // Only the clock is faked; timers stay real so the search debounce runs.
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
      'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'hrtime', 'performance'],
  });
  jest.setSystemTime(new Date(2026, 9, 29, 22, 30)); // Thursday 10:30 pm, local time
  useClientStore.getState().reset();
  jest.mocked(waterApi.getDaily).mockResolvedValue({ ...ok, data: { total_ml: 0 } });
  jest.mocked(foodApi.search).mockResolvedValue({ ...ok, data: { results: [oats] } });
  jest.mocked(logApi.getDaily).mockResolvedValue({ ...ok, data: { entries: [] } });
  jest.mocked(logApi.logFood).mockResolvedValue(ok);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('LO-FOOD B5 the Food log after midnight', () => {
  it('a breakfast logged the next morning on a Food tab left open overnight is saved to today', async () => {
    await render(<LogScreen />);
    expect(useClientStore.getState().selectedDate).toBe('2026-10-29');

    // The phone sleeps on the Food tab; the client opens the app at 8 am Friday.
    jest.setSystemTime(new Date(2026, 9, 30, 8, 0));
    await act(async () => {
      appStateListeners.forEach((h) => h('background'));
      appStateListeners.forEach((h) => h('active'));
    });

    await act(async () => {
      fireEvent.press(screen.getAllByText('Add food')[0]);
    });
    await fireEvent.changeText(screen.getByPlaceholderText('Search foods...'), 'oats');
    await fireEvent.press(await screen.findByText('Rolled oats', {}, { timeout: 3000 }));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
    });

    await waitFor(() => expect(logApi.logFood).toHaveBeenCalledTimes(1));
    expect(jest.mocked(logApi.logFood).mock.calls[0][0]).toMatchObject({ date: '2026-10-30' });
  });
});
