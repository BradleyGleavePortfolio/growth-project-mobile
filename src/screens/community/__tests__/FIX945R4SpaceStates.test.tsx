/**
 * FIX-945R4 (m#945 fix round 4, sheet S2b): the space chat ends where a fresh open would after a push or a link into the
 * chat already on screen (LS-945 B1), every empty space draws its start row in a scrolling stream with the list's own
 * inset (LS-945 B2 = LO-945 C4), and a closed space shows, keeps and sends nothing of the open chat (LS-945 B3 = LO-945
 * C1). The hook (useSpaceChat), the outbox and the rows are the real ones; the server answers by space.
 * LS-945's own B-TESTs stay in LS945RouteRetarget.btest.test.tsx; these are the rest of each class's table.
 */
import React from 'react';
import { AccessibilityInfo, Alert, FlatList, Keyboard, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommonActions, StackRouter } from '@react-navigation/routers';
import { authEvents } from '../../../utils/authEvents';
import { spacing } from '../../../theme/tokens';

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
let mockPurpose: string | undefined;
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityCohorts: () => ({
    data: { feature_flag_state: 'on', cohorts: [
      { id: 'c-a', workspace_id: 'ws', name: 'Running', is_default: true, kind: 'default', member_count: 12, my_role: mockRole, description: mockPurpose },
      { id: 'c-b', workspace_id: 'ws', name: 'Strength', is_default: false, kind: 'default', member_count: 8, my_role: mockRole },
      { id: 'c-ann', workspace_id: 'ws', name: 'Announcements', is_default: false, kind: 'announcement', posting_policy: 'coach', member_count: 24, my_role: mockRole, description: mockPurpose },
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

type Who = { id: string; name: string; is_coach?: boolean };
const COACH: Who = { id: 'coach-1', name: 'Sam Okafor', is_coach: true };
const JO: Who = { id: 'u-2', name: 'jo b.' };
const ME: Who = { id: 'me-1', name: 'Dana Reyes' };
const msg = (id: string, at: string, who: Who, cohort: string, extra: Record<string, unknown> = {}) => ({
  id, cohort_id: cohort, sender_user_id: who.id, body: `body ${id}`, kind: 'text', created_at: at, updated_at: at,
  edited: false, deleted: false, parent_message_id: null, voice_note: null,
  sender: { id: who.id, name: who.name, avatar_url: null, is_coach: !!who.is_coach }, ...extra,
});
const fail = (status: number) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data: {} } });

// Each space as its server answers it. Space B's rows are all older than space A's (LS-945's watermark case).
type Space = { page: unknown[]; older?: unknown[]; read: unknown; refuse?: number; hold?: boolean };
let spaces: Record<string, Space> = {};
let markFails = false;
let sendRefused = false;
const freshSpaces = (): Record<string, Space> => ({
  'c-a': {
    page: [
      msg('a3', '2026-10-22T10:05:00.000Z', JO, 'c-a'),
      msg('a2', '2026-10-22T09:30:00.000Z', COACH, 'c-a'),
      msg('a1', '2026-10-22T08:00:00.000Z', COACH, 'c-a'),
    ],
    read: { last_read_at: '2026-10-22T09:00:00.000Z', last_read_message_id: 'a1' },
  },
  'c-b': {
    page: [
      msg('b4', '2026-10-01T10:30:00.000Z', JO, 'c-b'),
      msg('b3', '2026-10-01T10:20:00.000Z', JO, 'c-b'),
      msg('b2', '2026-10-01T10:10:00.000Z', COACH, 'c-b'),
      msg('b1', '2026-10-01T09:00:00.000Z', COACH, 'c-b'),
    ],
    read: { last_read_at: '2026-10-01T10:00:00.000Z', last_read_message_id: 'b1' },
  },
  'c-ann': { page: [], read: { last_read_at: null, last_read_message_id: null } },
});

beforeEach(() => {
  authEvents.emit('logout');
  mockDisk.clear();
  (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store.set('supabase_token', 'tok-me-1');
  mockStack.routes = ['CommunityTab', 'CommunitySpaceChat'];
  mockRole = 'client';
  mockPurpose = undefined;
  mockUser = { id: 'me-1', name: 'Dana Reyes', coach_id: 'coach-1' };
  mockParams.current = { cohortId: 'c-a' };
  mockVoice.items = [];
  spaces = freshSpaces();
  markFails = false;
  sendRefused = false;
  mockApi.get.mockReset().mockImplementation(async (url: string, cfg?: { params?: { before?: string } }) => {
    if (url === '/community/voice-consent') return { data: { seen: true, seen_at: '2026-10-20T10:00:00.000Z' } };
    const [, id, what] = /^\/community\/cohorts\/([^/]+)\/(messages|read|members)$/.exec(url) ?? [];
    const space = spaces[id];
    if (!space) throw fail(404);
    if (what === 'members') return { data: { members: [], next_cursor: null } };
    if (what === 'read') return { data: space.read };
    if (space.refuse) throw fail(space.refuse);
    if (space.hold) return new Promise(() => undefined);
    if (cfg?.params?.before) return { data: { messages: space.older ?? [], next_before: null } };
    return { data: { messages: space.page, next_before: space.older ? 'cur' : null } };
  });
  mockApi.post.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/read')) {
      if (markFails) throw fail(500);
      return { data: { ok: true } };
    }
    if (sendRefused) throw fail(403);
    return { data: { message: msg('a9', new Date().toISOString(), ME, 'c-a') } };
  });
  mockApi.delete.mockReset().mockResolvedValue({ data: {} });
});

