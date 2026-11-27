/**
 * FIX-945R5 (m#945 fix round 5, LS-945R5 B1, class-first [R24]): every way into a space chat ends on the message asked
 * for, as a fresh open does. A push tap (the tray or the in-app banner) and a link (incomingLinks, a notification row, a
 * coach DM row's space link) reach the chat already on top through the installed StackRouter, which keeps its key and
 * replaces its params; a list tap (the space drawer, Community home, the coach's space list and inbox) always mounts a
 * new chat. For each target the table measures where a fresh open with those params lands, then sends the same params
 * to the chat she is in, scrolled up there, and expects it to land on the same place: the row the page scrolls to, or
 * the newest rows (where the inverted list starts). The hook (useSpaceChat), the outbox and the rows are the real ones;
 * the server answers by space. LS-945R5's own B-TEST stays in LS945R5NewestRetarget.btest.test.tsx.
 */
import React from 'react';
import { FlatList } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authEvents } from '../../../utils/authEvents';

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
const mockParams: { current: { cohortId: string; messageId?: string } } = { current: { cohortId: 'c-a' } };
const mockStack = { routes: ['CommunityTab', 'CommunitySpaceChat'] };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), getState: () => ({ routeNames: mockStack.routes }) }),
  useRoute: () => ({ params: mockParams.current }),
  useIsFocused: () => true,
}));
jest.mock('../../../components/community/SpaceDrawer', () => {
  const { Text } = jest.requireActual('react-native');
  return { SpaceListButton: ({ label, testID = 'space-list-open' }: { label?: string; testID?: string }) => <Text testID={testID} accessibilityLabel={label ?? 'Open space list'}>{label ?? 'list'}</Text> };
});
let mockUser = { id: 'me-1', name: 'Dana Reyes', coach_id: 'coach-1' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('react-native-safe-area-context', () => {
  const { createContext, createElement } = require('react');
  const { View } = require('react-native');
  const insets = { top: 47, right: 0, bottom: 34, left: 0 };
  return {
    SafeAreaView: ({ children, style, testID }: { children?: unknown; style?: unknown; testID?: string }) => createElement(View, { style, testID }, children),
    SafeAreaInsetsContext: createContext(insets),
    useSafeAreaInsets: () => insets,
  };
});
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: null }),
  isEffectivelyOnline: jest.requireActual('../../../hooks/useNetworkStatus').isEffectivelyOnline,
}));
let mockRole = 'client';
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityCohorts: () => ({
    data: { feature_flag_state: 'on', cohorts: [
      { id: 'c-a', workspace_id: 'ws', name: 'Running', is_default: true, kind: 'default', member_count: 12, my_role: mockRole },
    ] },
    isLoading: false, isError: false, refetch: jest.fn(),
  }),
  useCommunityMe: () => ({ dataUpdatedAt: 0 }),
  communityKeys: { cohorts: () => ['community', 'cohorts'], me: () => ['community', 'me'] },
}));
jest.mock('../../../components/community/VoiceNotePlayer', () => {
  const { Text } = jest.requireActual('react-native');
  return (p: { testID: string }) => <Text testID={p.testID}>player</Text>;
});
jest.mock('../../../api/communityVoiceApi', () => ({ communityVoiceApi: { getOne: jest.fn(async () => ({ url: 'https://x/v.m4a' })), remove: jest.fn() } }));
const mockVoice = { items: [] as unknown[], online: true, send: jest.fn(), retry: jest.fn(), discard: jest.fn() };
jest.mock('../../../hooks/useVoiceOutbox', () => ({ useVoiceOutbox: () => mockVoice }));
jest.mock('../../../components/community/VoiceRecordSheet', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { visible: boolean; target: { cohortName: string } }) => (p.visible ? <Text testID="voice-sheet">{p.target.cohortName}</Text> : null) };
});
jest.mock('../../../components/community/SafetyMenu', () => {
  const { Text } = jest.requireActual('react-native');
  return (p: { testID: string }) => <Text testID={p.testID}>menu</Text>;
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
const mockApi = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock('../../../services/api', () => ({ __esModule: true, default: mockApi }));

const Screen = require('../CommunitySpaceChatScreen').default;
// The installed StackRouter, through the declared package (declaredDependencies.test.ts: routers is not declared).
const { CommonActions, StackActions, StackRouter } = jest.requireActual<typeof import('@react-navigation/native')>('@react-navigation/native');

type Who = { id: string; name: string; is_coach?: boolean };
const COACH: Who = { id: 'coach-1', name: 'Sam Okafor', is_coach: true };
const JO: Who = { id: 'u-2', name: 'jo b.' };
const msg = (id: string, at: string, who: Who, extra: Record<string, unknown> = {}) => ({
  id, cohort_id: 'c-a', sender_user_id: who.id, body: `body ${id}`, kind: 'text', created_at: at, updated_at: at,
  edited: false, deleted: false, parent_message_id: null, voice_note: null,
  sender: { id: who.id, name: who.name, avatar_url: null, is_coach: !!who.is_coach }, ...extra,
});
const fail = (status: number) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data: {} } });

