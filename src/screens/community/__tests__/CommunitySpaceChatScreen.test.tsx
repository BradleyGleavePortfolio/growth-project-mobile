/**
 * SC-M1 (agent 168), FX-871 (agent 169): the space chat with communitySpaceChat on. Member Everyone (rows, names as
 * sent, Coach mark, voice row), member Announcements (no composer, SC-W03), coach Everyone (info button to the member
 * page), empty, loading (no composer), offline, send failure (Try again with the same Idempotency-Key, Delete), rows
 * written offline sent in order when back online (even with the page closed), the draft kept per space, the New
 * messages line (hidden when the read route is 404), read marks only in front and after the cursor answers, a linked
 * message on an older page, no access (404 / 403), a failed space list, block, own delete, and a label on every control.
 * Text scales (no maxFontSizeMultiplier / allowFontScaling off anywhere on the page).
 */
import React from 'react';
import { Alert, FlatList, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { authEvents } from '../../../utils/authEvents';
import { forestPop as fp } from '../../../theme/tokens';

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
const mockNavigate = jest.fn();
const mockStack = { routes: ['CommunityTab', 'CommunitySpaceChat'], focused: true };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), getState: () => ({ routeNames: mockStack.routes }) }),
  useRoute: () => ({ params: mockParams.current }),
  useIsFocused: () => mockStack.focused,
}));
jest.mock('../../../components/community/SpaceDrawer', () => {
  const { Text } = jest.requireActual('react-native');
  return { SpaceListButton: () => <Text testID="space-list-open" accessibilityLabel="Open space list">list</Text> };
});
let mockUser = { id: 'me-1', name: 'Dana Reyes', coach_id: 'coach-1' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
const mockInsets = { top: 47, right: 0, bottom: 34, left: 0 }; // an iPhone with a home indicator
jest.mock('react-native-safe-area-context', () => {
  const { createElement } = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style, testID }: { children?: unknown; style?: unknown; testID?: string }) => createElement(View, { style, testID }, children),
    useSafeAreaInsets: () => mockInsets,
  };
});
const mockNet: { isOnline: boolean; reachable: boolean | null } = { isOnline: true, reachable: null };
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: mockNet.isOnline, isInternetReachable: mockNet.reachable }),
  isEffectivelyOnline: jest.requireActual('../../../hooks/useNetworkStatus').isEffectivelyOnline,
}));
let mockRole = 'client';
const cohorts = () => [
  { id: 'c-every', workspace_id: 'ws', name: 'Everyone', is_default: true, kind: 'default', member_count: 1000, my_role: mockRole },
  { id: 'c-ann', workspace_id: 'ws', name: 'Announcements', is_default: false, kind: 'announcement', posting_policy: 'coach', member_count: 24, my_role: mockRole },
];
const mockCohorts = { failed: false, refetch: jest.fn() };
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityCohorts: () => (mockCohorts.failed
    ? { data: undefined, isLoading: false, isError: true, error: Object.assign(new Error('HTTP 500'), { isAxiosError: true, response: { status: 500, data: {} } }), refetch: mockCohorts.refetch }
    : { data: { feature_flag_state: 'on', cohorts: cohorts() }, isLoading: false, isError: false, refetch: mockCohorts.refetch }),
  useCommunityMe: () => ({ dataUpdatedAt: 0 }),
  communityKeys: { cohorts: () => ['community', 'cohorts'], me: () => ['community', 'me'] },
}));
jest.mock('../../../components/community/VoiceNotePlayer', () => {
  const { Text, View } = jest.requireActual('react-native');
  // Draws what SpaceVoiceNote hands the player (m#879): the trailing mark and the footer (send states, Try again).
  return (p: { testID: string; durationMs: number; url: string | null; onPlaybackError?: () => void; trailing?: import('react').ReactNode; footer?: import('react').ReactNode }) => (
    <View><Text testID={p.testID} onPress={p.onPlaybackError}>{`player ${p.durationMs} ${p.url}`}</Text>{p.trailing}{p.footer}</View>
  );
});
jest.mock('../../../api/communityVoiceApi', () => ({ communityVoiceApi: { getOne: jest.fn(async () => ({ url: 'https://x/v.m4a' })), remove: jest.fn(async () => ({ deleted: true })) } }));
// SC-M2: m#848's voice outbox and record sheet (FX-848) stand in; the space chat only feeds them.
const mockVoice = { items: [] as unknown[], online: true, send: jest.fn(), retry: jest.fn(), discard: jest.fn() };
jest.mock('../../../hooks/useVoiceOutbox', () => ({ useVoiceOutbox: () => mockVoice }));
jest.mock('../../../components/community/VoiceRecordSheet', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { visible: boolean; target: { cohortName: string } }) => (p.visible ? <Text testID="voice-sheet">{p.target.cohortName}</Text> : null) };
});
jest.mock('../../../components/community/SafetyMenu', () => {
  const { Text } = jest.requireActual('react-native');
  return (p: { testID: string; authorUserId: string; onBlocked?: (id: string) => void; onDelete?: () => Promise<void> }) => (
    <>
      <Text testID={p.testID} accessibilityLabel="Report or block" onPress={() => p.onBlocked?.(p.authorUserId)}>menu</Text>
      {p.onDelete ? <Text testID={`${p.testID}-delete`} onPress={() => { p.onDelete?.().catch(() => undefined); }}>delete</Text> : null}
    </>
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

const sends = () => mockApi.post.mock.calls.filter(([u]) => String(u).endsWith('/messages'));

beforeEach(() => {
  authEvents.emit('logout');
  mockDisk.clear();
  mockStack.routes = ['CommunityTab', 'CommunitySpaceChat'];
  mockStack.focused = true;
  mockCohorts.failed = false;
  mockCohorts.refetch.mockReset();
  mockNavigate.mockReset();
  mockFlags.communityVoiceNotes = true;
  mockVoice.items = [];
  mockVoice.retry.mockReset();
  mockVoice.discard.mockReset();
  mockNet.isOnline = true;
  mockNet.reachable = null;
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
    if (url === '/community/voice-consent') return { data: { seen: true, seen_at: '2026-10-20T10:00:00.000Z' } };
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
// FlatList viewability does not run in tests: report the rows on screen by hand. `see`: rows mostly on screen; `cover`:
// rows filling most of the screen (taller than it; FR-871R5, m#871 Sol B2).
type Pair = { viewabilityConfig: object; onViewableItemsChanged: (info: unknown) => void };
const pairs = (r: Awaited<ReturnType<typeof open>>) => r.getByTestId('space-chat-list').props.viewabilityConfigCallbackPairs as Pair[];
const report = (n: number) => (r: Awaited<ReturnType<typeof open>>, ...keys: string[]) => act(async () => {
  pairs(r)[n].onViewableItemsChanged({ viewableItems: keys.map((key) => ({ key, isViewable: true, index: null })), changed: [] });
});
const see = report(0);
const cover = report(1);
const readMarks = () => mockApi.post.mock.calls.filter(([u]) => String(u).endsWith('/read')).map(([, b]) => b.message_id);

it('member Everyone: header, rows with names as sent, Coach mark, voice row, New messages line, composer', async () => {
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  expect(r.getByText('Everyone')).toBeTruthy();
  expect(r.getByTestId('space-chat-hash', { includeHiddenElements: true })).toBeTruthy();
  expect(r.getByText('1,000 members')).toBeTruthy();
  expect(r.getByText('jo b.')).toBeTruthy();
  expect(r.getAllByText('Coach')).toHaveLength(2);
  expect(r.getByTestId('space-chat-voice-v1')).toBeTruthy();
  expect(r.getByTestId('space-chat-new-line')).toBeTruthy();
  // 05b: the New messages line is moss-green words on a leaf rule, never gold (FR-871R5, m#879 Opus C8).
  const newLine = r.getByTestId('space-chat-new-line');
  expect(StyleSheet.flatten(within(newLine).getByText('New messages').props.style)).toMatchObject({ color: fp.brand400 });
  const kids = newLine.children as ReadonlyArray<string | { props: { style?: unknown } }>;
  const fills = kids.map((c) => (typeof c === 'string' ? undefined : (StyleSheet.flatten(c.props.style as never) as { backgroundColor?: string } | undefined)?.backgroundColor));
  expect(fills.filter(Boolean)).toEqual([fp.leaf, fp.leaf]);
  expect(JSON.stringify(StyleSheet.flatten(newLine.props.style))).not.toContain(fp.goldInk);
  expect(r.getByTestId('space-chat-composer-field')).toBeTruthy();
  expect(r.queryByTestId('space-chat-hint')).toBeNull();
  // The stream reads the space's own route, newest first, and marks the newest row read (SC-BE2).
  expect(mockApi.get).toHaveBeenCalledWith('/community/cohorts/c-every/messages', { params: { limit: 30 } });
  await see(r, 'm3', 'm2', 'new-line');
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
  expect(r.getByText('Only your coach posts here.')).toBeTruthy(); // FR-871R6 (Opus B2): no press and hold promise
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

it('coach header: the space list and the info button (members, invites, removals) on the coach stack', async () => {
  mockRole = 'owner';
  mockUser = { id: 'coach-1', name: 'Sam Okafor', coach_id: '' };
  mockStack.routes = ['CoachCommunityCohorts', 'CoachCommunityCohortDetail', 'CommunitySpaceChat'];
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  await fireEvent.press(r.getByLabelText('Space info'));
  expect(mockNavigate).toHaveBeenCalledWith('CoachCommunityCohortDetail', { cohortId: 'c-every', cohortName: 'Everyone' });
  await fireEvent.press(r.getByLabelText('Open space list'));
  expect(mockNavigate).toHaveBeenLastCalledWith('CoachCommunityCohorts');
});

it('while the space loads there is no composer (a banned member never gets a box), and no read mark', async () => {
  mockApi.get.mockImplementation(() => new Promise(() => undefined));
  const r = await open();
  expect(r.getByTestId('space-chat-loading')).toBeTruthy();
  expect(r.queryByTestId('space-chat-composer-field')).toBeNull();
  expect(r.queryByTestId('space-chat-hint')).toBeNull();
});

it('a failed space list: the error and Try again (reads the list again), no blank header with no composer', async () => {
  mockCohorts.failed = true;
  const r = await open();
  expect(await r.findByTestId('space-chat-error')).toBeTruthy();
  expect(r.queryByTestId('space-chat-composer-field')).toBeNull();
  await fireEvent.press(r.getByLabelText('Try again'));
  expect(mockCohorts.refetch).toHaveBeenCalled();
});

it('read marks wait for the read cursor and for the page to be in front', async () => {
  let answer: (v: unknown) => void = () => undefined;
  mockApi.get.mockImplementation(async (url: string) => (url.endsWith('/read')
    ? new Promise((res) => { answer = res; }) : { data: { messages: page, next_before: null } }));
  mockStack.focused = false;
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  await act(async () => { answer({ data: readAnswer }); });
  await r.findByTestId('space-chat-new-line');
  await see(r, 'm3', 'm2', 'new-line');
  expect(mockApi.post).not.toHaveBeenCalledWith('/community/cohorts/c-every/read', expect.anything());
  mockStack.focused = true;
  await r.rerender(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
  await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/community/cohorts/c-every/read', { message_id: 'm3' }));
});

it('a linked message on an older page: older pages load until it is found', async () => {
  mockParams.current = { cohortId: 'c-every', messageId: 'm0' };
  mockApi.get.mockImplementation(async (url: string, cfg?: { params?: { before?: string } }) => {
    if (url.endsWith('/read')) return { data: readAnswer };
    return cfg?.params?.before
      ? { data: { messages: [msg('m0', '2026-10-21T08:00:00.000Z', JO)], next_before: null } }
      : { data: { messages: page, next_before: 'cur-1' } };
  });
  const r = await open();
  expect(await r.findByTestId('space-chat-row-m0')).toBeTruthy();
  expect(mockApi.get).toHaveBeenCalledWith('/community/cohorts/c-every/messages', { params: { limit: 30, before: 'cur-1' } });
  // Sol B1: opened at an old row, the newer rows are not read until they are on screen.
  await see(r, 'm0');
  expect(readMarks()).toEqual([]);
  await see(r, 'm2', 'm3');
  await waitFor(() => expect(readMarks()).toEqual(['m3']));
});

it('Sol B1: more than a page unread, older pages load until the first unread row, and the line sits above it', async () => {
  readAnswer = { last_read_at: '2026-10-21T00:00:00.000Z', last_read_message_id: 'm0a' };
  const older = [msg('m0b', '2026-10-21T12:00:00.000Z', JO), msg('m0a', '2026-10-20T12:00:00.000Z', JO)];
  mockApi.get.mockImplementation(async (url: string, cfg?: { params?: { before?: string } }) => (url.endsWith('/read') ? { data: readAnswer }
    : { data: cfg?.params?.before ? { messages: older, next_before: 'cur-2' } : { messages: page, next_before: 'cur-1' } }));
  const r = await open();
  await r.findByTestId('space-chat-row-m0b');
  const keys = r.getAllByTestId(/^space-chat-(row-m|new-line)/).map((e) => e.props.testID);
  expect(keys[keys.indexOf('space-chat-new-line') - 1]).toBe('space-chat-row-m0b');
  expect(mockApi.get).not.toHaveBeenCalledWith('/community/cohorts/c-every/messages', { params: { limit: 30, before: 'cur-2' } });
});

it('Sol B1: scrolled up a little, a new row from someone else brings the pill and is not marked read', async () => {
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  await see(r, 'm3', 'm2', 'new-line');
  await waitFor(() => expect(readMarks()).toEqual(['m3']));
  await see(r, 'm2', 'new-line');
  page = [msg('m4', '2026-10-22T10:30:00.000Z', JO), ...page];
  await act(async () => { await client.refetchQueries(); });
  expect(await r.findByTestId('space-chat-pill')).toBeTruthy();
  expect(readMarks()).toEqual(['m3']);
});

it('Sol B2: a failed play (the signed URL ran out) gets a fresh URL; a failed lookup has Try again', async () => {
  const getOne = jest.requireMock('../../../api/communityVoiceApi').communityVoiceApi.getOne as jest.Mock;
  let n = 0;
  getOne.mockImplementation(async () => { n += 1; if (n > 1 && n < 6) throw new Error('down'); return { url: n === 1 ? 'https://x/old.m4a' : 'https://x/new.m4a' }; });
  const r = await open();
  await fireEvent.press(await r.findByText('player 42000 https://x/old.m4a'));
  await fireEvent.press(await r.findByTestId('space-chat-voice-retry-v1'));
  expect(await r.findByText('player 42000 https://x/new.m4a')).toBeTruthy();
  getOne.mockImplementation(async () => ({ url: 'https://x/v.m4a' }));
});

it('Sol B4: a row being sent keeps its text at 4.5:1 or better on bone (every opacity above it composited)', async () => {
  mockApi.post.mockImplementation(() => new Promise(() => undefined));
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  await fireEvent.changeText(r.getByTestId('space-chat-composer-field'), 'Nice work');
  await fireEvent.press(r.getByTestId('space-chat-composer-send'));
  const body = await r.findByText('Nice work', { includeHiddenElements: true });
  let alpha = 1;
  for (let n = body as { props: { style?: unknown }; parent: unknown } | null; n; n = n.parent as typeof n) alpha *= (StyleSheet.flatten(n.props.style as object) as { opacity?: number } | undefined)?.opacity ?? 1;
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lum = (c: number[]) => c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
  const bone = rgb('#F7FAF7');
  const seen = rgb(StyleSheet.flatten(body.props.style).color).map((v, i) => v * alpha + bone[i] * (1 - alpha));
  expect((lum(bone) + 0.05) / (lum(seen) + 0.05)).toBeGreaterThanOrEqual(4.5);
});

it('own text message: Delete removes it', async () => {
  page = [msg('m-own', '2026-10-22T10:10:00.000Z', ME), ...page];
  const r = await open();
  await fireEvent.press(await r.findByTestId('space-chat-menu-m-own-delete'));
  await waitFor(() => expect(r.queryByTestId('space-chat-row-m-own')).toBeNull());
  expect(mockApi.delete).toHaveBeenCalledWith('/community/messages/m-own');
  expect(r.queryByTestId('space-chat-menu-m3-delete')).toBeNull();
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

it.each([404, 403])('no access (%i: not a member or banned): no rows, no composer, the line where the composer was', async (status) => {
  mockApi.get.mockImplementation(async () => { throw fail(status); });
  const r = await open();
  expect(await r.findByTestId('space-chat-no-access')).toBeTruthy();
  expect(r.getByText('This conversation is closed')).toBeTruthy();
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
  expect(await r.findByText('Not sent')).toBeTruthy();
  const key1 = mockApi.post.mock.calls.find(([u]) => String(u).endsWith('/messages'))[2].headers['Idempotency-Key'];
  await fireEvent.press(r.getByLabelText('Try again'));
  await waitFor(() => expect(mockApi.post.mock.calls.filter(([u]) => String(u).endsWith('/messages'))).toHaveLength(2));
  expect(sends()[1][1]).toEqual({ body: 'Hey, loved that set' });
  expect(sends()[1][2].headers['Idempotency-Key']).toBe(key1);
});

it('a failed send: Delete drops it without sending', async () => {
  mockApi.post.mockImplementation(async (url: string) => { if (url.endsWith('/messages')) throw fail(500); return { data: { ok: true } }; });
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  await fireEvent.changeText(r.getByTestId('space-chat-composer-field'), 'Wrong space');
  await fireEvent.press(r.getByTestId('space-chat-composer-send'));
  await r.findByText('Not sent');
  await fireEvent.press(r.getByLabelText('Delete'));
  await waitFor(() => expect(r.queryByText('Wrong space')).toBeNull());
  expect(sends()).toHaveLength(1);
});

it('a send in flight says Sending…', async () => {
  mockApi.post.mockImplementation(() => new Promise(() => undefined));
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  await fireEvent.changeText(r.getByTestId('space-chat-composer-field'), 'Nice work');
  await fireEvent.press(r.getByTestId('space-chat-composer-send'));
  expect(await r.findByText('Sending…')).toBeTruthy();
  expect(r.getByTestId('space-chat-composer-field').props.value).toBe('');
});

it.each([['no connection', false, null], ['connected, internet not reachable', true, false]] as const)('written offline (%s): Waiting to send, then sent when back online', async (_l, isOnline, reachable) => {
  mockNet.isOnline = isOnline;
  mockNet.reachable = reachable;
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  await fireEvent.changeText(r.getByTestId('space-chat-composer-field'), 'On the train');
  await fireEvent.press(r.getByTestId('space-chat-composer-send'));
  expect(await r.findByText('Waiting to send')).toBeTruthy();
  expect(mockApi.post.mock.calls.filter(([u]) => String(u).endsWith('/messages'))).toHaveLength(0);
  mockNet.isOnline = true;
  mockNet.reachable = true;
  await r.rerender(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
  await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/community/cohorts/c-every/messages', { body: 'On the train' }, expect.anything()));
});

it('written offline then the page closed: kept on the device, sent one at a time in order when the phone is back online', async () => {
  mockNet.isOnline = false;
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  for (const t of ['first', 'second']) {
    await fireEvent.changeText(r.getByTestId('space-chat-composer-field'), t);
    await fireEvent.press(r.getByTestId('space-chat-composer-send'));
  }
  await waitFor(() => expect(mockDisk.get('space_outbox_me-1')).toContain('second'));
  await r.unmount();
  let done: () => void = () => undefined;
  mockApi.post.mockImplementation((url: string, body: { body: string }) => (url.endsWith('/messages') && body.body === 'first'
    ? new Promise((res) => { done = () => res({ data: { message: msg('m10', new Date().toISOString(), ME) } }); })
    : Promise.resolve({ data: { message: msg('m11', new Date().toISOString(), ME) } })));
  await act(async () => { (NetInfo as unknown as { __setState: (s: object) => void }).__setState({ isConnected: true, isInternetReachable: true }); });
  await waitFor(() => expect(sends()).toHaveLength(1));
  expect(sends()[0][1]).toEqual({ body: 'first' });
  await act(async () => { done(); });
  await waitFor(() => expect(sends()).toHaveLength(2));
  expect(sends()[1][1]).toEqual({ body: 'second' });
});

it('after an app restart the rows kept on the device are back and go out', async () => {
  const kept = { localId: 'k1', key: 'k1', cohortId: 'c-every', body: 'Kept from yesterday', createdAt: '2026-10-22T10:20:00.000Z', state: 'sending' };
  mockDisk.set('space_outbox_me-1', JSON.stringify([kept]));
  await open();
  await waitFor(() => expect(sends()).toHaveLength(1));
  expect(sends()[0][1]).toEqual({ body: 'Kept from yesterday' });
  expect(sends()[0][2].headers['Idempotency-Key']).toBe('k1');
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
  expect(r.getByLabelText('Open space list')).toBeTruthy();
  expect(r.getByLabelText('Space info')).toBeTruthy(); // FR-871R6 (Opus B1): members have it too
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

it('SC-M2: the mic sits in the composer until there is text and opens the record sheet for this space', async () => {
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  await fireEvent.press(r.getByTestId('space-chat-mic'));
  expect((await r.findByTestId('voice-sheet')).props.children).toBe('Everyone');
  await fireEvent.changeText(r.getByTestId('space-chat-composer-field'), 'hi');
  expect(await r.findByTestId('space-chat-composer-send')).toBeTruthy();
  expect(r.queryByTestId('space-chat-mic')).toBeNull();
});

it('SC-M2: no mic while communityVoiceNotes is off', async () => {
  mockFlags.communityVoiceNotes = false;
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  expect(r.getByTestId('space-chat-composer-field')).toBeTruthy();
  expect(r.queryByTestId('space-chat-mic')).toBeNull();
});

it('SC-M2: a voice note on its way to this space shows at the bottom with its state; Not sent has Try again and Delete', async () => {
  const note = (id: string, cohortId: string, status: string) => ({
    id, authorId: 'me-1', workspaceId: 'ws', peaks: [0.4], status, input: { uri: `file:///${id}.m4a`, durationMs: 8000, cohortId },
  });
  mockVoice.items = [note('vo-1', 'c-every', 'failed'), note('vo-2', 'c-ann', 'sending')];
  const r = await open();
  await r.findByTestId('space-chat-row-vo-1');
  expect(r.queryByTestId('space-chat-row-vo-2')).toBeNull();
  expect(r.getByTestId('space-chat-failed-vo-1')).toBeTruthy();
  expect(r.getByTestId('space-chat-voice-failed-vo-1')).toBeTruthy();
  expect(r.getByText('That didn’t send. Your recording is safe — try sending again.')).toBeTruthy();
  await fireEvent.press(r.getByText('Try again'));
  expect(mockVoice.retry).toHaveBeenCalledWith('vo-1');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, b) => b?.find((x) => x.text === 'Delete')?.onPress?.());
  await fireEvent.press(r.getByText('Delete'));
  expect(alert).toHaveBeenCalledWith('Delete this voice note?', undefined, expect.any(Array));
  expect(mockVoice.discard).toHaveBeenCalledWith('vo-1');
  alert.mockRestore();
});

it('FR-871R5 (m#879 Opus B1, owner 10-20 12:25): offline with a voice note waiting, no sentence; the card has the circle and the struck wifi, the header nothing', async () => {
  mockNet.isOnline = false;
  const note = (id: string, status: string) => ({ id, authorId: 'me-1', workspaceId: 'ws', peaks: [0.4], status, input: { uri: `file:///${id}.m4a`, durationMs: 8000, cohortId: 'c-every' } });
  mockVoice.items = [note('vo-1', 'waiting')];
  const r = await open();
  await r.findByTestId('space-chat-row-vo-1');
  expect(r.queryByText(/You are offline/)).toBeNull();
  expect(r.queryByTestId('space-chat-offline')).toBeNull();
  expect(r.getByTestId('space-chat-voice-waiting-vo-1').props.accessibilityLabel).toBe('Waiting to send');
  expect(r.getByTestId('space-chat-voice-wifi-off-vo-1')).toBeTruthy();
  expect(r.getByTestId('space-chat-waiting-vo-1').props.children).toBe('');
  expect(r.getByTestId('space-chat-local-menu-vo-1').props.accessibilityLabel).toBe('Delete this voice note');
});

it('FR-871R5 (m#871 Opus B1 / Sol B1): opening at the first unread row tries the row again while it fails, a few times at most, and reads nothing until placed', async () => {
  const toIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex');
  const toOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
  const r = await open();
  await r.findByTestId('space-chat-new-line');
  await see(r, 'm3', 'm2');
  // No row is measured in tests, so every try fails: the offset guess, then the row itself again.
  await waitFor(() => expect(toIndex.mock.calls.length).toBeGreaterThanOrEqual(2));
  const index = (toIndex.mock.calls[0][0] as { index: number }).index;
  expect(index).toBeGreaterThan(0);
  expect(toIndex).toHaveBeenLastCalledWith({ index, viewPosition: 0.5, animated: false });
  expect(toOffset).toHaveBeenCalledWith(expect.objectContaining({ animated: false }));
  await act(async () => { await new Promise((res) => setTimeout(res, 500)); });
  expect(toIndex.mock.calls.length).toBeLessThanOrEqual(6);
  expect(readMarks()).toEqual([]);
  await see(r, 'm3', 'm2', 'new-line');
  await waitFor(() => expect(readMarks()).toEqual(['m3']));
  toIndex.mockRestore();
  toOffset.mockRestore();
});

it('FR-871R5 (m#871 Sol B2): a message taller than the screen counts as seen while it fills the screen', async () => {
  const r = await open();
  await r.findByTestId('space-chat-new-line');
  expect(pairs(r).map((x) => x.viewabilityConfig)).toEqual([{ itemVisiblePercentThreshold: 60 }, { viewAreaCoveragePercentThreshold: 60 }]);
  await see(r, 'new-line');
  expect(readMarks()).toEqual([]);
  await cover(r, 'm3');
  await waitFor(() => expect(readMarks()).toEqual(['m3']));
});

it('FR-871 (m#879 Opus B1 / Sol B2): your own voice note has Delete, through the voice route; a failed delete keeps the row', async () => {
  const voiceApi = jest.requireMock('../../../api/communityVoiceApi').communityVoiceApi;
  page = [msg('m5', '2026-10-22T10:10:00.000Z', ME, { kind: 'voice', body: null, voice_note: { id: 'v5', duration_ms: 9000, waveform_peaks: null, heard_at: null } }), ...page];
  voiceApi.remove.mockRejectedValueOnce(new Error('HTTP 500'));
  const r = await open();
  await r.findByTestId('space-chat-row-m5');
  expect(r.queryByTestId('space-chat-menu-m3-delete')).toBeNull();
  await fireEvent.press(r.getByTestId('space-chat-menu-m5-delete'));
  await waitFor(() => expect(voiceApi.remove).toHaveBeenCalledWith('v5'));
  expect(r.getByTestId('space-chat-row-m5')).toBeTruthy();
  await fireEvent.press(r.getByTestId('space-chat-menu-m5-delete'));
  await waitFor(() => expect(r.queryByTestId('space-chat-row-m5')).toBeNull());
  expect(voiceApi.remove).toHaveBeenCalledTimes(2);
  expect(mockApi.delete).not.toHaveBeenCalled();
});

it('m#871 Sol B5: a read mark that lands refreshes the space badges and the unread total', async () => {
  const r = await open();
  await r.findByTestId('space-chat-new-line');
  const spy = jest.spyOn(client, 'invalidateQueries');
  await see(r, 'm3', 'm2', 'new-line');
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['community', 'cohorts'] }));
  expect(spy).toHaveBeenCalledWith({ queryKey: ['community', 'me'] });
});

describe('FR-871R6 (m#871): member Space info, the hint, the server answer on this visit, refused sends', () => {
  const rejected = () => Object.assign(new Error('HTTP 422'), {
    isAxiosError: true, response: { status: 422, data: { code: 'community.content.rejected', message: 'Server words' } },
  });
  const REASON = 'This was not posted because it appears to contain abusive or explicit language. Your draft is kept so you can rephrase it.';
  const field = (r: Awaited<ReturnType<typeof open>>) => r.getByTestId('space-chat-composer-field');
  let alert: jest.SpyInstance;
  beforeEach(() => { alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); });
  afterEach(() => { alert.mockRestore(); });
  // A cold start: the page saved on the device is in the cache before the screen mounts (stale, not read this visit).
  const openSaved = async () => {
    client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    client.setQueryData(['community', 'space-chat', 'me-1', 'c-every'], { pages: [{ messages: page, next_before: null }], pageParams: [null] });
    return render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
  };

  it('Opus B1: a member\'s Space info opens a read-only sheet with # name and the member count; the scrim closes it', async () => {
    const r = await open();
    await r.findByTestId('space-chat-row-m3');
    await fireEvent.press(r.getByTestId('space-chat-info'));
    const sheet = r.getByTestId('space-info-sheet');
    expect(within(sheet).getByText('Everyone')).toBeTruthy();
    expect(within(sheet).getByTestId('space-chat-hash', { includeHiddenElements: true })).toBeTruthy();
    expect(within(sheet).getByText('1,000 members')).toBeTruthy();
    expect(within(sheet).queryAllByRole('button')).toHaveLength(0); // read only: nothing to change
    expect(mockNavigate).not.toHaveBeenCalled();
    // The scrim (the drawer's "Close"; screen readers use the escape gesture or Back, the sheet being modal for them).
    await fireEvent.press(r.getByTestId('space-info-scrim', { includeHiddenElements: true }));
    expect(r.queryByTestId('space-info-sheet')).toBeNull();
  });

  it('Opus B2: the announcements page has no press and hold anywhere, so the hint promises none', async () => {
    mockParams.current = { cohortId: 'c-ann' };
    const r = await open();
    await r.findByTestId('space-chat-row-m3');
    expect(r.getByTestId('space-chat-hint').props.children).toBe('Only your coach posts here.');
    expect(r.queryByText(/press and hold/i)).toBeNull();
  });

  it('Opus B3: a saved page at a cold start draws without a composer until the read answers; a 403 then closes it', async () => {
    let answer: (e: unknown) => void = () => undefined;
    mockApi.get.mockImplementation((url: string) => (url.endsWith('/read')
      ? Promise.resolve({ data: readAnswer })
      : new Promise((_res, rej) => { answer = rej; })));
    const r = await openSaved();
    expect(await r.findByTestId('space-chat-row-m3')).toBeTruthy();
    expect(r.queryByTestId('space-chat-composer-field')).toBeNull();
    expect(r.queryByTestId('space-chat-hint')).toBeNull();
    await act(async () => { answer(fail(403)); });
    expect(await r.findByTestId('space-chat-no-access')).toBeTruthy();
    expect(r.queryByTestId('space-chat-composer-field')).toBeNull();
  });

  it('Opus B3: the same saved page offline (no answer): the rows and no composer; the answer brings the composer', async () => {
    mockNet.isOnline = false;
    let answer: (v: unknown) => void = () => undefined;
    mockApi.get.mockImplementation((url: string) => (url.endsWith('/read')
      ? Promise.resolve({ data: readAnswer })
      : new Promise((res) => { answer = res; })));
    const r = await openSaved();
    expect(await r.findByTestId('space-chat-row-m3')).toBeTruthy();
    expect(r.queryByTestId('space-chat-composer-field')).toBeNull();
    await act(async () => { answer({ data: { messages: page, next_before: null } }); });
    expect(await r.findByTestId('space-chat-composer-field')).toBeTruthy();
  });

  it('Opus B3: a send refused with 403 closes the page; the text stays on the device, not sent again', async () => {
    mockApi.post.mockImplementation(async (url: string) => { if (url.endsWith('/messages')) throw fail(403); return { data: { ok: true } }; });
    const r = await open();
    await r.findByTestId('space-chat-row-m3');
    await fireEvent.changeText(field(r), 'Still here?');
    await fireEvent.press(r.getByTestId('space-chat-composer-send'));
    expect(await r.findByTestId('space-chat-no-access')).toBeTruthy();
    expect(r.queryByTestId('space-chat-composer-field')).toBeNull();
    await waitFor(() => expect(mockDisk.get('space_outbox_me-1')).toContain('"reason":"closed"'));
    expect(mockDisk.get('space_outbox_me-1')).not.toMatch(/Error|headers|response/);
    expect(sends()).toHaveLength(1);
  });

  it('Sol B871-2: a text refused for its words comes back into the empty field with the reason; the changed text is a new key', async () => {
    const ok = mockApi.post.getMockImplementation()!;
    mockApi.post.mockImplementation(async (url: string, body: { body: string }, ...rest: unknown[]) => {
      if (url.endsWith('/messages') && body.body === 'You absolute clown') throw rejected();
      return ok(url, body, ...rest);
    });
    const r = await open();
    await r.findByTestId('space-chat-row-m3');
    await fireEvent.changeText(field(r), 'You absolute clown');
    await fireEvent.press(r.getByTestId('space-chat-composer-send'));
    await waitFor(() => expect(field(r).props.value).toBe('You absolute clown'));
    expect(alert).toHaveBeenCalledWith('Please rephrase', REASON);
    expect(r.queryByText('Not sent')).toBeNull();
    expect(r.queryByLabelText('Try again')).toBeNull();
    await waitFor(() => expect(mockDisk.get('space_outbox_me-1') ?? '[]').not.toContain('You absolute clown'));
    await fireEvent.changeText(field(r), 'You absolute star');
    await fireEvent.press(r.getByTestId('space-chat-composer-send'));
    await waitFor(() => expect(sends()).toHaveLength(2));
    expect(sends()[1][1]).toEqual({ body: 'You absolute star' });
    expect(sends()[1][2].headers['Idempotency-Key']).not.toBe(sends()[0][2].headers['Idempotency-Key']);
  });

  it('Sol B871-2: a newer draft is never overwritten; the row keeps the text and the reason (no Try again) until the field is empty', async () => {
    let refuse: () => void = () => undefined;
    mockApi.post.mockImplementation((url: string) => (url.endsWith('/messages')
      ? new Promise((_res, rej) => { refuse = () => rej(rejected()); })
      : Promise.resolve({ data: { ok: true } })));
    const r = await open();
    await r.findByTestId('space-chat-row-m3');
    await fireEvent.changeText(field(r), 'You absolute clown');
    await fireEvent.press(r.getByTestId('space-chat-composer-send'));
    await waitFor(() => expect(sends()).toHaveLength(1));
    await fireEvent.changeText(field(r), 'A newer draft');
    await act(async () => { refuse(); });
    expect(await r.findByText(REASON)).toBeTruthy();
    expect(field(r).props.value).toBe('A newer draft');
    expect(r.getByLabelText('Dana Reyes, Not sent. You absolute clown')).toBeTruthy();
    expect(r.queryByLabelText('Try again')).toBeNull();
    expect(r.getByLabelText('Delete')).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
    await fireEvent.changeText(field(r), '');
    await waitFor(() => expect(field(r).props.value).toBe('You absolute clown'));
    expect(alert).toHaveBeenCalledWith('Please rephrase', REASON);
    expect(r.queryByText(REASON)).toBeNull();
  });

  it('Sol B871-2: after an app restart a refused text kept on the device comes back into the field; sign-out clears it', async () => {
    const kept = { localId: 'k1', key: 'k1', cohortId: 'c-every', body: 'Kept and refused', createdAt: '2026-10-22T10:20:00.000Z', state: 'failed', reason: 'rejected' };
    mockDisk.set('space_outbox_me-1', JSON.stringify([kept]));
    const r = await open();
    await waitFor(() => expect(field(r).props.value).toBe('Kept and refused'));
    expect(alert).toHaveBeenCalledWith('Please rephrase', REASON);
    expect(sends()).toHaveLength(0);
    await r.unmount();
    await act(async () => { authEvents.emit('logout'); });
    await waitFor(() => expect(mockDisk.get('space_outbox_me-1') ?? '[]').not.toContain('Kept and refused'));
    const again = await open();
    await again.findByTestId('space-chat-row-m3');
    expect(field(again).props.value).toBe('');
  });

  it('m#879 Opus B3 guard: a row already on its way cannot be dropped from the phone (its send cannot be called back)', async () => {
    const { spaceOutbox } = require('../../../components/community/space-chat/spaceChatOutbox');
    mockApi.post.mockImplementation((url: string) => (url.endsWith('/messages') ? new Promise(() => undefined) : Promise.resolve({ data: { ok: true } })));
    const r = await open();
    await r.findByTestId('space-chat-row-m3');
    await fireEvent.changeText(field(r), 'On its way');
    await fireEvent.press(r.getByTestId('space-chat-composer-send'));
    expect(await r.findByText('Sending…')).toBeTruthy();
    await waitFor(() => expect(mockDisk.get('space_outbox_me-1')).toContain('On its way'));
    const row = JSON.parse(mockDisk.get('space_outbox_me-1') ?? '[]')[0];
    await act(async () => { spaceOutbox.discard(row.localId); });
    expect(r.getByLabelText('Dana Reyes, Sending…. On its way')).toBeTruthy();
  });
});
