/**
 * LEAVE-MUTE-M (agent 203; owner D2b, #170-1; LEAVE-MUTE-MOCK Style 1, #203-E120): Mute thread and Leave thread in the
 * press-and-hold sheet (on a thread's first message, the owner's default), the Muted mark and its toast with Undo, and a
 * left thread's later replies folded into "{n} replies since you left", opened on a tap, followed again by Follow thread
 * or by a reply of her own. Cases L12-L14 of the job text; the server answers are made up (b#1168 shapes).
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
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
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { communitySpaceChat: true, communityVoiceNotes: false } }));
const mockParams: { current: Record<string, unknown> } = { current: { cohortId: 'c-chat' } };
const mockNavigate = jest.fn();
const mockStack = { routes: ['CommunityTab', 'CommunitySpaceChat'] };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), getState: () => ({ routeNames: mockStack.routes }) }),
  useRoute: () => ({ params: mockParams.current }),
  useIsFocused: () => true,
}));
jest.mock('../../../components/community/SpaceDrawer', () => {
  const { Text } = jest.requireActual('react-native');
  return { SpaceListButton: ({ label, testID = 'space-list-open' }: { label?: string; testID?: string }) => <Text testID={testID} accessibilityLabel={label ?? 'Open space list'}>{label ?? 'list'}</Text> };
});
let mockUser = { id: 'me-1', name: 'Dana Reyes', coach_id: 'coach-1' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
const mockInsets = { top: 47, right: 0, bottom: 34, left: 0 };
jest.mock('react-native-safe-area-context', () => {
  const { createContext, createElement } = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style, testID }: { children?: unknown; style?: unknown; testID?: string }) => createElement(View, { style, testID }, children),
    SafeAreaInsetsContext: createContext(mockInsets),
    useSafeAreaInsets: () => mockInsets,
  };
});
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: null }),
  isEffectivelyOnline: jest.requireActual('../../../hooks/useNetworkStatus').isEffectivelyOnline,
}));
// The space list as the server answers ?include_left=1: a row carries left_at once she left it (b#1168).
let mockRole = 'client';
const mockLeft = new Map<string, string>();
let mockKindOf: Record<string, string | undefined> = {};
const mockRows = () => [
  { id: 'c-chat', workspace_id: 'ws', name: 'Morning crew', is_default: false, kind: 'c-chat' in mockKindOf ? mockKindOf['c-chat'] : 'chat', member_count: mockLeft.has('c-chat') ? 13 : 14, my_role: mockRole, left_at: mockLeft.get('c-chat') ?? null },
  { id: 'c-ann', workspace_id: 'ws', name: 'Announcements', is_default: false, kind: 'announcement', posting_policy: 'coach', member_count: 24, my_role: mockRole, left_at: null },
].map((c) => (c.kind === undefined ? (({ kind: _k, ...rest }) => rest)(c) : c));
jest.mock('../../../hooks/useCommunity', () => {
  const { useQuery } = jest.requireActual('@tanstack/react-query');
  return {
    useCommunityCohorts: () => useQuery({ queryKey: ['community', 'cohorts'], queryFn: async () => ({ feature_flag_state: 'on', cohorts: mockRows() }) }),
    useCommunityMe: () => ({ dataUpdatedAt: 0 }),
    communityKeys: { cohorts: () => ['community', 'cohorts'], me: () => ['community', 'me'] },
  };
});
jest.mock('../../../components/community/SafetyMenu', () => {
  const { Text } = jest.requireActual('react-native');
  return (p: { testID: string; authorUserId: string; onBlocked?: (id: string) => void }) => (
    <Text testID={p.testID} accessibilityLabel="Report or block" onPress={() => p.onBlocked?.(p.authorUserId)}>menu</Text>
  );
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
const mockApi = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
jest.mock('../../../services/api', () => ({ __esModule: true, default: mockApi }));

const Screen = require('../CommunitySpaceChatScreen').default;
/** A module this job adds: null where it does not exist yet (the base), so each case fails on its own. */
const maybe = (load: () => unknown): Record<string, unknown> | null => { try { return load() as Record<string, unknown>; } catch { return null; } };