// Space A as its server answers it: a5 is the newest row (a reply to her, or the coach's High alert, names it); the
// read cursor sits between a1 and a2, so the New messages line is drawn above a2. `older` is the page under the first.
type Space = { page: unknown[]; older?: unknown[]; read: unknown };
let space: Space;
const NEWEST_READ = { last_read_at: '2026-10-22T10:30:00.000Z', last_read_message_id: 'a5' };
const freshSpace = (): Space => ({
  page: [
    msg('a5', '2026-10-22T10:30:00.000Z', JO),
    msg('a3', '2026-10-22T10:05:00.000Z', JO),
    msg('a2', '2026-10-22T09:30:00.000Z', COACH),
    msg('a1', '2026-10-22T08:00:00.000Z', COACH),
  ],
  read: { last_read_at: '2026-10-22T09:00:00.000Z', last_read_message_id: 'a1' },
});

beforeEach(() => {
  authEvents.emit('logout');
  mockDisk.clear();
  (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store.set('supabase_token', 'tok-me-1');
  mockStack.routes = ['CommunityTab', 'CommunitySpaceChat'];
  mockRole = 'client';
  mockUser = { id: 'me-1', name: 'Dana Reyes', coach_id: 'coach-1' };
  mockParams.current = { cohortId: 'c-a' };
  mockVoice.items = [];
  space = freshSpace();
  mockApi.get.mockReset().mockImplementation(async (url: string, cfg?: { params?: { before?: string } }) => {
    if (url === '/community/voice-consent') return { data: { seen: true, seen_at: '2026-10-20T10:00:00.000Z' } };
    const [, id, what] = /^\/community\/cohorts\/([^/]+)\/(messages|read|members)$/.exec(url) ?? [];
    if (id !== 'c-a') throw fail(404);
    if (what === 'members') return { data: { members: [], next_cursor: null } };
    if (what === 'read') return { data: space.read };
    if (cfg?.params?.before) return { data: { messages: space.older ?? [], next_before: null } };
    return { data: { messages: space.page, next_before: space.older ? 'cur' : null } };
  });
  mockApi.post.mockReset().mockImplementation(async () => ({ data: { ok: true } }));
  mockApi.delete.mockReset().mockResolvedValue({ data: {} });
});

let client: QueryClient;
const tree = () => <QueryClientProvider client={client}><Screen /></QueryClientProvider>;
const open = async (params: { cohortId: string; messageId?: string }) => {
  mockParams.current = params;
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const r = await render(tree());
  await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
  return r;
};
afterEach(() => client?.clear());
type R = Awaited<ReturnType<typeof open>>;
const wait = (ms: number) => act(async () => { await new Promise((res) => setTimeout(res, ms)); });
const keys = (r: R) => (r.getByTestId('space-chat-list').props.data as Array<{ key: string }>).map((i) => i.key);
const readMarks = () => mockApi.post.mock.calls.filter(([u]) => String(u).endsWith('/read'))
  .map(([, b]) => (b as { message_id: string }).message_id);
type Pair = { onViewableItemsChanged: (info: unknown) => void };
const see = (r: R, ...seen: string[]) => act(async () => {
  (r.getByTestId('space-chat-list').props.viewabilityConfigCallbackPairs as Pair[])[0]
    .onViewableItemsChanged({ viewableItems: seen.map((key) => ({ key, isViewable: true, index: null })), changed: [] });
});

// The push tap or the link into the chat already on top: the installed StackRouter keeps the screen's key and
// replaces its params (pushTapRouter deliverTarget, incomingLinks' nested navigate), so the mounted chat only sees
// new params.
const router = StackRouter({ initialRouteName: 'CommunitySpaceChat' });
const routerOptions = { routeNames: ['CommunitySpaceChat'], routeParamList: {}, routeGetIdList: {} };
const retarget = async (r: R, params: { cohortId: string; messageId?: string }) => {
  const initial = router.getInitialState(routerOptions);
  const before = { ...initial, routes: initial.routes.map((route) => ({ ...route, params: mockParams.current })) };
  const next = router.getStateForAction(before, CommonActions.navigate('CommunitySpaceChat', params), routerOptions)!;
  expect(next.routes[0].key).toBe(before.routes[0].key);
  mockParams.current = next.routes[0].params as typeof params;
  await r.rerender(tree());
};

// Where the list ends: the last scroll the page made, a row (by its key) or the newest rows (offset 0, where an inverted
// list starts); with no scroll at all, a fresh list is at its newest rows and a mounted one is wherever she left it.
const NEWEST = 'the newest rows';
const STAYED = 'where she was scrolled';
const watchScrolls = () => {
  const toIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
  const toOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => undefined);
  const landing = (r: R, mounted: boolean) => {
    const calls = [
      ...toIndex.mock.calls.map(([a], i) => ({ at: toIndex.mock.invocationCallOrder[i], row: (a as { index: number }).index, offset: undefined as number | undefined })),
      ...toOffset.mock.calls.map(([a], i) => ({ at: toOffset.mock.invocationCallOrder[i], row: undefined as number | undefined, offset: (a as { offset: number }).offset })),
    ].sort((x, y) => x.at - y.at);
    const last = calls[calls.length - 1];
    if (!last) return mounted ? STAYED : NEWEST;
    if (last.row !== undefined) return keys(r)[last.row];
    return last.offset === 0 ? NEWEST : `offset ${last.offset}`;
  };
  return {
    landing,
    clear: () => { toIndex.mockClear(); toOffset.mockClear(); },
    restore: () => { toIndex.mockRestore(); toOffset.mockRestore(); },
  };
};
const settle = async (r: R, row?: string) => {
  await r.findByTestId('space-chat-list');
  if (row) await r.findByTestId(`space-chat-row-${row}`);
  await wait(120);
};
// She opened the space, was placed, then dragged up to its oldest rows and reads there.
const scrollUp = async (r: R) => {
  await act(async () => { r.getByTestId('space-chat-list').props.onScrollBeginDrag?.(); });
  await see(r, 'a1');
};
const asCoach = () => {
  mockRole = 'owner';
  mockUser = { id: 'coach-1', name: 'Sam Okafor', coach_id: '' };
  mockStack.routes = ['CoachCommunityCohorts', 'CoachCommunityCohortDetail', 'CommunitySpaceChat'];
};

