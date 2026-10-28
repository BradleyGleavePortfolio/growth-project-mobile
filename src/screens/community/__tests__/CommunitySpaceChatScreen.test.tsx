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
import { Alert, FlatList, Keyboard, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { authEvents } from '../../../utils/authEvents';
import { forestPop as fp, spacing } from '../../../theme/tokens';

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
  const { createContext, createElement } = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style, testID }: { children?: unknown; style?: unknown; testID?: string }) => createElement(View, { style, testID }, children),
    SafeAreaInsetsContext: createContext(mockInsets),
    useSafeAreaInsets: () => mockInsets,
  };
});
const mockNet: { isOnline: boolean; reachable: boolean | null } = { isOnline: true, reachable: null };
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: mockNet.isOnline, isInternetReachable: mockNet.reachable }),
  isEffectivelyOnline: jest.requireActual('../../../hooks/useNetworkStatus').isEffectivelyOnline,
}));
let mockRole = 'client';
// FR-871R7: the space's purpose on the member-readable list (SC-PURPOSE-BE, backend#1178); undefined = the field is absent.
let mockPurpose: unknown;
const cohorts = () => [
  { id: 'c-every', workspace_id: 'ws', name: 'Everyone', is_default: true, kind: 'default', member_count: 1000, my_role: mockRole,
    ...(mockPurpose === undefined ? {} : { description: mockPurpose }) },
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
  type MockMenuProps = {
    testID: string; authorUserId: string; onBlocked?: (id: string) => void; onDelete?: () => Promise<void>;
    context?: { name: string; detail: string }; reported?: boolean; onReported?: () => void; onRemove?: () => Promise<void>;
  };
  return (p: MockMenuProps) => (
    <>
      <Text testID={p.testID} accessibilityLabel="Report or block" onPress={() => p.onBlocked?.(p.authorUserId)}>menu</Text>
      {p.onDelete ? <Text testID={`${p.testID}-delete`} onPress={() => { p.onDelete?.().catch(() => undefined); }}>delete</Text> : null}
      {/* FR-871R6 (m#879 B4): the card the report sheet draws above the reasons, and Report, done once sent. */}
      {p.context ? <Text testID={`${p.testID}-context`}>{`${p.context.name} | ${p.context.detail}`}</Text> : null}
      {p.onReported ? <Text testID={`${p.testID}-report`} onPress={p.onReported}>{p.reported ? 'Reported' : 'Report'}</Text> : null}
      {/* FR-871R6 (m#887 B1): Remove for everyone (the real menu confirms first; the confirm is the menu's own test). */}
      {p.onRemove ? <Text testID={`${p.testID}-remove`} onPress={() => { p.onRemove?.().catch(() => undefined); }}>remove</Text> : null}
    </>
  );
});
const mockApi = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock('../../../services/api', () => ({ __esModule: true, default: mockApi }));

