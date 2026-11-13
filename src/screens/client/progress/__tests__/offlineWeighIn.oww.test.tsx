/**
 * OFFLINE-WATER-WEIGHT-M (191-S5): a weigh-in saved with no signal, on Progress V2 (clientProgressV2 on) and on the
 * legacy Progress page (off), through the REAL queue, sync and client store.
 *   G1: Save with no signal queues one weigh-in dated the day it was logged; the sheet closes; the client is told it is
 *       saved on this phone ("Saved offline", food's alert); no "Couldn't log weight"; "{coach} sees it." is never shown
 *       for a weigh-in the coach cannot see yet; the trend counts it at once (featureFlags.offlineFoodInDay on).
 *   G2: the signal returns: one POST /weight whose client_uuid is the entry id; the history row carrying that key shows
 *       it once (joined by key, never by number or day).
 *   G6: the legacy page, the same.
 *   G7: the key an online try kept after a lost answer becomes the queue id.
 */
import React from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ProgressScreen from '../../ProgressScreen';
import { getTodayString } from '../../../../utils/date';
import { syncFoodLogQueue } from '../../../../services/foodLogSync';
import { useClientStore } from '../../../../store/clientStore';

const today = getTodayString();
const DAY = 86_400_000;
const ago = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);
const mockFlags = { v2: true };
const mockNet = { offline: false };
let mockRows: Array<{ id: string; date: string; weight_lbs: number; client_uuid?: string }> = [];
const mockLog = jest.fn(async (body: { weight_lbs: number; date?: string }, key?: string): Promise<unknown> => {
  if (mockNet.offline) throw new Error('Network Error');
  const row = { id: `g-${mockRows.length + 1}`, date: `${body.date}T00:00:00.000Z`, weight_lbs: body.weight_lbs, client_uuid: key };
  if (!mockRows.some((r) => r.client_uuid && r.client_uuid === key)) mockRows.push(row);
  return { data: row };
});
const mockHistory = jest.fn(async (): Promise<unknown> => {
  if (mockNet.offline) throw new Error('Network Error');
  return { data: { logs: mockRows } };
});
const mockTake = jest.fn((_data: unknown): string | undefined => undefined);
const mockChart = jest.fn();

jest.mock('../../../../services/api', () => ({
  weightApi: {
    getHistory: () => mockHistory(),
    log: (body: { weight_lbs: number; date?: string }, key?: string) => mockLog(body, key),
    takeKeptKey: (data: unknown) => mockTake(data),
  },
  workoutApi: { getAll: jest.fn(async () => ({ data: [] })) },
  logApi: { getDaily: jest.fn(async () => ({ data: {} })) },
  foodApi: { create: jest.fn() },
  waterApi: { log: jest.fn(), getDaily: jest.fn() },
}));
jest.mock('../../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'u1' }) }));
jest.mock('../../../../api/workoutBuilderApi', () => ({ workoutBuilderApi: { listMyAssignments: async () => [] } }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u1', coach_id: 'c1', profile: {} }) }));
jest.mock('../../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('../../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ coach_id: 'c1', name: 'Sam Rivera', timezone: null }] }) }));
jest.mock('../../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => ({ calories: 2000, protein: 150, carbs: 200, fat: 60 }) }));
jest.mock('@react-navigation/native', () => ({
  NavigationContext: require('react').createContext(undefined),
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../../config/featureFlags', () => ({
  __esModule: true,
  featureFlags: new Proxy({} as Record<string, boolean>, {
    get: (_t, key) => (key === 'clientProgressV2' ? mockFlags.v2 : key === 'offlineFoodInDay' || key === 'clientTimelineV2'),
  }),
}));
jest.mock('../../../../ui/haptics/haptics.service', () => {
  const fns: Record<string | symbol, jest.Mock> = {};
  return { HapticService: new Proxy(fns, { get: (t, k) => (t[k] ??= jest.fn()) }), setHapticsEnabled: jest.fn() };
});
jest.mock('../../wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('../../../../theme/ThemeProvider', () => {
  const tokens = require('../../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', colors: tokens.colors, semanticColors: tokens.lightTokens }) };
});
jest.mock('../../../../ui/charts/StyleCMarks', () => {
  const { createElement } = require('react');
  const { View } = require('react-native');
  return { PeakStar: () => createElement(View), SegmentedRing: () => createElement(View) };
});
jest.mock('../../../../components/progress/WeightTrendChartDark', () => (props: Record<string, unknown>) => {
  mockChart(props);
  return require('react').createElement(require('react-native').View, { testID: 'progress-weight-chart' });
});

