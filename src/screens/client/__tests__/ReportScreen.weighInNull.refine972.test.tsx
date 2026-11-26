/**
 * REFINE-972 (m#972, LO C1 = LS C4): the classic Weekly report (clientProgressV2 off, offlineFoodInDay on) joins this
 * phone's weigh-ins onto the week's history read only once a read has landed. Before a read, and after a failed one,
 * the week shows no weigh-in from the phone alone (offlineWeighIn.ts:26-29). After a good read it counts once.
 * Harness: src/__tests__/reportScreen133.test.tsx's.
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { logApi, weightApi } from '../../../services/api';
import ReportScreen from '../ReportScreen';
import { featureFlags } from '../../../config/featureFlags';
import { getTodayString } from '../../../utils/date';
import { useClientStore } from '../../../store/clientStore';

jest.replaceProperty(featureFlags, 'clientProgressV2', false);
jest.replaceProperty(featureFlags, 'offlineFoodInDay', true);

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../../constants/colors').default, semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'u1', firstName: 'Ada', profile: { current_weight: 180, calorie_target: 1600, primary_goal: 'maintain' } }),
}));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../api/macrosApi', () => ({ macrosApi: { currentForSelf: async () => ({ data: null }) } }));
jest.mock('../../../services/api', () => ({
  logApi: { getDaily: jest.fn() },
  weightApi: { getHistory: jest.fn() },
}));

const navigation = { goBack: jest.fn() as () => void } as NavigationProp<ParamListBase>;
const mount = () => render(
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } }}>
    <ReportScreen navigation={navigation} />
  </SafeAreaProvider>,
);
const waitingWeighIn = { id: 'pfl_g1', createdAt: 1, kind: 'weight' as const, log: { date: getTodayString(), weight_lbs: 190.4 } };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.mocked(logApi.getDaily).mockResolvedValue({ data: { entries: [] } } as Awaited<ReturnType<typeof logApi.getDaily>>);
  useClientStore.getState().reset();
  useClientStore.setState({ queuedWaterWeight: [waitingWeighIn], sentWaterWeight: [] });
});

describe('REFINE-972 LO C1: the Weekly report holds no weigh-in from the phone alone', () => {
  it('after a failed history read: not shown', async () => {
    jest.mocked(weightApi.getHistory).mockRejectedValue(new Error('Network Error'));
    const s = await mount();
    await waitFor(() => expect(weightApi.getHistory).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(s.queryAllByText(/190\.4/)).toHaveLength(0);
  });

  it('before a read lands: not shown', async () => {
    jest.mocked(weightApi.getHistory).mockReturnValue(new Promise(() => undefined));
    const s = await mount();
    await waitFor(() => expect(weightApi.getHistory).toHaveBeenCalled());
    expect(s.queryAllByText(/190\.4/)).toHaveLength(0);
  });

  it('after a good read: counted once, as at the head', async () => {
    jest.mocked(weightApi.getHistory).mockResolvedValue({ data: { logs: [] } } as Awaited<ReturnType<typeof weightApi.getHistory>>);
    const s = await mount();
    await waitFor(() => expect(s.getAllByText(/190\.4/).length).toBeGreaterThan(0));
  });
});