const Screen = require('../CommunitySpaceChatScreen').default;
// Required here, after the stand-ins above exist (both reach services/api or the device cache when loaded).
const { resetReportedVoiceNotes } = require('../../../components/community/VoiceReportedFold');
const { coachCommunityKeys } = require('../../../hooks/useCoachCommunity');

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
// FR-871R7: GET community/cohorts/:id/members (the member view: name and role, nothing else drawn).
const person = (user_id: string, display_name: string, role = 'student') => ({ id: null, user_id, display_name, role, status: null, email: null, joined_at: null, access: null });
let membersAnswer: unknown = { members: [], next_cursor: null };

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
  mockPurpose = undefined;
  membersAnswer = { members: [person('coach-1', 'Sam', 'coach'), person('u-2', 'Jo'), person('me-1', 'Dana')], next_cursor: null };
  mockApi.get.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/read')) {
      if (readAnswer instanceof Error) throw readAnswer;
      return { data: readAnswer };
    }
    if (url.endsWith('/members')) {
      if (membersAnswer instanceof Error) throw membersAnswer;
      return { data: membersAnswer };
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

// REMOVED-BY-M2 (owner #174-4, b#1165 CONTRACT 6405215872 section 2): a row the coach removed keeps its place.
const BY_COACH = { role: 'coach', user_id: 'coach-1', name: 'Sam Okafor' };
const removed = (id: string, at: string, who: { id: string; name: string }, extra: Record<string, unknown> = {}) =>
  msg(id, at, who, { deleted: true, body: null, voice_note: null, removed_at: '2026-10-22T11:00:00.000Z', removed_by: BY_COACH, ...extra });
const order = (r: Awaited<ReturnType<typeof open>>) =>
  r.getAllByTestId(/^space-chat-(row-|new-line)/).map((n) => String(n.props.testID).replace(/^space-chat-(row-)?/, ''));
// The line is read once, by the row's head with the name and time; the drawn line itself is hidden from a screen reader.
const line = (r: Awaited<ReturnType<typeof open>>, text: string) => r.getAllByText(text, { includeHiddenElements: true });
const removedPage = (who: { id: string; name: string }) => [
  msg('m3', '2026-10-22T10:05:00.000Z', JO),
  removed('rv', '2026-10-22T09:50:00.000Z', who, { kind: 'voice' }),
  removed('rt', '2026-10-22T09:40:00.000Z', who),
  ...page.slice(1),
];

it('REMOVED-BY-M2: a removed text row and voice row stay in place for everyone else, one line each, no menu or player', async () => {
  page = removedPage(JO);
  const r = await open();
  await r.findByTestId('space-chat-removed-rt');
  expect(order(r)).toEqual(['m3', 'rv', 'rt', 'm2', 'new-line', 'm1']);
  expect(line(r, 'Removed by Coach Sam Okafor')).toHaveLength(2);
  expect(r.getByTestId('space-chat-removed-rv')).toBeTruthy();
  for (const id of ['rt', 'rv']) {
    expect(r.queryByTestId(`space-chat-menu-${id}`)).toBeNull();
    expect(r.queryByTestId(`space-chat-removed-safety-${id}`)).toBeNull();
  }
  expect(r.getByTestId('space-chat-menu-m3')).toBeTruthy();
  expect(r.getAllByText(/^player /)).toHaveLength(1);
  expect(r.getAllByLabelText(/^jo b\., .+\. Removed by Coach Sam Okafor$/)).toHaveLength(2);
});

it('REMOVED-BY-M2: the coach who removed them reads "You removed this message" / "You removed this voice note"', async () => {
  mockRole = 'owner';
  mockUser = { id: 'coach-1', name: 'Sam Okafor', coach_id: '' };
  mockStack.routes = ['CoachCommunityCohorts', 'CoachCommunityCohortDetail', 'CommunitySpaceChat'];
  page = removedPage(JO);
  const r = await open();
  await r.findByTestId('space-chat-removed-rt');
  expect(line(r, 'You removed this message')).toHaveLength(1);
  expect(line(r, 'You removed this voice note')).toHaveLength(1);
  expect(r.getByLabelText(/^jo b\., .+\. You removed this message$/)).toBeTruthy();
  expect(r.queryByText(/Removed by Coach/, { includeHiddenElements: true })).toBeNull();
  expect(r.queryByTestId('space-chat-menu-rt')).toBeNull();
  expect(r.queryByTestId('space-chat-menu-rv')).toBeNull();
});

it('REMOVED-BY-M2: the author reads "Your coach removed your message" with a link to Community safety', async () => {
  mockStack.routes = ['CommunityTab', 'CommunitySpaceChat', 'CommunitySafety'];
  page = removedPage(ME);
  const r = await open();
  await r.findByTestId('space-chat-removed-rt');
  expect(line(r, 'Your coach removed your message')).toHaveLength(1);
  expect(line(r, 'Your coach removed your voice note')).toHaveLength(1);
  expect(r.getAllByLabelText(/^Dana Reyes, .+\. Your coach removed your (message|voice note)$/)).toHaveLength(2);
  expect(r.getByTestId('space-chat-removed-safety-rv')).toBeTruthy();
  expect(r.queryByTestId('space-chat-menu-rt-delete')).toBeNull();
  await fireEvent.press(r.getByTestId('space-chat-removed-safety-rt'));
  expect(mockNavigate).toHaveBeenCalledWith('CommunitySafety');
});

it('REMOVED-BY-M2: an author\'s own delete and a removal from before b#1165 (no removed_by) still vanish', async () => {
  page = [msg('own', '2026-10-22T10:10:00.000Z', ME, { deleted: true, body: null }), msg('old', '2026-10-22T09:45:00.000Z', JO, { deleted: true }), ...page];
  const r = await open();
  await r.findByTestId('space-chat-row-m3');
  expect(order(r)).toEqual(['m3', 'm2', 'new-line', 'm1']);
});

it('REMOVED-BY-M2: a removed voice row stays out while communityVoiceNotes is off; the text one stays', async () => {
  mockFlags.communityVoiceNotes = false;
  page = removedPage(JO);
  const r = await open();
  await r.findByTestId('space-chat-removed-rt');
  expect(r.queryByTestId('space-chat-row-rv')).toBeNull();
});

it('REMOVED-BY-M2: the read mark, the New messages line and the pill count only live rows', async () => {
  page = [removed('rn', '2026-10-22T10:20:00.000Z', JO), msg('m3', '2026-10-22T10:05:00.000Z', JO),
    removed('ru', '2026-10-22T09:10:00.000Z', JO), ...page.slice(1)];
  const r = await open();
  await r.findByTestId('space-chat-removed-rn');
  // The line sits above the first live unread row, not above the placeholder before it.
  expect(order(r)).toEqual(['rn', 'm3', 'm2', 'new-line', 'ru', 'm1']);
  await see(r, 'rn', 'm3', 'm2', 'new-line');
  await waitFor(() => expect(readMarks()).toEqual(['m3']));
  // Scrolled up, the newest live row is removed: an older row is newest now, which is no new message.
  await see(r, 'm2', 'new-line');
  page = [removed('m3', '2026-10-22T10:05:00.000Z', JO), ...page.filter((m) => (m as { id: string }).id !== 'm3')];
  await act(async () => { await client.refetchQueries(); });
  await r.findByTestId('space-chat-removed-m3');
  expect(r.queryByTestId('space-chat-pill')).toBeNull();
  expect(readMarks()).toEqual(['m3']);
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

describe('FR-871R6 (m#879): the bottom inset, rows on their way, the report card and fold, the coach list count', () => {
  afterEach(async () => {
    (Keyboard.addListener as unknown as { mockRestore?: () => void }).mockRestore?.();
    await act(async () => { resetReportedVoiceNotes(); });
  });
  const pad = (r: Awaited<ReturnType<typeof open>>, id: string) => (StyleSheet.flatten(r.getByTestId(id).props.style) as { paddingBottom?: number }).paddingBottom;
  const keyboard = () => {
    const on: Record<string, () => void> = {};
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((e: string, h: () => void) => { on[e] = h; return { remove: () => undefined }; }) as never);
    return on;
  };

  it('Opus B1 / Sol B879-1: with no tab bar below, the composer keeps clear of the home indicator; with the keyboard up it does not', async () => {
    const on = keyboard();
    const r = await open();
    await r.findByTestId('space-chat-row-m3');
    expect(pad(r, 'space-chat-composer')).toBe(spacing.sm + 34);
    await act(async () => { on.keyboardWillShow(); });
    expect(pad(r, 'space-chat-composer')).toBeUndefined();
    await act(async () => { on.keyboardWillHide(); });
    expect(pad(r, 'space-chat-composer')).toBe(spacing.sm + 34);
  });

  it('Opus B1 / Sol B879-1, B2 / B879-2: the hint line under announcements keeps clear of it too, and so does the coach\'s composer (the coach\'s bar steps aside too)', async () => {
    mockParams.current = { cohortId: 'c-ann' };
    const a = await open();
    await a.findByTestId('space-chat-hint');
    expect(pad(a, 'space-chat-hint')).toBe(spacing.lg + 34);
    await a.unmount();
    mockRole = 'owner';
    mockUser = { id: 'coach-1', name: 'Sam Okafor', coach_id: '' };
    mockStack.routes = ['CoachCommunityCohorts', 'CoachCommunityCohortDetail', 'CommunitySpaceChat'];
    const b = await open();
    await b.findByTestId('space-chat-composer');
    expect(pad(b, 'space-chat-composer')).toBe(spacing.sm + 34);
  });

  it('Opus B3 / Sol B879-3: a row that reads Sending… has no Delete (text and voice); Waiting to send keeps it', async () => {
    mockApi.post.mockImplementation((url: string) => (String(url).endsWith('/read') ? Promise.resolve({ data: { ok: true } }) : new Promise(() => undefined)));
    mockVoice.items = [{ id: 'vo-3', authorId: 'me-1', workspaceId: 'ws', peaks: [0.4], status: 'sending', input: { uri: 'file:///vo-3.m4a', durationMs: 8000, cohortId: 'c-every' } }];
    const a = await open();
    await a.findByTestId('space-chat-row-vo-3');
    expect(a.getByTestId('space-chat-local-busy-vo-3')).toBeTruthy();
    expect(a.queryByTestId('space-chat-local-menu-vo-3')).toBeNull();
    // The phone's own row draws before the server answers; the composer waits for that answer (m#871 Opus B3).
    await fireEvent.changeText(await a.findByTestId('space-chat-composer-field'), 'Nice work');
    await fireEvent.press(a.getByTestId('space-chat-composer-send'));
    await waitFor(() => expect(a.getAllByText('Sending…')).toHaveLength(2));
    expect(a.getAllByTestId(/^space-chat-local-busy-/)).toHaveLength(2);
    expect(a.queryAllByTestId(/^space-chat-local-menu-/)).toHaveLength(0);
    await a.unmount();
    mockVoice.items = [];
    mockNet.isOnline = false;
    const b = await open();
    await b.findByTestId('space-chat-row-m3');
    await fireEvent.changeText(b.getByTestId('space-chat-composer-field'), 'On the train');
    await fireEvent.press(b.getByTestId('space-chat-composer-send'));
    expect(await b.findByText('Waiting to send')).toBeTruthy();
    expect(b.getAllByTestId(/^space-chat-local-menu-/).map((x) => x.props.accessibilityLabel)).toEqual(['Delete this message']);
  });

  it('Opus B4 / Sol B879-4: the report sheet gets the card; a reported voice note folds (its player goes) and stays folded; a text keeps its place, Reported', async () => {
    const r = await open();
    await r.findByTestId('space-chat-row-m3');
    expect(r.getByTestId('space-chat-menu-m2-context').props.children).toBe('Sam Okafor | voice note · 0:42');
    expect(r.getByTestId('space-chat-menu-m3-context').props.children).toBe('jo b. | body m3');
    await fireEvent.press(r.getByTestId('space-chat-menu-m2-report'));
    expect(r.getByText('You reported this voice note. It is hidden for you.')).toBeTruthy();
    expect(r.getByTestId('space-chat-reported-m2')).toBeTruthy();
    expect(r.queryByTestId('space-chat-voice-v1')).toBeNull();
    expect(r.getByTestId('space-chat-menu-m2-report').props.children).toBe('Reported');
    await fireEvent.press(r.getByTestId('space-chat-menu-m3-report'));
    expect(r.getByTestId('space-chat-menu-m3-report').props.children).toBe('Reported');
    expect(r.getByLabelText(/^jo b\., .*\. body m3$/)).toBeTruthy();
    expect(r.getByTestId('space-chat-menu-m1-report').props.children).toBe('Report');
    await r.unmount();
    const again = await open();
    await again.findByTestId('space-chat-row-m3');
    expect(again.getByTestId('space-chat-reported-m2')).toBeTruthy();
    expect(again.queryByTestId('space-chat-voice-v1')).toBeNull();
    expect(again.getByTestId('space-chat-menu-m3-report').props.children).toBe('Reported');
    await again.unmount();
    authEvents.emit('logout');
    const next = await open();
    await next.findByTestId('space-chat-row-m3');
    expect(next.getByTestId('space-chat-voice-v1')).toBeTruthy();
    expect(next.getByTestId('space-chat-menu-m3-report').props.children).toBe('Report');
  });

  it('Sol B879-6: a read mark that lands refreshes the coach\'s space list too', async () => {
    const r = await open();
    await r.findByTestId('space-chat-new-line');
    const spy = jest.spyOn(client, 'invalidateQueries');
    await see(r, 'm3', 'm2', 'new-line');
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: coachCommunityKeys.cohorts() }));
  });
});

