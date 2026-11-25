/**
 * LS-933R3 original black-box reproduction at 0ab3da8e3bf23939b7db661adae545e60179d500.
 * Real lookup, peek, nudge hook/modal and shared conversation gate; server and
 * platform dependencies are stubbed. Expected at this head: four failures and
 * two passing controls. This reviewer artifact is not a production-code fix.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ClientLookupScreen from '../lookup/ClientLookupScreen';
import { useCoachStore } from '../../../store/coachStore';
import { closedRefusals } from '../../../components/messaging/closedRefusal';

const mockNavigate = jest.fn();
const mockSend = jest.fn(async () => ({}));
const mockClients = [
  { id: 'c1', firstName: 'Jordan', lastName: 'Reyes', status: 'active', createdAt: '2026-08-14T10:00:00.000Z', activity: { lastActiveOn: '2026-10-20', checkInsToReview: 0 } },
];
const mockUnread = jest.fn();
const mockCache = new Map<string, string>();
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-r3', role: 'coach' }) }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: async () => ({ data: { users: [] } }) },
  coachApi: {
    getUnreadCounts: () => mockUnread(),
    getClients: async () => ({ data: [] }),
    getClientSummary: async () => ({ data: {} }),
    getClientCheckIns: async () => ({ data: [] }),
    getClientWeek: async () => ({ data: { week_start: '2026-11-02', today: '2026-11-05', assignments: [] } }),
    sendNudge: (...args: any[]) => (mockSend as any)(...args),
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
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: {
  selection: jest.fn(), success: jest.fn(), error: jest.fn(), warning: jest.fn(),
} }));
jest.mock('../../../ui', () => ({
  Overline: jest.requireActual('react-native').Text,
  useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../../ui/states/QuietStates', () => ({ QuietLoading: () => null, QuietError: () => null }));
jest.mock('../../../ui/empty-states', () => ({ EmptyStateNoResults: () => null }));
jest.mock('../../../components/home/PushPermissionCard', () => () => null);
jest.mock('../../../navigation/coachLanding', () => ({ coachLandingTab: () => 'ClientsStack' }));

const nav = {
  navigate: mockNavigate, setParams: jest.fn(), isFocused: () => true,
  addListener: () => () => undefined,
  getParent: () => ({ navigate: mockNavigate, addListener: () => () => undefined }),
} as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockCache.clear();
  closedRefusals.clear('c1');
  useCoachStore.setState({
    clients: mockClients as never, filterStatus: 'active', isLoading: false,
    loadError: null, loadClients: jest.fn(async () => undefined),
  });
  mockUnread.mockResolvedValue({ data: { total: 0, by_client: {}, closed_client_ids: ['c1'] } });
  mockSend.mockResolvedValue({});
});

it('one known client-side block has the same nudge guard on the peek and its adjacent lookup row', async () => {
  const view = await render(<ClientLookupScreen navigation={nav} />);
  await waitFor(() => expect(view.getByTestId('lookup-act-c1')).toBeTruthy());
  await fireEvent.press(view.getByTestId('lookup-row-c1'));
  await waitFor(() => expect(view.getByText('Jordan Reyes has blocked you')).toBeTruthy());
  expect(view.queryByTestId('peek-nudge')).toBeNull();
  await fireEvent.press(view.getByTestId('peek-close'));
  // The exact same settled server answer must guard the entry immediately behind the sheet.
  await fireEvent.press(view.getByTestId('lookup-act-c1'));
  await act(async () => undefined);
  expect(view.queryByLabelText('Nudge message')).toBeNull();
  expect(view.queryByText('Send to all clients')).toBeNull();
  expect(mockSend).not.toHaveBeenCalled();
});

it('a failed unread read cannot be bypassed by closing the peek and using the adjacent row', async () => {
  mockUnread.mockRejectedValue(new Error('offline'));
  const view = await render(<ClientLookupScreen navigation={nav} />);
  await waitFor(() => expect(view.getByTestId('lookup-act-c1')).toBeTruthy());
  await fireEvent.press(view.getByTestId('lookup-row-c1'));
  await waitFor(() => expect(view.getByTestId('peek-chip-Full profile')).toBeTruthy());
  expect(view.queryByTestId('peek-nudge')).toBeNull();
  await fireEvent.press(view.getByTestId('peek-close'));
  await fireEvent.press(view.getByTestId('lookup-act-c1'));
  await act(async () => undefined);
  expect(view.queryByLabelText('Nudge message')).toBeNull();
});

it('a real peek nudge refused because the pair became blocked closes the editor and stays closed on return', async () => {
  mockUnread.mockResolvedValue({ data: { total: 0, by_client: {}, closed_client_ids: [] } });
  mockSend.mockRejectedValue(Object.assign(new Error('blocked'), {
    response: { status: 403, data: {
      code: 'messaging.blocked', error: 'messaging.blocked',
      message: 'This conversation is blocked, so messages cannot be sent, edited or pinned. Unblock in Settings to continue.',
    } },
  }));
  const view = await render(<ClientLookupScreen navigation={nav} />);
  await waitFor(() => expect(view.getByTestId('lookup-row-c1')).toBeTruthy());
  await fireEvent.press(view.getByTestId('lookup-row-c1'));
  await waitFor(() => expect(view.getByTestId('peek-nudge')).toBeTruthy());
  await fireEvent.press(view.getByTestId('peek-nudge'));
  await fireEvent.changeText(view.getByLabelText('Nudge title'), 'Check in');
  await fireEvent.changeText(view.getByLabelText('Nudge message'), 'How are you doing?');
  await fireEvent.press(view.getByText('Send'));
  await waitFor(() => expect(mockSend).toHaveBeenCalledWith('c1', {
    title: 'Check in', body: 'How are you doing?',
  }));
  await act(async () => undefined);
  const editorStillVisible = view.queryByLabelText('Nudge message') != null;
  const sessionStillOpen = !closedRefusals.has('c1');
  if (editorStillVisible) await fireEvent.press(view.getByText('Cancel'));
  const peekStillOffersNudge = view.queryByTestId('peek-nudge') != null;
  expect({ editorStillVisible, sessionStillOpen, peekStillOffersNudge }).toEqual({
    editorStillVisible: false, sessionStillOpen: false, peekStillOffersNudge: false,
  });
});

it('an explicitly open pair still sends one nudge successfully', async () => {
  mockUnread.mockResolvedValue({ data: { total: 0, by_client: {}, closed_client_ids: [] } });
  const view = await render(<ClientLookupScreen navigation={nav} />);
  await waitFor(() => expect(view.getByTestId('lookup-row-c1')).toBeTruthy());
  await fireEvent.press(view.getByTestId('lookup-row-c1'));
  await waitFor(() => expect(view.getByTestId('peek-nudge')).toBeTruthy());
  await fireEvent.press(view.getByTestId('peek-nudge'));
  await fireEvent.changeText(view.getByLabelText('Nudge title'), 'Check in');
  await fireEvent.changeText(view.getByLabelText('Nudge message'), 'How are you doing?');
  await fireEvent.press(view.getByText('Send'));
  await waitFor(() => expect(view.queryByLabelText('Nudge message')).toBeNull());
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(view.queryByLabelText('Nudge message')).toBeNull();
  expect(closedRefusals.has('c1')).toBe(false);
});

it('an ordinary connection failure preserves the draft without fabricating a block', async () => {
  mockUnread.mockResolvedValue({ data: { total: 0, by_client: {}, closed_client_ids: [] } });
  mockSend.mockRejectedValue(new Error('offline'));
  const view = await render(<ClientLookupScreen navigation={nav} />);
  await waitFor(() => expect(view.getByTestId('lookup-row-c1')).toBeTruthy());
  await fireEvent.press(view.getByTestId('lookup-row-c1'));
  await waitFor(() => expect(view.getByTestId('peek-nudge')).toBeTruthy());
  await fireEvent.press(view.getByTestId('peek-nudge'));
  await fireEvent.changeText(view.getByLabelText('Nudge title'), 'Check in');
  await fireEvent.changeText(view.getByLabelText('Nudge message'), 'How are you doing?');
  await fireEvent.press(view.getByText('Send'));
  await waitFor(() => expect(view.getByText('offline')).toBeTruthy());
  expect(view.getByLabelText('Nudge message').props.value).toBe('How are you doing?');
  expect(closedRefusals.has('c1')).toBe(false);
});

it('a session refusal that closes the live peek also removes the already-open nudge editor', async () => {
  mockUnread.mockResolvedValue({ data: { total: 0, by_client: {}, closed_client_ids: [] } });
  const view = await render(<ClientLookupScreen navigation={nav} />);
  await waitFor(() => expect(view.getByTestId('lookup-row-c1')).toBeTruthy());
  await fireEvent.press(view.getByTestId('lookup-row-c1'));
  await waitFor(() => expect(view.getByTestId('peek-nudge')).toBeTruthy());
  await fireEvent.press(view.getByTestId('peek-nudge'));
  expect(view.getByLabelText('Nudge message')).toBeTruthy();
  await act(async () => { closedRefusals.add('c1'); });
  await waitFor(() => expect(view.queryByTestId('peek-nudge')).toBeNull());
  expect(view.queryByLabelText('Nudge message')).toBeNull();
});
