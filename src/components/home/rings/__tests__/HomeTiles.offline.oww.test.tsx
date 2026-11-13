/**
 * OFFLINE-WATER-WEIGHT-M (191-S5) on Home's tiles:
 *   W7: the water chip with no signal, on a day already read, queues the glass (the call site's network state, food's
 *       send decision) and the error haptic does not fire.
 *   G1: a weigh-in saved with no signal counts on the weight tile at once (joined by key; switch on).
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import HomeTiles from '../HomeTiles';
import { HapticService } from '../../../../ui/haptics/haptics.service';
import { getTodayString } from '../../../../utils/date';

const today = getTodayString();
const mockState = {
  loadError: null as string | null,
  logWater: jest.fn(async () => undefined),
  queuedWaterWeight: [] as object[],
  sentWaterWeight: [] as object[],
  showQueuedWaterWeight: jest.fn(),
};
jest.mock('../../../../store/clientStore', () => ({
  useClientStore: Object.assign((select?: (s: unknown) => unknown) => (select ? select(mockState) : mockState), {
    getState: () => mockState,
  }),
}));
const mockWeight = { isSuccess: true, data: { logs: [{ id: 'g-0', date: '2026-10-01T00:00:00.000Z', weight_lbs: 180 }] }, refetch: jest.fn() };
jest.mock('../../../../hooks/useApi', () => ({
  useWeightHistory: () => mockWeight,
  useHabits: () => ({ data: [], refetch: jest.fn() }),
  useHabitLogs: () => ({ data: [], refetch: jest.fn() }),
}));
jest.mock('../../../../hooks/useWearableSamples', () => ({ useWearableSamples: () => ({ data: undefined, isSuccess: false, refetch: jest.fn() }) }));
jest.mock('../../../../hooks/useRefreshOnOpen', () => ({ useRefreshOnOpen: jest.fn() }));
jest.mock('../../../../hooks/useSettings', () => ({ useSettings: () => ({ settings: { unit: 'lbs', waterGoalOz: 64 }, loaded: true }) }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u1' }) }));
jest.mock('../../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, offlineFoodInDay: true } };
});
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../../../../theme/ThemeProvider', () => {
  const tokens = require('../../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', colors: tokens.colors, semanticColors: tokens.lightTokens }) };
});

const netinfo = jest.requireMock('@react-native-community/netinfo') as { __setState: (s: object) => void; __reset: () => void };
const day = { ready: true, protein: 0, simple: false, waterOz: 16 };

beforeEach(() => {
  jest.clearAllMocks();
  netinfo.__reset();
  mockState.loadError = null;
  mockState.queuedWaterWeight = [];
  mockState.sentWaterWeight = [];
});

it('W7: the water chip with no signal queues the glass and fires no error haptic', async () => {
  const v = await render(<HomeTiles day={day} checkIn={null} refreshing={false} noSource={false} />);
  await act(async () => {
    netinfo.__setState({ isConnected: false, isInternetReachable: false });
  });
  await act(async () => {
    fireEvent.press(v.getByTestId('home-tile-water-add'));
  });
  expect(mockState.logWater).toHaveBeenCalledWith('u1', '', 8, false);
  expect(HapticService.error).not.toHaveBeenCalled();
  expect(HapticService.success).toHaveBeenCalledTimes(1);
});

it('W7: with a signal it is the online send, as main', async () => {
  const v = await render(<HomeTiles day={day} checkIn={null} refreshing={false} noSource={false} />);
  await act(async () => {
    fireEvent.press(v.getByTestId('home-tile-water-add'));
  });
  expect(mockState.logWater).toHaveBeenCalledWith('u1', '', 8, true);
});

it('G1: a weigh-in saved with no signal counts on the weight tile at once', async () => {
  mockState.queuedWaterWeight = [{ id: 'pfl_g1', createdAt: 1, kind: 'weight', log: { date: today, weight_lbs: 190.4 } }];
  const v = await render(<HomeTiles day={day} checkIn={null} refreshing={false} noSource={false} />);
  expect(v.getByTestId('home-tile-weight').props.accessibilityLabel).toMatch(/^Weight, 190\.4 lb/);
});

it('G2: once the history row carries its key, the weigh-in counts once (the phone copy is not added again)', async () => {
  mockState.sentWaterWeight = [{ id: 'pfl_g1', createdAt: 1, sentAt: 2, kind: 'weight', log: { date: today, weight_lbs: 190.4 } }];
  mockWeight.data = { logs: [{ id: 'g-0', date: '2026-10-01T00:00:00.000Z', weight_lbs: 180 },
    { id: 'g-1', date: `${today}T00:00:00.000Z`, weight_lbs: 190.4, client_uuid: 'pfl_g1' } as never] };
  const v = await render(<HomeTiles day={day} checkIn={null} refreshing={false} noSource={false} />);
  expect(v.getByTestId('home-tile-weight').props.accessibilityLabel).toMatch(/^Weight, 190\.4 lb/);
  // A sent weigh-in makes the tile read again, and the read holding its key settles it.
  expect(mockWeight.refetch).toHaveBeenCalled();
  await act(async () => undefined);
  expect(mockState.showQueuedWaterWeight).toHaveBeenCalledWith({ queue: [], sent: [] });
});