describe('FR-871R6 (m#887): the space\'s coach removes someone else\'s message or voice note for everyone', () => {
  const asCoach = () => {
    mockRole = 'owner';
    mockUser = { id: 'coach-1', name: 'Sam Okafor', coach_id: '' };
    mockStack.routes = ['CoachCommunityCohorts', 'CoachCommunityCohortDetail', 'CommunitySpaceChat'];
  };
  const voiceApi = () => jest.requireMock('../../../api/communityVoiceApi').communityVoiceApi as { remove: jest.Mock };
  // The file's earlier removal cases call this mock too; count only this block's calls.
  beforeEach(() => { voiceApi().remove.mockClear(); });
  // The server's answer after a removal: the row comes back deleted with removed_by (b#1165 CONTRACT section 2).
  const serverRemoves = (id: string) => { page = page.map((m) => ((m as { id: string }).id === id ? removed(id, (m as { created_at: string }).created_at, JO, { kind: (m as { kind: string }).kind }) : m)); };

  it('Opus B1 / Sol B887-1: the coach gets Remove for everyone on members\' rows, not on their own; a member never gets it', async () => {
    const m = await open();
    await m.findByTestId('space-chat-row-m3');
    expect(m.queryAllByTestId(/^space-chat-menu-.*-remove$/)).toHaveLength(0);
    await m.unmount();
    asCoach();
    const c = await open();
    await c.findByTestId('space-chat-row-m3');
    expect(c.getByTestId('space-chat-menu-m3-remove')).toBeTruthy();
    expect(c.queryByTestId('space-chat-menu-m1-remove')).toBeNull();
    expect(c.queryByTestId('space-chat-menu-m2-remove')).toBeNull();
  });

  it('Opus B1 / Sol B887-1: a text goes through one DELETE on its route and keeps its place as "You removed this message"', async () => {
    asCoach();
    mockApi.delete.mockImplementation(async () => { serverRemoves('m3'); return { data: { ok: true } }; });
    const r = await open();
    await r.findByTestId('space-chat-row-m3');
    await fireEvent.press(r.getByTestId('space-chat-menu-m3-remove'));
    await waitFor(() => expect(r.getByTestId('space-chat-removed-m3')).toBeTruthy());
    expect(mockApi.delete).toHaveBeenCalledTimes(1);
    expect(String(mockApi.delete.mock.calls[0][0])).toContain('m3');
    expect(voiceApi().remove).not.toHaveBeenCalled();
    expect(line(r, 'You removed this message')).toHaveLength(1);
    expect(r.queryByLabelText(/body m3$/)).toBeNull();
    expect(order(r).indexOf('m3')).toBeGreaterThanOrEqual(0);
  });

  it('Opus B1 / Sol B887-1: a voice note goes through the voice route; its player goes and the row reads "You removed this voice note"', async () => {
    asCoach();
    page = [msg('m5', '2026-10-22T10:10:00.000Z', JO, { kind: 'voice', body: null, voice_note: { id: 'v5', duration_ms: 9000, waveform_peaks: null, heard_at: null } }), ...page];
    voiceApi().remove.mockImplementationOnce(async () => { serverRemoves('m5'); return { deleted: true }; });
    const r = await open();
    await r.findByTestId('space-chat-voice-v5');
    await fireEvent.press(r.getByTestId('space-chat-menu-m5-remove'));
    await waitFor(() => expect(r.getByTestId('space-chat-removed-m5')).toBeTruthy());
    expect(voiceApi().remove).toHaveBeenCalledWith('v5');
    expect(mockApi.delete).not.toHaveBeenCalled();
    expect(r.queryByTestId('space-chat-voice-v5')).toBeNull();
    expect(line(r, 'You removed this voice note')).toHaveLength(1);
  });

  it('Opus B1 / Sol B887-1: a refused removal changes nothing on the page', async () => {
    asCoach();
    mockApi.delete.mockRejectedValue(Object.assign(new Error('HTTP 403'), { isAxiosError: true, response: { status: 403, data: {} } }));
    const r = await open();
    await r.findByTestId('space-chat-row-m3');
    await fireEvent.press(r.getByTestId('space-chat-menu-m3-remove'));
    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledTimes(1));
    expect(r.queryByTestId('space-chat-removed-m3')).toBeNull();
    expect(r.getByLabelText(/body m3$/)).toBeTruthy();
  });
});

