/**
 * C3B-S2: the client Messages list (MOCK-C3 Style B slice 2). Coached and coachless states, every tap and where it
 * lands, each read failing on its own, Reduce Motion, 44 pt targets and screen reader labels. HTTP is mocked.
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { Animated, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { COMMUNITY_REPORT_CRISIS_LINE } from '../../../api/communitySafetyApi';
import type { InboxThread } from '../../../api/messagingV2Api';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';

const mockRoman = jest.fn(() => true);
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { get romanChat() { return mockRoman(); } } }));
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({
  colors: new Proxy({}, { get: () => '#000000' }),
  semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  tokens: jest.requireActual('../../../theme/tokens').default,
}) }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), softImpact: jest.fn() } }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: (u: string) => mockGet(u) } }));
const mockInbox = jest.fn();
jest.mock('../../../api/messagingV2Api', () => ({ messagingV2Api: { getClientInbox: () => mockInbox() } }));
// D10-BUILD-CLOSE: the client's own Roman history (list newest first, then the newest chat's messages newest first).
const mockList = jest.fn();
const mockRead = jest.fn();
jest.mock('../../../api/romanChatsApi', () => ({
  ROMAN_CHATS_MAX_LIMIT: 100,
  romanChatsApi: { list: (...a: unknown[]) => mockList(...a), readMessages: (...a: unknown[]) => mockRead(...a) },
}));
const mockBindingCurrent = jest.fn(() => true);
const mockCapture = jest.fn(async () => ({ subject: 'client-1', epoch: 1 }) as { subject: string; epoch: number } | null);
jest.mock('../../../services/accountBinding', () => ({
  captureAccountBinding: () => mockCapture(),
  bindingIsCurrent: () => mockBindingCurrent(),
}));
const OFFLINE = { ok: false, failure: { reason: 'offline' } };
const chats = (n: number, nextCursor: string | null = null) => ({ ok: true, value: { sessions: Array.from({ length: n }, (_, i) => ({ id: `rs${i}`, surface: 'client', dayKey: '2026-11-04', messageCount: 4, startedAt: '2026-11-04T18:00:00.000Z', lastActivityAt: '2026-11-04T18:00:00.000Z' })), nextCursor } });
const ANSWER = "62 g, Jordan. Sam's dinner covers 45 g of it, so a Greek yoghurt this evening closes the rest.";
const said = (o: Record<string, unknown> = {}) => ({ id: 'rm2', role: 'assistant', content: ANSWER, interrupted: false, createdAt: '2026-11-04T18:02:00.000Z', ...o });
const asked = { id: 'rm1', role: 'user', content: 'How much protein is left?', interrupted: false, createdAt: '2026-11-04T18:01:00.000Z' };
const mockFlags = { messaging_core_v2: true };
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: mockFlags }) }));
const mockReduce = jest.fn(() => false);
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduce() }));
let mockUser: { id: string; coach_id?: string } | null = null; // the signed-in user (FR-880R4); none unless a test sets one
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
const mockNeedsCoach = jest.fn(() => false);
jest.mock('../../../components/coachless/JoinCoachState', () => ({
  JOIN_A_COACH: 'Join a coach',
  ROMAN_LOCK_TITLE: 'Roman works with a coach',
  ROMAN_LOCK_BODY: "Roman reads your plan and a coach's guidance, so he is available once you join a coach. Your own logging stays open.",
  useClientNeedsCoach: () => mockNeedsCoach(),
}));
const mockJoin = jest.fn();
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ messageCoach: mockJoin }) }));
const mockSupport = jest.fn(() => true);
let mockSupportOn = true;
jest.mock('../../../components/ai/useOpenSupport', () => ({ useOpenSupport: () => (mockSupportOn ? mockSupport : null) }));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => require('react').createElement(require('react-native').Text, { testID: `icon-${name}` }),
}));
/** Focus runs the effect; mockRefocus() is a blur and a focus again (the cleanup, then a fresh read) of every focus
 * effect on the screen (D10-BUILD-CLOSE: the coach reads and the Roman history are two). */
const mockFocused = new Set<() => void>();
const mockRefocus = () => { mockFocused.forEach((again) => again()); };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(() => {
    let undo = cb();
    const again = () => { if (typeof undo === 'function') undo(); undo = cb(); };
    mockFocused.add(again);
    return () => { mockFocused.delete(again); if (typeof undo === 'function') undo(); };
  }, [cb]),
}));

import MessagesInboxScreen, { previewOf, romanLeft } from '../MessagesInboxScreen';

