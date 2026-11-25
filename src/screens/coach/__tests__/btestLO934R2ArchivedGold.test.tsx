/** B-TEST LO-934R2 B1: with the Clients filter on Archived, Home's gold safety card opens a list with no safety row (KT-3). */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockGetClients = jest.fn();
const mockUnread = jest.fn();
const mockSendNudge = jest.fn();
const mockPrefs = new Map<string, string>(); // this phone's saved block list (blockedUsersStore)
const mockListBlocked = jest.fn(); // GET /users/blocks
const mockCache = new Map<string, string>();
const mockHaptic = { success: jest.fn(), error: jest.fn(), warning: jest.fn(), selection: jest.fn() };
const mockRenders = { az: 0 }; // A to Z row renders (Opus B1: a scroll must not redraw the rows)
jest.mock('../../../services/api', () => ({
  coachApi: { getClients: (...a: unknown[]) => mockGetClients(...a), getUnreadCounts: () => mockUnread(), sendNudge: (...a: unknown[]) => mockSendNudge(...a) },
}));
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: { getStringAsync: async (k: string) => mockCache.get(k), set: async (k: string, v: string) => void mockCache.set(k, v) },
  prefsStorage: { getString: () => undefined, getStringAsync: async (k: string) => mockPrefs.get(k), set: async (k: string, v: string) => void mockPrefs.set(k, v), delete: async (k: string) => void mockPrefs.delete(k) },
}));
jest.mock('../../../api/messagesApi', () => ({ messagesModerationApi: { listBlocked: () => mockListBlocked() } }));
const mockQueue = jest.fn(); // GET .../action-queue: the open alerts the Needs you list groups (NEEDS-YOU-M)
jest.mock('../../../services/commandCenterApi', () => ({
  ...jest.requireActual('../../../services/commandCenterApi'),
  commandCenterApi: { getActionQueue: () => mockQueue() },
}));
jest.mock('../../../ui/haptics/haptics.service', () => ({ get HapticService() { return mockHaptic; } }));
let mockRole: string | undefined = 'coach';
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: mockRole }) }));
jest.mock('../../../theme/ThemeProvider', () => {
  const anyColor = new Proxy({}, { get: () => '#000000' });
  return { useTheme: () => ({ colors: anyColor, semanticColors: anyColor }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../components/HapticPressable', () => {
  const { Pressable } = jest.requireActual('react-native');
  const { createElement } = jest.requireActual('react');
  return (p: { testID?: string }) => { if (p.testID?.startsWith('lookup-az-')) mockRenders.az += 1; return createElement(Pressable, p); };
});
const mockText = (t: string) => React.createElement(jest.requireActual('react-native').Text, null, t);
jest.mock('../../../ui', () => ({ Overline: jest.requireActual('react-native').Text, useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../../ui/states/QuietStates', () => ({ QuietLoading: () => mockText('Loading clients'), QuietError: (p: { message: string }) => mockText(p.message) }));
jest.mock('../../../ui/empty-states', () => ({ EmptyStateNoResults: () => mockText('No results') }));
// The peek sheet has its own tests (ClientPeekUI4); here a stub proves the lookup routes each of its taps.
type MockPeek = { client: { id: string } | null; onOpen: (c: unknown, t: unknown) => void; onNudge: (c: unknown) => void; children?: React.ReactNode };
jest.mock('../lookup/ClientPeekSheet', () => ({
  __esModule: true,
  default: (p: MockPeek) => {
    const { createElement: h } = jest.requireActual('react');
    const { Pressable, View } = jest.requireActual('react-native');
    const tap = (id: string, run: () => void) => h(Pressable, { testID: id, onPress: run });
    return p.client ? h(View, null, mockText(`peek ${p.client.id}`),
      tap('stub-logs', () => p.onOpen(p.client, { screen: 'ClientDetail', tab: 'logs' })),
      tap('stub-pay', () => p.onOpen(p.client, { screen: 'ClientPayments' })),
      tap('stub-message', () => p.onOpen(p.client, { screen: 'chat' })),
      tap('stub-nudge', () => p.onNudge(p.client)), p.children) : null;
  },
}));
jest.mock('../../../components/home/PushPermissionCard', () => () => mockText('push-ask'));
jest.mock('../../../navigation/coachLanding', () => ({ coachLandingTab: () => 'ClientsStack' }));

import ClientLookupScreen from '../lookup/ClientLookupScreen';
import { CoachTeamEntryContext } from '../../../navigation/coachTeamEntry';
import { useCoachStore } from '../../../store/coachStore';
import { featureFlags } from '../../../config/featureFlags';

// Pins EXPO_PUBLIC_FF_COACH_TABS_V2 off: this file opens chats over the Clients list (coachInbox.ts:18 sends them to Messages when on).
jest.replaceProperty(featureFlags, 'coachTabsV2', false);

const pad = (n: number) => String(n).padStart(2, '0');
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
type Act = { last?: string | null; review?: number; workout?: string };
const wire = (id: string, name: string, a: Act = {}, joined = day(-60)) => ({
  id, name, email: `${id}@example.com`, created_at: `${joined}T10:00:00.000Z`,
  activity: { shared: true, last_active_on: a.last ?? null, check_ins_to_review: a.review ?? 0, last_workout_on: a.workout ?? null },
});
const navigate = jest.fn();
let focused = true;
let onFocus: (() => void) | undefined;
const setParams = jest.fn();
let onTabBlur: (() => void) | undefined; // the Clients tab (the lookup's parent) losing focus
const parent = { navigate, addListener: (_e: string, cb: () => void) => ((onTabBlur = cb), () => { onTabBlur = undefined; }) };
const nav = { navigate, setParams, isFocused: () => focused, addListener: (_e: string, cb: () => void) => ((onFocus = cb), () => undefined), getParent: () => parent } as never;

const UNDER_15 = [wire('c1', 'Maya Brooks', { last: day(0), review: 2 }), wire('c2', 'Theo Grant', { last: day(0), workout: day(0) }), wire('c3', 'Priya Nair', {}, day(-2))];

beforeEach(() => {
  jest.clearAllMocks(); mockCache.clear(); useCoachStore.getState().reset(); focused = true; mockRole = 'coach'; onTabBlur = undefined;
  mockListBlocked.mockResolvedValue({ blocked: [] });
  mockQueue.mockResolvedValue({ data: { items: [] } });
});

describe('LO-934R2 B1: the gold card lands on the safety alert even when the Clients filter is on Archived', () => {
  it('Home sends view needs; the list still shows the open safety alert, two taps to the alert', async () => {
    useCoachStore.setState({ filterStatus: 'archived' }); // the coach looked at Archived on the Clients tab, then went Home
    mockQueue.mockResolvedValue({ data: { items: [{
      alert_id: 'a1', alert_type: 'roman_crisis_reply', client_id: 'c9', client_name: 'Avery Cole', message: 'x',
      created_at: new Date().toISOString(), sent_at: new Date(Date.now() - 2 * 3_600_000).toISOString(), dismissed_at: null, quote: null,
    }] } });
    mockGetClients.mockImplementation(async (status: string) => (status === 'archived' ? { data: [wire('z1', 'Zed Old')] } : { data: UNDER_15 }));
    mockUnread.mockResolvedValue({ data: { total: 0, by_client: {} } });
    await render(<CoachTeamEntryContext.Provider value><ClientLookupScreen navigation={nav} route={{ params: { view: 'needs' } } as never} /></CoachTeamEntryContext.Provider>);
    await waitFor(() => expect(mockQueue).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Loading clients')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('needs-safety-a1')).toBeTruthy(), { timeout: 2000 });
    await fireEvent.press(screen.getByTestId('needs-safety-a1'));
    expect(navigate).toHaveBeenLastCalledWith('CoachSafetyAlert', expect.objectContaining({ clientId: 'c9' }));
  });
});
