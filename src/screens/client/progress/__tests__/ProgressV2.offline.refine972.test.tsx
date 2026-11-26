/**
 * REFINE-972 (m#972, B1): the drawn offline weigh-in on Progress V2, as C8 Style C v2 draws it
 * (planning/MOCKUP3/C8/style-c-v2/C2_offline_ios390_100.png, _ios390_130, _android360_100, _android360_130 at context
 * main a9434a53; index-v2.md and index.md lines quoted beside each case). Harness: offlineWeighIn.oww.test.tsx's, with
 * the coach, the switch and the history's read-back made settable. The chart is mocked: what it is handed (the samples,
 * the line under the chart) is read from its props; what it draws is WeightTrendChartDark.refine972.test.tsx's.
 */
import React from 'react';
import { AccessibilityInfo, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ProgressScreen from '../../ProgressScreen';
import { getTodayString } from '../../../../utils/date';
import { syncFoodLogQueue } from '../../../../services/foodLogSync';
import { useClientStore } from '../../../../store/clientStore';

const today = getTodayString();
const DAY = 86_400_000;
const ago = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);
const mockFlags = { v2: true, inDay: true };
const mockNet = { offline: false };
/** The coach as the page reads it: a coach (Sam), coachless, or not read yet (undefined data). */
const mockCoach = { coachless: false, coaches: [{ coach_id: 'c1', name: 'Sam Rivera', timezone: null }] as unknown[] | undefined };
/** The history read leaves out rows sent from this phone (a weigh-in sent, not read back yet). */
const mockHist = { holdBack: false };
let mockRows: Array<{ id: string; date: string; weight_lbs: number; client_uuid?: string }> = [];
const mockLog = jest.fn(async (body: { weight_lbs: number; date?: string }, key?: string): Promise<unknown> => {
  if (mockNet.offline) throw new Error('Network Error');
  const row = { id: `g-${mockRows.length + 1}`, date: `${body.date}T00:00:00.000Z`, weight_lbs: body.weight_lbs, client_uuid: key };
  if (!mockRows.some((r) => r.client_uuid && r.client_uuid === key)) mockRows.push(row);
  return { data: row };
});
const mockHistory = jest.fn(async (): Promise<unknown> => {
  if (mockNet.offline) throw new Error('Network Error');
  return { data: { logs: mockHist.holdBack ? mockRows.filter((r) => !r.client_uuid) : mockRows } };
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
jest.mock('../../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => mockCoach.coachless }));
jest.mock('../../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: mockCoach.coaches }) }));
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
    get: (_t, key) => (key === 'clientProgressV2' ? mockFlags.v2 : key === 'offlineFoodInDay' ? mockFlags.inDay : key === 'clientTimelineV2'),
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

const { HapticService } = jest.requireMock('../../../../ui/haptics/haptics.service') as { HapticService: Record<string, jest.Mock> };
const netinfo = jest.requireMock('@react-native-community/netinfo') as { __setState: (s: object) => void; __reset: () => void };
const setOffline = async (offline: boolean) => {
  mockNet.offline = offline;
  await act(async () => {
    netinfo.__setState({ isConnected: !offline, isInternetReachable: !offline });
  });
};
type Chart = { data: { x: number; y: number; pending?: boolean }[]; through: number; phoneLine?: string };
const lastChart = () => mockChart.mock.calls[mockChart.mock.calls.length - 1][0] as Chart;
const queued = async () => JSON.parse((await AsyncStorage.getItem('pending_food_logs_u1')) ?? '[]') as Array<{ id: string; kind: string }>;
const CARD = 'No connection. Weigh-ins are kept on this phone and send when you are back online.';
const LINE_SAM = 'On this phone. Goes to Sam when you are back online.';

/** No signal, Log weight, one step up (176.1 lb), Save. */
async function saveOffline(v: Awaited<ReturnType<typeof render>>) {
  await act(async () => {
    fireEvent.press(v.getByLabelText('Log weight'));
  });
  await act(async () => {
    fireEvent.press(v.getByLabelText('0.1 lb more'));
  });
  await act(async () => {
    fireEvent.press(v.getByLabelText('Save weight log entry'));
  });
}

let alert: jest.SpyInstance;
let announce: jest.SpyInstance;
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  netinfo.__reset();
  Object.assign(mockNet, { offline: false });
  Object.assign(mockFlags, { v2: true, inDay: true });
  Object.assign(mockCoach, { coachless: false, coaches: [{ coach_id: 'c1', name: 'Sam Rivera', timezone: null }] });
  mockHist.holdBack = false;
  mockRows = [180, 178, 176].map((w, i) => ({ id: String(i), date: `${ago([20, 7, 1][i])}T00:00:00.000Z`, weight_lbs: w }));
  useClientStore.getState().reset();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});
afterEach(() => {
  alert.mockRestore();
  announce.mockRestore();
});

describe('REFINE-972 B1: Progress V2 with no signal (C8 C2_offline)', () => {
  it.each([false, true])('LS-972R2 B2: a new offline save clears an earlier online saved moment (coachless=%s)', async (coachless) => {
    mockCoach.coachless = coachless;
    const v = await render(<ProgressScreen />);
    await waitFor(() => expect(v.getByText('lb trend')).toBeTruthy());

    // The same actual sheet and Save button first complete an online save.
    await saveOffline(v);
    await waitFor(() => expect(v.getByTestId('progress-saved')).toBeTruthy());
    expect(mockLog).toHaveBeenCalledTimes(1);

    // Without leaving Progress, lose the signal and save a second reading.
    await setOffline(true);
    await saveOffline(v);
    await waitFor(() => expect(lastChart().phoneLine).toBe(coachless
      ? 'On this phone. Sends when you are back online.' : LINE_SAM));
    expect(await queued()).toEqual([expect.objectContaining({ kind: 'weight' })]);
    expect(lastChart().data.some((p) => p.pending)).toBe(true);
    expect(mockLog).toHaveBeenCalledTimes(1);

    // C8's offline state must replace the old online confirmation, not retain
    // "Weigh-in saved" / "Sam sees it" and suppress the last-good-read time.
    expect(v.queryByTestId('progress-saved')).toBeNull();
    expect(v.getByTestId('progress-updated')).toBeTruthy();
  });

  it('the card shows with no signal and not with one: its words (RF972-W1) and a status role (index-v2.md:248)', async () => {
    const v = await render(<ProgressScreen />);
    await waitFor(() => expect(v.getByText('lb trend')).toBeTruthy());
    expect(v.queryByTestId('progress-offline-card')).toBeNull();
    await setOffline(true);
    const card = await v.findByTestId('progress-offline-card');
    expect(v.getByText(CARD)).toBeTruthy();
    expect(card.props.role).toBe('status');
    await setOffline(false);
    await waitFor(() => expect(v.queryByTestId('progress-offline-card')).toBeNull());
  });

  it('"Updated {time}" in place of the period sentence after a good read (C2_offline "Updated 8:12 am"; RF972-W2)', async () => {
    const v = await render(<ProgressScreen />);
    await waitFor(() => expect(v.getByText('lb trend')).toBeTruthy());
    expect(v.queryByTestId('progress-updated')).toBeNull();
    await setOffline(true);
    expect((await v.findByTestId('progress-updated')).props.children).toMatch(/^Updated \d{1,2}:\d{2} (am|pm)$/);
  });

  it('no good read in this mount: no "Updated"; the card shows over main\'s "did not load" frame (no frame draws this pair)', async () => {
    await setOffline(true);
    const v = await render(<ProgressScreen />);
    await waitFor(() => expect(v.getByText('The weight chart did not load. Pull down to try again.')).toBeTruthy());
    expect(v.getByTestId('progress-offline-card')).toBeTruthy();
    expect(v.queryByTestId('progress-updated')).toBeNull();
  });

  it('an offline Save: no alert, one spoken status (the line\'s words), the success haptic, no saved block (index-v2.md:232)', async () => {
    const v = await render(<ProgressScreen />);
    await waitFor(() => expect(v.getByText('lb trend')).toBeTruthy());
    await setOffline(true);
    await saveOffline(v);
    await waitFor(() => expect(lastChart().phoneLine).toBe(LINE_SAM));
    expect(alert).not.toHaveBeenCalled();
    expect(announce.mock.calls.filter(([said]) => said === LINE_SAM)).toHaveLength(1);
    expect(announce).not.toHaveBeenCalledWith('Weigh-in saved');
    expect(HapticService.success).toHaveBeenCalledTimes(1);
    expect(v.queryByText('Weigh-in saved')).toBeNull();
    expect(v.queryByText(/sees it\./)).toBeNull();
    expect(v.queryByTestId('log-weight-sheet')).toBeNull();
    expect(await queued()).toEqual([expect.objectContaining({ kind: 'weight' })]);
  });

  it('the ring only on the waiting weigh-in (index-v2.md:120, :215), today\'s, so the chart draws its callout; never on a sent or refused one', async () => {
    await AsyncStorage.setItem('pending_food_logs_u1', JSON.stringify([
      { id: 'pfl_parked', createdAt: 1, parkedAt: 2, kind: 'weight', log: { date: today, weight_lbs: 150 } },
    ]));
    const v = await render(<ProgressScreen />);
    await waitFor(() => expect(v.getByText('lb trend')).toBeTruthy());
    await setOffline(true);
    await saveOffline(v);
    await waitFor(() => expect(lastChart().data.filter((p) => p.y === 176.1)).toHaveLength(1));
    const chart = lastChart();
    expect(chart.data.find((p) => p.y === 176.1)).toEqual({ x: chart.through, y: 176.1, pending: true });
    expect(chart.data.filter((p) => p.pending)).toHaveLength(1);
    // A refused (parked) weigh-in counts nowhere and draws nowhere.
    expect(chart.data.some((p) => p.y === 150)).toBe(false);
    // Sent, not read back yet: a dot, and the line goes.
    mockHist.holdBack = true;
    await setOffline(false);
    await act(async () => {
      await syncFoodLogQueue();
    });
    await waitFor(() => expect(useClientStore.getState().sentWaterWeight).toHaveLength(1));
    await waitFor(() => expect(lastChart().phoneLine).toBeUndefined());
    expect(lastChart().data.filter((p) => p.y === 176.1)).toEqual([{ x: chart.through, y: 176.1 }]);
  });

  it('the ring becomes a dot once sent and read back (index-v2.md:233, "Sent after offline")', async () => {
    const v = await render(<ProgressScreen />);
    await waitFor(() => expect(v.getByText('lb trend')).toBeTruthy());
    await setOffline(true);
    await saveOffline(v);
    await waitFor(() => expect(lastChart().data.find((p) => p.y === 176.1)?.pending).toBe(true));
    await setOffline(false);
    await act(async () => {
      await syncFoodLogQueue();
    });
    await waitFor(() => expect(useClientStore.getState().sentWaterWeight).toHaveLength(0));
    await waitFor(() => expect(lastChart().data.filter((p) => p.y === 176.1)).toEqual([{ x: lastChart().through, y: 176.1 }]));
    expect(lastChart().phoneLine).toBeUndefined();
    expect(v.queryByTestId('progress-offline-card')).toBeNull();
  });

  it.each([
    ['a coach', false, [{ coach_id: 'c1', name: 'Sam Rivera', timezone: null }], LINE_SAM],
    ['coachless (index.md:387, C8-S-133)', true, undefined, 'On this phone. Sends when you are back online.'],
    ['a coach not read yet', false, undefined, 'On this phone. Goes to your coach when you are back online.'],
  ])('the line under the chart with %s (index-v2.md:215)', async (_who, coachless, coaches, line) => {
    Object.assign(mockCoach, { coachless, coaches });
    const v = await render(<ProgressScreen />);
    await waitFor(() => expect(v.getByText('lb trend')).toBeTruthy());
    expect(lastChart().phoneLine).toBeUndefined();
    await setOffline(true);
    await saveOffline(v);
    await waitFor(() => expect(lastChart().phoneLine).toBe(line));
    expect(announce).toHaveBeenCalledWith(line);
  });

  it('offlineFoodInDay off: the alert stays; no card, ring or line is drawn (operator ruling 2; ruling 10:4x (5))', async () => {
    mockFlags.inDay = false;
    const v = await render(<ProgressScreen />);
    await waitFor(() => expect(v.getByText('lb trend')).toBeTruthy());
    await setOffline(true);
    expect(v.queryByTestId('progress-offline-card')).toBeNull();
    expect(v.queryByTestId('progress-updated')).toBeNull();
    await saveOffline(v);
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Saved offline', 'Your weigh-in will sync when you reconnect.'));
    expect(lastChart().data.some((p) => p.pending)).toBe(false);
    expect(lastChart().phoneLine).toBeUndefined();
  });

  it('LS C5: a queue write that fails says "Couldn\'t log weight" / "Please try again.", never the raw error', async () => {
    const v = await render(<ProgressScreen />);
    await waitFor(() => expect(v.getByText('lb trend')).toBeTruthy());
    await setOffline(true);
    const write = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk is full'));
    await saveOffline(v);
    await waitFor(() => expect(alert).toHaveBeenCalledWith("Couldn't log weight", 'Please try again.'));
    write.mockRestore();
  });
});