let client: QueryClient;
const tree = () => <QueryClientProvider client={client}><Screen /></QueryClientProvider>;
const open = async () => {
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const r = await render(tree());
  await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
  return r;
};
afterEach(() => client?.clear());
type R = Awaited<ReturnType<typeof open>>;

// A push or a link into the chat already on top: the installed StackRouter keeps the screen's key and replaces its
// params (pushTapRouter deliverTarget, incomingLinks nested navigate), so the mounted screen only sees new params.
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
type Pair = { onViewableItemsChanged: (info: unknown) => void };
const see = (r: R, ...keys: string[]) => act(async () => {
  (r.getByTestId('space-chat-list').props.viewabilityConfigCallbackPairs as Pair[])[0]
    .onViewableItemsChanged({ viewableItems: keys.map((key) => ({ key, isViewable: true, index: null })), changed: [] });
});
const keys = (r: R) => (r.getByTestId('space-chat-list').props.data as Array<{ key: string }>).map((i) => i.key);
const readMarks = () => mockApi.post.mock.calls.filter(([u]) => String(u).endsWith('/read'))
  .map(([u, b]) => `${/cohorts\/([^/]+)\//.exec(String(u))?.[1]}:${(b as { message_id: string }).message_id}`);
const scrolls = (spy: jest.SpyInstance) => spy.mock.calls.map(([a]) => a as { index: number; animated?: boolean });
const wait = (ms: number) => act(async () => { await new Promise((res) => setTimeout(res, ms)); });
const hold = async (r: R, id: string) => { await fireEvent(r.getByTestId(`space-chat-row-${id}`), 'longPress'); };
const pickReply = async (r: R) => {
  let node = r.getByTestId('space-chat-sheet') as unknown as { props: Record<string, unknown>; parent: unknown } | null;
  while (node && typeof node.props.onDismiss !== 'function') node = node.parent as typeof node;
  await fireEvent.press(r.getByTestId('space-chat-sheet-reply'));
  await act(async () => { (node?.props.onDismiss as (() => void) | undefined)?.(); });
};
// Space A opened at its New messages line, read to a3, then scrolled up a little: a new row from someone else lights the pill.
const pillUp = async (r: R) => {
  await r.findByTestId('space-chat-row-a3');
  await see(r, 'a3', 'a2', 'new-line');
  await waitFor(() => expect(readMarks()).toEqual(['c-a:a3']));
  await see(r, 'a2', 'new-line');
  spaces['c-a'].page = [msg('a5', '2026-10-22T10:30:00.000Z', JO, 'c-a'), ...spaces['c-a'].page];
  await act(async () => { await client.refetchQueries(); });
  expect(await r.findByTestId('space-chat-pill')).toBeTruthy();
};

