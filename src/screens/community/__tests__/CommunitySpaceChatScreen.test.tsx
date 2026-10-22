/**
 * SC-M1 (agent 168): the space chat with communitySpaceChat on. Member Everyone (rows, names as sent, Coach mark,
 * voice row), member Announcements (no composer, SC-W03), coach Everyone, empty, offline, send failure and Try again
 * (same Idempotency-Key), a written-offline row sent when back online, the draft kept per space, the New messages line
 * (hidden when the read route is 404), no access (404: no content, no composer), block (rows leave at once), and a
 * label on every control. Text scales (no maxFontSizeMultiplier / allowFontScaling off anywhere on the page).
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockDisk = new Map<string, string>();
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: {
    getString: () => undefined,
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
}));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
const mockFlags = { communitySpaceChat: true, communityVoiceNotes: true };
jest.mock('../../../config/featureFlags', () => ({ featureFlags: mockFlags }));
const mockParams: { current: Record<string, unknown> } = { current: { cohortId: 'c-every' } };
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack }),
  useRoute: () => ({ params: mockParams.current }),
}));
let mockUser = { id: 'me-1', name: 'Dana Reyes', coach_id: 'coach-1' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
const mockNet = { isOnline: true };
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ isOnline: mockNet.isOnline, isInternetReachable: null }) }));
let mockRole = 'client';
const cohorts = () => [
  { id: 'c-every', workspace_id: 'ws', name: 'Everyone', is_default: true, kind: 'default', member_count: 24, my_role: mockRole },
  { id: 'c-ann', workspace_id: 'ws', name: 'Announcements', is_default: false, kind: 'announcement', posting_policy: 'coach', member_count: 24, my_role: mockRole },
];
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityCohorts: () => ({ data: { feature_flag_state: 'on', cohorts: cohorts() }, isLoading: false }),
  useCommunityMe: () => ({ dataUpdatedAt: 0 }),
}));
jest.mock('../../../components/community/VoiceNotePlayer', () => {
  const { Text } = jest.requireActual('react-native');
  return (p: { testID: string; durationMs: number }) => <Text testID={p.testID}>{`player ${p.durationMs}`}</Text>;
});
jest.mock('../../../api/communityVoiceApi', () => ({ communityVoiceApi: { getOne: jest.fn(async () => ({ url: 'https://x/v.m4a' })) } }));
jest.mock('../../../components/community/SafetyMenu', () => {
  const { Text } = jest.requireActual('react-native');
  return (p: { testID: string; authorUserId: string; onBlocked?: (id: string) => void }) => (
    <Text testID={p.testID} accessibilityLabel="Report or block" onPress={() => p.onBlocked?.(p.authorUserId)}>menu</Text>
  );
});
const mockApi = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock('../../../services/api', () => ({ __esModule: true, default: mockApi }));

const Screen = require('../CommunitySpaceChatScreen').default;

const msg = (id: string, at: string, who: { id: string; name: string; is_coach?: boolean }, extra: Record<string, unknown> = {}) => ({
  id, cohort_id: 'c-every', sender_user_id: who.id, body: `body ${id}`, kind: 'text', created_at: at, updated_at: at,
  edited: false, deleted: false, parent_message_id: null, voice_note: null,
  sender: { id: who.id, name: who.name, avatar_url: null, is_coach: !!who.is_coach }, ...extra,
});
const COACH = { id: 'coach-1', name: 'Sam Okafor', is_coach: true };
const JO = { id: 'u-2', name: 'jo b.' };
const ME = { id: 'me-1', name: 'Dana Reyes' };
const fail = (status: number) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data: {} } });
let page: unknown[] = [];
let readAnswer: unknown = { last_read_at: '2026-10-22T09:00:00.000Z', last_read_message_id: 'm1' };

beforeEach(() => {
  mockDisk.clear();
  mockFlags.communityVoiceNotes = true;
  mockNet.isOnline = true;
  mockRole = 'client';
  mockUser = { id: 'me-1', name: 'Dana Reyes', coach_id: 'coach-1' };
  mockParams.current = { cohortId: 'c-every' };
  page = [
    msg('m3', '2026-10-22T10:05:00.000Z', JO),
    msg('m2', '2026-10-22T09:30:00.000Z', COACH, { kind: 'voice', body: null, voice_note: { id: 'v1', duration_ms: 42000, waveform_peaks: null, heard_at: null } }),
    msg('m1', '2026-10-22T08:00:00.000Z', COACH),
  ];
  readAnswer = { last_read_at: '2026-10-22T09:00:00.000Z', last_read_message_id: 'm1' };
  mockApi.get.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/read')) {
      if (readAnswer instanceof Error) throw readAnswer;
      return { data: readAnswer };
    }
    return { data: { messages: page, next_before: null } };
  });
  mockApi.post.mockReset().mockImplementation(async (url: string) =>
    (url.endsWith('/read') ? { data: { ok: true } } : { data: { message: msg('m9', new Date().toISOString(), ME) } }));
  mockApi.delete.mockReset().mockResolvedValue({ data: {} });
});

let client: QueryClient;
const open = async () => {
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const r = await render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
  await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
  return r;
};
afterEach(() => client?.clear());

it('member Everyone: header, rows with names as sent, Coach mark, voice row, New messages line, composer', async () => {
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  expect(r.getByText('# Everyone')).toBeTruthy();
  expect(r.getByText('24 members')).toBeTruthy();
  expect(r.getByText('jo b.')).toBeTruthy();
  expect(r.getAllByText('Coach')).toHaveLength(2);
  expect(r.getByTestId('space-chat-voice-v1')).toBeTruthy();
  expect(r.getByTestId('space-chat-new-line')).toBeTruthy();
  expect(r.getByTestId('space-chat-composer-field')).toBeTruthy();
  expect(r.queryByTestId('space-chat-hint')).toBeNull();
  // The stream reads the space's own route, newest first, and marks the newest row read (SC-BE2).
  expect(mockApi.get).toHaveBeenCalledWith('/community/cohorts/c-every/messages', { params: { limit: 30 } });
  await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/community/cohorts/c-every/read', { message_id: 'm3' }));
});

it('voice rows stay out of the stream while communityVoiceNotes is off', async () => {
  mockFlags.communityVoiceNotes = false;
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  expect(r.queryByTestId('space-chat-row-m2')).toBeNull();
});

it('the New messages line is hidden when the server has no read route (404)', async () => {
  readAnswer = fail(404);
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  expect(r.queryByTestId('space-chat-new-line')).toBeNull();
});

it('member Announcements: no composer, only the hint', async () => {
  mockParams.current = { cohortId: 'c-ann' };
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  expect(r.getByText('Only your coach posts here. Press and hold a message to reply.')).toBeTruthy();
  expect(r.queryByTestId('space-chat-composer-field')).toBeNull();
});

it('coach Everyone and Announcements: the coach has the composer', async () => {
  mockRole = 'owner';
  mockUser = { id: 'coach-1', name: 'Sam Okafor', coach_id: '' };
  mockParams.current = { cohortId: 'c-ann' };
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  expect(r.getByTestId('space-chat-composer-field')).toBeTruthy();
  expect(r.queryByTestId('space-chat-hint')).toBeNull();
});

it('empty space: SC-W05 and the composer', async () => {
  page = [];
  const r = await open();
  expect(await r.findByText('No messages yet. Say hello.')).toBeTruthy();
  expect(r.getByTestId('space-chat-composer-field')).toBeTruthy();
});

it('offline with nothing loaded: the offline line and Try again', async () => {
  mockNet.isOnline = false;
  mockApi.get.mockImplementation(async () => { throw Object.assign(new Error('Network Error'), { isAxiosError: true, request: {} }); });
  const r = await open();
  expect(await r.findByTestId('space-chat-error')).toBeTruthy();
  expect(r.getByText(/offline/i)).toBeTruthy();
  expect(r.getByLabelText('Try again')).toBeTruthy();
});

it('no access (404: not a member or banned): no rows, no composer, the line where the composer was', async () => {
  mockApi.get.mockImplementation(async () => { throw fail(404); });
  const r = await open();
  expect(await r.findByTestId('space-chat-no-access')).toBeTruthy();
  expect(r.queryByTestId('space-chat-composer-field')).toBeNull();
  expect(r.queryByTestId('space-chat-list')).toBeNull();
  expect(mockApi.get.mock.calls.filter(([u]) => String(u).endsWith('/messages'))).toHaveLength(1);
});

it('a failed send says Not sent; Try again reuses the same Idempotency-Key', async () => {
  const ok = mockApi.post.getMockImplementation()!;
  let failNext = true;
  mockApi.post.mockImplementation(async (url: string, ...rest: unknown[]) => {
    if (url.endsWith('/messages') && failNext) { failNext = false; throw fail(500); }
    return ok(url, ...rest);
  });
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  await fireEvent.changeText(r.getByTestId('space-chat-composer-field'), 'Hey, loved that set');
  await fireEvent.press(r.getByTestId('space-chat-composer-send'));
  const retry = await r.findByLabelText('Not sent. Tap to send again');
  const key1 = mockApi.post.mock.calls.find(([u]) => String(u).endsWith('/messages'))[2].headers['Idempotency-Key'];
  await fireEvent.press(retry);
  await waitFor(() => expect(mockApi.post.mock.calls.filter(([u]) => String(u).endsWith('/messages'))).toHaveLength(2));
  const sends = mockApi.post.mock.calls.filter(([u]) => String(u).endsWith('/messages'));
  expect(sends[1][1]).toEqual({ body: 'Hey, loved that set' });
  expect(sends[1][2].headers['Idempotency-Key']).toBe(key1);
});

it('written offline: Waiting to send, then sent when back online', async () => {
  mockNet.isOnline = false;
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  await fireEvent.changeText(r.getByTestId('space-chat-composer-field'), 'On the train');
  await fireEvent.press(r.getByTestId('space-chat-composer-send'));
  expect(await r.findByText('Waiting to send')).toBeTruthy();
  expect(mockApi.post.mock.calls.filter(([u]) => String(u).endsWith('/messages'))).toHaveLength(0);
  mockNet.isOnline = true;
  await r.rerender(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
  await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/community/cohorts/c-every/messages', { body: 'On the train' }, expect.anything()));
});

it('the half-typed text stays with this space across navigation; another space starts empty', async () => {
  const a = await open();
  await a.findByTestId('space-chat-row-m3');
  await fireEvent.changeText(a.getByTestId('space-chat-composer-field'), 'Hey, loved th');
  await a.unmount();
  mockParams.current = { cohortId: 'c-other' };
  const b = await render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
  expect(b.queryByTestId('space-chat-composer-field')?.props.value ?? '').toBe('');
  await b.unmount();
  mockParams.current = { cohortId: 'c-every' };
  const c = await render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
  await waitFor(() => expect(c.getByTestId('space-chat-composer-field').props.value).toBe('Hey, loved th'));
});

it('block: the blocked person\'s rows leave the stream at once', async () => {
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  await fireEvent.press(r.getByTestId('space-chat-menu-m3'));
  await waitFor(() => expect(r.queryByTestId('space-chat-row-m3')).toBeNull());
  expect(r.getByTestId('space-chat-row-m1')).toBeTruthy();
});

it('every control has a spoken label and no text is locked to a size', async () => {
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  expect(r.getByLabelText('Go back')).toBeTruthy();
  expect(r.getByLabelText(/^jo b\., .*\. body m3$/)).toBeTruthy();
  expect(r.getByLabelText(/^Sam Okafor, Coach, .*\. body m1$/)).toBeTruthy();
  expect(r.getByLabelText('New messages')).toBeTruthy();
  type Node = { props: Record<string, unknown>; children: Array<Node | string> | null };
  const walk = (n: unknown): Node[] => (!n || typeof n === 'string' ? [] : Array.isArray(n) ? n.flatMap(walk)
    : [n as Node, ...walk((n as Node).children)]);
  // Icons (vector-icons glyphs) are fixed by design; every word on the page scales.
  const locked = walk(r.toJSON()).filter((n) => !JSON.stringify(n.props.style ?? '').includes('ionicons')
    && (n.props.allowFontScaling === false || n.props.maxFontSizeMultiplier != null));
  expect(locked).toHaveLength(0);
});
