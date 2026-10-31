/**
 * FOOD-1-M R2 (operator ruling, the owner's S1): a food or water log keeps the day on screen at the
 * tap; a Food tab left open past midnight moves to the new day before it takes the next log. Real
 * screen, store and submitters; only the network and the clock are faked. LO-FOOD B5
 * (LogScreen.loFoodNextMorning.test.tsx) covers a searched food after the app comes back.
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
  waterApi: { getDaily: jest.fn(), log: jest.fn(), deleteEntry: jest.fn() },
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

const appStateListeners = new Set<(s: AppStateStatus) => void>();
const ok: AxiosResponse = { data: {}, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } };

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

async function addManualFood() {
  await act(async () => {
    fireEvent.press(screen.getAllByText('Add food')[0]);
  });
  await fireEvent.press(await screen.findByText('Enter manually'));
  await fireEvent.changeText(screen.getByPlaceholderText('Food name'), 'Breakfast bowl');
  for (const [index, value] of ['400', '25', '45', '13'].entries()) {
    await fireEvent.changeText(screen.getAllByPlaceholderText('0')[index], value);
  }
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
  });
  await waitFor(() => expect(logApi.logFood).toHaveBeenCalledTimes(1));
  return jest.mocked(logApi.logFood).mock.calls[0][0];
}

describe('FOOD-1-M R2 the Food tab after midnight', () => {
  it('a food entered by hand on a tab left open overnight, with no app switch, is saved to the new day', async () => {
    await render(<LogScreen />);
    nextMorning();
    expect(await addManualFood()).toMatchObject({ date: '2026-10-30' });
    expect(useClientStore.getState().selectedDate).toBe('2026-10-30');
  });

  it('a glass of water added on a tab left open overnight is saved to the new day', async () => {
    await render(<LogScreen />);
    nextMorning();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Add 8 ounces of water'));
    });
    await waitFor(() => expect(waterApi.log).toHaveBeenCalledTimes(1));
    expect(jest.mocked(waterApi.log).mock.calls[0][0]).toMatchObject({ date: '2026-10-30' });
    expect(useClientStore.getState().selectedDate).toBe('2026-10-30');
  });

  it('coming back to the app after midnight moves the shown day to the new day and reads it', async () => {
    await render(<LogScreen />);
    nextMorning();
    await act(async () => {
      appStateListeners.forEach((h) => h('background'));
      appStateListeners.forEach((h) => h('active'));
    });
    expect(useClientStore.getState().selectedDate).toBe('2026-10-30');
    await waitFor(() => expect(logApi.getDaily).toHaveBeenCalledWith('2026-10-30'));
  });

  it('a day the member chose before midnight stays chosen: its log goes to that day', async () => {
    await render(<LogScreen />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Previous day'));
    });
    expect(useClientStore.getState().selectedDate).toBe('2026-10-28');
    nextMorning();
    await act(async () => {
      appStateListeners.forEach((h) => h('active'));
    });
    expect(await addManualFood()).toMatchObject({ date: '2026-10-28' });
  });
});