describe('FIX-945R4 B1 (LS-945 B1): a push or a link into the chat already on screen ends where a fresh open would', () => {
  it('(b) the same space, a message on an older page: older pages load first, then the page opens at it', async () => {
    spaces['c-a'].older = [msg('a0', '2026-10-20T08:00:00.000Z', JO, 'c-a')];
    const toIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
    try {
      const r = await open();
      await r.findByTestId('space-chat-row-a3');
      await see(r, 'a3', 'a2', 'new-line');
      await waitFor(() => expect(readMarks()).toEqual(['c-a:a3']));
      toIndex.mockClear();
      await retarget(r, { cohortId: 'c-a', messageId: 'a0' });
      expect(await r.findByTestId('space-chat-row-a0')).toBeTruthy();
      expect(mockApi.get).toHaveBeenCalledWith('/community/cohorts/c-a/messages', { params: { limit: 30, before: 'cur' } });
      await waitFor(() => expect(scrolls(toIndex)).toContainEqual({ index: keys(r).indexOf('a0'), viewPosition: 0.5, animated: false }));
    } finally {
      toIndex.mockRestore();
    }
  });

  it('(a) the same space, a new message on a loaded page: it opens there and reads nothing until that row is on screen', async () => {
    const toIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
    try {
      const r = await open();
      await r.findByTestId('space-chat-row-a3');
      await see(r, 'new-line', 'a2');
      await waitFor(() => expect(readMarks()).toEqual(['c-a:a2']));
      toIndex.mockClear();
      await retarget(r, { cohortId: 'c-a', messageId: 'a1' });
      await waitFor(() => expect(scrolls(toIndex)).toContainEqual({ index: keys(r).indexOf('a1'), viewPosition: 0.5, animated: false }));
      await see(r, 'a3');
      await wait(50);
      expect(readMarks()).toEqual(['c-a:a2']);
      await see(r, 'a3', 'a2', 'a1');
      await waitFor(() => expect(readMarks()).toEqual(['c-a:a2', 'c-a:a3']));
    } finally {
      toIndex.mockRestore();
    }
  });

  it("(d) another space, no message asked for: its own New messages line; nothing read before it is on screen; then that space's rows, with its id", async () => {
    const toIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
    try {
      const r = await open();
      await r.findByTestId('space-chat-row-a3');
      await see(r, 'a3', 'a2', 'new-line');
      await waitFor(() => expect(readMarks()).toEqual(['c-a:a3']));
      toIndex.mockClear();
      await retarget(r, { cohortId: 'c-b' });
      await r.findByTestId('space-chat-row-b4');
      expect(r.queryByTestId('space-chat-row-a3')).toBeNull();
      await waitFor(() => expect(scrolls(toIndex)).toContainEqual({ index: keys(r).indexOf('new-line'), viewPosition: 0.5, animated: false }));
      expect(keys(r).indexOf('new-line')).toBe(3);
      await see(r, 'b4', 'b3');
      await wait(50);
      expect(readMarks()).toEqual(['c-a:a3']);
      await see(r, 'b3', 'b2', 'new-line');
      await waitFor(() => expect(readMarks()).toEqual(['c-a:a3', 'c-b:b3']));
    } finally {
      toIndex.mockRestore();
    }
  });

  it('(e) a retry of the opening place still waiting, then a push into another space: the old retry never scrolls the new list', async () => {
    const toIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
    try {
      const r = await open();
      await r.findByTestId('space-chat-row-a3');
      await waitFor(() => expect(toIndex).toHaveBeenCalled());
      const old = scrolls(toIndex)[0].index;
      // The row had not measured yet: the list says so and the page tries again in 50 ms.
      await act(async () => {
        r.getByTestId('space-chat-list').props.onScrollToIndexFailed({ index: old, averageItemLength: 80, highestMeasuredFrameIndex: 0 });
      });
      toIndex.mockClear();
      await retarget(r, { cohortId: 'c-b' });
      await r.findByTestId('space-chat-row-b4');
      await wait(200);
      const line = keys(r).indexOf('new-line');
      expect(line).not.toBe(old);
      expect(scrolls(toIndex).map((s) => s.index)).toEqual([line]);
    } finally {
      toIndex.mockRestore();
    }
  });

  it("(e) a quote's scroll still on its way, then a new message asked for in the same space: the old scroll never moves the list", async () => {
    spaces['c-a'].page = [
      msg('a4', '2026-10-22T10:10:00.000Z', JO, 'c-a', { body: 'Count me in', parent_message_id: 'a1',
        parent: { id: 'a1', gone: false, kind: 'text', sender_name: 'Sam Okafor', snippet: 'body a1', voice_duration_ms: null } }),
      ...spaces['c-a'].page,
    ];
    const toIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
    try {
      const r = await open();
      await r.findByTestId('space-chat-row-a4');
      await see(r, 'a4', 'a3', 'a2', 'new-line');
      await fireEvent.press(r.getByTestId('space-chat-quote-a4', { includeHiddenElements: true }));
      const quoted = keys(r).indexOf('a1');
      expect(scrolls(toIndex)).toContainEqual({ index: quoted, viewPosition: 0.5, animated: true });
      // Far off screen: the list says so and the quote tries once more in 100 ms.
      await act(async () => {
        r.getByTestId('space-chat-list').props.onScrollToIndexFailed({ index: quoted, averageItemLength: 80, highestMeasuredFrameIndex: 0 });
      });
      toIndex.mockClear();
      await retarget(r, { cohortId: 'c-a', messageId: 'a2' });
      await wait(250);
      expect(scrolls(toIndex)).toEqual([{ index: keys(r).indexOf('a2'), viewPosition: 0.5, animated: false }]);
    } finally {
      toIndex.mockRestore();
    }
  });

  it('(f) the New messages pill up in one space, then a push into another: no pill there', async () => {
    const r = await open();
    await pillUp(r);
    await retarget(r, { cohortId: 'c-b' });
    await r.findByTestId('space-chat-row-b4');
    await wait(50);
    expect(r.queryByTestId('space-chat-pill')).toBeNull();
  });

  it("(f) a push into another space whose page is kept from earlier: no box until that space's own read answers (a banned member never gets one)", async () => {
    const r = await open();
    await r.findByTestId('space-chat-composer-field');
    client.setQueryData(['community', 'space-chat', 'me-1', 'c-b'], { pages: [{ messages: spaces['c-b'].page, next_before: null }], pageParams: [null] });
    spaces['c-b'].hold = true;
    await retarget(r, { cohortId: 'c-b' });
    await r.findByTestId('space-chat-row-b4');
    await wait(50);
    expect(r.queryByTestId('space-chat-composer-field')).toBeNull();
    expect(r.queryByTestId('space-chat-mic')).toBeNull();
  });

  it('(f) Space info open in one space, then a push into another: no sheet there', async () => {
    const r = await open();
    await r.findByTestId('space-chat-row-a3');
    await fireEvent.press(r.getByTestId('space-chat-info'));
    expect(within(r.getByTestId('space-info-sheet')).getByText('Running')).toBeTruthy();
    await retarget(r, { cohortId: 'c-b' });
    await r.findByTestId('space-chat-row-b4');
    expect(r.queryByTestId('space-info-sheet')).toBeNull();
  });

  it('(f) the record sheet open in one space, then a push into another: it closes; nothing is aimed at the other space', async () => {
    const r = await open();
    await r.findByTestId('space-chat-row-a3');
    await fireEvent.press(await r.findByTestId('space-chat-mic'));
    expect((await r.findByTestId('voice-sheet')).props.children).toBe('Running');
    await retarget(r, { cohortId: 'c-b' });
    await r.findByTestId('space-chat-row-b4');
    await r.findByTestId('space-chat-composer-field');
    expect(r.queryByTestId('voice-sheet')).toBeNull();
    expect(mockVoice.send).not.toHaveBeenCalled();
  });

  it('(f) reply mode and the message sheet up in one space, then a push into another: neither there (the hook drops them too; a guard)', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    try {
      const r = await open();
      await r.findByTestId('space-chat-row-a3');
      await hold(r, 'a3');
      await pickReply(r);
      expect(r.getByLabelText('Replying to jo b.')).toBeTruthy();
      await hold(r, 'a2');
      expect(r.getByTestId('space-chat-sheet')).toBeTruthy();
      await retarget(r, { cohortId: 'c-b' });
      await r.findByTestId('space-chat-composer-field');
      expect(r.queryByLabelText('Replying to jo b.')).toBeNull();
      expect(r.queryByTestId('space-chat-sheet')).toBeNull();
    } finally {
      alert.mockRestore();
    }
  });

  it('(g) a closed space, an open one, then the closed one again: each draws its own state; the closed bar is said once per closing', async () => {
    spaces['c-a'].refuse = 403;
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    try {
      const r = await open();
      expect(await r.findByTestId('space-chat-no-access')).toBeTruthy();
      expect(announce).toHaveBeenCalledTimes(1);
      await retarget(r, { cohortId: 'c-b' });
      expect(await r.findByTestId('space-chat-composer-field')).toBeTruthy();
      expect(r.getByTestId('space-chat-row-b4')).toBeTruthy();
      expect(r.queryByTestId('space-chat-no-access')).toBeNull();
      expect(r.queryByTestId('space-chat-closed-note')).toBeNull();
      expect(announce).toHaveBeenCalledTimes(1);
      await retarget(r, { cohortId: 'c-a' });
      expect(await r.findByTestId('space-chat-no-access')).toBeTruthy();
      expect(r.queryByTestId(/^space-chat-row-/)).toBeNull();
      expect(r.queryByTestId('space-chat-composer-field')).toBeNull();
      expect(announce).toHaveBeenCalledTimes(2);
      expect(dismiss).toHaveBeenCalled();
    } finally {
      announce.mockRestore();
      dismiss.mockRestore();
    }
  });

  it('(h) the same params delivered twice move nothing, read nothing again and keep the box as it was', async () => {
    const toIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
    try {
      const r = await open();
      await r.findByTestId('space-chat-row-a3');
      await see(r, 'a3', 'a2', 'new-line');
      await waitFor(() => expect(readMarks()).toEqual(['c-a:a3']));
      await fireEvent.changeText(r.getByTestId('space-chat-composer-field'), 'half typed');
      toIndex.mockClear();
      await retarget(r, { cohortId: 'c-a' });
      await wait(50);
      expect(toIndex).not.toHaveBeenCalled();
      expect(readMarks()).toEqual(['c-a:a3']);
      expect(r.getByTestId('space-chat-composer-field').props.value).toBe('half typed');
    } finally {
      toIndex.mockRestore();
    }
  });
});

