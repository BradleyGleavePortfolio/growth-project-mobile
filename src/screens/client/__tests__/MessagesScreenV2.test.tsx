/**
 * Client thread with the server flag messaging_core_v2 ON (M-MSG-121 2/2):
 * bubble side from sender_id, idempotent send with a kept key on failure,
 * server reply quote, read up to the newest coach message, thread mute.
 * The HTTP layer is mocked (services/api), not messagingV2Api.
 */
import React from 'react';
import { Alert, Platform, StyleSheet, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import api from '../../../services/api';
import * as Clipboard from 'expo-clipboard';

const originalOS = Platform.OS;
beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
});
afterAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS });
});
afterEach(() => jest.restoreAllMocks());

jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({
  colors: new Proxy({}, { get: () => '#000000' }),
  semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
}) }));
jest.mock('../../../storage/mmkv', () => {
  const store = { getString: () => undefined, getStringAsync: async () => undefined, set: async () => undefined, delete: async () => undefined };
  return { prefsStorage: store, cacheStorage: store };
});
const mockList = jest.fn();
const mockProfileGet = jest.fn();
const mockLegacySend = jest.fn();
const mockLegacyRead = jest.fn(async () => ({ data: {} }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  messagesApi: {
    list: (...a: unknown[]) => mockList(...a),
    coachReview: jest.fn(async () => ({ data: { coachReviewedAt: null } })),
    send: (...a: unknown[]) => mockLegacySend(...a),
    markRead: () => mockLegacyRead(),
  },
  profileApi: { get: () => mockProfileGet() },
}));
jest.mock('../../../services/realtime', () => ({ subscribeToMessages: () => () => undefined }));
jest.mock('../../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ flags: { messaging_core_v2: true } }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1' }) }));
jest.mock('../../../hooks/useBlockedUsersHydration', () => ({
  useBlockedUsersHydration: () => ({ serverHydrationComplete: true }),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => ({ key: 'messages', name: 'Messages', params: undefined }),
    useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate, getParent: () => ({ navigate: jest.fn() }) }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      const R = jest.requireActual('react');
      R.useEffect(() => cb(), [cb]);
    },
  };
});

import MessagesScreen from '../MessagesScreen';

