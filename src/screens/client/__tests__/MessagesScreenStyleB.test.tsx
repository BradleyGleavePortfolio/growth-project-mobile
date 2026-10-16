/**
 * C3B-THREAD: the client's thread with featureFlags.c3StyleB ON (MOCK-C3 Style B, slice 1): every state and every main
 * pathway (contact, back, mute, copy, reply, report, send, pins, load older, edit, delete, Send again). HTTP is mocked.
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { Alert, Animated, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import api from '../../../services/api';
import * as Clipboard from 'expo-clipboard';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { gold, lightTokens } from '../../../theme/tokens';
import { StyleBBubble, dayB, timeB } from '../../../components/messaging/StyleBThread';

jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, c3StyleB: true } };
});
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({
  colors: new Proxy({}, { get: () => '#000000' }),
  semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  tokens: jest.requireActual('../../../theme/tokens').default,
}) }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: {
  selection: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(), heavyImpact: jest.fn(),
  success: jest.fn(), warning: jest.fn(), error: jest.fn(),
} }));
jest.mock('../../../storage/mmkv', () => {
  const store = { getString: () => undefined, getStringAsync: async () => undefined, set: async () => undefined, delete: async () => undefined };
  return { prefsStorage: store, cacheStorage: store };
});
const mockList = jest.fn();
const mockProfileGet = jest.fn();
const mockLegacySend = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  messagesApi: {
    list: (...a: unknown[]) => mockList(...a),
    coachReview: jest.fn(async () => ({ data: { coachReviewedAt: null } })),
    send: (...a: unknown[]) => mockLegacySend(...a),
    markRead: jest.fn(async () => ({ data: {} })),
  },
  profileApi: { get: () => mockProfileGet() },
}));
const mockRealtime: { ping: () => void } = { ping: () => undefined };
jest.mock('../../../services/realtime', () => ({
  subscribeToMessages: (_id: string, cb: () => void) => { mockRealtime.ping = cb; return () => undefined; },
}));
const mockFlags = { messaging_core_v2: true };
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: mockFlags }) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1' }) }));
jest.mock('../../../hooks/useBlockedUsersHydration', () => ({ useBlockedUsersHydration: () => ({ serverHydrationComplete: true }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({ key: 'messages', name: 'Messages', params: undefined }),
  useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate, getParent: () => ({ navigate: jest.fn() }) }),
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(() => cb(), [cb]),
}));

import MessagesScreen from '../MessagesScreen';

const NetInfo = jest.requireMock('@react-native-community/netinfo');
const getMock = api.get as unknown as jest.Mock;
const postMock = api.post as unknown as jest.Mock;
const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const readAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
const row = (o: Record<string, unknown>) => ({ coach_id: 'coach-9', client_id: 'client-1', created_at: recent, ...o });
const axiosErr = () => Object.assign(new Error('request failed'), { isAxiosError: true });
const flat = (el: { props: object }) => StyleSheet.flatten((el.props as { style?: StyleProp<ViewStyle> }).style) as unknown as Record<string, unknown>;
const named = { data: { coach_id: 'coach-9', coach_name: 'Coach Nine' } };
let alertSpy: jest.SpyInstance;
const originalOS = Platform.OS; // menus as in MessagesScreenV2.test (the in-app sheet, not ActionSheetIOS)
beforeAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' }));
afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS }));

beforeEach(() => {
  jest.clearAllMocks();
  NetInfo.__reset();
  mockFlags.messaging_core_v2 = true;
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockProfileGet.mockResolvedValue(named);
  mockList.mockResolvedValue({ data: [
    row({ id: 'm1', sender_id: 'coach-9', body: 'from the coach' }),
    row({ id: 'm2', sender_id: 'client-1', body: 'answer', read_at: readAt }),
  ] });
  getMock.mockImplementation(async (url: string) => ({ data: url === '/messages/pins' ? { items: [] } : {} }));
  postMock.mockResolvedValue({ data: {} });
});
afterEach(() => alertSpy.mockRestore());

const sendText = async (u: Awaited<ReturnType<typeof render>>, text: string) => {
  await fireEvent.changeText(u.getByLabelText('Message text'), text);
  await fireEvent.press(u.getByLabelText('Send message'));
};
const menu = async (u: Awaited<ReturnType<typeof render>>, target: RegExp, label: string) => {
  await fireEvent(u.getByLabelText(target), 'longPress');
  await fireEvent.press(await waitFor(() => u.getByLabelText(label)));
};

describe('client MessagesScreen with c3StyleB ON', () => {
  it('draws Style B: coach header, serif day mark, forest and cream bubbles, "6:03 pm" times and "Read {time}"', async () => {
    const u = await render(<MessagesScreen />);
    await u.findByLabelText(/Message: from the coach/);
    expect(await u.findByText('Your coach')).toBeTruthy();
    expect(u.getByText(dayB(recent))).toBeTruthy();
    expect(u.getAllByText(timeB(recent)).length).toBeGreaterThan(0);
    expect(timeB(recent)).toMatch(/\d (am|pm)$/);
    expect(u.getByText(`Read ${timeB(readAt)}`)).toBeTruthy();
    expect(u.queryByText('Read')).toBeNull();
    expect(flat(u.getByLabelText(/Message: answer/))).toMatchObject({ backgroundColor: lightTokens.accent, minHeight: 44 });
    expect(flat(u.getByLabelText(/Message: from the coach/)).backgroundColor).toBe('#F1E8D5');
    expect(flat(u.getByLabelText('Send message'))).toMatchObject({ width: 44, height: 44 });
  });

  it('keeps every pathway: contact, back, mute, copy, reply, report, send (softImpact)', async () => {
    const u = await render(<MessagesScreen />);
    await fireEvent.press(await u.findByLabelText('View Coach Nine contact details'));
    expect(mockNavigate).toHaveBeenCalledWith('ContactView', { contactId: 'coach-9', displayName: 'Coach Nine', role: 'coach' });
    await fireEvent.press(u.getByLabelText('Go back'));
    expect(mockGoBack).toHaveBeenCalled();
    (api.put as jest.Mock).mockResolvedValue({ data: { muted: true, muted_until: null, pinned: false } });
    await fireEvent.press(await u.findByTestId('thread-mute-button'));
    await fireEvent.press(await waitFor(() => u.getByLabelText('Mute for 8 hours')));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/messages/mute', { duration: '8h' }, expect.anything()));
    await menu(u, /Message: from the coach/, 'Copy');
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('from the coach'));
    await menu(u, /Message: from the coach/, 'Report Message');
    await fireEvent.press(u.getByLabelText('Spam'));
    await fireEvent.press(u.getByLabelText('Submit report'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Reported', 'Your report has been submitted.'));
    await menu(u, /Message: from the coach/, 'Reply');
    await fireEvent.press(u.getByLabelText('Cancel reply'));
    await menu(u, /Message: from the coach/, 'Reply');
    postMock.mockImplementation(async (url: string, body: Record<string, unknown>) => ({ data: url === '/messages'
      ? row({ id: 'new', sender_id: 'client-1', body: body.body, created_at: new Date().toISOString() }) : {} }));
    await sendText(u, 'reply');
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/messages', expect.objectContaining({ body: 'reply', reply_to_id: 'm1' }), expect.anything()));
    expect(HapticService.softImpact).toHaveBeenCalledTimes(1);
    expect(await u.findByText('Sent')).toBeTruthy();
  });

  it('keeps pins, load older, edit and delete for everyone', async () => {
    const own = row({ id: 'own', sender_id: 'client-1', body: 'own text', pinned_at: recent });
    mockList.mockResolvedValue({ data: Array.from({ length: 100 }, (_, i) => (i === 0 ? own : { ...own, id: `older-${i}`, body: 'history' })) });
    getMock.mockImplementation(async (url: string) => ({ data: url === '/messages/pins' ? { items: [own] } : {} }));
    (api.patch as jest.Mock).mockResolvedValue({ data: { ...own, body: 'edited', edited_at: recent } });
    (api.delete as jest.Mock).mockResolvedValue({ data: { ...own, body: null, deleted: true } });
    const u = await render(<MessagesScreen />);
    await fireEvent.press(await u.findByTestId('thread-pinned-bar'));
    await fireEvent.press(u.getByLabelText('Load older messages'));
    await waitFor(() => expect(mockList).toHaveBeenCalledWith({ before: recent, limit: 100 }));
    await menu(u, /Message: own text/, 'Edit');
    await fireEvent.changeText(u.getByLabelText('Edited message text'), 'edited');
    await fireEvent.press(u.getByLabelText('Save edit'));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/messages/own', { body: 'edited' }, expect.anything()));
    await menu(u, /Message: own text/, 'Delete for everyone');
    await act(async () => alertSpy.mock.calls.find(([t]) => t === 'Delete for everyone?')?.[2]?.find((b: { text: string }) => b.text === 'Delete')?.onPress?.());
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/messages/own', expect.anything()));
  });

  it('a failed send is warm, not red: "Not sent. Tap to send again" replays the same key; long press still works', async () => {
    let fail = true;
    postMock.mockImplementation(async (url: string, body: Record<string, unknown>) => {
      if (url !== '/messages') return { data: {} };
      if (fail) throw axiosErr();
      return { data: row({ id: 'srv-1', sender_id: 'client-1', body: body.body, client_message_id: body.client_message_id, created_at: new Date().toISOString() }) };
    });
    const u = await render(<MessagesScreen />);
    await u.findByLabelText(/Message: from the coach/);
    await sendText(u, 'running late');
    const retry = await u.findByLabelText('Not sent. Tap to send again');
    expect(flat(retry).minHeight).toBe(44);
    expect(flat(u.getByText('Not sent. Tap to send again')).color).toBe(gold[800]);
    expect(flat(u.getByLabelText(/Message: running late/))).toMatchObject({ borderColor: gold[700], backgroundColor: lightTokens.bgSurface });
    expect(HapticService.error).toHaveBeenCalledTimes(1);
    const sends = () => postMock.mock.calls.filter(([url]) => url === '/messages');
    const key = (sends()[0][1] as { client_message_id: string }).client_message_id;
    // A tap that fails again keeps main's alert.
    await fireEvent.press(retry);
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Message not sent', expect.any(String)));
    fail = false;
    await menu(u, /Message: running late/, 'Send again');
    await waitFor(() => expect(u.queryByText('Not sent. Tap to send again')).toBeNull());
    expect(sends().map(([, b]) => (b as { client_message_id: string }).client_message_id)).toEqual([key, key, key]);
    expect(u.getAllByLabelText(/Message: running late/)).toHaveLength(1);
  });

  it('offline: messages wait ("Waiting to send", C3-S-58 for two, no alert, no haptic) and go out once, in order, on reconnect', async () => {
    NetInfo.__setState({ isConnected: false, isInternetReachable: false });
    postMock.mockImplementation(async (url: string) => {
      if (url === '/messages') throw axiosErr();
      return { data: {} };
    });
    const u = await render(<MessagesScreen />);
    await u.findByLabelText(/Message: from the coach/);
    await sendText(u, 'see you friday');
    expect(await u.findByText('Waiting to send')).toBeTruthy();
    expect(flat(u.getByLabelText(/Message: see you friday/)).borderStyle).toBe('dashed');
    expect(u.queryByText('Not sent. Tap to send again')).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(HapticService.error).not.toHaveBeenCalled();
    expect(u.queryByText(/messages send when you reconnect/)).toBeNull();
    await sendText(u, 'and saturday');
    expect(await u.findByText('2 messages send when you reconnect.')).toBeTruthy();
    postMock.mockImplementation(async (url: string, body: Record<string, unknown>) => ({ data: url === '/messages'
      ? row({ id: `srv-${body.client_message_id}`, sender_id: 'client-1', body: body.body, client_message_id: body.client_message_id, created_at: new Date().toISOString() }) : {} }));
    await act(async () => NetInfo.__setState({ isConnected: true, isInternetReachable: true }));
    await waitFor(() => expect(u.queryByText('Waiting to send')).toBeNull());
    const keys = postMock.mock.calls.filter(([url]) => url === '/messages').map(([, b]) => (b as { client_message_id: string }).client_message_id);
    expect(keys).toHaveLength(4);
    expect(keys.slice(2)).toEqual(keys.slice(0, 2));
    expect(u.getAllByLabelText(/Message: see you friday/)).toHaveLength(1);
    expect(u.queryByText(/messages send when you reconnect/)).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('a replay the server refuses stops waiting: one alert, then a tap to send again', async () => {
    NetInfo.__setState({ isConnected: false, isInternetReachable: false });
    postMock.mockImplementation(async (url: string) => { if (url === '/messages') throw axiosErr(); return { data: {} }; });
    const u = await render(<MessagesScreen />);
    await u.findByLabelText(/Message: from the coach/).then(() => sendText(u, 'see you friday'));
    await u.findByText('Waiting to send');
    postMock.mockImplementation(async (url: string) => { if (url === '/messages') throw Object.assign(axiosErr(), { response: { status: 403, data: {} } }); return { data: {} }; });
    await act(async () => NetInfo.__setState({ isConnected: true, isInternetReachable: true }));
    expect(await u.findByLabelText('Not sent. Tap to send again')).toBeTruthy();
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('a read that lands while the thread is open shows "Read {time}" with one success haptic', async () => {
    mockList.mockResolvedValue({ data: [row({ id: 'm2', sender_id: 'client-1', body: 'answer' })] });
    const u = await render(<MessagesScreen />);
    expect(await u.findByText('Sent')).toBeTruthy();
    expect(HapticService.success).not.toHaveBeenCalled();
    mockList.mockResolvedValue({ data: [row({ id: 'm2', sender_id: 'client-1', body: 'answer', read_at: readAt })] });
    await act(async () => mockRealtime.ping());
    expect(await u.findByText(`Read ${timeB(readAt)}`)).toBeTruthy();
    expect(u.queryByText('Sent')).toBeNull();
    expect(HapticService.success).toHaveBeenCalledTimes(1);
  });

  it('first message: one forest hero card "Say hello to {coach}" over main\'s prompt', async () => {
    mockList.mockResolvedValue({ data: [] });
    const u = await render(<MessagesScreen />);
    expect(await u.findByText('Say hello to Coach Nine')).toBeTruthy();
    expect(u.getByText('Start a conversation with your coach')).toBeTruthy();
    expect(u.getAllByText('Your coach')).toHaveLength(2);
  });

  it('loading: "Loading your messages" progressbar under a working back button', async () => {
    mockList.mockReturnValue(new Promise(() => undefined));
    const u = await render(<MessagesScreen />);
    const loading = u.getByLabelText('Loading your messages');
    expect(loading.props.accessibilityRole).toBe('progressbar');
    await fireEvent.press(u.getByLabelText('Go back'));
    expect(mockGoBack).toHaveBeenCalled();
    expect(u.queryByTestId('thread-mute-button')).toBeNull();
  });

  it('legacy thread (messaging v2 off): a failed send is also a tap to send again', async () => {
    mockFlags.messaging_core_v2 = false;
    mockLegacySend.mockRejectedValueOnce(Object.assign(axiosErr(), { response: { status: 503 } }));
    const u = await render(<MessagesScreen />);
    await u.findByLabelText(/Message: from the coach/);
    await sendText(u, 'hello');
    mockLegacySend.mockResolvedValueOnce({ data: { id: 'srv-3', sender_id: 'client-1', body: 'hello', created_at: new Date().toISOString() } });
    await fireEvent.press(await u.findByLabelText('Not sent. Tap to send again'));
    await waitFor(() => expect(u.queryByText('Not sent. Tap to send again')).toBeNull());
    expect(mockLegacySend.mock.calls).toEqual([['hello'], ['hello']]);
    expect(u.getAllByLabelText(/Message: hello/)).toHaveLength(1);
  });
});

describe('Style B motion and reach', () => {
  const msg = { id: 'x', body: 'hi', created_at: recent };
  it.each([[false, 250, 12], [true, 150, 0]])('reduceMotion=%s: %d ms, starts %d pt low (nothing moves under Reduce Motion)', async (reduceMotion, ms, lift) => {
    // Held at its first frame so the start values can be read.
    const timing = jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn() } as unknown as Animated.CompositeAnimation);
    const u = await render(<StyleBBubble message={msg} isMe state="sent" groupEnd animateIn reduceMotion={reduceMotion} onLongPress={jest.fn()} onRetry={jest.fn()} />);
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, duration: ms, useNativeDriver: true }));
    expect(flat(u.getByTestId('c3b-row-x'))).toMatchObject({ opacity: 0, transform: [{ translateY: lift }] });
    timing.mockRestore();
  });

  it('coach side unchanged: only the client thread reads c3StyleB or the Style B parts', () => {
    const src = path.resolve(__dirname, '../../..');
    // C3B-S2: Home's entry reads the flag to open the client Messages list (tested in HomeHeaderActions.test).
    const clientEntries = ['components/home/HomeHeaderActions.tsx'];
    const hits: string[] = [];
    const walk = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__') walk(f); } else if (/\.tsx?$/.test(e.name) && !clientEntries.includes(path.relative(src, f)) && /c3StyleB|StyleBThread/.test(fs.readFileSync(f, 'utf8'))) hits.push(path.relative(src, f));
    });
    walk(src);
    expect(hits.sort()).toEqual(['components/messaging/StyleBThread.tsx', 'config/featureFlags.ts', 'screens/client/MessagesScreen.tsx']);
  });
});
