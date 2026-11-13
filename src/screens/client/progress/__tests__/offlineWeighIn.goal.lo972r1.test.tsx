/**
 * LO-972R1 B1 (B-TEST): Progress V2 draws a weigh-in saved with no signal (C8 Style C v2, context main a9434a53:
 * planning/MOCKUP3/C8/style-c-v2/C2_offline_*, index-v2.md :232-233, :339 C8V2-S-29, :382 item 11 "Offline queue":
 * "warm card on the masthead, dashed pending ring and its callout, ring to dot when sent"). The drawing says, under
 * the chart, that the weigh-in is on this phone and goes to the coach when back online. At 5aee27f0 the weigh-in
 * counts in the trend with no mark at all, so this test fails there for that reason.
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

describe('LO-972R1 B1: Progress V2 shows a weigh-in saved with no signal as the C8 offline frames draw it', () => {
  it('after Save with no signal the page says the weigh-in is on this phone (GOAL C2_offline: the line under the chart)', async () => {
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
    await waitFor(() => expect(lastChart().data.filter((p) => p.y === 176.1)).toHaveLength(1));
    // The weigh-in counts at once (as built); the drawn waiting state names where it is.
    expect(v.queryAllByText(/this phone/i).length).toBeGreaterThan(0);
  });
});