const thread = (o: Partial<InboxThread> = {}): InboxThread => ({
  thread_id: 't1', kind: 'coach_client', coach_id: 'coach-9', client_id: 'client-1',
  counterpart: { user_id: 'coach-9', display_name: 'Sam Carter' },
  last_message: { id: 'm1', sender_id: 'coach-9', is_mine: false, kind: 'text', preview: 'Yes, move it to Friday.', created_at: '2026-10-15T18:03:00.000Z', edited: false },
  unread_count: 2, muted: false, muted_until: null, pinned: false, blocked_by_me: false, last_activity_at: '2026-10-15T18:03:00.000Z',
  ...o,
});
const USAGE = { day: '2026-10-15', used: { messages: 64, files: 1, changes: 0 }, limits: { messages: 100, files: 3, changes: 5 }, resets_at: '2026-10-16T07:00:00.000Z' };
const ROUTES: Record<string, unknown> = {
  '/v1/clients/me/coach': { id: 'coach-9', name: 'Sam Carter' },
  '/messages/unread-count': { total: 2 },
  '/me/roman/usage': USAGE,
};
const http = (failing: string[] = []) => mockGet.mockImplementation(async (u: string) => {
  if (failing.includes(u) || !(u in ROUTES)) throw Object.assign(new Error(`GET ${u} failed`), { response: { status: 404 } });
  return { data: ROUTES[u] };
});
const flat = (el: { props: object }) => StyleSheet.flatten((el.props as { style?: StyleProp<ViewStyle> }).style) as unknown as Record<string, unknown>;
const COACH_LABEL = 'Sam, your coach, 2 unread. Yes, move it to Friday.';
const ROMAN_LABEL = 'Roman, your assistant, 36 left today';

async function show() {
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const u = await render(<MessagesInboxScreen navigation={navigation as never} />);
  return { u, navigation };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
  mockRoman.mockReturnValue(true);
  mockNeedsCoach.mockReturnValue(false);
  mockReduce.mockReturnValue(false);
  mockFlags.messaging_core_v2 = true;
  mockSupportOn = true;
  http();
  mockList.mockResolvedValue(OFFLINE);
  mockRead.mockResolvedValue(OFFLINE);
  mockBindingCurrent.mockReturnValue(true);
  mockCapture.mockResolvedValue({ subject: 'client-1', epoch: 1 });
  mockInbox.mockResolvedValue({ items: [thread()], next_cursor: null, total_unread: 2 });
});

