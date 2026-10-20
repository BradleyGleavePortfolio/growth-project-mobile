/**
 * UI-4 (V1_1_UI_SPEC) — coach client lookup behind featureFlags.coachClientLookup. Every tap lands on a real
 * screen; a client the roster no longer returns (moved, owner 4) never shows, even from Opened recently.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { KeyboardAvoidingView, ScrollView, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockGetClients = jest.fn();
const mockUnread = jest.fn();
const mockSendNudge = jest.fn();
const mockCache = new Map<string, string>();
const mockHaptic = { success: jest.fn(), error: jest.fn(), warning: jest.fn(), selection: jest.fn() };
const mockRenders = { az: 0 }; // A to Z row renders (Opus B1: a scroll must not redraw the rows)
jest.mock('../../../services/api', () => ({
  coachApi: { getClients: (...a: unknown[]) => mockGetClients(...a), getUnreadCounts: () => mockUnread(), sendNudge: (...a: unknown[]) => mockSendNudge(...a) },
}));
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: { getStringAsync: async (k: string) => mockCache.get(k), set: async (k: string, v: string) => void mockCache.set(k, v) },
}));
jest.mock('../../../ui/haptics/haptics.service', () => ({ get HapticService() { return mockHaptic; } }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
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
import { dayWord, groupByLetter, lastLoggedWord, lookupReason, needsYouSentence, parseLookupQuery, recentFromRoster } from '../../../utils/coach/clientLookup';
import type { RosterClient } from '../../../utils/coach/clientRoster';

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
const nav = { navigate, isFocused: () => focused, addListener: (_e: string, cb: () => void) => ((onFocus = cb), () => undefined), getParent: () => ({ navigate }) } as never;
// Six tabs off, a chat opens over the lookup through openInboxChat (the six-tab placement: navigation/__tests__/coachTabsV2.test.tsx).
const chatOverList = (clientId: string, clientName: string) => ['ClientsStack', { screen: 'ClientMessages', params: { clientId, clientName }, initial: false }];

async function mount(rows: ReturnType<typeof wire>[], unread: Record<string, number> = {}, archivedReply = async (_cursor?: string) => ({ data: [wire('z1', 'Zed Old')] }), route?: { params: { view: 'needs' } }) {
  mockGetClients.mockImplementation(async (status: string, cursor?: string) => (status === 'archived' ? archivedReply(cursor) : { data: rows }));
  mockUnread.mockResolvedValue({ data: { total: 0, by_client: unread } });
  await render(<CoachTeamEntryContext.Provider value><ClientLookupScreen navigation={nav} route={route as never} /></CoachTeamEntryContext.Provider>);
  await waitFor(() => expect(screen.getByTestId('lookup-count')).toBeTruthy());
}

const UNDER_15 = [wire('c1', 'Maya Brooks', { last: day(0), review: 2 }), wire('c2', 'Theo Grant', { last: day(0), workout: day(0) }), wire('c3', 'Priya Nair', {}, day(-2))];
const NAMES = ['Ana Lopez', 'Ava Price', 'Ben Carter', 'Bianca Shah', 'Chloe Dunn', 'Dev Patel', 'Elena Ruiz', 'Finn Walsh',
  'Grace Kim', 'Maya Brooks', 'Omar Haddad', 'Priya Nair', 'Sam Okafor', 'Theo Grant', 'Uma Reyes'];
const MANY = NAMES.map((n, i) => wire(`m${i}`, n, n === 'Ben Carter' ? { last: day(-5) } : n === 'Ava Price' ? {} : { last: day(-1) }));

beforeEach(() => { jest.clearAllMocks(); mockCache.clear(); useCoachStore.getState().reset(); focused = true; });

describe('UI-4 helpers', () => {
  it('reads typed filter words and writes the Needs you sentence with number words', () => {
    expect(parseLookupQuery(' Review  messages ')).toEqual({ filters: ['review', 'messages'], text: '' });
    expect([needsYouSentence(2, 1), needsYouSentence(1, 0), needsYouSentence(0, 3)]).toEqual(['Two need you today. One is steady.', 'One needs you today.', 'Three are steady.']);
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
  it('view "needs" (the coach Home Needs you tile) shows the Needs you list at 15 or more, only clients with an action', async () => {
    const rows = [...NAMES.slice(0, 14).map((n, i) => wire(`m${i}`, n, { last: day(-1) })), wire('n1', 'Nina Cole', { last: day(0), review: 1 })];
    await mount(rows, {}, undefined, { params: { view: 'needs' } });
    expect(screen.queryByTestId('lookup-search')).toBeNull();
    expect(screen.getByText('One needs you today.')).toBeTruthy();
    expect(screen.getByTestId('lookup-act-n1')).toBeTruthy();
    expect(screen.queryByTestId('lookup-row-m0')).toBeNull(); // steady clients stay on the full list
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
    expect(screen.UNSAFE_getByType(KeyboardAvoidingView)).toBeTruthy(); // Send and Cancel stay above the keyboard
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