const msg = (id: string, at: string, who: { id: string; name: string; is_coach?: boolean }, extra: Record<string, unknown> = {}) => ({
  id, cohort_id: 'c-chat', sender_user_id: who.id, body: `body ${id}`, kind: 'text', created_at: at, deleted: false,
  parent_message_id: null, voice_note: null, sender: { id: who.id, name: who.name, avatar_url: null, is_coach: !!who.is_coach }, ...extra,
});
const COACH = { id: 'coach-1', name: 'Sam Carter', is_coach: true };
const MAYA = { id: 'u-maya', name: 'Maya Ortiz' };
const RILEY = { id: 'u-riley', name: 'Riley Park' };
const fail = (status: number, code?: string) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data: code ? { code } : {} } });
const offline = () => Object.assign(new Error('Network Error'), { isAxiosError: true });
const HIDDEN = { includeHiddenElements: true };
const OFFLINE_LINE = 'You appear to be offline. Check your connection, then try again.';
const CHANGED_LINE = 'This changed while you were looking at it. Refresh, then try again.';
const GONE_LINE = 'This is no longer available. It may have been removed or hidden. Go back and refresh.';
const notify = (mode: string, extra: Record<string, unknown> = {}) => ({ mode, default_mode: 'mute_low', effective_mode: mode, silenced_until: null, ...extra });
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

let page: unknown[] = [];
let readNoAccess = false;
let notifyAnswer: unknown = notify('mute_low');
let leftAnswer: Record<string, unknown[]> = {};
const calls = (verb: 'get' | 'post' | 'put' | 'delete', end: string) => mockApi[verb].mock.calls.filter(([u]) => String(u).endsWith(end));

beforeEach(() => {
  authEvents.emit('logout');
  mockDisk.clear();
  (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store.set('supabase_token', 'tok-me-1');
  mockStack.routes = ['CommunityTab', 'CommunitySpaceChat'];
  mockNavigate.mockReset();
  mockRole = 'client';
  mockLeft.clear();
  mockKindOf = {};
  mockUser = { id: 'me-1', name: 'Dana Reyes', coach_id: 'coach-1' };
  mockParams.current = { cohortId: 'c-chat' };
  readNoAccess = false;
  notifyAnswer = notify('mute_low');
  leftAnswer = {};
  page = [
    msg('m3', '2026-11-27T15:30:00.000Z', COACH),
    msg('m2', '2026-11-27T15:02:00.000Z', RILEY),
    msg('m1', '2026-11-27T14:48:00.000Z', MAYA),
  ];
  mockApi.get.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/read')) return { data: { last_read_at: null, last_read_message_id: null } };
    if (url.endsWith('/notifications')) return { data: notifyAnswer };
    if (url.endsWith('/threads')) return { data: { cohort_id: 'c-chat', threads: [] } };
    if (url.endsWith('/left')) {
      const id = String(url).split('/')[3];
      if (readNoAccess) throw fail(404, 'community.cohort.not_found');
      return { data: { cohort_id: id, left: leftAnswer[id] ?? [] } };
    }
    if (url.endsWith('/messages')) {
      if (readNoAccess) throw fail(404, 'community.cohort.not_found');
      return { data: { messages: page, next_before: null } };
    }
    return { data: {} };
  });
  mockApi.post.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/read')) return { data: { ok: true } };
    if (url.endsWith('/leave')) { mockLeft.set('c-chat', '2026-11-27T16:00:00.000Z'); return { data: { cohort_id: 'c-chat', left_at: '2026-11-27T16:00:00.000Z' } }; }
    if (url.endsWith('/join')) { const id = String(url).split('/')[3]; mockLeft.delete(id); return { data: { cohort_id: id, left_at: null } }; }
    if (url.endsWith('/notifications/silence')) return { data: notify('mute_low', { effective_mode: 'mute_all', silenced_until: '2026-11-28T00:30:00.000Z' }) };
    return { data: {} };
  });
  mockApi.put.mockReset().mockImplementation(async (_url: string, body: { mode: string }) => ({ data: notify(body.mode) }));
  mockApi.delete.mockReset().mockImplementation(async () => ({ data: notify('mute_low') }));
});