describe('Messages list, client with a coach', () => {
  it('draws the coach card (name, gold unread ring, last message) and Roman with what is left today', async () => {
    const { u } = await show();
    expect(await u.findByLabelText(COACH_LABEL)).toBeTruthy();
    expect(u.getByRole('header', { name: 'Messages' })).toBeTruthy();
    expect(u.getByText('Your coach')).toBeTruthy();
    expect(u.getByText('Sam')).toBeTruthy();
    expect(u.getByText('S')).toBeTruthy();
    expect(u.getByTestId('inbox-unread')).toBeTruthy();
    expect(u.getByText('2')).toBeTruthy();
    expect(u.getByTestId('inbox-preview').props.children).toBe('Yes, move it to Friday.');
    expect(await u.findByLabelText(ROMAN_LABEL)).toBeTruthy();
    expect(u.getByText('Your assistant')).toBeTruthy();
    expect(u.getByText('Roman')).toBeTruthy();
    expect(u.getByText('36')).toBeTruthy();
    expect(u.getByText('left today')).toBeTruthy();
    expect(u.getByText('Ask Roman anything.')).toBeTruthy();
    expect(u.getByLabelText('Sam never sees this chat, with one safety exception.')).toBeTruthy();
    expect(flat(u.getByTestId('inbox-unread'))).toMatchObject({ borderColor: '#D4B96B', minWidth: 40, minHeight: 40 });
  });

  it('every tap lands on a real screen, with a selection haptic on each row', async () => {
    const { u, navigation } = await show();
    await fireEvent.press(await u.findByLabelText(COACH_LABEL));
    expect(navigation.navigate).toHaveBeenLastCalledWith('Messages');
    await fireEvent.press(await u.findByLabelText(ROMAN_LABEL));
    expect(navigation.navigate).toHaveBeenLastCalledWith('MoreTab', { screen: 'RomanChat', initial: false });
    await fireEvent.press(u.getByLabelText('Sam never sees this chat, with one safety exception.'));
    expect(navigation.navigate).toHaveBeenLastCalledWith('MoreTab', { screen: 'RomanConversations', initial: false });
    expect(HapticService.selection).toHaveBeenCalledTimes(3);
    await fireEvent.press(u.getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['/v1/clients/me/coach', 'Your coach, 2 unread. Yes, move it to Friday.', ROMAN_LABEL],
    ['/messages/unread-count', 'Sam, your coach. Yes, move it to Friday.', ROMAN_LABEL],
    ['inbox', 'Sam, your coach, 2 unread', ROMAN_LABEL],
    ['/me/roman/usage', COACH_LABEL, 'Roman, your assistant'],
  ])('a failed %s hides only its own part', async (failed, coachLabel, romanLabel) => {
    http([failed]);
    if (failed === 'inbox') mockInbox.mockRejectedValue(new Error('503'));
    const { u } = await show();
    expect(await u.findByLabelText(coachLabel)).toBeTruthy();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/me/roman/usage'));
    expect(await u.findByLabelText(romanLabel)).toBeTruthy();
    expect(u.queryByText('Message your coach') !== null).toBe(failed === '/v1/clients/me/coach');
    expect(u.queryByTestId('inbox-unread') === null).toBe(failed === '/messages/unread-count');
    expect(u.queryByTestId('inbox-preview') === null).toBe(failed === 'inbox');
    expect(u.queryByText('left today') === null).toBe(failed === '/me/roman/usage');
  });

  it('with every read failing (offline) both cards still open their screens', async () => {
    http(Object.keys(ROUTES));
    mockInbox.mockRejectedValue(new Error('offline'));
    const { u, navigation } = await show();
    await fireEvent.press(await u.findByLabelText('Your coach'));
    expect(navigation.navigate).toHaveBeenLastCalledWith('Messages');
    expect(u.getByText('Message your coach')).toBeTruthy();
    expect(u.getByTestId('icon-person-outline')).toBeTruthy();
    await fireEvent.press(u.getByLabelText('Roman, your assistant'));
    expect(navigation.navigate).toHaveBeenLastCalledWith('MoreTab', { screen: 'RomanChat', initial: false });
    expect(u.getByLabelText('Your coach never sees this chat, with one safety exception.')).toBeTruthy();
  });

  it('a refresh that fails keeps the last good values; one that succeeds replaces them', async () => {
    const { u } = await show();
    expect(await u.findByLabelText(COACH_LABEL)).toBeTruthy();
    expect(await u.findByText('36')).toBeTruthy();
    http(Object.keys(ROUTES));
    mockInbox.mockRejectedValue(new Error('offline'));
    await act(async () => mockRefocus());
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(6));
    expect(u.getByLabelText(COACH_LABEL)).toBeTruthy();
    expect(u.getByText('36')).toBeTruthy();
    http();
    mockInbox.mockResolvedValue({ items: [thread({ unread_count: 0, last_message: { ...thread().last_message!, is_mine: true, preview: 'Thanks' } })], next_cursor: null, total_unread: 0 });
    mockGet.mockImplementation(async (url: string) => ({ data: url === '/messages/unread-count' ? { total: 0 } : ROUTES[url] }));
    await act(async () => mockRefocus());
    expect(await u.findByLabelText('Sam, your coach. You: Thanks')).toBeTruthy();
    expect(u.queryByTestId('inbox-unread')).toBeNull();
  });

  it('without the messaging v2 switch the list never asks for the inbox; without Roman chat there is no Roman card', async () => {
    mockFlags.messaging_core_v2 = false;
    mockRoman.mockReturnValue(false);
    const { u } = await show();
    expect(await u.findByLabelText('Sam, your coach, 2 unread')).toBeTruthy();
    expect(mockInbox).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalledWith('/me/roman/usage');
    expect(u.queryByTestId('inbox-roman')).toBeNull();
    expect(u.queryByTestId('inbox-privacy')).toBeNull();
  });

  it('shows the loading skeleton (a progressbar) until the coach reads settle', async () => {
    mockGet.mockImplementation(() => new Promise(() => undefined));
    mockInbox.mockResolvedValue({ items: [thread({ last_message: null, unread_count: 0 })], next_cursor: null, total_unread: 0 });
    const { u } = await show();
    expect(u.getByRole('progressbar', { name: 'Loading your messages' })).toBeTruthy();
    expect(u.queryByTestId('inbox-coach')).toBeNull();
    http();
    await act(async () => mockRefocus());
    expect(await u.findByText('No messages yet')).toBeTruthy();
    expect(u.queryByTestId('inbox-loading')).toBeNull();
  });
});

