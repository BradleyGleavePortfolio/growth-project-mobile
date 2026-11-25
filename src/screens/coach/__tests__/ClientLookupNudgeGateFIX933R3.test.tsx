/**
 * FIX-933R3 (LS-933R3 B1, class-first [R24]): one table over every Nudge entry on the coach's client lookup (the
 * Needs you row's Nudge, the search row's bell, the peek's Send nudge) and every pair answer. The nudge form opens only
 * for a pair the lookup knows is open; a closed or unread pair opens the client's peek instead (with the chat's closed
 * line when the server says closed). A send refused as closed takes the form away, is remembered, and the entry stays
 * closed; a plain network error keeps the form and its words. Real lookup, peek, nudge hook, NudgeModal and gate.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ClientLookupScreen from '../lookup/ClientLookupScreen';
import { useCoachStore } from '../../../store/coachStore';
import { closedRefusals } from '../../../components/messaging/closedRefusal';

const mockNavigate = jest.fn();
const mockSend = jest.fn(async () => ({}));
const jordan = { id: 'c1', firstName: 'Jordan', lastName: 'Reyes', status: 'active', createdAt: '2026-08-14T10:00:00.000Z', activity: { lastActiveOn: '2026-10-20', checkInsToReview: 0 } };
// Fifteen clients turn the lookup search-first, where each result row carries its own bell.
const others = Array.from({ length: 14 }, (_, i) => ({ ...jordan, id: `o${i}`, firstName: 'Sam', lastName: `Other${i}` }));
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


const BLOCKED = Object.assign(new Error('blocked'), {
  response: { status: 403, data: { code: 'messaging.blocked', error: 'messaging.blocked', message: 'This conversation is blocked.' } },
});

/** Each Nudge entry on the lookup, reached the way a coach reaches it; returns false when the entry is not drawn. */
const ENTRIES: Record<string, { many: boolean; tap: (v: ReturnType<typeof render> extends Promise<infer R> ? R : never) => Promise<boolean> }> = {
  'Needs you Nudge': { many: false, tap: async (v) => { const b = v.queryByTestId('lookup-act-c1'); if (b) await fireEvent.press(b); return !!b; } },
  'search row bell': { many: true, tap: async (v) => {
    await fireEvent.changeText(v.getByTestId('lookup-search'), 'jordan');
    const b = v.queryByTestId('lookup-nudge-c1'); if (b) await fireEvent.press(b); return !!b;
  } },
  'peek Send nudge': { many: false, tap: async (v) => {
    await fireEvent.press(v.getByTestId('lookup-row-c1'));
    await waitFor(() => expect(v.getByTestId('peek-chip-Full profile')).toBeTruthy());
    const b = v.queryByTestId('peek-nudge'); if (b) await fireEvent.press(b); return !!b;
  } },
};
const PAIRS = {
  open: { data: { total: 0, by_client: {}, closed_client_ids: [] } },
  'client blocked the coach': { data: { total: 0, by_client: {}, closed_client_ids: ['c1'] } },
  'unread read failed': null,
} as const;

async function mount(many: boolean, pair: keyof typeof PAIRS) {
  useCoachStore.setState({
    clients: (many ? [jordan, ...others] : [jordan]) as never, filterStatus: 'active', isLoading: false,
    loadError: null, loadClients: jest.fn(async () => undefined),
  });
  const answer = PAIRS[pair];
  if (answer) mockUnread.mockResolvedValue(answer); else mockUnread.mockRejectedValue(new Error('offline'));
  const view = await render(<ClientLookupScreen navigation={nav} />);
  await waitFor(() => expect(view.queryByTestId(many ? 'lookup-az-c1' : 'lookup-row-c1')).toBeTruthy());
  await act(async () => undefined);
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCache.clear();
  closedRefusals.clear('c1');
  mockSend.mockResolvedValue({});
});

// FIX-933R3 class-first (LS-933R3 B1): every Nudge entry on the lookup x every pair answer.
describe.each(Object.keys(ENTRIES))('%s', (entry) => {
  const { many, tap } = ENTRIES[entry];
  it.each(['client blocked the coach', 'unread read failed'] as const)('opens no nudge form when the pair is %s', async (pair) => {
    const view = await mount(many, pair);
    await tap(view);
    await act(async () => undefined);
    expect(view.queryByLabelText('Nudge message')).toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
    if (pair === 'client blocked the coach') expect(view.getByText('Jordan Reyes has blocked you')).toBeTruthy(); // the peek says why
  });
  it('an open pair opens the form; a 403 messaging.blocked takes it away, is remembered and the entry stays closed', async () => {
    mockSend.mockRejectedValue(BLOCKED);
    const view = await mount(many, 'open');
    expect(await tap(view)).toBe(true);
    await fireEvent.changeText(view.getByLabelText('Nudge title'), 'Check in');
    await fireEvent.changeText(view.getByLabelText('Nudge message'), 'How are you doing?');
    await fireEvent.press(view.getByText('Send'));
    await waitFor(() => expect(view.queryByLabelText('Nudge message')).toBeNull());
    expect(view.queryByText('Send')).toBeNull();
    expect(closedRefusals.has('c1')).toBe(true);
    if (view.queryByTestId('peek-close')) await fireEvent.press(view.getByTestId('peek-close'));
    await tap(view); // the same entry again, after the peek is closed and reopened
    await act(async () => undefined);
    expect(view.queryByLabelText('Nudge message')).toBeNull();
    expect(view.queryByTestId('peek-nudge')).toBeNull();
    expect(view.getByText('Jordan Reyes has blocked you')).toBeTruthy();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
  it('a plain network error keeps the form, its words and Send', async () => {
    mockSend.mockRejectedValue(new Error('offline'));
    const view = await mount(many, 'open');
    expect(await tap(view)).toBe(true);
    await fireEvent.changeText(view.getByLabelText('Nudge title'), 'Check in');
    await fireEvent.changeText(view.getByLabelText('Nudge message'), 'How are you doing?');
    await fireEvent.press(view.getByText('Send'));
    await waitFor(() => expect(view.getByText('offline')).toBeTruthy());
    expect(view.getByLabelText('Nudge message').props.value).toBe('How are you doing?');
    expect(view.getByText('Send')).toBeTruthy();
    expect(closedRefusals.has('c1')).toBe(false);
  });
});