let client: QueryClient;
const open = async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = await render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
  await waitFor(() => expect(r.queryByTestId('space-chat-loading')).toBeNull());
  return r;
};
afterEach(() => client?.clear());
const openMenu = async (r: Awaited<ReturnType<typeof open>>) => {
  await fireEvent.press(await r.findByTestId('space-chat-bell'));
  return r.findByTestId('space-bell-menu');
};
const menuLabels = (menu: ReturnType<typeof within>) => menu.getAllByRole('menuitem').map((b) => b.props.accessibilityLabel);
const BELL = 'Notifications for this space';
const BELL_MUTED = 'Notifications for this space, muted';


type R = Awaited<ReturnType<typeof open>>;
const BEN = { id: 'u-ben', name: 'Ben Cole' };
const ME = { id: 'me-1', name: 'Dana Reyes' };
const quoteOf = (id: string) => ({ id, gone: false, kind: 'text', sender_name: 'Maya Ortiz', snippet: `body ${id}`, voice_duration_ms: null });
let threadStates: Array<{ thread_message_id: string; state: 'muted' | 'left'; since: string }> = [];
const thread = () => [
  msg('m5', '2026-11-27T15:30:00.000Z', COACH),
  msg('m4', '2026-11-27T15:02:00.000Z', RILEY, { parent_message_id: 'm1', parent: quoteOf('m1') }),
  msg('m3', '2026-11-27T14:55:00.000Z', BEN, { parent_message_id: 'm1', parent: quoteOf('m1') }),
  msg('m2', '2026-11-27T14:52:00.000Z', BEN, { parent_message_id: 'm1', parent: quoteOf('m1') }),
  msg('m1', '2026-11-27T14:48:00.000Z', MAYA),
  msg('m0', '2026-11-27T14:40:00.000Z', COACH),
];
beforeEach(() => {
  threadStates = [];
  page = thread();
  const get = mockApi.get.getMockImplementation() as (url: string) => Promise<unknown>;
  mockApi.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/threads')) return { data: { cohort_id: 'c-chat', threads: threadStates } };
    return get(url);
  });
  mockApi.put.mockImplementation(async (url: string) => {
    const [id, verb] = String(url).split('/').slice(5);
    const state = verb === 'mute' ? 'muted' : 'left';
    return { data: { thread_message_id: id, state, since: '2026-11-27T15:00:00.000Z' } };
  });
  mockApi.delete.mockImplementation(async () => ({ data: '' }));
});
const hold = async (r: R, id: string) => { await fireEvent(r.getByTestId(`space-chat-row-${id}`), 'longPress'); };
const dismissOf = (r: R) => {
  let node = r.getByTestId('space-chat-sheet') as unknown as { props: Record<string, unknown>; parent: unknown } | null;
  while (node && typeof node.props.onDismiss !== 'function') node = node.parent as typeof node;
  if (!node) throw new Error('no Modal onDismiss');
  return node.props.onDismiss as () => void;
};
const pick = async (r: R, id: string) => {
  const dismiss = dismissOf(r);
  await fireEvent.press(r.getByTestId(`space-chat-sheet-${id}`));
  await act(async () => { dismiss(); });
};
const sheetRows = (r: R) => within(r.getByTestId('space-chat-sheet')).getAllByRole('button').map((b) => b.props.accessibilityLabel);
const keysOf = (r: R) => (r.getByTestId('space-chat-list').props.data as Array<{ key: string }>).map((i) => i.key).reverse();