describe('FIX-945R5 B1 (LS-945R5 B1), class-first: the chat she is in lands where a fresh open with the same params does', () => {
  type Row = [string, 'member' | 'coach', { messageId?: string }, { messageId?: string }, string, (() => void) | undefined];
  const table: Row[] = [
    // LS-945R5 B1: the two space pushes that carry ?message= name the message just posted, the space's newest row.
    ['the newest message (a reply to her, a High alert)', 'member', {}, { messageId: 'a5' }, NEWEST, undefined],
    ['the newest message, the coach reading back in a busy space', 'coach', {}, { messageId: 'a5' }, NEWEST, asCoach],
    // Not on the phone and not on any older page: removed, its author blocked, or not polled yet.
    ['a message the list does not hold', 'member', {}, { messageId: 'a-gone' }, NEWEST, undefined],
    ['no message, everything read (no New messages line)', 'member', { messageId: 'a2' }, {}, NEWEST, () => { space.read = NEWEST_READ; }],
    // Already right before this round; kept as guards of the same table.
    ['an older message on the loaded page', 'member', {}, { messageId: 'a1' }, 'a1', undefined],
    ['a message on an older page (older pages load first)', 'member', {}, { messageId: 'a0' }, 'a0',
      () => { space.older = [msg('a0', '2026-10-20T08:00:00.000Z', JO)]; }],
    ['no message, a New messages line', 'member', { messageId: 'a2' }, {}, 'new-line', undefined],
  ];

  it.each(table)('%s (%s): a fresh open and the chat she is in, scrolled up, both end on it', async (_n, _who, first, then, expected, setUp) => {
    setUp?.();
    const scrolls = watchScrolls();
    try {
      const fresh = await open({ cohortId: 'c-a', ...then });
      await settle(fresh, then.messageId === 'a0' ? 'a0' : undefined);
      expect(scrolls.landing(fresh, false)).toBe(expected);
      await fresh.unmount();
      client.clear();

      scrolls.clear();
      const r = await open({ cohortId: 'c-a', ...first });
      await settle(r);
      await scrollUp(r);
      scrolls.clear();
      await retarget(r, { cohortId: 'c-a', ...then });
      await settle(r, then.messageId === 'a0' ? 'a0' : undefined);
      expect(scrolls.landing(r, true)).toBe(expected);
    } finally {
      scrolls.restore();
    }
  });

  it('a push for a message not polled yet: the newest rows at once, and the poll draws it there; it is read once on screen', async () => {
    const scrolls = watchScrolls();
    try {
      const r = await open({ cohortId: 'c-a' });
      await settle(r);
      await see(r, 'a3', 'a2', 'new-line');
      await waitFor(() => expect(readMarks()).toEqual(['a3']));
      await scrollUp(r);
      scrolls.clear();
      await retarget(r, { cohortId: 'c-a', messageId: 'a6' });
      await settle(r);
      expect(scrolls.landing(r, true)).toBe(NEWEST);
      scrolls.clear();
      space.page = [msg('a6', '2026-10-22T10:45:00.000Z', JO), ...space.page];
      await act(async () => { await client.refetchQueries(); });
      expect(await r.findByTestId('space-chat-row-a6')).toBeTruthy();
      expect(keys(r)[0]).toBe('a6');
      await wait(120);
      expect(scrolls.landing(r, true)).toBe(STAYED);
      await see(r, 'a6', 'a5');
      await waitFor(() => expect(readMarks()).toEqual(['a3', 'a6']));
    } finally {
      scrolls.restore();
    }
  });
});