describe('FIX-945R4 B2 (LS-945 B2, LO-945 C4): every empty space draws its start row in a scrolling stream', () => {
  const asCoach = () => {
    mockRole = 'owner';
    mockUser = { id: 'coach-1', name: 'Sam Okafor', coach_id: '' };
    mockStack.routes = ['CoachCommunityCohorts', 'CoachCommunityCohortDetail', 'CommunitySpaceChat'];
  };
  // The longest purpose the server takes (community-cohort.dto.ts MaxLength 2000).
  const LONG = `${'Weekly check-ins, form questions and plans for the next session. '.repeat(31).slice(0, 1999)}.`;

  it('the empty stream carries the list\'s own inset (GOAL .stream 8 pt)', async () => {
    const r = await open();
    const inset = StyleSheet.flatten((await r.findByTestId('space-chat-list')).props.contentContainerStyle);
    await r.unmount();
    spaces['c-a'].page = [];
    const e = await open();
    await e.findByTestId('space-chat-start');
    expect(inset).toEqual({ paddingVertical: spacing.sm });
    expect(StyleSheet.flatten(e.getByTestId('space-chat-empty').props.contentContainerStyle)).toEqual(inset);
  });

  it.each([
    ['a member, chat (S3)', 'c-a', false, '12 members'],
    ['a member, Announcements (S4)', 'c-ann', false, '24 members'],
    ['the coach, chat (S5)', 'c-a', true, '12 members'],
    ['the coach, a coach-only space', 'c-ann', true, '24 members'],
  ])('%s: the start row scrolls; a 2,000-character purpose and the count are in it; the box, the chip and the band are not', async (_n, cohortId, coach, count) => {
    expect(LONG).toHaveLength(2000);
    if (coach) asCoach();
    mockPurpose = LONG;
    mockParams.current = { cohortId };
    spaces[cohortId].page = [];
    const r = await open();
    const start = await r.findByTestId('space-chat-start');
    const stream = r.getByTestId('space-chat-empty');
    expect(String(stream.type)).toMatch(/ScrollView/);
    expect(stream.props.keyboardShouldPersistTaps).toBe('handled');
    expect(within(stream).getByTestId('space-chat-start')).toBe(start);
    expect(within(start).getByText(LONG).props.numberOfLines).toBeUndefined();
    expect(within(start).getByText(count)).toBeTruthy();
    const outside = ['space-chat-composer', 'space-chat-suggestion', 'space-chat-hint'].filter((id) => r.queryByTestId(id));
    expect(outside.length).toBeGreaterThan(0);
    for (const id of outside) expect(within(stream).queryByTestId(id)).toBeNull();
    expect(!!r.queryByTestId('space-chat-suggestion')).toBe(coach);
  });
});