describe('LEAVE-MUTE-M thread rows in the hold sheet (D2b, Style 1)', () => {
  it('L12: on a thread\'s first message: Reply, Copy, Mute thread, Leave thread, Cancel; on a reply: no thread rows (the owner\'s default)', async () => {
    const r = await open();
    await r.findByTestId('space-chat-row-m1');
    await hold(r, 'm1');
    expect(sheetRows(r)).toEqual(['Reply', 'Copy', 'Mute thread', 'Leave thread', 'Cancel']);
    await pick(r, 'cancel');
    await hold(r, 'm3');
    expect(sheetRows(r)).not.toContain('Mute thread');
    expect(sheetRows(r)).not.toContain('Leave thread');
  });

  it.each([
    ['Mute thread', 'mute-thread', [], 'put', '/community/cohorts/c-chat/threads/m1/mute'],
    ['Leave thread', 'leave-thread', [], 'put', '/community/cohorts/c-chat/threads/m1/leave'],
    ['Unmute thread', 'unmute-thread', [{ thread_message_id: 'm1', state: 'muted', since: '2026-11-27T14:50:00.000Z' }], 'delete', '/community/cohorts/c-chat/threads/m1/mute'],
    ['Follow thread', 'follow-thread', [{ thread_message_id: 'm1', state: 'left', since: '2026-11-27T14:50:00.000Z' }], 'delete', '/community/cohorts/c-chat/threads/m1/leave'],
  ] as const)('L12: %s calls its route once with the first message\'s id', async (label, id, states, verb, url) => {
    threadStates = [...states] as typeof threadStates;
    const r = await open();
    await r.findByTestId('space-chat-row-m1');
    await waitFor(() => expect(calls('get', '/threads').length).toBeGreaterThan(0));
    await hold(r, 'm1');
    await waitFor(() => expect(sheetRows(r)).toContain(label));
    await pick(r, id);
    await waitFor(() => expect(mockApi[verb]).toHaveBeenCalledTimes(1));
    expect(mockApi[verb].mock.calls[0][0]).toBe(url);
  });

  it('L12: a muted thread offers Unmute thread and Leave thread; a left one Mute thread and Follow thread', async () => {
    threadStates = [{ thread_message_id: 'm1', state: 'muted', since: '2026-11-27T14:50:00.000Z' }];
    let r = await open();
    await r.findByTestId('space-chat-row-m1');
    await hold(r, 'm1');
    await waitFor(() => expect(sheetRows(r)).toEqual(['Reply', 'Copy', 'Unmute thread', 'Leave thread', 'Cancel']));
    await r.unmount();
    client.clear();
    threadStates = [{ thread_message_id: 'm1', state: 'left', since: '2026-11-27T14:50:00.000Z' }];
    r = await open();
    await r.findByTestId('space-chat-row-m1');
    await hold(r, 'm1');
    await waitFor(() => expect(sheetRows(r)).toEqual(['Reply', 'Copy', 'Mute thread', 'Follow thread', 'Cancel']));
  });

  it('L12: no thread rows in a left space', async () => {
    mockLeft.set('c-chat', '2026-11-27T16:00:00.000Z');
    const r = await open();
    await r.findByTestId('space-chat-left');
    await hold(r, 'm1');
    expect(r.queryByTestId('space-chat-sheet-mute-thread')).toBeNull();
    expect(r.queryByTestId('space-chat-sheet-leave-thread')).toBeNull();
  });
});

describe('LEAVE-MUTE-M the Muted mark (LM-05, LM-06, LM-07)', () => {
  it('L13: after the server answers Mute thread: the mark under the first message, spoken "Thread muted", and the toast "Thread muted." with Undo (which unmutes)', async () => {
    const r = await open();
    await r.findByTestId('space-chat-row-m1');
    const answer = deferred<{ data: unknown }>();
    mockApi.put.mockImplementationOnce(() => answer.promise);
    await hold(r, 'm1');
    await pick(r, 'mute-thread');
    expect(r.queryByTestId('space-muted-m1')).toBeNull(); // nothing before the answer (R3)
    await act(async () => { answer.resolve({ data: { thread_message_id: 'm1', state: 'muted', since: '2026-11-27T15:00:00.000Z' } }); });
    const mark = await r.findByTestId('space-muted-m1');
    expect(mark.props.accessibilityLabel).toBe('Thread muted');
    expect(within(mark).getByText('Muted')).toBeTruthy();
    expect(keysOf(r).indexOf('mark-m1')).toBe(keysOf(r).indexOf('m1') + 1);
    const toast = await r.findByTestId('space-toast');
    expect(within(toast).getByText('Thread muted.')).toBeTruthy();
    // The replies stay in the stream.
    expect(r.getByText('body m3', HIDDEN)).toBeTruthy();
    await fireEvent.press(within(toast).getByText('Undo'));
    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/community/cohorts/c-chat/threads/m1/mute'));
    await waitFor(() => expect(r.queryByTestId('space-muted-m1')).toBeNull());
  });

  it('L13: a mute refused offline: no mark, the failure line', async () => {
    const r = await open();
    await r.findByTestId('space-chat-row-m1');
    mockApi.put.mockImplementationOnce(async () => { throw offline(); });
    await hold(r, 'm1');
    await pick(r, 'mute-thread');
    const toast = await r.findByTestId('space-toast');
    expect(within(toast).getByText(OFFLINE_LINE)).toBeTruthy();
    expect(r.queryByTestId('space-muted-m1')).toBeNull();
  });
});

