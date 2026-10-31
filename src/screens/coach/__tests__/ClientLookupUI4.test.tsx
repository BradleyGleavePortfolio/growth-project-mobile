/**
 * UI-4 (V1_1_UI_SPEC) — coach client lookup behind featureFlags.coachClientLookup. Every tap lands on a real
 * screen; a client the roster no longer returns (moved, owner 4) never shows, even from Opened recently.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { ScrollView, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

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
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import { featureFlags } from '../../../config/featureFlags';
import { dayWord, groupByLetter, lastLoggedWord, lookupReason, needsYouSentence, parseLookupQuery, recentFromRoster } from '../../../utils/coach/clientLookup';
import type { RosterClient } from '../../../utils/coach/clientRoster';
import { needsAndSteady } from '../home-v11/useCoachHomeV11';

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
// Six tabs off, a chat opens over the lookup through openInboxChat (the six-tab placement: navigation/__tests__/coachTabsV2.test.tsx).
const chatOverList = (clientId: string, clientName: string) => ['ClientsStack', { screen: 'ClientMessages', params: { clientId, clientName }, initial: false }];

async function mount(rows: ReturnType<typeof wire>[], unread: Record<string, number> = {}, archivedReply = async (_cursor?: string) => ({ data: [wire('z1', 'Zed Old')] }), route?: { params: { view: 'needs' } }) {
  mockGetClients.mockImplementation(async (status: string, cursor?: string) => (status === 'archived' ? archivedReply(cursor) : { data: rows }));
  mockUnread.mockResolvedValue({ data: { total: 0, by_client: unread } });
  await render(<CoachTeamEntryContext.Provider value><ClientLookupScreen navigation={nav} route={route as never} /></CoachTeamEntryContext.Provider>);
  await waitFor(() => expect(screen.getByTestId('lookup-count')).toBeTruthy());
  await waitFor(() => expect(screen.queryByText('Loading clients')).toBeNull()); // this phone's block list is read first
}

const UNDER_15 = [wire('c1', 'Maya Brooks', { last: day(0), review: 2 }), wire('c2', 'Theo Grant', { last: day(0), workout: day(0) }), wire('c3', 'Priya Nair', {}, day(-2))];
const NAMES = ['Ana Lopez', 'Ava Price', 'Ben Carter', 'Bianca Shah', 'Chloe Dunn', 'Dev Patel', 'Elena Ruiz', 'Finn Walsh',
  'Grace Kim', 'Maya Brooks', 'Omar Haddad', 'Priya Nair', 'Sam Okafor', 'Theo Grant', 'Uma Reyes'];
const MANY = NAMES.map((n, i) => wire(`m${i}`, n, n === 'Ben Carter' ? { last: day(-5) } : n === 'Ava Price' ? {} : { last: day(-1) }));

beforeEach(() => {
  jest.clearAllMocks(); mockCache.clear(); useCoachStore.getState().reset(); focused = true; mockRole = 'coach'; onTabBlur = undefined;
  mockListBlocked.mockResolvedValue({ blocked: [] });
});
// The store as the app leaves it once this coach's list is read (a block made a moment ago is in it), and the server's
// list, which names the block too: Block posts it first, and GET /users/blocks's answer replaces this phone's copy (FX-872).
const blockedNow = (id: string, displayName: string) => {
  mockListBlocked.mockResolvedValue({ blocked: [{ blockedId: id, displayName, blockedAt: '2026-10-20T10:00:00Z' }] });
  useBlockedUsersStore.setState({ blocked: [{ id, displayName, role: 'client', blockedAt: '2026-10-20T10:00:00Z' }], hydrated: true, userId: 'coach-1' });
};

describe('UI-4 helpers', () => {
  it('reads typed filter words and writes the Needs you sentence with number words', () => {
    expect(parseLookupQuery(' Review  messages ')).toEqual({ filters: ['review', 'messages'], text: '' });
    expect([needsYouSentence(2, 1), needsYouSentence(1, 0), needsYouSentence(0, 3)]).toEqual(['Two need you today. One is steady.', 'One needs you today.', 'Three are steady.']);
  });
  it('the sentence never prints a numeral: counts past Nineteen are spelled, and past 14 steady clients Everyone holds the number (LO-847 B1)', () => {
    expect([needsYouSentence(6, 94), needsYouSentence(0, 100), needsYouSentence(23, 77), needsYouSentence(5, 14), needsYouSentence(0, 15)]).toEqual([
      'Six need you today. Everyone else is steady.', 'Everyone is steady.', 'Twenty-three need you today. Everyone else is steady.',
      'Five need you today. Fourteen are steady.', 'Everyone is steady.',
    ]);
    expect([needsYouSentence(40, 0), needsYouSentence(106, 0), needsYouSentence(100, 0)]).toEqual(['Forty need you today.', 'One hundred and six need you today.', 'One hundred need you today.']);
    for (let n = 1; n < 1000; n += 1) expect(needsYouSentence(n, n)).not.toMatch(/\d/);
  });
  it('never shows an empty value: nothing logged says so', () => {
    const c = (a: Act) => ({ id: 'x', firstName: 'Ava', lastName: 'Price', email: '', createdAt: day(-30), activity: { lastActiveOn: a.last ?? null, checkInsToReview: 0 } }) as unknown as RosterClient;
    expect(lastLoggedWord(c({}))).toBe('Nothing logged yet');
    expect(lookupReason(c({ last: day(-1) }), { x: 3 }, 'recent')).toEqual({ text: '3 new messages', action: 'reply', ok: false });
    expect([dayWord(day(0)), dayWord(day(-1))]).toEqual(['Today', 'Yesterday']);
  });
  it('groups A to Z and keeps only recent ids the roster still returns (moved clients drop out)', () => {
    const roster = [{ id: 'a', firstName: 'Ana', lastName: 'L' }, { id: 'b', firstName: 'Ben', lastName: 'C' }] as RosterClient[];
    expect(groupByLetter(roster).map((g) => g.letter)).toEqual(['A', 'B']);
    expect(recentFromRoster(['moved', 'b'], roster).map((c) => c.id)).toEqual(['b']);
  });
  it('ships OFF: default false and not switched on in any eas.json profile', () => {
    expect(featureFlags.coachClientLookup).toBe(false);
    const eas = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'eas.json'), 'utf8');
    expect(eas).not.toMatch(/EXPO_PUBLIC_FF_COACH_CLIENT_LOOKUP/);
  });
});

describe('UI-4 Needs you (under 15 clients)', () => {
  it('matches the mockup: count, sentence, Review / Say hello, and the steady row', async () => {
    await mount(UNDER_15);
    for (const t of ['3 active clients', 'Two need you today. One is steady.', '2 check-ins to review', 'Logged today, workout done', 'New, no logs yet', 'Add your next client', 'Archived', 'push-ask']) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.queryByTestId('lookup-search')).toBeNull();
  });
  it('every button opens a real screen', async () => {
    await mount(UNDER_15);
    await fireEvent.press(screen.getByTestId('lookup-act-c1'));
    expect(navigate).toHaveBeenLastCalledWith('ClientDetail', { clientId: 'c1', clientName: 'Maya Brooks', initialTab: 'timeline' });
    await fireEvent.press(screen.getByTestId('lookup-act-c3'));
    expect(navigate).toHaveBeenLastCalledWith(...chatOverList('c3', 'Priya Nair')); // Say hello
    await fireEvent.press(screen.getByTestId('lookup-row-c2'));
    expect(screen.getByText('peek c2')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('stub-logs'));
    expect(navigate).toHaveBeenLastCalledWith('ClientDetail', { clientId: 'c2', clientName: 'Theo Grant', initialTab: 'logs' });
    expect(screen.queryByText('peek c2')).toBeNull();
    await fireEvent.press(screen.getByTestId('lookup-row-c2'));
    await fireEvent.press(screen.getByTestId('stub-pay'));
    expect(navigate).toHaveBeenLastCalledWith('ClientPayments', { clientId: 'c2', clientName: 'Theo Grant' });
    await fireEvent.press(screen.getByTestId('lookup-row-c2'));
    await fireEvent.press(screen.getByTestId('stub-message')); // Message {first}
    expect(navigate).toHaveBeenLastCalledWith(...chatOverList('c2', 'Theo Grant'));
    expect(screen.queryByText('peek c2')).toBeNull();
    await fireEvent.press(screen.getByTestId('lookup-row-c2'));
    await fireEvent.press(screen.getByTestId('stub-nudge'));
    expect(screen.getByText('peek c2')).toBeTruthy(); // the nudge form opens over the sheet
    expect(screen.getByPlaceholderText('e.g. Great job today')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('lookup-share-code'));
    expect(navigate).toHaveBeenLastCalledWith('InviteCodes');
    await fireEvent.press(screen.getByTestId('lookup-invite'));
    expect(navigate).toHaveBeenLastCalledWith('InviteCodes');
    await fireEvent.press(screen.getByTestId('lookup-team-entry')); // COACHTABS: Team opens from Clients
    expect(navigate).toHaveBeenLastCalledWith('TeamStack');
    await fireEvent.press(screen.getByTestId('lookup-archived-link'));
    await waitFor(() => expect(screen.getByText('1 archived client')).toBeTruthy());
  });
  it.each([['3 active clients', UNDER_15], ['15 active clients', null]])('a failed pull-to-refresh keeps "%s" and says it did not refresh (Opus B3)', async (count, rows) => {
    await mount(rows ?? MANY);
    mockGetClients.mockRejectedValue(new Error('offline'));
    await act(async () => { await screen.getByTestId('lookup-scroll').props.refreshControl.props.onRefresh(); });
    expect(screen.getByText('Clients did not refresh. Pull down to try again.')).toBeTruthy();
    expect(screen.getByText(count)).toBeTruthy();
    expect(screen.getAllByText('Maya Brooks').length).toBeGreaterThan(0); // the last list stays
  });
  it('a failed switch to Archived does not count the active list as archived', async () => {
    await mount(MANY, {}, async () => { throw new Error('offline'); });
    await fireEvent.press(screen.getByTestId('lookup-chip-archived'));
    await waitFor(() => expect(screen.getByText('Clients did not refresh. Pull down to try again.')).toBeTruthy());
    expect(screen.queryByText(/archived clients/)).toBeNull();
  });
  it('view "needs" (the coach Home Needs you tile) shows the Needs you list at 15 or more, only clients with an action', async () => {
    const rows = [...NAMES.slice(0, 14).map((n, i) => wire(`m${i}`, n, { last: day(-1) })), wire('n1', 'Nina Cole', { last: day(0), review: 1 })];
    await mount(rows, {}, undefined, { params: { view: 'needs' } });
    expect(screen.queryByTestId('lookup-search')).toBeNull();
    expect(screen.getByText('One needs you today. Fourteen are steady.')).toBeTruthy();
    expect(screen.getByTestId('lookup-act-n1')).toBeTruthy();
    expect(screen.queryByTestId('lookup-row-m0')).toBeNull(); // steady clients stay on the full list
    // LO-690-695 C1: Everyone leaves the view without leaving the tab.
    expect(screen.getByLabelText('Everyone, 15')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('lookup-everyone-link'));
    expect(setParams).toHaveBeenLastCalledWith({ view: undefined });
  });
  it('view "needs" at 60 clients: the top sentence spells the count and leaves the steady number to Everyone (LO-847 B1)', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => wire(`p${i}`, `Pat ${String.fromCharCode(65 + (i % 26))}${i}`, i < 17 ? { last: day(0), review: 1 } : { last: day(-1) }));
    await mount(rows, {}, undefined, { params: { view: 'needs' } });
    expect(screen.getByTestId('lookup-sentence').props.children).toBe('Seventeen need you today. Everyone else is steady.');
    expect(screen.getByLabelText('Everyone, 60')).toBeTruthy();
  });
  it('view "needs" ends when Clients loses the tab, so the tab reopens on the full list; with no one waiting it reads the steady sentence (LO-690-695 C1)', async () => {
    await mount([wire('s1', 'Ava Price', { last: day(0) }), wire('s2', 'Ben Carter', { last: day(-1) })], {}, undefined, { params: { view: 'needs' } });
    expect(screen.getByText('Two are steady.')).toBeTruthy();
    expect(screen.queryByTestId('lookup-act-s1')).toBeNull();
    expect(screen.getByTestId('lookup-everyone-link')).toBeTruthy();
    await act(async () => onTabBlur?.());
    expect(setParams).toHaveBeenCalledWith({ view: undefined });
  });
  it('the full list never listens for the tab and shows no Everyone link', async () => {
    await mount(UNDER_15);
    expect(onTabBlur).toBeUndefined();
    expect(screen.queryByTestId('lookup-everyone-link')).toBeNull();
  });
  it.each(['coach', 'owner'])('%s: the At risk pill opens the risk board, as on today\'s list (LO-690-695 C2)', async (role) => {
    mockRole = role;
    await mount(MANY);
    expect(screen.getByText('Bianca Shah').props.numberOfLines).toBe(2); // the A to Z name wraps, never an ellipsis
    await fireEvent.press(screen.getByTestId('lookup-risk'));
    expect(navigate).toHaveBeenLastCalledWith('RiskBoard');
  });
  it.each(['sub_coach', 'student', undefined])('role %s: no At risk pill (the board answers 403)', async (role) => {
    mockRole = role;
    await mount(UNDER_15);
    expect(screen.queryByTestId('lookup-risk')).toBeNull();
  });
  it('Invite, At risk and every Needs you control is a 44 pt target with no hitSlop; names wrap to two lines (LO-690-695 C3, C4)', async () => {
    await mount(UNDER_15, {}, undefined, { params: { view: 'needs' } });
    for (const id of ['lookup-invite', 'lookup-risk', 'lookup-act-c1', 'lookup-everyone-link', 'lookup-share-code', 'lookup-archived-link']) {
      const el = screen.getByTestId(id);
      expect(StyleSheet.flatten(el.props.style).minHeight).toBeGreaterThanOrEqual(44);
      expect(el.props.hitSlop ?? null).toBeNull();
    }
    expect(screen.getByText('Maya Brooks').props.numberOfLines).toBe(2);
    expect(screen.getByText('2 check-ins to review').props.numberOfLines).toBe(3); // the reason beside an action button
  });
  it.each([[true, 0], [false, 1]])('mounted focused %s: the first focus reloads the roster and side counts %s times (Sol B2: Clients mounts unseen)', async (seen, reloads) => {
    focused = seen;
    await mount(UNDER_15);
    expect(screen.queryByText('2 new messages')).toBeNull();
    const [rosterReads, unreadReads] = [mockGetClients.mock.calls.length, mockUnread.mock.calls.length];
    mockUnread.mockResolvedValue({ data: { total: 2, by_client: { c2: 2 } } });
    await act(async () => onFocus?.()); // the first visit
    expect([mockGetClients.mock.calls.length - rosterReads, mockUnread.mock.calls.length - unreadReads]).toEqual([2 * reloads, reloads]);
    expect(screen.queryAllByText('2 new messages')).toHaveLength(reloads); // Theo's row: Reply
  });
  it.each(['full first page', 'failed read'])('Archived stays reachable when its count is unknown (%s); the chip returns to Active', async (mode) => {
    let reads = 0; // the first archived read is the count
    await mount(UNDER_15, {}, async (cursor) => {
      if (reads++ === 0 && mode === 'failed read') throw new Error('offline');
      return { data: cursor ? [] : Array.from({ length: 50 }, (_, i) => wire(`z${i}`, `Zed Old ${i}`)) };
    });
    await waitFor(() => expect(reads).toBeGreaterThan(0));
    await fireEvent.press(screen.getByTestId('lookup-archived-link'));
    await waitFor(() => expect(screen.getByText('50 archived clients')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('lookup-chip-archived'));
    await waitFor(() => expect(screen.getByText('3 active clients')).toBeTruthy());
  });
});

describe('UI-4 Search first (15 or more)', () => {
  it('shows the search, chips with counts, A to Z sections and the tip', async () => {
    await mount(MANY, { m3: 2 });
    expect(screen.getByText('15 active clients')).toBeTruthy();
    expect(screen.getByTestId('lookup-search').props.placeholder).toBe('Name, email or a filter');
    expect(['messages', 'quiet'].map((f) => screen.getByTestId(`lookup-chip-${f}`).props.accessibilityLabel)).toEqual(['New messages, 1', 'Quiet 3+ days, 2']);
    expect(screen.getByText('Nothing logged yet')).toBeTruthy();
    expect(screen.getByTestId('lookup-letter-A')).toBeTruthy();
    expect(screen.getByText(/filters combine with typing/)).toBeTruthy();
  });
  it('"quiet ben" finds Ben Carter, and a chip narrows the list', async () => {
    await mount(MANY);
    await fireEvent.changeText(screen.getByTestId('lookup-search'), 'quiet ben');
    expect(screen.getByText('1 result')).toBeTruthy();
    expect(screen.getByText('Ben Carter')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('lookup-search'), '');
    await fireEvent.press(screen.getByTestId('lookup-chip-quiet'));
    expect(screen.getByText('2 results')).toBeTruthy();
    expect(screen.getByText('Ava Price')).toBeTruthy();
  });
  it('a client this coach blocked gets no messaging on any row (owner, b#1141): no Say hello, Reply, Message or Nudge; Review and the row stay', async () => {
    blockedNow('c3', 'Priya Nair');
    try {
      await mount(UNDER_15);
      expect([screen.queryByTestId('lookup-act-c3'), !!screen.getByTestId('lookup-row-c3'), !!screen.getByTestId('lookup-act-c1')]).toEqual([null, true, true]);
      expect(screen.getByText('One needs you today. Two are steady.')).toBeTruthy(); // Priya's Say hello is not counted
    } finally {
      useBlockedUsersStore.setState({ blocked: [] });
    }
  });
  it('the same on the 15+ list: a blocked client keeps the row with no Message or Nudge; an unblocked one keeps both', async () => {
    blockedNow('m2', 'Ben Carter');
    try {
      await mount(MANY);
      await fireEvent.changeText(screen.getByTestId('lookup-search'), 'ben');
      expect([!!screen.getByTestId('lookup-row-m2'), screen.queryByTestId('lookup-message-m2'), screen.queryByTestId('lookup-nudge-m2')]).toEqual([true, null, null]);
      await fireEvent.changeText(screen.getByTestId('lookup-search'), 'bianca');
      expect([!!screen.getByTestId('lookup-message-m3'), !!screen.getByTestId('lookup-nudge-m3')]).toEqual([true, true]); // control: not blocked
    } finally {
      useBlockedUsersStore.setState({ blocked: [] });
    }
  });
  describe('on a cold start (LO m#866 B1): the lookup reads the block list itself, before any chat screen has', () => {
    const KEY = 'blocked_user_ids_v1:coach-1';
    const PRIYA = { id: 'c3', displayName: 'Priya Nair', role: 'client', blockedAt: '2026-10-20T10:00:00Z' };
    const appStart = () => useBlockedUsersStore.setState({ blocked: [], hydrated: false, userId: null }); // nothing read yet
    beforeEach(() => { mockPrefs.clear(); appStart(); });
    afterEach(() => { mockPrefs.clear(); appStart(); });
    it("a client blocked earlier on this phone (its saved list; the server down) gets no Say hello and no count", async () => {
      mockPrefs.set(KEY, JSON.stringify([PRIYA]));
      mockListBlocked.mockRejectedValue(new Error('Network Error'));
      await mount(UNDER_15);
      expect([screen.queryByTestId('lookup-act-c3'), !!screen.getByTestId('lookup-row-c3'), !!screen.getByTestId('lookup-act-c1')]).toEqual([null, true, true]);
      expect(screen.getByText('One needs you today. Two are steady.')).toBeTruthy();
    });
    it('a client GET /users/blocks names (blocked on another phone) loses Message and Nudge on the 15+ list', async () => {
      mockListBlocked.mockResolvedValue({ blocked: [{ blockedId: 'm2', displayName: 'Ben Carter', blockedAt: '2026-10-20T10:00:00Z' }] });
      await mount(MANY);
      await fireEvent.changeText(screen.getByTestId('lookup-search'), 'ben');
      await waitFor(() => expect(screen.queryByTestId('lookup-message-m2')).toBeNull());
      expect([!!screen.getByTestId('lookup-row-m2'), screen.queryByTestId('lookup-nudge-m2')]).toEqual([true, null]);
    });
    it('shows no row with an action until the saved list is read', async () => {
      mockListBlocked.mockResolvedValue({ blocked: [{ blockedId: 'c3', displayName: 'Priya Nair', blockedAt: PRIYA.blockedAt }] }); // the server's list names her too
      let done: (v: string | undefined) => void = () => undefined;
      const read = jest.requireMock('../../../storage/mmkv').prefsStorage;
      const was = read.getStringAsync;
      read.getStringAsync = (k: string) => (k === KEY ? new Promise((r) => { done = r; }) : was(k));
      try {
        mockGetClients.mockImplementation(async (status: string) => (status === 'archived' ? { data: [] } : { data: UNDER_15 }));
        mockUnread.mockResolvedValue({ data: { total: 0, by_client: {} } });
        await render(<CoachTeamEntryContext.Provider value><ClientLookupScreen navigation={nav} /></CoachTeamEntryContext.Provider>);
        await waitFor(() => expect(screen.getByTestId('lookup-count')).toBeTruthy());
        expect([!!screen.getByText('Loading clients'), screen.queryByTestId('lookup-act-c1'), screen.queryByTestId('lookup-act-c3')]).toEqual([true, null, null]);
        await act(async () => { done(JSON.stringify([PRIYA])); });
        await waitFor(() => expect(screen.getByTestId('lookup-act-c1')).toBeTruthy());
        expect(screen.queryByTestId('lookup-act-c3')).toBeNull();
      } finally { read.getStringAsync = was; }
    });
  });
  it("the Home's Needs you tile counts what this list shows, a blocked client with an action left out of both (LO m#866 B2)", async () => {
    blockedNow('c3', 'Priya Nair'); // Priya, new this week, would get Say hello
    try {
      await mount(UNDER_15, {}, undefined, { params: { view: 'needs' } });
      const listed = screen.queryAllByTestId(/^lookup-row-/).length;
      const blockedIds = new Set(useBlockedUsersStore.getState().blocked.map((b) => b.id));
      const tile = needsAndSteady(useCoachStore.getState().clients, {}, new Date(), blockedIds).needs.length;
      expect([listed, tile]).toEqual([1, 1]);
      expect(needsAndSteady(useCoachStore.getState().clients, {}, new Date()).needs.length).toBe(2); // control: unblocked, Priya counts
    } finally {
      useBlockedUsersStore.setState({ blocked: [] });
    }
  });
  it('message and bell open the thread and the nudge form; a sent nudge gives the success haptic', async () => {
    mockSendNudge.mockResolvedValue({});
    await mount(MANY);
    await fireEvent.changeText(screen.getByTestId('lookup-search'), 'ben');
    await fireEvent.press(screen.getByTestId('lookup-message-m2'));
    expect(navigate).toHaveBeenLastCalledWith(...chatOverList('m2', 'Ben Carter'));
    await fireEvent.press(screen.getByTestId('lookup-nudge-m2'));
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Great job today'), 'Checking in');
    await fireEvent.changeText(screen.getByPlaceholderText('Write a short message...'), 'How is the week going');
    await fireEvent.press(screen.getByLabelText('Send nudge'));
    expect(mockSendNudge).toHaveBeenCalledWith('m2', { title: 'Checking in', body: 'How is the week going' });
    expect(mockHaptic.success).toHaveBeenCalled();
  });
  it('Opened recently lists only clients still on the roster, and opening one records it', async () => {
    mockCache.set('coach_lookup_recent:coach-1', JSON.stringify(['moved-away', 'm9']));
    await mount(MANY);
    await waitFor(() => expect(screen.getByText('Opened recently')).toBeTruthy());
    expect(screen.getAllByText('Maya Brooks').length).toBe(2);
    expect(screen.queryByTestId('lookup-row-moved-away')).toBeNull();
    await fireEvent.press(screen.getByTestId('lookup-az-m0'));
    expect(screen.getByText('peek m0')).toBeTruthy();
    await waitFor(() => expect(JSON.parse(mockCache.get('coach_lookup_recent:coach-1') ?? '[]')).toEqual(['m0', 'moved-away', 'm9']));
  });
  it('the side index appears once Everyone is near the top; a touch, a slide or a screen reader step jumps to a letter', async () => {
    await mount(MANY);
    await fireEvent(screen.getByTestId('lookup-everyone'), 'layout', { nativeEvent: { layout: { y: 600, height: 20 } } });
    for (const [l, y] of [['A', 0], ['B', 140], ['C', 260]] as const) await fireEvent(screen.getByTestId(`lookup-letter-${l}`), 'layout', { nativeEvent: { layout: { y, height: 120 } } });
    expect(screen.queryByTestId('lookup-index')).toBeNull(); // not over the header, search or chips
    await fireEvent.scroll(screen.getByTestId('lookup-scroll'), { nativeEvent: { contentOffset: { y: 600 } } });
    const index = () => screen.getByTestId('lookup-index');
    expect(index().props).toMatchObject({ accessibilityRole: 'adjustable', accessibilityLabel: 'A to Z' });
    expect(StyleSheet.flatten(index().props.style).width).toBeGreaterThanOrEqual(44); // one 44 pt wide control, not 26 small taps
    const scrollTo = (ScrollView.prototype as unknown as { scrollTo: jest.Mock }).scrollTo;
    scrollTo.mockClear();
    await fireEvent(index(), 'layout', { nativeEvent: { layout: { height: 260 } } }); // 10 pt a letter
    await fireEvent(index(), 'responderGrant', { nativeEvent: { locationY: 15 } }); // touch B
    expect(index().props.accessibilityValue).toEqual({ text: 'B' });
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ animated: true }));
    await fireEvent(index(), 'responderMove', { nativeEvent: { locationY: 25 } }); // slide to C
    expect(index().props.accessibilityValue).toEqual({ text: 'C' });
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ animated: false }));
    await fireEvent(index(), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } }); // VoiceOver swipe down
    expect(index().props.accessibilityValue).toEqual({ text: 'B' });
    expect(mockHaptic.selection).toHaveBeenCalledTimes(3);
  });
  it.each([15, 300])('a scroll redraws no client row at %s clients (Opus B1)', async (n) => {
    const rows = n === 15 ? MANY : Array.from({ length: n }, (_, i) => wire(`r${i}`, `${String.fromCharCode(65 + (i % 26))}lex Person${i}`, { last: day(-1) }));
    await mount(rows);
    await fireEvent(screen.getByTestId('lookup-everyone'), 'layout', { nativeEvent: { layout: { y: 600, height: 20 } } });
    const before = mockRenders.az;
    for (const y of [0, 120, 380, 420, 900, 2400, 300, 5000]) await fireEvent.scroll(screen.getByTestId('lookup-scroll'), { nativeEvent: { contentOffset: { y } } });
    expect(mockRenders.az - before).toBe(0);
    expect(screen.getByTestId('lookup-index')).toBeTruthy(); // the index still follows the scroll
  });
  it('every filter chip and Archived is a 44 pt target around a 36 pt pill (Opus B2, Sol B3)', async () => {
    await mount(MANY);
    for (const id of ['review', 'messages', 'quiet', 'new', 'archived']) {
      expect(StyleSheet.flatten(screen.getByTestId(`lookup-chip-${id}`).props.style).minHeight).toBeGreaterThanOrEqual(44);
    }
  });
  it('a cancelled nudge stays with its client: A, Cancel, B opens a clean form; A again keeps A\'s words (Sol B1)', async () => {
    mockSendNudge.mockResolvedValue({});
    await mount(MANY);
    await fireEvent.changeText(screen.getByTestId('lookup-search'), 'ben');
    await fireEvent.press(screen.getByTestId('lookup-nudge-m2'));
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Great job today'), 'Ben');
    await fireEvent.changeText(screen.getByPlaceholderText('Write a short message...'), 'For Ben only');
    await fireEvent.press(screen.getByLabelText('Cancel'));
    await fireEvent.press(screen.getByTestId('lookup-nudge-m2')); // same client: the draft is kept
    // Send and Cancel stay above the keyboard (the test renderer keeps host views only, so this reads the form's source).
    expect(fs.readFileSync(path.join(__dirname, '..', 'client-detail', 'NudgeModal.tsx'), 'utf8')).toMatch(/<KeyboardAvoidingView behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\} style=\{styles\.nudgeModalOverlay\}>/);
    for (const l of ['Cancel', 'Send nudge']) expect(StyleSheet.flatten(screen.getByLabelText(l).props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(screen.getByPlaceholderText('Write a short message...').props.value).toBe('For Ben only');
    await fireEvent.press(screen.getByLabelText('Cancel'));
    await fireEvent.changeText(screen.getByTestId('lookup-search'), 'theo');
    await fireEvent.press(screen.getByTestId('lookup-nudge-m13')); // another client: a clean form
    expect([screen.getByPlaceholderText('e.g. Great job today').props.value, screen.getByPlaceholderText('Write a short message...').props.value]).toEqual(['', '']);
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Great job today'), 'Theo');
    await fireEvent.changeText(screen.getByPlaceholderText('Write a short message...'), 'For Theo');
    await fireEvent.press(screen.getByLabelText('Send nudge'));
    expect(mockSendNudge).toHaveBeenCalledTimes(1);
    expect(mockSendNudge).toHaveBeenCalledWith('m13', { title: 'Theo', body: 'For Theo' });
  });
});