// FR-880 (owner 10-23, "Dissapear"; LO-1153 N4): a closed coach chat leaves the list (no card, no name, no unread) and
// comes back on unblock. The server's inbox leaves the coach row out while either person blocks (b#1141).
describe('Messages list, the coach chat closed', () => {
  const SAM = { id: 'coach-9', displayName: 'Sam Carter', blockedAt: '2026-10-24T00:00:00Z' };
  const expectGone = (u: Awaited<ReturnType<typeof show>>['u']) => {
    expect(u.queryByTestId('inbox-coach')).toBeNull();
    expect(u.queryByTestId('inbox-unread')).toBeNull();
    expect(u.queryAllByText(/Sam/)).toHaveLength(0);
    expect(u.queryAllByLabelText(/Sam/)).toHaveLength(0);
    expect(u.getByLabelText('Your coach never sees this chat, with one safety exception.')).toBeTruthy();
  };
  afterEach(() => useBlockedUsersStore.setState({ blocked: [] }));

  it('the coach blocked me (the inbox leaves the row out): the card is gone; when the row is back, so is the card', async () => {
    mockInbox.mockResolvedValue({ items: [], next_cursor: null, total_unread: 0 });
    const { u } = await show();
    expect(await u.findByLabelText(ROMAN_LABEL)).toBeTruthy();
    expectGone(u);
    mockInbox.mockResolvedValue({ items: [thread()], next_cursor: null, total_unread: 2 });
    await act(async () => mockRefocus());
    expect(await u.findByLabelText(COACH_LABEL)).toBeTruthy();
    expect(u.getByLabelText('Sam never sees this chat, with one safety exception.')).toBeTruthy();
  });

  it('I block my coach: the card leaves at once and the list reads again; my unblock reads again and it comes back', async () => {
    const { u } = await show();
    expect(await u.findByLabelText(COACH_LABEL)).toBeTruthy();
    const reads = mockInbox.mock.calls.length;
    mockInbox.mockResolvedValue({ items: [], next_cursor: null, total_unread: 0 });
    await act(async () => useBlockedUsersStore.setState({ blocked: [SAM] }));
    expectGone(u);
    await waitFor(() => expect(mockInbox).toHaveBeenCalledTimes(reads + 1));
    mockInbox.mockResolvedValue({ items: [thread()], next_cursor: null, total_unread: 2 });
    await act(async () => useBlockedUsersStore.setState({ blocked: [] }));
    expect(await u.findByLabelText(COACH_LABEL)).toBeTruthy();
    expect(mockInbox).toHaveBeenCalledTimes(reads + 2);
  });

  // FR-880R4 (Sol B1, agent 174 draft): a cold start offline, with my block of my coach saved on the phone. No read gives
  // a coach id, so only the signed-in coach id and the saved list can say it; the card stays away until I unblock.
  it('a cold offline list with my saved block never shows the coach; my unblock brings back the offline card', async () => {
    const { queryClient } = jest.requireActual('../../../services/queryClient');
    mockUser = { id: 'client-1', coach_id: 'coach-9' };
    queryClient.clear();
    // my saved block of my coach, as Home's header read it from the phone before Roman's shortcut opened this list
    useBlockedUsersStore.setState({ blocked: [{ ...SAM, role: 'coach' }], hydrated: true, userId: 'client-1' });
    mockGet.mockRejectedValue(new Error('offline')); // coach, count, usage and thread reads all fail
    mockInbox.mockRejectedValue(new Error('offline'));
    const { u } = await show();
    expect(await u.findByLabelText('Roman, your assistant')).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(u.queryByTestId('inbox-coach')).toBeNull();
    expect(u.queryByText('Your coach')).toBeNull();
    expect(u.queryByText('Message your coach')).toBeNull();
    await act(async () => useBlockedUsersStore.setState({ blocked: [] }));
    expect(await u.findByLabelText('Your coach')).toBeTruthy(); // unblocked: the offline card is back
    u.unmount();
    queryClient.clear();
    useBlockedUsersStore.setState({ hydrated: false, userId: null });
  });

  it('without the messaging v2 switch my own block still hides the card, and an unblock brings it back', async () => {
    mockFlags.messaging_core_v2 = false;
    const { u } = await show();
    expect(await u.findByLabelText('Sam, your coach, 2 unread')).toBeTruthy();
    await act(async () => useBlockedUsersStore.setState({ blocked: [SAM] }));
    expectGone(u);
    await act(async () => useBlockedUsersStore.setState({ blocked: [] }));
    expect(await u.findByLabelText('Sam, your coach, 2 unread')).toBeTruthy();
  });

  // FR-880R2 (Sol B2): with messaging v2 off there is no inbox read; the thread read (GET /messages) answers 200 [] with
  // x-conversation-closed while either person blocks (b#1141 CONTRACT 6370968268), any messaging version.
  it('without the messaging v2 switch the coach blocked me: no card, never shown first; a read that says open brings it back', async () => {
    mockFlags.messaging_core_v2 = false;
    let closed = true;
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/messages?limit=1') return { data: [], headers: closed ? { 'x-conversation-closed': 'blocked_by_them' } : {} };
      if (url === '/messages/unread-count') return { data: { total: closed ? 0 : 2 } };
      if (!(url in ROUTES)) throw Object.assign(new Error(`GET ${url} failed`), { response: { status: 404 } });
      return { data: ROUTES[url] };
    });
    const { u } = await show();
    expect(await u.findByLabelText(ROMAN_LABEL)).toBeTruthy();
    expectGone(u);
    expect(mockInbox).not.toHaveBeenCalled();
    const offline = mockGet.getMockImplementation();
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/messages?limit=1') throw new Error('offline');
      return offline?.(url);
    });
    await act(async () => mockRefocus());
    await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === '/messages?limit=1')).toHaveLength(2));
    expectGone(u); // a failed read keeps the last answer
    mockGet.mockImplementation(offline as never);
    closed = false;
    await act(async () => mockRefocus());
    expect(await u.findByLabelText('Sam, your coach, 2 unread')).toBeTruthy();
    expect(u.getByLabelText('Sam never sees this chat, with one safety exception.')).toBeTruthy();
  });

  it.each<[string, Partial<InboxThread>]>([['closed', { closed: true }], ['blocked by me', { blocked_by_me: true }]])('a row the server marks %s leaves the list too', async (_, o) => {
    mockInbox.mockResolvedValue({ items: [thread(o)], next_cursor: null, total_unread: 0 });
    const { u } = await show();
    expect(await u.findByLabelText(ROMAN_LABEL)).toBeTruthy();
    expectGone(u);
  });

  it('a failed inbox read keeps a closed chat closed (the last good answer stays)', async () => {
    mockInbox.mockResolvedValue({ items: [], next_cursor: null, total_unread: 0 });
    const { u } = await show();
    expect(await u.findByLabelText(ROMAN_LABEL)).toBeTruthy();
    expectGone(u);
    mockInbox.mockRejectedValue(new Error('offline'));
    await act(async () => mockRefocus());
    await waitFor(() => expect(mockInbox).toHaveBeenCalledTimes(2));
    expectGone(u);
  });
});