describe('LEAVE-MUTE-M the fold of a left thread (LM-08)', () => {
  const LEFT = [{ thread_message_id: 'm1', state: 'left' as const, since: '2026-11-27T14:53:00.000Z' }];

  it('L14: the replies after `since` fold into one line with the loaded count where the first would be; earlier replies stay', async () => {
    threadStates = LEFT;
    const r = await open();
    const fold = await r.findByTestId('space-fold-m1');
    expect(within(fold).getByText('2 replies since you left')).toBeTruthy();
    expect(r.getByText('body m2', HIDDEN)).toBeTruthy(); // before she left the thread
    expect(r.queryByText('body m3', HIDDEN)).toBeNull();
    expect(r.queryByText('body m4', HIDDEN)).toBeNull();
    expect(r.getByText('body m5', HIDDEN)).toBeTruthy(); // not in the thread
    const keys = keysOf(r);
    expect(keys.indexOf('fold-m1')).toBe(keys.indexOf('m2') + 1);
  });

  it('L14: tapping the line opens the replies under it with Follow thread under them; Follow thread unfolds for good after the answer', async () => {
    threadStates = LEFT;
    const r = await open();
    await fireEvent.press(await r.findByTestId('space-fold-m1'));
    // The line stays above the opened replies (s1_L10b), said as open.
    expect(r.getByTestId('space-fold-m1').props.accessibilityState).toEqual(expect.objectContaining({ expanded: true }));
    expect(keysOf(r).indexOf('fold-m1')).toBe(keysOf(r).indexOf('m3') - 1);
    expect(r.getByText('body m3', HIDDEN)).toBeTruthy();
    expect(r.getByText('body m4', HIDDEN)).toBeTruthy();
    const keys = keysOf(r);
    expect(keys.indexOf('follow-m1')).toBe(keys.indexOf('m4') + 1);
    const answer = deferred<{ data: unknown }>();
    mockApi.delete.mockImplementationOnce(() => answer.promise);
    await fireEvent.press(r.getByTestId('space-follow-m1'));
    await fireEvent.press(r.getByTestId('space-follow-m1'));
    expect(mockApi.delete).toHaveBeenCalledTimes(1);
    expect(mockApi.delete).toHaveBeenCalledWith('/community/cohorts/c-chat/threads/m1/leave');
    threadStates = [];
    await act(async () => { answer.resolve({ data: '' }); });
    await waitFor(() => expect(r.queryByTestId('space-follow-m1')).toBeNull());
    expect(r.queryByTestId('space-fold-m1')).toBeNull();
    expect(r.getByText('body m4', HIDDEN)).toBeTruthy();
  });

  it('L14: a reply of her own follows the thread again on the server: no fold after the next read', async () => {
    threadStates = LEFT;
    const r = await open();
    await r.findByTestId('space-fold-m1');
    // The server answers her reply and drops the thread's state (b#1168 trigger); the next read has no fold.
    threadStates = [];
    page = [msg('m6', '2026-11-27T15:40:00.000Z', ME, { parent_message_id: 'm1', parent: quoteOf('m1') }), ...thread()];
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(() => expect(r.queryByTestId('space-fold-m1')).toBeNull());
    expect(r.getByText('body m4', HIDDEN)).toBeTruthy();
    expect(r.getByText('body m6', HIDDEN)).toBeTruthy();
  });

  it('L14: the states survive a refetch of the stream', async () => {
    threadStates = LEFT;
    const r = await open();
    await r.findByTestId('space-fold-m1');
    await act(async () => { await client.invalidateQueries({ queryKey: ['community', 'space-chat'] }); });
    await waitFor(() => expect(calls('get', '/messages').length).toBeGreaterThan(1));
    expect(r.getByTestId('space-fold-m1')).toBeTruthy();
  });
});