describe('FIX-945R4 B3 (LS-945 B3, LO-945 C1): closed, nothing of the open chat is drawn, pressable or sent while it holds', () => {
  const refuseRead = async () => {
    spaces['c-a'].refuse = 403;
    await act(async () => { await client.refetchQueries(); });
  };
  const refuseSend = async (r: R) => {
    sendRefused = true;
    await fireEvent.changeText(r.getByTestId('space-chat-composer-field'), 'Still here?');
    await fireEvent.press(r.getByTestId('space-chat-composer-send'));
  };

  it.each([['a refused read', 'read'], ['a refused send', 'send']])('the pill showing, then %s: no pill, no list, no row; the closed note and bar', async (_n, how) => {
    const r = await open();
    await pillUp(r);
    if (how === 'read') await refuseRead(); else await refuseSend(r);
    expect(await r.findByTestId('space-chat-no-access')).toBeTruthy();
    expect(r.getByTestId('space-chat-closed-note')).toBeTruthy();
    expect(r.queryByTestId('space-chat-list')).toBeNull();
    expect(r.queryByTestId(/^space-chat-row-/)).toBeNull();
    expect(r.queryByTestId('space-chat-pill')).toBeNull();
    expect(r.queryByTestId('space-chat-composer-field')).toBeNull();
    expect(r.queryByTestId('space-chat-mic')).toBeNull();
  });

  it("closed by a refused send, then another member's message reaches the kept list: no pill, no row, no read mark", async () => {
    const r = await open();
    await r.findByTestId('space-chat-row-a3');
    await see(r, 'a3', 'a2', 'new-line');
    await waitFor(() => expect(readMarks()).toEqual(['c-a:a3']));
    await see(r, 'a2', 'new-line');
    await refuseSend(r);
    expect(await r.findByTestId('space-chat-no-access')).toBeTruthy();
    spaces['c-a'].page = [msg('a6', '2026-10-22T10:40:00.000Z', JO, 'c-a'), ...spaces['c-a'].page];
    await act(async () => { await client.refetchQueries(); });
    await wait(50);
    expect(r.getByTestId('space-chat-no-access')).toBeTruthy();
    expect(r.queryByTestId('space-chat-pill')).toBeNull();
    expect(r.queryByTestId(/^space-chat-row-/)).toBeNull();
    expect(readMarks()).toEqual(['c-a:a3']);
  });

  it('closed by a refused read, then the next read answers again: the open chat, with no pill from before', async () => {
    const r = await open();
    await pillUp(r);
    await refuseRead();
    expect(await r.findByTestId('space-chat-no-access')).toBeTruthy();
    spaces['c-a'].refuse = undefined;
    await act(async () => { await client.refetchQueries(); });
    expect(await r.findByTestId('space-chat-row-a5')).toBeTruthy();
    expect(r.queryByTestId('space-chat-no-access')).toBeNull();
    await wait(50);
    expect(r.queryByTestId('space-chat-pill')).toBeNull();
  });

  it('a read mark that did not land is not tried again once the space is closed', async () => {
    markFails = true;
    const r = await open();
    await r.findByTestId('space-chat-row-a3');
    await see(r, 'a3', 'a2', 'new-line');
    await waitFor(() => expect(readMarks().length).toBeGreaterThan(0));
    await refuseRead();
    expect(await r.findByTestId('space-chat-no-access')).toBeTruthy();
    await wait(50);
    const tried = readMarks().length;
    await act(async () => { await client.refetchQueries(); });
    await r.rerender(tree());
    await wait(50);
    expect(readMarks().length).toBe(tried);
  });
});