describe('Messages list, client with no coach', () => {
  beforeEach(() => mockNeedsCoach.mockReturnValue(true));

  it('reads nothing and says what is missing, with Join a coach, Contact support, the crisis line and old Roman chats', async () => {
    const { u, navigation } = await show();
    expect(u.getByRole('header', { name: 'No coach connected' })).toBeTruthy();
    expect(u.getByText('Messages open once you join a coach. Need help finding one? Contact support.')).toBeTruthy();
    expect(u.getByText('Roman works with a coach')).toBeTruthy();
    expect(u.getByText(/^Roman reads your plan and a coach's guidance/)).toBeTruthy();
    expect(u.getByTestId('inbox-crisis').props.children).toBe(COMMUNITY_REPORT_CRISIS_LINE);
    expect(u.getByText('Your assistant')).toBeTruthy();
    expect(u.queryByTestId('inbox-privacy')).toBeNull();
    expect(u.queryByText(/never sees this chat/)).toBeNull();
    await fireEvent.press(u.getByLabelText('Join a coach'));
    expect(mockJoin).toHaveBeenCalledTimes(1);
    await fireEvent.press(u.getByLabelText('Contact support'));
    expect(mockSupport).toHaveBeenCalledTimes(1);
    await fireEvent.press(u.getByLabelText('Your conversations with Roman'));
    expect(navigation.navigate).toHaveBeenLastCalledWith('MoreTab', { screen: 'RomanConversations', initial: false });
    expect(HapticService.selection).toHaveBeenCalledTimes(3);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockInbox).not.toHaveBeenCalled();
  });

  it('every button is a full target; Contact support is left out where no navigator can open it', async () => {
    const { u } = await show();
    expect(flat(u.getByTestId('inbox-join'))).toMatchObject({ minHeight: 48, borderRadius: 12 });
    expect(flat(u.getByTestId('inbox-support'))).toMatchObject({ minHeight: 48, borderRadius: 12 });
    expect(flat(u.getByTestId('inbox-chats'))).toMatchObject({ minHeight: 56, borderRadius: 16 });
    expect(flat(u.getByTestId('inbox-top-back'))).toMatchObject({ width: 44, height: 44 });
    mockSupportOn = false;
    const again = await render(<MessagesInboxScreen navigation={{ navigate: jest.fn(), goBack: jest.fn() } as never} />);
    expect(again.queryByTestId('inbox-support')).toBeNull();
    expect(again.getByTestId('inbox-join')).toBeTruthy();
  });
});

describe('Messages list motion, reach and wiring', () => {
  it.each([[false, 250, 16], [true, 150, 0]])('reduceMotion=%s: cards take %d ms and start %d pt low', async (reduce, ms, lift) => {
    mockReduce.mockReturnValue(reduce);
    mockNeedsCoach.mockReturnValue(true);
    const timing = jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn() } as unknown as Animated.CompositeAnimation);
    const { u } = await show();
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, duration: ms, useNativeDriver: true }));
    expect(flat(u.getByTestId('inbox-rise-0'))).toMatchObject({ opacity: 0, transform: [{ translateY: lift }] });
    timing.mockRestore();
  });

  it('the privacy line says where it goes to a screen reader and is a full target; no exclamation marks', async () => {
    const { u } = await show();
    const privacy = await u.findByLabelText('Sam never sees this chat, with one safety exception.');
    expect(privacy.props.accessibilityHint).toBe('See, open and delete your past conversations with Roman');
    expect(flat(privacy)).toMatchObject({ minHeight: 44 });
    expect(u.queryAllByText(/!/)).toHaveLength(0);
  });

  it('is registered in the Home stack beside the thread; Roman chat and the chat list are in the You stack', () => {
    const nav = fs.readFileSync(path.join(__dirname, '../../../navigation/ClientNavigator.tsx'), 'utf8');
    const block = (stack: string) => nav.slice(nav.indexOf(`<${stack}.Navigator`), nav.indexOf(`</${stack}.Navigator>`));
    expect(block('HomeStackNav')).toMatch(/<HomeStackNav\.Screen name="MessagesInbox"\s+component=\{MessagesInboxScreen\} \/>/);
    expect(block('HomeStackNav')).toMatch(/<HomeStackNav\.Screen name="Messages"\s+component=\{MessagesScreen\} \/>/);
    expect(nav).toContain("import MessagesInboxScreen from '../screens/client/MessagesInboxScreen';");
    expect(block('MoreStackNav')).toContain('name="RomanChat"');
    expect(block('MoreStackNav')).toMatch(/name="RomanConversations" component=\{RomanConversationsScreen\}/);
  });
});