describe('FR-871R7 (m#871 Sol B871-1 / Opus B1): a member\'s Space info: what the space is for and who is in it', () => {
  const PURPOSE = 'Daily check-ins and wins. Post your training, ask questions, cheer each other on.';
  const memberCalls = () => mockApi.get.mock.calls.filter(([u]) => String(u).endsWith('/members'));
  const sheetOpen = async () => {
    const r = await open();
    await r.findByTestId('space-chat-row-m3');
    await fireEvent.press(r.getByTestId('space-chat-info'));
    return r;
  };
  const failure = (status?: number) => Object.assign(new Error(status ? `HTTP ${status}` : 'Network Error'), {
    isAxiosError: true, ...(status ? { response: { status, data: {} } } : {}),
  });

  it('B-TEST: the purpose the coach wrote, then the people: Coach, Team, Members with the viewer first ("You"); nothing to change', async () => {
    mockPurpose = PURPOSE;
    membersAnswer = {
      members: [person('u-2', 'Jo'), person('coach-1', 'Sam', 'coach'), person('u-3', 'Casey', 'co_coach'), person('me-1', 'Dana'), person('u-4', 'Avery')],
      next_cursor: null,
    };
    const r = await sheetOpen();
    const sheet = r.getByTestId('space-info-sheet');
    expect(within(sheet).getByTestId('space-info-purpose').props.children).toBe(PURPOSE);
    const people = await within(sheet).findByTestId('space-info-people');
    expect(memberCalls()).toEqual([['/community/cohorts/c-every/members', { params: { limit: 50 } }]]);
    expect(within(people).getAllByTestId(/^space-info-person-/).map((n) => n.props.testID)).toEqual([
      'space-info-person-coach-1', 'space-info-person-u-3', 'space-info-person-me-1', 'space-info-person-u-2', 'space-info-person-u-4',
    ]);
    expect(within(people).getAllByRole('header').map((h) => h.props.children)).toEqual(['Coach', 'Team', 'Members']);
    expect(within(people).getByLabelText('Dana, you')).toBeTruthy();
    expect(StyleSheet.flatten(within(people).getByText('You').props.style)).toMatchObject({ color: '#2C2C2C' }); // graphite, owner #168-13
    // The coach on the space chat's coach tile: deep, with a gold initial.
    const coachTile = within(people).getByTestId('space-info-person-coach-1').children[0] as unknown as { props: { style: unknown } };
    expect(StyleSheet.flatten(coachTile.props.style)).toMatchObject({ backgroundColor: fp.deep, borderRadius: 12 });
    expect(within(sheet).queryAllByRole('button')).toHaveLength(0); // no coach controls, nothing to change
    expect(within(sheet).queryByTestId('space-info-alone')).toBeNull();
    expect(StyleSheet.flatten(sheet.props.style)).toMatchObject({ borderTopLeftRadius: 24, borderTopRightRadius: 24 });
  });

  it.each([['absent (before backend#1178)', undefined], ['null', null], ['only spaces', '   ']])('no purpose line when the space has none: %s', async (_, value) => {
    mockPurpose = value;
    const r = await sheetOpen();
    await r.findByTestId('space-info-people');
    expect(r.queryByTestId('space-info-purpose')).toBeNull();
  });

  it('the space list reads the purpose strictly: a string or null; absent or a bad value is no purpose, and the list still loads', () => {
    const { CommunityCohortSummarySchema } = require('../../../api/communityApi');
    const row = {
      id: '00000000-0000-4000-8000-000000000001', workspace_id: '00000000-0000-4000-8000-000000000002', name: 'Everyone',
      is_default: true, member_count: 3, my_role: 'client',
    };
    expect(CommunityCohortSummarySchema.parse({ ...row, description: PURPOSE }).description).toBe(PURPOSE);
    expect(CommunityCohortSummarySchema.parse({ ...row, description: null }).description).toBeNull();
    expect(CommunityCohortSummarySchema.parse(row).description).toBeUndefined();
    expect(CommunityCohortSummarySchema.parse({ ...row, description: 42 }).description).toBeUndefined();
  });

  it('loading: quiet rows, spoken "Loading people", while the members read is out', async () => {
    let release: (() => void) | undefined;
    const answer = mockApi.get.getMockImplementation() as (url: string) => Promise<unknown>;
    mockApi.get.mockImplementation((url: string) => (String(url).endsWith('/members')
      ? new Promise((done) => { release = () => done(answer(url)); })
      : answer(url)));
    const r = await sheetOpen();
    expect(r.getByTestId('space-info-people-loading').props.accessibilityLabel).toBe('Loading people');
    await waitFor(() => expect(release).toBeDefined());
    await act(async () => release?.());
    await r.findByTestId('space-info-people');
    expect(r.queryByTestId('space-info-people-loading')).toBeNull();
  });

  it('could not load: one calm line and Try again, which asks again and lists the people', async () => {
    membersAnswer = failure(500);
    const r = await sheetOpen();
    const err = await r.findByTestId('space-info-people-error');
    expect(within(err).getByText('People could not load. Try again in a moment.')).toBeTruthy();
    membersAnswer = { members: [person('me-1', 'Dana'), person('u-2', 'Jo')], next_cursor: null };
    await fireEvent.press(r.getByTestId('space-info-people-error-retry'));
    await r.findByTestId('space-info-people');
    expect(memberCalls()).toHaveLength(2);
  });

  it('offline: the connection line, and Try again lists them once the line is back', async () => {
    mockNet.isOnline = false;
    membersAnswer = failure();
    const r = await sheetOpen();
    const err = await r.findByTestId('space-info-people-error');
    expect(within(err).getByText('People could not load. Check your connection, then try again.')).toBeTruthy();
    mockNet.isOnline = true;
    membersAnswer = { members: [person('me-1', 'Dana'), person('u-2', 'Jo')], next_cursor: null };
    await fireEvent.press(r.getByTestId('space-info-people-error-retry'));
    expect(await r.findByTestId('space-info-person-u-2')).toBeTruthy();
  });

  it('the server no longer lets them read the space (404 on the people): no one listed, no error', async () => {
    membersAnswer = failure(404);
    const r = await sheetOpen();
    await waitFor(() => expect(memberCalls()).toHaveLength(1));
    await waitFor(() => expect(r.queryByTestId('space-info-people-loading')).toBeNull());
    expect(r.queryByTestId('space-info-people-error')).toBeNull();
    expect(r.queryByTestId('space-info-people')).toBeNull();
  });

  it('a page from the saved cache before the server answers this visit: people wait and are not asked for', async () => {
    const answer = mockApi.get.getMockImplementation() as (url: string) => Promise<unknown>;
    mockApi.get.mockImplementation((url: string) => (String(url).endsWith('/messages') ? new Promise(() => undefined) : answer(url)));
    client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    client.setQueryData(['community', 'space-chat', 'me-1', 'c-every'], { pages: [{ messages: page, next_before: null }], pageParams: [null] });
    const r = await render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
    await r.findByTestId('space-chat-row-m3');
    await fireEvent.press(r.getByTestId('space-chat-info'));
    expect(r.getByTestId('space-info-people-loading')).toBeTruthy();
    expect(memberCalls()).toHaveLength(0);
  });

  it('offline on the saved page at a cold start: the connection line with no button, no loading rows, no request', async () => {
    mockNet.isOnline = false;
    const answer = mockApi.get.getMockImplementation() as (url: string) => Promise<unknown>;
    mockApi.get.mockImplementation((url: string) => (String(url).endsWith('/messages') ? new Promise(() => undefined) : answer(url)));
    client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    client.setQueryData(['community', 'space-chat', 'me-1', 'c-every'], { pages: [{ messages: page, next_before: null }], pageParams: [null] });
    const r = await render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
    await r.findByTestId('space-chat-row-m3');
    await fireEvent.press(r.getByTestId('space-chat-info'));
    const line = r.getByTestId('space-info-people-offline');
    expect(within(line).getByText('People could not load. Check your connection, then try again.')).toBeTruthy();
    expect(r.queryByTestId('space-info-people-offline-retry')).toBeNull();
    expect(r.queryByTestId('space-info-people-loading')).toBeNull();
    expect(memberCalls()).toHaveLength(0);
  });

  it('a space closed to them (403 on the chat): the sheet asks for no people and lists none', async () => {
    const answer = mockApi.get.getMockImplementation() as (url: string) => Promise<unknown>;
    mockApi.get.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/messages')) throw failure(403);
      return answer(url);
    });
    const r = await open();
    await r.findByTestId('space-chat-no-access');
    await fireEvent.press(r.getByTestId('space-chat-info'));
    expect(r.getByTestId('space-info-sheet')).toBeTruthy();
    expect(r.queryByTestId('space-info-people-loading')).toBeNull();
    expect(r.queryByTestId('space-info-people')).toBeNull();
    expect(memberCalls()).toHaveLength(0);
  });

  it('Show more asks for the next 50 with the cursor and adds them once; at the end it goes away', async () => {
    const first = [person('me-1', 'Dana'), ...Array.from({ length: 49 }, (_, i) => person(`u-${100 + i}`, `Member ${i}`))];
    const second = [person('u-148', 'Member 48'), person('u-200', 'Riley')];
    const answer = mockApi.get.getMockImplementation() as (url: string) => Promise<unknown>;
    mockApi.get.mockImplementation(async (url: string, cfg?: { params?: { cursor?: string } }) => {
      if (!String(url).endsWith('/members')) return answer(url);
      return { data: cfg?.params?.cursor === 'u-148' ? { members: second, next_cursor: null } : { members: first, next_cursor: 'u-148' } };
    });
    const r = await sheetOpen();
    const more = await r.findByTestId('space-info-more');
    expect(within(more).getByText('Show more')).toBeTruthy();
    expect(more.props.accessibilityLabel).toBe('Show more people');
    expect(StyleSheet.flatten(more.props.style)).toMatchObject({ minHeight: 44, borderRadius: 12 });
    await fireEvent.press(more);
    expect(await r.findByTestId('space-info-person-u-200')).toBeTruthy();
    expect(memberCalls()[1]).toEqual(['/community/cohorts/c-every/members', { params: { limit: 50, cursor: 'u-148' } }]);
    expect(r.getAllByTestId('space-info-person-u-148')).toHaveLength(1);
    expect(r.queryByTestId('space-info-more')).toBeNull();
  });

  it('empty: nobody but the viewer: "You" and one line that no one else is here yet', async () => {
    membersAnswer = { members: [person('me-1', 'Dana')], next_cursor: null };
    const r = await sheetOpen();
    await r.findByTestId('space-info-people');
    expect(r.getByLabelText('Dana, you')).toBeTruthy();
    expect(r.getByTestId('space-info-alone').props.children).toBe('No one else is here yet.');
  });

  it('the people stay off the disk: the members query is kept in memory only', async () => {
    const r = await sheetOpen();
    await r.findByTestId('space-info-people');
    expect(client.getQueryCache().find({ queryKey: ['community', 'space-members', 'c-every'] })?.meta).toEqual({ persist: false });
  });
});

