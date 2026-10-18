/**
 * C3B-THREAD: the client's thread with featureFlags.c3StyleB ON (MOCK-C3 Style B, slice 1): every state and every main
 * pathway (contact, back, mute, copy, reply, report, send, pins, load older, edit, delete, Send again). HTTP is mocked.
 * C3B-THREAD-R1: one table-driven test per rule (R1 outbox, R2 dispatcher, R3 calm offline, R4 44 x 44 pt). The thread
 * renders under <Host />, the app-level drain ClientNavigator mounts, so it can be closed while the app stays open.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fs from 'fs';
import * as path from 'path';
import { Alert, Animated, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import api from '../../../services/api';
import * as Clipboard from 'expo-clipboard';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { gold, lightTokens } from '../../../theme/tokens';
import { StyleBBubble, dayB, timeB } from '../../../components/messaging/StyleBThread';
import { featureFlags } from '../../../config/featureFlags';

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
  // The AsyncStorage shim: no synchronous read; the async read sees what was written.
  const data = new Map<string, string>();
  const store = { data, getString: () => undefined, getStringAsync: async (k: string) => data.get(k), set: async (k: string, v: string) => { data.set(k, v); }, delete: async (k: string) => { data.delete(k); } };
  return { prefsStorage: store, cacheStorage: store };
});
jest.mock('../../../lib/userCache', () => ({ ...jest.requireActual('../../../lib/userCache'), readUserCacheSync: () => ({ id: 'client-1' }) }));
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
import { useMessageOutboxDrain } from '../../../hooks/useMessageOutbox';
import { sendCardViaOutbox } from '../../../services/messageOutbox';

function Host() {
  useMessageOutboxDrain();
  return null;
}
const App = ({ thread = true }: { thread?: boolean }) => <><Host />{thread ? <MessagesScreen /> : null}</>;
const stored: Map<string, string> = jest.requireMock('../../../storage/mmkv').cacheStorage.data;
const OUTBOX = 'messages_thread_outbox_client-1';
const ERR = 'Messages could not be loaded. Tap to try again.';
const OFF = { isConnected: false, isInternetReachable: false };
const ON = { isConnected: true, isInternetReachable: true };

const NetInfo = jest.requireMock('@react-native-community/netinfo');
const getMock = api.get as unknown as jest.Mock;
const postMock = api.post as unknown as jest.Mock;
const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const readAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
const row = (o: Record<string, unknown>) => ({ coach_id: 'coach-9', client_id: 'client-1', created_at: recent, ...o });
const axiosErr = () => Object.assign(new Error('request failed'), { isAxiosError: true });
const flat = (el: { props: object }) => StyleSheet.flatten((el.props as { style?: StyleProp<ViewStyle> }).style) as unknown as Record<string, unknown>;
const named = { data: { coach_id: 'coach-9', coach_name: 'Coach Nine' } };
// The server: each POST /messages takes the next planned step, else the fallback. 'hold' answers when released.
type Step = 'ok' | 'net' | 'hold' | number;
const posts: Array<{ body: string; key?: string; header?: string }> = [];
const delivered: string[] = [];
let plan: Step[] = [];
let fallback: Step = 'ok';
let release: (() => void) | null = null;
const serve = (fb: Step, ...steps: Step[]) => { fallback = fb; plan = steps; };
const serverImpl = async (url: string, b: Record<string, string>, cfg?: { headers?: Record<string, string> }) => {
  if (url !== '/messages') return { data: {} };
  posts.push({ body: b.body, key: b.client_message_id, header: cfg?.headers?.['Idempotency-Key'] });
  const step = plan.shift() ?? fallback;
  if (step === 'net') throw axiosErr();
  if (typeof step === 'number') throw Object.assign(axiosErr(), { response: { status: step, data: {} } });
  if (step === 'hold') await new Promise<void>((r) => { release = r; });
  delivered.push(b.body);
  return { data: row({ id: `srv-${b.client_message_id}`, sender_id: 'client-1', body: b.body, client_message_id: b.client_message_id, created_at: new Date().toISOString() }) };
};
const net = (state: typeof ON) => act(async () => NetInfo.__setState(state));
const holdReached = () => waitFor(() => expect(release).not.toBeNull());
const releaseHold = async () => { const r = release; release = null; await act(async () => r?.()); };
const posted = (body: string) => posts.filter((p) => p.body === body).length;
const keyOf = async (body: string) => (JSON.parse((await AsyncStorage.getItem(OUTBOX)) ?? '[]') as Array<{ key: string; body: string }>).find((i) => i.body === body)?.key;
let alertSpy: jest.SpyInstance;
const originalOS = Platform.OS; // menus as in MessagesScreenV2.test (the in-app sheet, not ActionSheetIOS)
beforeAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' }));
afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS }));

beforeEach(async () => {
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
  stored.clear();
  await AsyncStorage.clear();
  posts.length = 0;
  delivered.length = 0;
  serve('ok');
  release = null;
  postMock.mockImplementation(serverImpl);
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
    const u = await render(<App />);
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

  it('ROMANMARK: each drafted coach message carries the mark on its bottom inner corner; typed, voice, deleted and own rows none', async () => {
    Object.defineProperty(featureFlags, 'romanDraftMark', { value: true });
    mockList.mockResolvedValue({ data: [
      row({ id: 'd1', sender_id: 'coach-9', body: 'First draft', ai_draft_id: 'a1' }),
      row({ id: 'd2', sender_id: 'coach-9', body: 'Edited draft', ai_draft_id: 'a2', edited_at: recent }),
      row({ id: 'typed', sender_id: 'coach-9', body: 'Typed' }),
      row({ id: 'voice', sender_id: 'coach-9', body: '', ai_draft_id: 'a3', voice_url: 'voice.m4a' }),
      row({ id: 'gone', sender_id: 'coach-9', body: null, ai_draft_id: 'a4', deleted: true }),
      row({ id: 'own', sender_id: 'client-1', body: 'answer', ai_draft_id: 'a5' }),
    ] });
    try {
      const u = await render(<MessagesScreen />);
      await waitFor(() => expect(u.getAllByLabelText('Roman helped draft this message. Coach sent it.')).toHaveLength(2));
      expect(flat(u.getAllByTestId('roman-draft-mark')[0])).toMatchObject({ width: 44, height: 44, right: 0 });
      await fireEvent.press(u.getAllByTestId('roman-draft-mark')[0]);
      expect(flat(u.getByText('Drafted by Roman'))).toMatchObject({ fontStyle: 'italic', textDecorationLine: 'underline' });
      expect(u.getAllByText(timeB(recent)).length).toBeGreaterThan(0); // times stay under the bubbles, as on every Style B row
    } finally { Object.defineProperty(featureFlags, 'romanDraftMark', { value: false }); }
  });

  it('keeps every pathway: contact, back, mute, copy, reply, report, send (softImpact)', async () => {
    const u = await render(<App />);
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
    const u = await render(<App />);
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
    serve('net');
    const u = await render(<App />);
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
    serve('ok');
    await menu(u, /Message: running late/, 'Send again');
    await waitFor(() => expect(u.queryByText('Not sent. Tap to send again')).toBeNull());
    expect(sends().map(([, b]) => (b as { client_message_id: string }).client_message_id)).toEqual([key, key, key]);
    expect(u.getAllByLabelText(/Message: running late/)).toHaveLength(1);
  });

  it('offline: messages wait ("Waiting to send", C3-S-58 for two, no alert, no haptic) and go out once, in order, on reconnect', async () => {
    NetInfo.__setState(OFF);
    serve('net');
    const u = await render(<App />);
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
    expect(posted('and saturday')).toBe(0); // offline nothing gets past the first
    const keys = await Promise.all([keyOf('see you friday'), keyOf('and saturday')]);
    serve('ok');
    await net(ON);
    await waitFor(() => expect(u.queryByText('Waiting to send')).toBeNull());
    expect(delivered).toEqual(['see you friday', 'and saturday']);
    expect(posts.slice(-2).map((p) => p.key)).toEqual(keys);
    expect(u.getAllByLabelText(/Message: see you friday/)).toHaveLength(1);
    expect(u.queryByText(/messages send when you reconnect/)).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('a replay the server refuses stops waiting: one alert, then a tap to send again', async () => {
    NetInfo.__setState(OFF);
    serve('net');
    const u = await render(<App />);
    await u.findByLabelText(/Message: from the coach/).then(() => sendText(u, 'see you friday'));
    await u.findByText('Waiting to send');
    serve(403);
    await net(ON);
    expect(await u.findByLabelText('Not sent. Tap to send again')).toBeTruthy();
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('a read that lands while the thread is open shows "Read {time}" with one success haptic', async () => {
    mockList.mockResolvedValue({ data: [row({ id: 'm2', sender_id: 'client-1', body: 'answer' })] });
    const u = await render(<App />);
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
    const u = await render(<App />);
    expect(await u.findByText('Say hello to Coach Nine')).toBeTruthy();
    expect(u.getByText('Start a conversation with your coach')).toBeTruthy();
    expect(u.getAllByText('Your coach')).toHaveLength(2);
  });

  it('loading: "Loading your messages" progressbar under a working back button', async () => {
    mockList.mockReturnValue(new Promise(() => undefined));
    const u = await render(<App />);
    const loading = u.getByLabelText('Loading your messages');
    expect(loading.props.accessibilityRole).toBe('progressbar');
    await fireEvent.press(u.getByLabelText('Go back'));
    expect(mockGoBack).toHaveBeenCalled();
    expect(u.queryByTestId('thread-mute-button')).toBeNull();
  });
});

type U = Awaited<ReturnType<typeof render>>;
const ready = async (u: U) => { await u.findByLabelText(/Message: from the coach/); };
// Lets the sends already started finish before the server's next step is planned.
const idle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('R1: a message written offline survives leaving the thread and sends itself once when the phone is back online', () => {
  it.each([
    ['the app closes and the thread opens again, history loads, then the signal returns', 'restart'],
    ['the client backs out of the thread and the signal returns with it closed', 'closed'],
  ])('%s: one delivery, with the key it was written with', async (_name, how) => {
    NetInfo.__setState(OFF);
    serve('net');
    let u = await render(<App />);
    await ready(u);
    await sendText(u, 'see you friday');
    await u.findByText('Waiting to send');
    await idle();
    const key = await keyOf('see you friday');
    expect(key).toBeTruthy();
    if (how === 'restart') {
      await u.unmount(); // ClientNavigator gone: only the saved copy is left
      mockList.mockClear();
      u = await render(<App />);
      await ready(u);
      expect(mockList).toHaveBeenCalled();
      expect(await u.findByText('Waiting to send')).toBeTruthy(); // still visible and waiting
    } else {
      await u.rerender(<App thread={false} />);
      expect(u.queryByText('Waiting to send')).toBeNull();
    }
    serve('ok');
    await net(ON);
    await waitFor(() => expect(delivered).toEqual(['see you friday']));
    expect(posts[posts.length - 1]).toEqual({ body: 'see you friday', key, header: key });
    await net(OFF);
    await net(ON);
    expect(delivered).toEqual(['see you friday']);
    expect(await AsyncStorage.getItem(OUTBOX)).toBe('[]');
  });
});

describe('R2: every send goes through one ordered, keyed dispatcher', () => {
  const tapStatus = (u: U) => fireEvent.press(u.getByLabelText('Not sent. Tap to send again'));
  const tapBubble = (u: U) => fireEvent.press(u.getByLabelText(/Message: first/));
  const sendAgain = (u: U) => menu(u, /Message: second/, 'Send again');
  // "first" fails while online and "second" waits behind it; each tap entry point then sends from "first".
  const failedHead = async (u: U) => {
    serve('ok', 500);
    await sendText(u, 'first');
    await u.findByLabelText('Not sent. Tap to send again');
    await sendText(u, 'second');
    await waitFor(() => expect(u.getAllByLabelText(/Message: second/)).toHaveLength(1));
    expect(posted('second')).toBe(0);
  };
  const tapRow = (tap: (u: U) => unknown) => async (u: U) => {
    await failedHead(u);
    serve('ok', 500);
    await tap(u); // the first item fails again: nothing after it goes
    await waitFor(() => expect(posted('first')).toBe(2));
    expect(posted('second')).toBe(0);
    serve('ok', 'hold');
    await tap(u);
    await holdReached();
    await sendText(u, 'third'); // a fresh send during the drain queues behind it
    await releaseHold();
  };
  it.each([
    ['failed bubble status line tap', true, 3, tapRow(tapStatus)],
    ['failed bubble tap', true, 3, tapRow(tapBubble)],
    ['long press, Send again', true, 3, tapRow(sendAgain)],
    ['legacy thread (messaging v2 off): status line tap', false, 3, tapRow(tapStatus)],
    ['fresh send', true, 4, async (u: U) => {
      serve('ok', 'hold');
      await sendText(u, 'first');
      await holdReached();
      await sendText(u, 'second');
      await releaseHold();
      await waitFor(() => expect(delivered).toEqual(['first', 'second']));
      serve('ok', 500);
      await sendText(u, 'third');
      await u.findByLabelText('Not sent. Tap to send again');
      await sendText(u, 'fourth');
      expect(posted('fourth')).toBe(0);
      await tapStatus(u);
    }],
    ['automatic reconnect', true, 4, async (u: U) => {
      await net(OFF);
      serve('net');
      await sendText(u, 'first');
      await sendText(u, 'second');
      await idle();
      serve('ok', 'hold');
      await net(ON);
      await holdReached();
      await sendText(u, 'third');
      await releaseHold();
      await waitFor(() => expect(delivered).toEqual(['first', 'second', 'third']));
      await net(OFF);
      serve('net');
      await sendText(u, 'fourth');
      await idle();
      serve('ok', 500);
      await net(ON);
      await u.findByLabelText('Not sent. Tap to send again');
      const tries = posted('fourth');
      await net(OFF);
      await net(ON); // automatic sends never replay a failed message
      await idle();
      expect(posted('fourth')).toBe(tries);
      await tapStatus(u);
    }],
  ] as Array<[string, boolean, number, (u: U) => Promise<void>]>)('%s: a first-item failure holds the rest; a send during the drain goes after; each once, in order, keyed', async (_name, v2, n, run) => {
    mockFlags.messaging_core_v2 = v2;
    const u = await render(<App />);
    await ready(u);
    await run(u);
    const written = ['first', 'second', 'third', 'fourth'].slice(0, n);
    await waitFor(() => expect(delivered).toEqual(written));
    expect(u.queryByText('Not sent. Tap to send again')).toBeNull();
    expect(posts.every((p) => !!p.key && p.header === p.key)).toBe(true);
    expect(new Set(posts.map((p) => `${p.body}|${p.key}`)).size).toBe(written.length);
    expect(mockLegacySend).not.toHaveBeenCalled();
  });
});

describe('R6: a message the server can never accept holds nothing', () => {
  it('400: "second" goes, "first" is never repeated; its tap puts the text back in the composer', async () => {
    serve('ok', 400);
    const u = await render(<App />);
    await ready(u);
    await sendText(u, 'first');
    await sendText(u, 'second');
    await waitFor(() => expect(delivered).toEqual(['second']));
    await fireEvent.press(u.getByLabelText('Not sent. Tap to send again'));
    expect(u.getByLabelText('Message text').props.value).toBe('first');
    expect(u.queryByLabelText(/Message: first/)).toBeNull();
    expect(posted('first')).toBe(1);
  });
});

describe('R3: offline is the calm state the mockup draws', () => {
  it.each([
    ['offline: no error line, one reload when the signal returns', false],
    ['online: a real load failure keeps the line', true],
  ])('%s', async (_name, online) => {
    if (!online) NetInfo.__setState(OFF);
    mockList.mockRejectedValue(axiosErr());
    const u = await render(<App />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    if (online) {
      expect(await u.findByText(ERR)).toBeTruthy();
      return;
    }
    await act(async () => mockRealtime.ping());
    expect(u.queryByText(ERR)).toBeNull();
    const calls = mockList.mock.calls.length;
    mockList.mockResolvedValue({ data: [row({ id: 'm1', sender_id: 'coach-9', body: 'from the coach' })] });
    await net(ON);
    await ready(u);
    expect(mockList).toHaveBeenCalledTimes(calls + 1);
    expect(u.queryByText(ERR)).toBeNull();
  });
});

describe('R4: every message bubble is at least 44 x 44 pt', () => {
  it.each([['sent', true], ['waiting', true], ['failed', true], ['sent', false]] as const)('a one-letter "k" (%s, mine=%s)', async (state, isMe) => {
    const u = await render(<StyleBBubble message={{ id: 'k', body: 'k', created_at: recent }} isMe={isMe} state={state} groupEnd animateIn={false} reduceMotion onLongPress={jest.fn()} onRetry={jest.fn()} />);
    expect(flat(u.getByLabelText(/^Message: k\./))).toMatchObject({ minWidth: 44, minHeight: 44 });
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

  // C3B-S2: Home's entry reads the flag to open the client Messages list (HomeHeaderActions.test).
  it('coach side unchanged: only the client thread reads c3StyleB or the Style B parts', () => {
    const src = path.resolve(__dirname, '../../..');
    const hits: string[] = [];
    const walk = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__') walk(f); } else if (/\.tsx?$/.test(e.name) && /c3StyleB|StyleBThread/.test(fs.readFileSync(f, 'utf8'))) hits.push(path.relative(src, f));
    });
    walk(src);
    expect(hits.sort()).toEqual(['components/home/HomeHeaderActions.tsx', 'components/messaging/StyleBThread.tsx', 'config/featureFlags.ts', 'hooks/useMessageOutbox.ts', 'screens/client/MessagesScreen.tsx', 'services/messageOutbox.ts']);
  });
});

describe('SHARE-B: shareSendV1 on, c3StyleB off: a card sent from the share sheet waits in this thread too and sends once', () => {
  const CARD = { kind: 'weigh_in_run', value: 14, words: 'days in a row', from: '2026-10-04', to: '2026-10-17' } as const;
  const KEY = 'card-key-1';
  const cards = (u: U) => u.queryAllByLabelText(/^Shared progress: 14 days in a row/);
  const keys = () => posts.map((p) => p.key);
  beforeEach(() => {
    Object.assign(featureFlags, { c3StyleB: false, shareSendV1: true });
    // SHARE-BE stores a card-only message: no text, the card on the row.
    postMock.mockImplementation(async (url: string, b: Record<string, string>, cfg?: { headers?: Record<string, string> }) => {
      const res = await serverImpl(url, b, cfg);
      const sent = (b as { card?: { snapshot: unknown } }).card;
      return sent ? { data: { ...res.data, body: '', card: { card_type: 'share', snapshot: sent.snapshot } } } : res;
    });
  });
  afterEach(() => Object.assign(featureFlags, { c3StyleB: true, shareSendV1: false }));

  it('offline: saved with its snapshot and key, "Waiting to send" here, sent once on reconnect with the thread closed, once after the read', async () => {
    NetInfo.__setState(OFF);
    serve('net');
    const u = await render(<App />);
    await ready(u);
    await act(async () => { await expect(sendCardViaOutbox('client-1', CARD, KEY)).resolves.toBe('waiting'); });
    expect(await u.findByText('Waiting to send')).toBeTruthy();
    expect(cards(u)).toHaveLength(1);
    expect(JSON.parse((await AsyncStorage.getItem(OUTBOX)) ?? '[]')).toEqual([expect.objectContaining({ key: KEY, body: '', card: CARD })]);
    await u.rerender(<App thread={false} />);
    serve('ok');
    await net(ON);
    await waitFor(() => expect(delivered).toHaveLength(1));
    expect(keys()).toEqual([KEY, KEY]); // the offline try and the delivery: one key, so the server keeps one
    expect(await AsyncStorage.getItem(OUTBOX)).toBe('[]');
    mockList.mockResolvedValue({ data: [row({ id: 'm1', sender_id: 'coach-9', body: 'from the coach' }),
      row({ id: `srv-${KEY}`, sender_id: 'client-1', body: '', client_message_id: KEY, card: { card_type: 'share', snapshot: CARD } })] });
    await u.rerender(<App />);
    await ready(u);
    await waitFor(() => expect(cards(u)).toHaveLength(1));
    expect(u.queryByText('Waiting to send')).toBeNull();
    expect(mockLegacySend).not.toHaveBeenCalled();
  });

  it('online failure: "Not sent. Long press to send again"; Send again replays its key through the outbox, not the text send', async () => {
    serve('net');
    const u = await render(<App />);
    await ready(u);
    await act(async () => { await expect(sendCardViaOutbox('client-1', CARD, KEY)).resolves.toBe('failed'); });
    expect(await u.findByText('Not sent. Long press to send again')).toBeTruthy();
    serve('ok');
    await menu(u, /^Shared progress: 14 days in a row/, 'Send again');
    await waitFor(() => expect(u.queryByText('Not sent. Long press to send again')).toBeNull());
    expect([keys(), delivered.length, cards(u).length]).toEqual([[KEY, KEY], 1, 1]);
    expect(mockLegacySend).not.toHaveBeenCalled();
  });
});