describe('previewOf and romanLeft', () => {
  const last = thread().last_message!;
  it.each([
    [undefined, null],
    [thread({ last_message: null }), 'No messages yet'],
    [thread({ blocked_by_me: true }), 'Blocked'],
    [thread({ last_message: { ...last, kind: 'deleted', preview: '' } }), 'Message deleted'],
    [thread({ last_message: { ...last, kind: 'voice', preview: '' } }), 'Voice note'],
    [thread({ last_message: { ...last, is_mine: true } }), 'You: Yes, move it to Friday.'],
    [thread({ last_message: { ...last, preview: '' } }), 'Message'],
  ])('%#: %j', (t, want) => expect(previewOf(t as InboxThread | undefined)).toBe(want));

  it.each([
    [USAGE, 36],
    [{ used: { messages: 100 }, limits: { messages: 100 } }, 0],
    [{ used: { messages: 130 }, limits: { messages: 100 } }, 0],
    [{ used: { messages: '4' }, limits: { messages: 100 } }, null],
    [{ used: {}, limits: { messages: 100 } }, null],
    [{ used: { messages: 0 }, limits: { messages: 0 } }, null],
    [null, null],
    ['<html>', null],
  ])('%#: %j -> %p', (d, want) => expect(romanLeft(d)).toBe(want));
});