const netinfo = jest.requireMock('@react-native-community/netinfo') as { __setState: (s: object) => void; __reset: () => void };
const setOffline = async (offline: boolean) => {
  mockNet.offline = offline;
  await act(async () => {
    netinfo.__setState({ isConnected: !offline, isInternetReachable: !offline });
  });
};
const lastChart = () => mockChart.mock.calls[mockChart.mock.calls.length - 1][0] as { data: { y: number }[] };
const queued = async () => JSON.parse((await AsyncStorage.getItem('pending_food_logs_u1')) ?? '[]') as Array<{ id: string; kind: string; log: object }>;

let alert: jest.SpyInstance;
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  netinfo.__reset();
  mockNet.offline = false;
  mockFlags.v2 = true;
  mockRows = [180, 178, 176].map((w, i) => ({ id: String(i), date: `${ago([20, 7, 1][i])}T00:00:00.000Z`, weight_lbs: w }));
  useClientStore.getState().reset();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => alert.mockRestore());

describe('Progress V2: a weigh-in saved with no signal', () => {
  it('G1, G2: queued and counted at once with no coach line; sent once with its id as key; shown once after the read', async () => {
    const v = await render(<ProgressScreen />);
    await waitFor(() => expect(v.getByText('lb trend')).toBeTruthy());
    await setOffline(true);
    await act(async () => {
      fireEvent.press(v.getByLabelText('Log weight'));
    });
    await act(async () => {
      fireEvent.press(v.getByLabelText('0.1 lb more'));
    });
    await act(async () => {
      fireEvent.press(v.getByLabelText('Save weight log entry'));
    });
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Saved offline', 'Your weigh-in will sync when you reconnect.'));
    expect(alert).not.toHaveBeenCalledWith("Couldn't log weight", expect.anything());
    expect(mockLog).not.toHaveBeenCalled();
    const q = await queued();
    expect(q).toEqual([expect.objectContaining({ kind: 'weight', log: { date: today, weight_lbs: 176.1 } })]);
    expect(v.getByTestId('log-weight-modal').props.visible).toBe(false);
    expect(v.queryByText('Weigh-in saved')).toBeNull();
    expect(v.queryByText(/sees it\./)).toBeNull();
    await waitFor(() => expect(lastChart().data.filter((p) => p.y === 176.1)).toHaveLength(1));

    await setOffline(false);
    await act(async () => {
      await syncFoodLogQueue();
    });
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ weight_lbs: 176.1, date: today }), q[0].id);
    expect(mockRows.filter((r) => r.client_uuid === q[0].id)).toHaveLength(1);
    await waitFor(() => expect(useClientStore.getState().sentWaterWeight).toHaveLength(0));
    expect(lastChart().data.filter((p) => p.y === 176.1)).toHaveLength(1);
    expect(await queued()).toHaveLength(0);
  });

  it('G7: the key an online try of this weigh-in kept after a lost answer is the queue id', async () => {
    mockTake.mockReturnValueOnce('kept-key-1');
    const v = await render(<ProgressScreen />);
    await waitFor(() => expect(v.getByText('lb trend')).toBeTruthy());
    await setOffline(true);
    await act(async () => {
      fireEvent.press(v.getByLabelText('Log weight'));
    });
    await act(async () => {
      fireEvent.press(v.getByLabelText('Save weight log entry'));
    });
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Saved offline', 'Your weigh-in will sync when you reconnect.'));
    expect(mockTake).toHaveBeenCalledWith({ weight_lbs: 176, date: today, notes: undefined });
    expect((await queued()).map((x) => x.id)).toEqual(['kept-key-1']);
  });
});

describe('legacy Progress page (clientProgressV2 off): a weigh-in saved with no signal', () => {
  it('G6: queued, "Saved offline", no "Couldn\'t log weight", listed once; sent once with its id as key', async () => {
    mockFlags.v2 = false;
    const v = await render(<ProgressScreen />);
    await waitFor(() => expect(mockHistory).toHaveBeenCalled());
    await setOffline(true);
    await act(async () => {
      fireEvent.press(await v.findByLabelText('Log weight'));
    });
    await act(async () => {
      fireEvent.changeText(v.getByLabelText('Enter weight in pounds'), '190.4');
    });
    await act(async () => {
      fireEvent.press(v.getByLabelText('Save weight log entry'));
    });
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Saved offline', 'Your weigh-in will sync when you reconnect.'));
    expect(alert).not.toHaveBeenCalledWith("Couldn't log weight", expect.anything());
    expect(mockLog).not.toHaveBeenCalled();
    const q = await queued();
    expect(q).toEqual([expect.objectContaining({ kind: 'weight', log: { date: today, weight_lbs: 190.4 } })]);
    await waitFor(() => expect(v.getAllByText(/190\.4/).length).toBeGreaterThan(0));

    await setOffline(false);
    await act(async () => {
      await syncFoodLogQueue();
    });
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ weight_lbs: 190.4, date: today }), q[0].id);
    await waitFor(() => expect(useClientStore.getState().sentWaterWeight).toHaveLength(0));
    expect(await queued()).toHaveLength(0);
  });
});
