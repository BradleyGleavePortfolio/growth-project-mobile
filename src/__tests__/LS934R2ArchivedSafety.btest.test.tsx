/** Independent LS-934R2 safety-navigation B-TEST, exact product base 03484a39. */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ClientLookupScreen from '../screens/coach/lookup/ClientLookupScreen';
import { useCoachStore } from '../store/coachStore';

const mockQueue = jest.fn();
const mockNavigate = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true, default: { get: () => Promise.resolve({ data: {} }) },
  coachApi: {
    getClients: () => Promise.resolve({ data: [] }),
    getUnreadCounts: () => Promise.resolve({ data: { by_client: {} } }),
    sendNudge: jest.fn(),
  },
}));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../screens/coach/command-center/coachHomeSources', () => ({ readOpenAlerts: () => mockQueue() }));
jest.mock('../screens/coach/home-v11/blockList', () => ({
  needsYouReason: jest.requireActual('../screens/coach/home-v11/blockList').needsYouReason,
  useCoachBlockList: () => ({ blockedIds: [], known: true, loading: false, error: null, refresh: jest.fn() }),
}));
jest.mock('../config/featureFlags', () => ({ featureFlags: { clientPathCopilot: true } }));
jest.mock('../screens/coach/lookup/ClientPeekSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../ui/haptics/haptics.service', () => ({ HapticService: { lightImpact: jest.fn(), softImpact: jest.fn(), selection: jest.fn() } }));
jest.mock('../ui', () => ({
  Overline: jest.requireActual('react-native').Text,
  useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const navigation = {
  navigate: mockNavigate, setParams: jest.fn(), isFocused: () => true,
  addListener: () => () => undefined, getParent: () => undefined,
};
const safety = {
  alert_id: 's1', alert_type: 'roman_crisis_reply', client_id: 'c1', client_name: 'Avery Cole',
  message: 'Safety', dismissed_at: null, created_at: '2026-11-05T10:00:00Z',
};
beforeEach(() => {
  jest.clearAllMocks();
  useCoachStore.getState().reset();
  mockQueue.mockResolvedValue([safety]);
});
const mount = () => render(<ClientLookupScreen navigation={navigation as never} route={{ params: { view: 'needs' } } as never} />);

it('control: Home route opens the known safety row and its detail from an active roster', async () => {
  const v = await mount();
  await waitFor(() => expect(v.queryByTestId('needs-safety-s1')).toBeTruthy());
  await fireEvent.press(v.getByTestId('needs-safety-s1'));
  expect(mockNavigate).toHaveBeenCalledWith('CoachSafetyAlert', expect.objectContaining({ clientId: 'c1' }));
});

it('B2: after browsing Archived, the Home Needs you route must still expose the known safety row', async () => {
  useCoachStore.getState().setFilterStatus('archived');
  const v = await mount();
  await waitFor(() => expect(mockQueue).toHaveBeenCalled());
  await waitFor(() => expect(useCoachStore.getState().isLoading).toBe(false));
  expect(v.queryByTestId('needs-safety-s1')).toBeTruthy();
});