describe('FIX-945R5 B1, class-first: which ways in reach the chat already on screen (the installed StackRouter)', () => {
  type Nav = { index?: number; routes: Array<{ key?: string; name: string; params?: object }> };
  type Stack = Parameters<ReturnType<typeof StackRouter>['getStateForAction']>[0];
  const top = (s: Nav) => s.routes[s.index ?? s.routes.length - 1];
  const chatOnTop = (names: string[]) => {
    const r = StackRouter({ initialRouteName: names[0] });
    const options = { routeNames: names, routeParamList: {}, routeGetIdList: {} };
    const state = r.getStateForAction(r.getInitialState(options), CommonActions.navigate('CommunitySpaceChat', { cohortId: 'c-a' }), options)!;
    return { r, options, state, key: top(state).key };
  };

  it.each([
    ['a push tap (tray or in-app banner) or a link, member: CommunityTab > CommunitySpaceChat', ['CommunityTab', 'CommunitySpaceChat']],
    ['a push tap or a link, the coach: CommunityStack > CommunitySpaceChat', ['CoachCommunityCohorts', 'CoachCommunityInbox', 'CommunitySpaceChat']],
  ])('%s keeps the chat on top (its key) and replaces its params: the case table above', (_n, names) => {
    const { r, options, state, key } = chatOnTop(names);
    const next = r.getStateForAction(state as Stack, CommonActions.navigate('CommunitySpaceChat', { cohortId: 'c-a', messageId: 'a5' }), options)!;
    expect(top(next).key).toBe(key);
    expect(top(next).params).toEqual({ cohortId: 'c-a', messageId: 'a5' });
  });

  it('the space drawer (SpaceTree replace) mounts a new chat: a fresh open, even for the space she is in', () => {
    const { r, options, state, key } = chatOnTop(['CommunityTab', 'CommunitySpaceChat']);
    const next = r.getStateForAction(state as Stack, StackActions.replace('CommunitySpaceChat', { cohortId: 'c-a' }), options)!;
    expect(top(next).name).toBe('CommunitySpaceChat');
    expect(top(next).key).not.toBe(key);
  });

  it.each([
    ['Community home (SpaceTree navigate)', ['CommunityTab', 'CommunitySpaceChat'], 'CommunityTab'],
    ["the coach's space list, opened over the chat (CoachCommunityCohortsScreen)", ['CoachCommunityCohorts', 'CommunitySpaceChat'], 'CoachCommunityCohorts'],
    ["the coach's inbox (CoachCommunityInboxScreen, with the message)", ['CoachCommunityInbox', 'CommunitySpaceChat'], 'CoachCommunityInbox'],
  ])('a list tap from %s mounts a new chat: a fresh open', (_n, names, list) => {
    const { r, options, state, key } = chatOnTop(names);
    const onList = r.getStateForAction(state as Stack, CommonActions.navigate(list), options)!;
    expect(top(onList).name).toBe(list);
    const next = r.getStateForAction(onList as Stack, CommonActions.navigate('CommunitySpaceChat', { cohortId: 'c-a', messageId: 'a5' }), options)!;
    expect(top(next).name).toBe('CommunitySpaceChat');
    expect(top(next).key).not.toBe(key);
  });
});
