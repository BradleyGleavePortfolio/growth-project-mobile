/**
 * Coach thread with the server flag messaging_core_v2 ON (M-MSG-121 2/2).
 * The HTTP layer (services/api default export) is mocked, not
 * messagingV2Api, so each test proves screen -> messagingV2Api -> exact route
 * and body.
 */
import React from 'react';
import { Alert, Platform } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ClientMessagesScreen from '../ClientMessagesScreen';
import api from '../../../services/api';

const originalOS = Platform.OS;
beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
});
afterAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS });
});

jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({
  colors: new Proxy({}, { get: () => '#000000' }),
  semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
}) }));
jest.mock('../../../storage/mmkv', () => {
  const store = { getString: () => undefined, getStringAsync: async () => undefined, set: async () => undefined, delete: async () => undefined };
  return { prefsStorage: store, cacheStorage: store };
});

const mockRows: Array<Record<string, unknown>> = [];
const mockGetClientMessages = jest.fn(async (..._a: unknown[]) => ({ data: { messages: mockRows } }));
const mockLegacySend = jest.fn(async (_id: string, body: string) => ({
  data: { id: 'legacy-new', sender_id: 'coach-1', body, created_at: new Date().toISOString() },
}));
const mockLegacyRead = jest.fn(async (..._a: unknown[]) => ({ data: {} }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  coachApi: {
    getClientMessages: (...a: unknown[]) => mockGetClientMessages(...a),
    markClientThreadRead: (...a: unknown[]) => mockLegacyRead(...a),
    sendClientMessage: (...a: unknown[]) => mockLegacySend(...(a as [string, string])),
  },
}));
const mockSubs: Array<{ userId: string; onPing: () => void }> = [];
jest.mock('../../../services/realtime', () => ({
  subscribeToMessages: (userId: string, onPing: () => void) => {
    mockSubs.push({ userId, onPing });
    return () => undefined;
  },
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1' }) }));
jest.mock('../../../hooks/useBlockedUsersHydration', () => ({
  useBlockedUsersHydration: () => ({ serverHydrationComplete: true }),
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ flags: { messaging_core_v2: true } }),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
    useRoute: () => ({ params: { clientId: 'client-1', clientName: 'Alice Smith' } }),
    useFocusEffect: (cb: () => () => void) => {
      const R = require('react');
      // eslint-disable-next-line react-hooks/exhaustive-deps
      R.useEffect(() => cb(), [cb]);
    },
  };
});

const getMock = api.get as unknown as jest.Mock;
const postMock = api.post as unknown as jest.Mock;
const patchMock = api.patch as unknown as jest.Mock;
const deleteMock = api.delete as unknown as jest.Mock;
const BASE = '/coach/clients/client-1/messages';
const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const axiosErr = (o: Record<string, unknown>) => Object.assign(new Error('request failed'), { isAxiosError: true, ...o });
const row = (o: Record<string, unknown>) => ({ coach_id: 'coach-1', client_id: 'client-1', created_at: recent, ...o });

beforeEach(() => {
  mockRows.length = 0;
  mockRows.push(
    row({ id: 'm1', sender_id: 'client-1', body: 'from the client' }),
    row({ id: 'm2', sender_id: 'coach-1', body: 'from the coach', edited_at: recent }),
    row({ id: 'm3', sender_id: 'client-1', body: null, deleted: true }),
  );
  [getMock, postMock, patchMock, deleteMock, mockLegacySend, mockLegacyRead].forEach((m) => m.mockReset());
  getMock.mockImplementation(async (url: string) => (url === `${BASE}/pins` ? { data: { items: [] } } : { data: {} }));
  postMock.mockResolvedValue({ data: {} });
  mockLegacySend.mockImplementation(async (_id: string, body: string) => ({
    data: { id: 'legacy-new', sender_id: 'coach-1', body, created_at: new Date().toISOString() },
  }));
});

const sentRow = (body: Record<string, unknown>) => ({
  data: row({ id: 'srv-1', sender_id: 'coach-1', body: body.body, client_message_id: body.client_message_id }),
});

describe('ClientMessagesScreen with messaging_core_v2 ON', () => {
  it('parity: shared quiet parts retain back, contact, copy and reply cancellation', async () => {
    const u = await render(<ClientMessagesScreen />);
    await u.findByLabelText(/Message: from the client/);
    await fireEvent.press(u.getByLabelText('Go back'));
    expect(mockGoBack).toHaveBeenCalled();
    await fireEvent.press(u.getByLabelText(/contact details/));
    expect(mockNavigate).toHaveBeenCalledWith('ContactView', { contactId: 'client-1', displayName: 'Alice Smith', role: 'client' });
    await fireEvent(u.getByLabelText(/Message: from the client/), 'longPress');
    await fireEvent.press(await waitFor(() => u.getByLabelText('Reply')));
    await fireEvent.press(u.getByLabelText('Cancel reply'));
    expect(u.queryByLabelText('Cancel reply')).toBeNull();
    await fireEvent(u.getByLabelText(/Message: from the client/), 'longPress');
    await fireEvent.press(await waitFor(() => u.getByLabelText('Copy')));
    expect(jest.requireMock('expo-clipboard').setStringAsync).toHaveBeenCalledWith('from the client');
    const put = api.put as jest.Mock;
    put.mockResolvedValue({ data: { muted: true, muted_until: null, pinned: false } });
    await fireEvent.press(u.getByTestId('thread-mute-button'));
    await fireEvent.press(await waitFor(() => u.getByLabelText('Mute for 1 hour')));
    await waitFor(() => expect(put).toHaveBeenCalledWith(`${BASE}/mute`, { duration: '1h' }, expect.anything()));
  });

  it('a client message that arrives while the thread is open is marked read (AUDIT-03-125 U1)', async () => {
    mockSubs.length = 0;
    await render(<ClientMessagesScreen />);
    await waitFor(() => expect(postMock).toHaveBeenCalledWith(`${BASE}/read`, { up_to_message_id: 'm3' }, expect.anything()));
    mockRows.push(row({ id: 'm4', sender_id: 'client-1', body: 'are you there', created_at: new Date().toISOString() }));
    const self = mockSubs.filter((x) => x.userId === 'coach-1').pop();
    expect(self).toBeTruthy();
    self?.onPing();
    await waitFor(() => expect(postMock).toHaveBeenCalledWith(`${BASE}/read`, { up_to_message_id: 'm4' }, expect.anything()));
  });

  it('sides from sender_id: client message offers report, own message edit and delete; tombstone, Edited, read-up-to', async () => {
    const { findByLabelText, getByLabelText, queryByLabelText, getByText } = await render(<ClientMessagesScreen />);
    expect(getByText('Message deleted')).toBeTruthy();
    await findByLabelText(/Message: from the coach\. Edited\./);
    await waitFor(() => expect(postMock).toHaveBeenCalledWith(`${BASE}/read`, { up_to_message_id: 'm3' }, expect.anything()));
    expect(mockLegacyRead).not.toHaveBeenCalled();

    await fireEvent(await findByLabelText(/Message: from the client/), 'longPress');
    await waitFor(() => getByLabelText('Report Message'));
    expect(queryByLabelText('Edit')).toBeNull();
    expect(queryByLabelText('Delete for everyone')).toBeNull();
    expect(getByLabelText('Reply')).toBeTruthy();
    await fireEvent.press(getByLabelText('Cancel'));

    await fireEvent(await findByLabelText(/Message: from the coach/), 'longPress');
    await waitFor(() => getByLabelText('Edit'));
    expect(getByLabelText('Delete for everyone')).toBeTruthy();
    expect(queryByLabelText('Report Message')).toBeNull();
  });

  it('send is idempotent: same key in body and Idempotency-Key, reused after a network failure', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    postMock.mockImplementation(async (url: string, body: Record<string, unknown>) => {
      if (url === BASE) throw axiosErr({});
      return { data: {} };
    });
    const { findByLabelText, getByLabelText } = await render(<ClientMessagesScreen />);
    await findByLabelText(/Message: from the client/);
    await fireEvent.changeText(getByLabelText('Message text'), 'see you at 6');
    await fireEvent.press(getByLabelText('Send message'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Message not sent', expect.stringContaining('connection')));
    const first = postMock.mock.calls.find(([u]) => u === BASE)!;
    const key = (first[1] as { client_message_id: string }).client_message_id;
    expect(first[1]).toEqual({ body: 'see you at 6', client_message_id: key });
    expect(first[2]).toMatchObject({ headers: { 'Idempotency-Key': key } });

    postMock.mockImplementation(async (url: string, body: Record<string, unknown>) =>
      url === BASE ? sentRow(body) : { data: {} },
    );
    await fireEvent.press(getByLabelText('Send message'));
    await findByLabelText(/Message: see you at 6/);
    const sends = postMock.mock.calls.filter(([u]) => u === BASE);
    expect((sends[sends.length - 1][1] as { client_message_id: string }).client_message_id).toBe(key);
    expect(mockLegacySend).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('edit and delete for everyone hit the v2 routes; delete asks first', async () => {
    patchMock.mockResolvedValue({ data: row({ id: 'm2', sender_id: 'coach-1', body: 'fixed', edited_at: recent }) });
    deleteMock.mockResolvedValue({ data: row({ id: 'm2', sender_id: 'coach-1', body: null, deleted: true }) });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { findByLabelText, getByLabelText } = await render(<ClientMessagesScreen />);

    await fireEvent(await findByLabelText(/Message: from the coach/), 'longPress');
    await fireEvent.press(await waitFor(() => getByLabelText('Edit')));
    await fireEvent.changeText(await waitFor(() => getByLabelText('Edited message text')), 'fixed');
    await fireEvent.press(getByLabelText('Save edit'));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith(`${BASE}/m2`, { body: 'fixed' }, expect.anything()));

    await fireEvent(await findByLabelText(/Message: from the coach/), 'longPress');
    await fireEvent.press(await waitFor(() => getByLabelText('Delete for everyone')));
    expect(deleteMock).not.toHaveBeenCalled();
    const [title, , buttons] = alertSpy.mock.calls.find(([t]) => t === 'Delete for everyone?')!;
    expect(title).toBe('Delete for everyone?');
    (buttons as Array<{ text: string; onPress?: () => void }>).find((b) => b.text === 'Delete')!.onPress!();
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(`${BASE}/m2`, expect.anything()));
    alertSpy.mockRestore();
  });

  it('pins bar shows the pinned message; pin posts to the pin route; reply carries reply_to_id', async () => {
    const pinned = row({ id: 'm1', sender_id: 'client-1', body: 'from the client', pinned_at: recent });
    getMock.mockImplementation(async (url: string) => ({ data: url === `${BASE}/pins` ? { items: [pinned] } : {} }));
    postMock.mockImplementation(async (url: string, body: Record<string, unknown>) =>
      url === BASE ? sentRow(body) : { data: pinned },
    );
    const { findByLabelText, findByTestId, getByLabelText } = await render(<ClientMessagesScreen />);
    expect((await findByTestId('thread-pinned-bar')).props.accessibilityLabel).toMatch(/^Pinned: from the client/);
    await fireEvent(await findByLabelText(/Message: from the client/), 'longPress');
    await fireEvent.press(await waitFor(() => getByLabelText('Pin')));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith(`${BASE}/m1/pin`, undefined, expect.anything()));

    await fireEvent(await findByLabelText(/Message: from the client/), 'longPress');
    await fireEvent.press(await waitFor(() => getByLabelText('Reply')));
    await fireEvent.changeText(getByLabelText('Message text'), 'yes');
    await fireEvent.press(getByLabelText('Send message'));
    const reply = expect.objectContaining({ body: 'yes', reply_to_id: 'm1' });
    await waitFor(() => expect(postMock).toHaveBeenCalledWith(BASE, reply, expect.anything()));
  });

  it('a 503 messaging.feature_disabled falls back to the legacy thread and keeps the text', async () => {
    postMock.mockImplementation(async (url: string) => {
      if (url === BASE) throw axiosErr({ response: { status: 503, data: { code: 'messaging.feature_disabled' } } });
      return { data: {} };
    });
    const { findByLabelText, getByLabelText, queryByTestId } = await render(<ClientMessagesScreen />);
    await findByLabelText(/Message: from the client/);
    await fireEvent.changeText(getByLabelText('Message text'), 'hello');
    await fireEvent.press(getByLabelText('Send message'));
    await waitFor(() => expect(queryByTestId('thread-mute-button')).toBeNull());
    await fireEvent.press(getByLabelText('Send message'));
    await waitFor(() => expect(mockLegacySend).toHaveBeenCalledWith('client-1', 'hello'));
  });
});
