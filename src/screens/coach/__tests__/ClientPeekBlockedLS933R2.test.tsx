/** LS-933R2 B1: a blocked client's real lookup peek must not open an editable nudge composer. */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockGetClients = jest.fn();
const mockSendNudge = jest.fn();
const mockCache = new Map<string, string>();
let mockBlockedIds = ['blocked-c1'];
jest.mock('../../../services/api', () => ({
  coachApi: {
    getClients: (...args: unknown[]) => mockGetClients(...args),
    getUnreadCounts: async () => ({ data: { total: 0, by_client: {} } }),
    getClientSummary: async () => ({ data: {} }),
    getClientCheckIns: async () => ({ data: [] }),
    getClientWeek: async () => ({ data: { days: [] } }),
    sendNudge: (...args: unknown[]) => mockSendNudge(...args),
  },
}));
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: {
    getStringAsync: async (key: string) => mockCache.get(key),
    set: async (key: string, value: string) => void mockCache.set(key, value),
  },
  prefsStorage: { getString: () => undefined },
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-r2', role: 'coach' }),
}));
jest.mock('../../../hooks/useMacros', () => ({
  useMacros: () => ({ formatWeight: (value: number) => `${value} lb` }),
  useCurrentMacrosForClient: () => ({ isSuccess: true, data: null }),
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: {} }) }));
jest.mock('../home-v11/blockList', () => ({
  ...jest.requireActual('../home-v11/blockList'),
  useCoachBlockList: () => ({ known: true, blockedIds: mockBlockedIds }),
}));
jest.mock('../home-v11/DraftSheets', () => ({ HomeSheet: () => null }));
jest.mock('../../../theme/ThemeProvider', () => {
  const flat = new Proxy({}, { get: () => '#000000' });
  const anyColor = new Proxy({}, { get: (_t, key) => key === 'surface' || key === 'data' ? flat : '#000000' });
  return { useTheme: () => ({ colors: anyColor, semanticColors: anyColor }) };
});
jest.mock('../../../components/HapticPressable', () => jest.requireActual('react-native').Pressable);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));
jest.mock('../../../ui', () => ({
  Overline: jest.requireActual('react-native').Text,
  useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../../ui/states/QuietStates', () => ({
  QuietLoading: () => null, QuietError: () => null,
}));
jest.mock('../../../ui/empty-states', () => ({ EmptyStateNoResults: () => null }));
jest.mock('../../../components/home/PushPermissionCard', () => () => null);
jest.mock('../../../navigation/coachLanding', () => ({ coachLandingTab: () => 'ClientsStack' }));

import ClientLookupScreen from '../lookup/ClientLookupScreen';
import { useCoachStore } from '../../../store/coachStore';

const navigate = jest.fn();
const nav = {
  navigate, setParams: jest.fn(), isFocused: () => true,
  addListener: () => () => undefined,
  getParent: () => ({ navigate, addListener: () => () => undefined }),
} as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockCache.clear();
  mockBlockedIds = ['blocked-c1'];
  useCoachStore.getState().reset();
  mockGetClients.mockResolvedValue({
    data: [{
      id: 'blocked-c1', name: 'Jordan Reyes', role: 'student',
      email: 'blocked-c1@example.com', created_at: '2025-01-01T12:00:00Z',
      activity: { shared: true, last_active_on: null, check_ins_to_review: 0, last_workout_on: null },
    }],
  });
  mockSendNudge.mockResolvedValue({ data: {} });
});

async function openRealPeek(blocked = true) {
  await render(<ClientLookupScreen navigation={nav} />);
  await waitFor(() => expect(screen.getByTestId('lookup-row-blocked-c1')).toBeTruthy());
  // The existing row gate knows this pair is blocked and offers no Nudge.
  if (blocked) expect(screen.queryByTestId('lookup-act-blocked-c1')).toBeNull();
  await fireEvent.press(screen.getByTestId('lookup-row-blocked-c1'));
  await waitFor(() => expect(screen.getByTestId('peek-sheet')).toBeTruthy());
  await act(async () => {});
}

it('does not open a nudge composer for that blocked pair through its peek', async () => {
  await openRealPeek();
  const nudge = screen.queryByTestId('peek-nudge');
  if (nudge) await fireEvent.press(nudge);
  expect(screen.queryByLabelText('Nudge message')).toBeNull();
});

it('control: a non-blocked pair can open the real nudge composer', async () => {
  mockBlockedIds = [];
  await openRealPeek(false);
  await fireEvent.press(screen.getByTestId('peek-nudge'));
  expect(screen.getByLabelText('Nudge message')).toBeTruthy();
});
