/**
 * LS-933R4 B1: a closed refusal is not a successful nudge. Once Send is refused and its form is removed, the coach
 * must see the existing closed line immediately, without discovering the failure by opening the same entry again.
 * Class-first: the two list entries and the peek entry, with the real lookup, hook, modal, peek and shared gate.
 * Expected at 76d212c0: list entries fail (no closed line anywhere); peek entry passes (its sheet was already open).
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ClientLookupScreen from '../lookup/ClientLookupScreen';
import { useCoachStore } from '../../../store/coachStore';
import { closedRefusals } from '../../../components/messaging/closedRefusal';

const mockSend = jest.fn();
const mockNavigate = jest.fn();
const mockCache = new Map<string, string>();
const jordan = {
  id: 'c1', firstName: 'Jordan', lastName: 'Reyes', status: 'active', createdAt: '2026-08-14T10:00:00.000Z',
  activity: { lastActiveOn: '2026-10-20', checkInsToReview: 0 },
};
const others = Array.from({ length: 14 }, (_, i) => ({
  ...jordan, id: `o${i}`, firstName: 'Sam', lastName: `Other${i}`,
}));
const refused = Object.assign(new Error('blocked'), {
  response: { status: 403, data: {
    code: 'messaging.blocked', error: 'messaging.blocked', message: 'This conversation is blocked.',
  } },
});

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-ls-r4', role: 'coach' }),
}));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: async () => ({ data: { users: [] } }) },
  coachApi: {
    getUnreadCounts: async () => ({ data: { total: 0, by_client: {}, closed_client_ids: [] } }),
    getClients: async () => ({ data: [] }),
    getClientSummary: async () => ({ data: {} }),
    getClientCheckIns: async () => ({ data: [] }),
    getClientWeek: async () => ({
      data: { week_start: '2026-11-02', today: '2026-11-05', assignments: [] },
    }),
    sendNudge: (...args: any[]) => mockSend(...args),
  },
}));
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: {
    getStringAsync: async (key: string) => mockCache.get(key),
    set: async (key: string, value: string) => void mockCache.set(key, value),
  },
  prefsStorage: { getString: () => undefined },
}));
jest.mock('../../../hooks/useMacros', () => ({
  useMacros: () => ({ formatWeight: (value: number) => `${value} lb` }),
  useCurrentMacrosForClient: () => ({ isSuccess: true, data: null }),
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: {} }) }));
jest.mock('../home-v11/blockList', () => ({
  ...jest.requireActual('../home-v11/blockList'),
  useCoachBlockList: () => ({ known: true, blockedIds: [] }),
}));
jest.mock('../home-v11/DraftSheets', () => ({ HomeSheet: () => null }));
jest.mock('../../../theme/ThemeProvider', () => {
  const flat = new Proxy({}, { get: () => '#000000' });
  const colors = new Proxy({}, { get: (_t, key) => key === 'surface' || key === 'data' ? flat : '#000000' });
  return { useTheme: () => ({ colors, semanticColors: colors }) };
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
jest.mock('../../../ui/states/QuietStates', () => ({ QuietLoading: () => null, QuietError: () => null }));
jest.mock('../../../ui/empty-states', () => ({ EmptyStateNoResults: () => null }));
jest.mock('../../../components/home/PushPermissionCard', () => () => null);
jest.mock('../../../navigation/coachLanding', () => ({ coachLandingTab: () => 'ClientsStack' }));

const nav = {
  navigate: mockNavigate, setParams: jest.fn(), isFocused: () => true, addListener: () => () => undefined,
  getParent: () => ({ navigate: mockNavigate, addListener: () => () => undefined }),
} as never;

type View = Awaited<ReturnType<typeof render>>;
const entries: Array<{ name: string; many: boolean; tap: (view: View) => Promise<void> }> = [
  { name: 'Needs you Nudge', many: false, tap: async (v) => {
    await fireEvent.press(v.getByTestId('lookup-act-c1'));
  } },
  { name: 'search row bell', many: true, tap: async (v) => {
    await fireEvent.changeText(v.getByTestId('lookup-search'), 'jordan');
    await fireEvent.press(v.getByTestId('lookup-nudge-c1'));
  } },
  { name: 'peek Send nudge', many: false, tap: async (v) => {
    await fireEvent.press(v.getByTestId('lookup-row-c1'));
    await waitFor(() => expect(v.getByTestId('peek-chip-Full profile')).toBeTruthy());
    await fireEvent.press(v.getByTestId('peek-nudge'));
  } },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockCache.clear();
  closedRefusals.clear('c1');
  mockSend.mockRejectedValue(refused);
});

describe('LS-933R4 B1 immediate closed-refusal feedback', () => {
  it.each(entries)('$name: shows why Send failed as soon as its form closes', async ({ many, tap }) => {
    useCoachStore.setState({
      clients: (many ? [jordan, ...others] : [jordan]) as never,
      filterStatus: 'active', isLoading: false, loadError: null, loadClients: jest.fn(async () => undefined),
    });
    const view = await render(<ClientLookupScreen navigation={nav} />);
    await waitFor(() => expect(view.queryByTestId(many ? 'lookup-az-c1' : 'lookup-row-c1')).toBeTruthy());
    await act(async () => undefined);
    await tap(view);
    await fireEvent.changeText(view.getByLabelText('Nudge title'), 'Check in');
    await fireEvent.changeText(view.getByLabelText('Nudge message'), 'How are you doing?');
    await fireEvent.press(view.getByText('Send'));
    await waitFor(() => expect(view.queryByLabelText('Nudge message')).toBeNull());
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(closedRefusals.has('c1')).toBe(true);
    expect(mockNavigate).not.toHaveBeenCalled();
    // No extra tap or reopen: a refusal must not look like the successful-send close.
    expect(view.getByText('Jordan Reyes has blocked you')).toBeTruthy();
  });
});