describe('FIX-945R4 step 4: one copy of PHOTO_WORD (SpaceReplyQuote photoLine)', () => {
  it('Reply on a photo with no caption reads "Photo"; on one with a caption, its first line', async () => {
    const image = { url: 'https://signed.example/p.jpg', width: 1200, height: 900, expires_at: '2026-10-22T11:00:00.000Z' };
    spaces['c-a'].page = [
      msg('p2', '2026-10-22T10:20:00.000Z', JO, 'c-a', { kind: 'image', body: null, image }),
      msg('p1', '2026-10-22T10:15:00.000Z', JO, 'c-a', { kind: 'image', body: 'Morning walk\nsecond line', image }),
      ...spaces['c-a'].page,
    ];
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    try {
      const r = await open();
      await r.findByTestId('space-chat-row-p2');
      await r.findByTestId('space-chat-composer-field');
      await hold(r, 'p2');
      await pickReply(r);
      expect(within(r.getByLabelText('Replying to jo b.')).getByText('Photo')).toBeTruthy();
      await fireEvent.press(r.getByRole('button', { name: 'Cancel reply' }));
      await hold(r, 'p1');
      await pickReply(r);
      expect(within(r.getByLabelText('Replying to jo b.')).getByText('Morning walk')).toBeTruthy();
    } finally {
      alert.mockRestore();
    }
  });
});