const getMock = api.get as unknown as jest.Mock;
const postMock = api.post as unknown as jest.Mock;
const putMock = api.put as unknown as jest.Mock;
const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const row = (o: Record<string, unknown>) => ({ coach_id: 'coach-9', client_id: 'client-1', created_at: recent, ...o });
const axiosErr = (o: Record<string, unknown>) => Object.assign(new Error('request failed'), { isAxiosError: true, ...o });
const inboxRow = { thread_id: 't', kind: 'coach_client', coach_id: 'coach-9', client_id: 'client-1', last_message: null };
const inbox = (muted: boolean) => ({
  data: {
    items: [{ ...inboxRow, counterpart: { user_id: 'coach-9', display_name: 'Coach Nine' }, unread_count: 0, muted, muted_until: null, pinned: false, blocked_by_me: false, last_activity_at: recent }],
    next_cursor: null,
    total_unread: 0,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockProfileGet.mockResolvedValue({ data: {} });
  mockList.mockResolvedValue({
    data: {
      messages: [
        row({ id: 'm1', sender_id: 'coach-9', body: 'from the coach' }),
        row({
          id: 'm2',
          sender_id: 'client-1',
          body: 'answer',
          reply_to_id: 'm0',
          reply_to: { id: 'm0', sender_id: 'coach-9', kind: 'deleted', preview: '' },
        }),
      ],
    },
  });
  getMock.mockImplementation(async (url: string) => {
    if (url === '/messages/pins') return { data: { items: [] } };
    if (url === '/messages/inbox') return inbox(false);
    return { data: {} };
  });
  postMock.mockResolvedValue({ data: {} });
});

describe('client MessagesScreen with messaging_core_v2 ON', () => {
  it('groups timestamps without hiding Edited, and names never imply online presence', async () => {
    mockProfileGet.mockResolvedValueOnce({ data: { coach_id: 'coach-9', coach_name: 'Coach Nine' } });
    mockList.mockResolvedValue({ data: [
      row({ id: 'a', sender_id: 'coach-9', body: 'first', edited_at: recent }),
      row({ id: 'b', sender_id: 'coach-9', body: 'second' }),
      row({ id: 'c', sender_id: 'client-1', body: 'third', read_at: recent }),
    ] });
    const u = await render(<MessagesScreen />);
    await u.findByLabelText(/Message: second/);
    const time = new Date(recent).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    expect(u.getAllByText(time)).toHaveLength(2);
    expect(u.getByText('Edited')).toBeTruthy();
    expect(u.getByText('Read')).toBeTruthy();
    const contact = await u.findByLabelText('View Coach Nine contact details');
    expect(React.Children.toArray(contact.props.children)[0]).toHaveProperty('type', Text);
    expect(StyleSheet.flatten(u.getByLabelText('Send message').props.style)).toMatchObject({ width: 44, height: 44 });
  });

  it('parity: back, contact, copy, reply/cancel, report/close and send remain reachable', async () => {
    mockProfileGet.mockResolvedValueOnce({ data: { coach_id: 'coach-9', coach_name: 'Coach Nine' } });
    const u = await render(<MessagesScreen />);
    await fireEvent.press(await u.findByLabelText('View Coach Nine contact details'));
    expect(mockNavigate).toHaveBeenCalledWith('ContactView', { contactId: 'coach-9', displayName: 'Coach Nine', role: 'coach' });
    await fireEvent.press(u.getByLabelText('Go back'));
    expect(mockGoBack).toHaveBeenCalled();
    const menu = async (label: string) => {
      await fireEvent(u.getByLabelText(/Message: from the coach/), 'longPress');
      await fireEvent.press(await waitFor(() => u.getByLabelText(label)));
    };
    await menu('Copy');
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('from the coach'));
    await menu('Reply');
    await fireEvent.press(u.getByLabelText('Cancel reply'));
    await menu('Report Message');
    await fireEvent.press(u.getByLabelText('Close report sheet'));
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await menu('Report Message');
    await fireEvent.press(u.getByLabelText('Spam'));
    await fireEvent.press(u.getByLabelText('Submit report'));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/messages/report', { messageId: 'm1', reason: 'spam', details: undefined }));
    expect(spy).toHaveBeenCalledWith('Reported', 'Your report has been submitted.');
    spy.mockRestore();
    await menu('Reply');
    postMock.mockImplementation(async (url: string, body: Record<string, unknown>) => ({ data: url === '/messages'
      ? row({ id: 'new', sender_id: 'client-1', body: body.body }) : {} }));
    await fireEvent.changeText(u.getByLabelText('Message text'), 'reply');
    await fireEvent.press(u.getByLabelText('Send message'));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/messages', expect.objectContaining({ body: 'reply', reply_to_id: 'm1' }), expect.anything()));
  });

  it('load errors offer an honest retry, not a contradictory empty conversation', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockList.mockRejectedValue(new Error('offline'));
    const u = await render(<MessagesScreen />);
    await u.findByLabelText('Retry loading messages');
    expect(u.queryByText('Start a conversation with your coach')).toBeNull();
    mockList.mockResolvedValue({ data: [] });
    await fireEvent.press(u.getByLabelText('Retry loading messages'));
    await u.findByText('Start a conversation with your coach');
    spy.mockRestore();
  });

  it('parity: pins, load older, edit/save/cancel and delete confirmation retain their handlers', async () => {
    const own = row({ id: 'own', sender_id: 'client-1', body: 'own text', pinned_at: recent });
    mockList.mockResolvedValue({ data: Array.from({ length: 100 }, (_, i) => i === 0 ? own : { ...own, id: `older-${i}`, body: 'history' }) });
    getMock.mockImplementation(async (url: string) => ({ data: url === '/messages/pins' ? { items: [own] } : {} }));
    const patch = api.patch as jest.Mock;
    patch.mockResolvedValue({ data: { ...own, body: 'edited', edited_at: recent } });
    const del = api.delete as jest.Mock;
    del.mockResolvedValue({ data: { ...own, body: null, deleted: true } });
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const u = await render(<MessagesScreen />);
    await fireEvent.press(await u.findByTestId('thread-pinned-bar'));
    await fireEvent.press(u.getByLabelText('Load older messages'));
    await waitFor(() => expect(mockList).toHaveBeenCalledWith({ before: recent, limit: 100 }));
    const menu = async (label: string) => {
      await fireEvent(u.getByLabelText(/Message: own text/), 'longPress');
      await fireEvent.press(await waitFor(() => u.getByLabelText(label)));
    };
    await menu('Edit');
    await fireEvent.press(u.getByLabelText('Cancel editing'));
    await menu('Edit');
    await fireEvent.changeText(u.getByLabelText('Edited message text'), 'edited');
    await fireEvent.press(u.getByLabelText('Save edit'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/messages/own', { body: 'edited' }, expect.anything()));
    await menu('Unpin');
    await waitFor(() => expect(del).toHaveBeenCalledWith('/messages/own/pin', expect.anything()));
    del.mockClear();
    await menu('Delete for everyone');
    expect(del).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith('Delete for everyone?', expect.any(String), expect.any(Array));
    await act(async () => spy.mock.calls.find(([title]) => title === 'Delete for everyone?')?.[2]?.find((b) => b.text === 'Delete')?.onPress?.());
    await waitFor(() => expect(del).toHaveBeenCalledWith('/messages/own', expect.anything()));
    spy.mockRestore();
  });

  it('coach message is the coach side even without sender_role; read goes up to it; server quote renders', async () => {
    const utils = await render(<MessagesScreen />);
    await utils.findByLabelText(/Message: from the coach/);
    // The quoted message was deleted: the quote says so instead of a stale body.
    expect(utils.getByText('Message deleted')).toBeTruthy();
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/messages/read', { up_to_message_id: 'm1' }, expect.anything()),
    );
    expect(mockLegacyRead).not.toHaveBeenCalled();
    // Coach message: report offered, edit not offered.
    await fireEvent(utils.getByLabelText(/Message: from the coach/), 'longPress');
    await waitFor(() => utils.getByLabelText('Report Message'));
    expect(utils.queryByLabelText('Edit')).toBeNull();
    await fireEvent.press(utils.getByLabelText('Cancel'));
    // Header bell: not muted, so no Unmute; a duration goes to PUT /messages/mute.
    putMock.mockResolvedValue({ data: { muted: true, muted_until: null, pinned: false } });
    await fireEvent.press(await utils.findByTestId('thread-mute-button'));
    expect(utils.queryByLabelText('Unmute')).toBeNull();
    await fireEvent.press(await waitFor(() => utils.getByLabelText('Mute for 8 hours')));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith('/messages/mute', { duration: '8h' }, expect.anything()));
    await fireEvent.press(utils.getByTestId('thread-mute-button'));
    await fireEvent.press(await waitFor(() => utils.getByLabelText('Unmute')));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith('/messages/mute', { duration: 'off' }, expect.anything()));
  });

  it('a failed send stays as "Not sent" with its key; Send again replays the same key, no duplicate', async () => {
    let fail = true;
    postMock.mockImplementation(async (url: string, body: Record<string, unknown>) => {
      if (url !== '/messages') return { data: {} };
      if (fail) throw axiosErr({});
      return { data: row({ id: 'srv-1', sender_id: 'client-1', body: body.body, client_message_id: body.client_message_id }) };
    });
    const utils = await render(<MessagesScreen />);
    await utils.findByLabelText(/Message: from the coach/);
    await fireEvent.changeText(utils.getByLabelText('Message text'), 'running late');
    await fireEvent.press(utils.getByLabelText('Send message'));
    expect(await utils.findByText('Not sent. Long press to send again')).toBeTruthy();
    const first = postMock.mock.calls.find(([u]) => u === '/messages')!;
    const key = (first[1] as { client_message_id: string }).client_message_id;
    expect(first[2]).toMatchObject({ headers: { 'Idempotency-Key': key } });

    fail = false;
    await fireEvent(utils.getByLabelText(/Message: running late/), 'longPress');
    await fireEvent.press(await waitFor(() => utils.getByLabelText('Send again')));
    await waitFor(() => expect(utils.queryByText('Not sent. Long press to send again')).toBeNull());
    const sends = postMock.mock.calls.filter(([u]) => u === '/messages');
    expect(sends).toHaveLength(2);
    expect((sends[1][1] as { client_message_id: string }).client_message_id).toBe(key);
    expect(utils.getAllByLabelText(/Message: running late/)).toHaveLength(1);
    expect(mockLegacySend).not.toHaveBeenCalled();
  });
});