describe('D10-BUILD-CLOSE: the Roman card on the list (C3 Style B, B_inbox and B_coachless)', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'MessagesInboxScreen.tsx'), 'utf8');
  const page = (messages: unknown[], nextCursor: string | null = null) => ({ ok: true, value: { messages, nextCursor } });
  const today = { id: 'rs-today', surface: 'client', dayKey: '2026-11-05', messageCount: 0, startedAt: '2026-11-05T09:00:00.000Z', lastActivityAt: '2026-11-05T09:00:00.000Z' };
  const yesterday = { id: 'rs-yday', surface: 'client', dayKey: '2026-11-04', messageCount: 2, startedAt: '2026-11-04T18:00:00.000Z', lastActivityAt: '2026-11-04T18:02:00.000Z' };
  // FIX-935R1: the owner moved quoting Roman's latest answer to v1.1 (op198/v1-1-messages-roman-line keeps the work),
  // so LO-935 B1 and LS-935 B1 close with the quote. Every history shape those B-TESTs and the round before named
  // now gives the same card: "Ask Roman anything.", the same label, and no Roman history read at all.
  it.each([
    ['a finished answer in the newest chat', chats(3), page([said(), asked])],
    ['LO-935 B1: today\'s empty chat is newest', { ok: true, value: { sessions: [today, yesterday], nextCursor: null } }, page([said(), asked])],
    ['LS-935 B1: a newly opened empty chat is newest', chats(2), page([])],
    ['LS-935 B1: the newest chat holds only a cut-off answer', chats(2), page([said({ interrupted: true })])],
    ['LS-935 B1: the answer sits past the first message page', chats(1), page([asked], 'older-turn')],
    ['only a crisis reply', chats(1), page([said({ safetyActions: [{ kind: 'call', label: 'Call 988' }] }), asked])],
    ['no chats yet', chats(0), page([])],
    ['the history read fails', OFFLINE, OFFLINE],
  ])('%s: the coached card says "Ask Roman anything." and reads no Roman history', async (_n, list, read) => {
    mockList.mockResolvedValue(list);
    mockRead.mockResolvedValue(read);
    const { u } = await show();
    expect(await u.findByLabelText(ROMAN_LABEL)).toBeTruthy();
    await act(async () => { await Promise.resolve(); });
    expect(u.getByTestId('inbox-roman-line').props.children).toBe('Ask Roman anything.');
    expect(u.getByTestId('inbox-roman-line').props.numberOfLines).toBeUndefined();
    expect(u.queryByText(ANSWER)).toBeNull();
    expect(mockList).not.toHaveBeenCalled();
    expect(mockRead).not.toHaveBeenCalled();
    expect(u.queryByTestId('inbox-chats-count')).toBeNull();
  });

  it('the screen has no way left to read or quote a Roman message', () => {
    expect(SRC).not.toMatch(/readMessages|romanLine|RomanMessage|fontScale|numberOfLines/);
  });

  describe('no coach', () => {
    beforeEach(() => mockNeedsCoach.mockReturnValue(true));

    it('the old-chats row leads with how many chats are kept, and says it; no chat is opened to count', async () => {
      mockList.mockResolvedValue(chats(3));
      const { u } = await show();
      expect(await u.findByLabelText('Your conversations with Roman, 3')).toBeTruthy();
      expect(u.getByTestId('inbox-chats-count').props.children).toBe(3);
      expect(mockList).toHaveBeenCalledWith({ subject: 'client-1', epoch: 1 }, { limit: 100 });
      expect(mockRead).not.toHaveBeenCalled();
      expect(u.queryByText(ANSWER)).toBeNull();
    });

    it.each([
      ['no chats', chats(0)],
      ['more than one page (no guessed total)', chats(100, 'rs100')],
      ['the read fails', OFFLINE],
    ])('%s: no number, the row reads as before', async (_n, list) => {
      mockList.mockResolvedValue(list);
      const { u } = await show();
      await act(async () => { await Promise.resolve(); });
      expect(u.getByLabelText('Your conversations with Roman')).toBeTruthy();
      expect(u.queryByTestId('inbox-chats-count')).toBeNull();
    });

    it('a count for a sign-in that has ended is never shown; a later failed read keeps the last good count', async () => {
      mockList.mockResolvedValue(chats(3));
      const { u } = await show();
      expect(await u.findByLabelText('Your conversations with Roman, 3')).toBeTruthy();
      mockList.mockResolvedValue(OFFLINE);
      await act(async () => { mockRefocus(); });
      await act(async () => { await Promise.resolve(); });
      expect(u.getByTestId('inbox-chats-count').props.children).toBe(3);
      mockBindingCurrent.mockReturnValue(false);
      await act(async () => { mockRefocus(); });
      await waitFor(() => expect(u.queryByTestId('inbox-chats-count')).toBeNull());
      expect(u.getByLabelText('Your conversations with Roman')).toBeTruthy();
    });

    it('signed out (no credential): nothing is read', async () => {
      mockCapture.mockResolvedValue(null);
      const { u } = await show();
      await act(async () => { await Promise.resolve(); });
      expect(u.getByLabelText('Your conversations with Roman')).toBeTruthy();
      expect(mockList).not.toHaveBeenCalled();
    });

    it('without Roman chat nothing is read', async () => {
      mockRoman.mockReturnValue(false);
      await show();
      await act(async () => { await Promise.resolve(); });
      expect(mockCapture).not.toHaveBeenCalled();
      expect(mockList).not.toHaveBeenCalled();
    });

    // m#935 B2 (LO-935, LS-935): the drawn face, Cormorant Medium 22 on a 28 line, so it sits on one line at 390 pt.
    it('B2: "Roman works with a coach" is set as drawn', async () => {
      const { u } = await show();
      expect(flat(u.getByTestId('inbox-roman-lock-title'))).toMatchObject({ fontFamily: 'CormorantGaramond_500Medium', fontSize: 22, lineHeight: 28, letterSpacing: 0 });
    });

    // m#935 B4 (LO-935, LS-935): Roman waits for a coach, so his portrait is the grey canonical crop at 75%.
    it('B4: the no-coach portrait is grey and faded; the coached card keeps colour', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const grey = require('../../../../assets/roman/neutral-grey.png');
      const { u } = await show();
      const ring = u.getByTestId('inbox-roman-grey');
      expect(flat(ring).opacity).toBe(0.75);
      expect(u.getByTestId('inbox-roman-grey-face').props.source).toEqual(grey);
      mockNeedsCoach.mockReturnValue(false);
      const coached = await show();
      expect(coached.u.queryByTestId('inbox-roman-grey')).toBeNull();
    });

    // m#935 LO-935 non-blocking: 10 pt apart with no side padding, as drawn, so "Contact support" fits at 360 pt.
    it('the two coach buttons are spaced and padded as drawn', async () => {
      const { u } = await show();
      expect(flat(u.getByTestId('inbox-join'))).toMatchObject({ paddingHorizontal: 0, minHeight: 48 });
      expect(flat(u.getByTestId('inbox-support'))).toMatchObject({ paddingHorizontal: 0, minHeight: 48 });
      expect(SRC).toMatch(/actions: \{ flexDirection: 'row', flexWrap: 'wrap', gap: 10,/);
    });
  });
});