describe('FR-871R7 (m#879 Sol B879-3): a text the server accepted, before the list carries it', () => {
  it('B-TEST: with the list refresh after the receipt held, it offers no Delete that only hides it on the phone; the server row brings the real Delete', async () => {
    const { spaceOutbox } = require('../../../components/community/space-chat/spaceChatOutbox');
    const accepted = msg('m9', '2026-10-22T10:20:00.000Z', ME, { body: 'Accepted text' });
    mockApi.post.mockImplementation(async (url: string) => (String(url).endsWith('/read') ? { data: { ok: true } } : { data: { message: accepted } }));
    const r = await open();
    await r.findByTestId('space-chat-row-m3');
    // From here every list read waits (a slow line): the refresh the receipt starts is held until released below.
    const held: Array<() => void> = [];
    const answer = mockApi.get.getMockImplementation() as (url: string) => Promise<unknown>;
    mockApi.get.mockImplementation((url: string) => (String(url).endsWith('/messages')
      ? new Promise((done) => { held.push(() => done(answer(url))); })
      : answer(url)));
    page = [accepted, ...page];
    await fireEvent.changeText(r.getByTestId('space-chat-composer-field'), 'Accepted text');
    await fireEvent.press(r.getByTestId('space-chat-composer-send'));
    const sent = await r.findByTestId(/^space-chat-sent-/);
    await waitFor(() => expect(held.length).toBeGreaterThan(0));
    const localId = String(sent.props.testID).replace('space-chat-sent-', '');
    expect(r.getAllByLabelText(/^Dana Reyes, .*\. Accepted text$/)).toHaveLength(1);
    // The receipt is in, the list is not: no phone-only Delete (the ••• keeps its place, with nothing to press) ...
    expect(r.queryByTestId(`space-chat-local-menu-${localId}`)).toBeNull();
    expect(r.getByTestId(`space-chat-local-busy-${localId}`)).toBeTruthy();
    // ... and the outbox keeps the row if anything asks it to drop it (the text is on the server for everyone).
    await act(async () => { spaceOutbox.discard(localId); });
    expect(r.getByTestId(`space-chat-sent-${localId}`)).toBeTruthy();
    expect(mockApi.delete).not.toHaveBeenCalled();
    // The held read answers with the accepted text: the server row takes the phone's place, once, with the real Delete.
    await act(async () => { held.splice(0).forEach((go) => go()); });
    await r.findByTestId('space-chat-row-m9');
    expect(r.queryByTestId(`space-chat-row-${localId}`)).toBeNull();
    expect(r.getAllByLabelText(/^Dana Reyes, .*\. Accepted text$/)).toHaveLength(1);
    await fireEvent.press(r.getByTestId('space-chat-menu-m9-delete'));
    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/community/messages/m9'));
    await waitFor(() => expect(r.queryAllByLabelText(/^Dana Reyes, .*\. Accepted text$/)).toHaveLength(0));
  });
});
