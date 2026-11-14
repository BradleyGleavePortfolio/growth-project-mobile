/**
 * REFINE-972 (m#972, LO C1 = LS C4): the legacy Progress page (clientProgressV2 off, offlineFoodInDay on) joins this
 * phone's weigh-ins onto a history read only once a read has landed. Before a read, and after a failed one, the page
 * keeps its own empty and failed looks: a number from the phone alone would not be the client's trend
 * (offlineWeighIn.ts:26-29). After a good read the waiting weigh-in counts once, as at the head (G6).
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import ProgressScreen from '../ProgressScreen';
import { getTodayString } from '../../../utils/date';
import { useClientStore } from '../../../store/clientStore';

const today = getTodayString();
const mockHistory = jest.fn(async (): Promise<unknown> => ({ data: { logs: [] } }));
jest.mock('../../../services/api', () => ({
  weightApi: { getHistory: () => mockHistory(), log: jest.fn(), takeKeptKey: jest.fn() },
  workoutApi: { getAll: jest.fn(async () => ({ data: [] })) },
  logApi: { getDaily: jest.fn(async () => ({ data: {} })) },
  foodApi: { create: jest.fn() },
  waterApi: { log: jest.fn(), getDaily: jest.fn() },
}));
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'u1' }) }));
jest.mock('../../../api/workoutBuilderApi', () => ({ workoutBuilderApi: { listMyAssignments: async () => [] } }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u1', coach_id: 'c1', profile: {} }) }));
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ coach_id: 'c1', name: 'Sam Rivera', timezone: null }] }) }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => ({ calories: 2000, protein: 150, carbs: 200, fat: 60 }) }));
jest.mock('@react-navigation/native', () => ({
  NavigationContext: require('react').createContext(undefined),
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../config/featureFlags', () => ({
  __esModule: true,
  featureFlags: new Proxy({} as Record<string, boolean>, { get: (_t, key) => key === 'offlineFoodInDay' }),
}));
jest.mock('../../../ui/haptics/haptics.service', () => {
  const fns: Record<string | symbol, jest.Mock> = {};
  return { HapticService: new Proxy(fns, { get: (t, k) => (t[k] ??= jest.fn()) }), setHapticsEnabled: jest.fn() };
});
jest.mock('../wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('../../../theme/ThemeProvider', () => {
  const tokens = require('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', colors: tokens.colors, semanticColors: tokens.lightTokens }) };
});

const waitingWeighIn = { id: 'pfl_g1', createdAt: 1, kind: 'weight' as const, log: { date: today, weight_lbs: 190.4 } };

beforeEach(() => {
  jest.clearAllMocks();
  useClientStore.getState().reset();
  useClientStore.setState({ queuedWaterWeight: [waitingWeighIn], sentWaterWeight: [] });
});

describe('REFINE-972 LO C1: the legacy Progress page holds no weigh-in from the phone alone', () => {
  it('after a failed history read: the waiting weigh-in is not shown on its own', async () => {
    mockHistory.mockRejectedValue(new Error('Network Error'));
    const v = await render(<ProgressScreen />);
    await waitFor(() => expect(mockHistory).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(v.queryAllByText(/190\.4/)).toHaveLength(0);
  });

  it('before a read lands: not shown', async () => {
    mockHistory.mockReturnValue(new Promise(() => undefined));
    const v = await render(<ProgressScreen />);
    await waitFor(() => expect(mockHistory).toHaveBeenCalled());
    expect(v.queryAllByText(/190\.4/)).toHaveLength(0);
  });

  it('after a good read: the waiting weigh-in counts once, as at the head (G6)', async () => {
    mockHistory.mockResolvedValue({ data: { logs: [{ id: 'g-0', date: '2026-01-02T00:00:00.000Z', weight_lbs: 182 }] } });
    const v = await render(<ProgressScreen />);
    await waitFor(() => expect(v.getAllByText(/190\.4/).length).toBeGreaterThan(0));
  });
});