// LO-935R2 B1 (agent 199, review round 2): C3 Style B sets two of its big Cormorant numbers in lining figures (B_coachless
// "3" before "Your conversations with Roman" and B_inbox "36 left today"). Cormorant Garamond's default figures are
// old-style, so the "3" hangs below the line beside its label; the font's lnum feature gives the drawn ones. The gold
// unread ring is drawn old-style and is pinned by LO-935R3 B1 below.
describe('LO-935R2 B1: the big Cormorant numbers use lining figures, as drawn', () => {
  it.each([
    ['the no-coach chat count "3"', true, '3'],
    ['"36 left today"', false, '36'],
  ] as Array<[string, boolean, string]>)('LO-935R2 B1: %s is set in lining figures', async (_n, noCoach, digits) => {
    mockNeedsCoach.mockReturnValue(noCoach);
    mockList.mockResolvedValue(chats(3));
    const { u } = await show();
    const el = noCoach ? await u.findByTestId('inbox-chats-count') : (await u.findByLabelText(ROMAN_LABEL), await u.findByLabelText(COACH_LABEL), u.getByText(digits));
    expect(String(el.props.children)).toBe(digits);
    expect(flat(el).fontVariant).toEqual(expect.arrayContaining(['lining-nums']));
  });
});

// LO-935R3 B1 (agent 199, review round 3): every C3 Style B inbox drawing (B_inbox ios390/android360 at 100 and 130)
// draws the gold unread ring's "2" as Cormorant's old-style figure (x-height tall, height/width about 1.2, the font's
// `two`), not the lining `two.lf` (about 1.75). "36 left today" and the no-coach "3" are drawn lining and stay so.
describe('LO-935R3 B1: the unread ring keeps the drawn old-style figure', () => {
  it('LO-935R3 B1: the unread ring "2" is not set in lining figures', async () => {
    mockNeedsCoach.mockReturnValue(false);
    mockList.mockResolvedValue(chats(3));
    const { u } = await show();
    await u.findByLabelText(ROMAN_LABEL);
    await u.findByLabelText(COACH_LABEL);
    const el = u.getByText('2');
    expect(String(el.props.children)).toBe('2');
    expect(flat(el).fontVariant ?? []).not.toContain('lining-nums');
  });
});
