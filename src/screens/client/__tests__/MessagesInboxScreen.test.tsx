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
const mockFlags = { messaging_core_v2: true };
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: mockFlags }) }));
const mockReduce = jest.fn(() => false);
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduce() }));
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
/** Focus runs the effect; mockRefocus() is a blur and a focus again (the cleanup, then a fresh read). */
let mockRefocus: () => void = () => undefined;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(() => {
    let undo = cb();
    mockRefocus = () => { if (typeof undo === 'function') undo(); undo = cb(); };
    return () => { if (typeof undo === 'function') undo(); };
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
  mockRoman.mockReturnValue(true);
  mockNeedsCoach.mockReturnValue(false);
  mockReduce.mockReturnValue(false);
  mockFlags.messaging_core_v2 = true;
  mockSupportOn = true;
  http();
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
