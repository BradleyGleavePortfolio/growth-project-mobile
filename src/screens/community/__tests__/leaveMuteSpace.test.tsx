/**
 * LEAVE-MUTE-M (agent 203; owner D2, #170-1; LEAVE-MUTE-MOCK Style 1, #203-E120): a space's bell and its one menu, Leave
 * and Join again, the left space's view, closed beats left, the "{name} left" line, the membership ping and a second
 * account. Cases L1-L8, L10, L11, L15 of the job text; the server answers are made up (b#1168 CONTRACT 6423745363 shapes).
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
// The realtime channel stands in: the ping handler useCommunityBadge subscribes is kept for L11 to call.
const mockPing: { current: ((p?: { event: string }) => void) | null } = { current: null };
jest.mock('../../../api/communityRealtime', () => ({
  COMMUNITY_BROADCAST_EVENTS: {
    messageCreated: 'community.message.created', messageUpdated: 'community.message.updated', postCreated: 'community.post.created',
    postUpdated: 'community.post.updated', reactionChanged: 'community.reaction.changed', membershipChanged: 'community.membership.changed',
  },
  subscribeToCommunityUser: (_u: string, cb: (p?: { event: string }) => void) => { mockPing.current = cb; return () => { mockPing.current = null; }; },
}));
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
// The app's words for that code (communityErrors.ts BY_CODE), through describeCommunityFailure (R3).
const GONE_LINE = 'This cohort is no longer available. Go back and refresh, or contact your coach.';
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

describe('LEAVE-MUTE-M the space bell and its menu (Style 1)', () => {
  it('L1: a chat space, member: the bell beside the info button, spoken with its state; one menu with the three levels (Mute low priority checked), the three timed mutes and Leave space', async () => {
    const r = await open();
    const bell = await r.findByTestId('space-chat-bell');
    expect(bell.props.accessibilityLabel).toBe(BELL);
    expect(r.getByTestId('space-chat-info')).toBeTruthy();
    const menu = within(await openMenu(r));
    await waitFor(() => expect(menu.getByLabelText('Mute low priority').props.accessibilityState).toEqual(expect.objectContaining({ checked: true })));
    expect(menuLabels(menu)).toEqual(['All messages', 'Mute low priority', 'Mute all', 'Mute for 1 hour', 'Mute for 8 hours', 'Mute for 1 day', 'Leave space']);
    expect(menu.getByLabelText('All messages').props.accessibilityState).toEqual(expect.objectContaining({ checked: false }));
    expect(menu.getByText('Notifications')).toBeTruthy();
    expect(calls('get', '/c-chat/notifications')).toHaveLength(1);
  });

  it.each([
    ['Announcements, member', 'c-ann', 'client', undefined],
    ["the coach in the coach's own space", 'c-chat', 'coach', undefined],
    ['a space whose kind an older server leaves out', 'c-chat', 'client', 'none'],
  ])('L2: %s: the menu has no Leave space (R6)', async (_name, id, role, kind) => {
    mockParams.current = { cohortId: id };
    mockRole = role as string;
    if (kind === 'none') mockKindOf = { 'c-chat': undefined };
    if (id === 'c-ann') notifyAnswer = { ...notify('all'), default_mode: 'all' };
    const r = await open();
    const menu = within(await openMenu(r));
    await waitFor(() => expect(menu.getAllByRole('menuitem').length).toBeGreaterThanOrEqual(6));
    expect(menuLabels(menu)).not.toContain('Leave space');
    expect(menuLabels(menu).slice(0, 3)).toEqual(['All messages', 'Mute low priority', 'Mute all']);
  });

  it('L3: Mute all calls PUT .../notifications once and slashes the bell only after the answer (R3, R5)', async () => {
    const r = await open();
    const answer = deferred<{ data: unknown }>();
    mockApi.put.mockImplementationOnce(() => answer.promise);
    const menu = within(await openMenu(r));
    await waitFor(() => expect(menu.getByLabelText('Mute low priority').props.accessibilityState).toEqual(expect.objectContaining({ checked: true })));
    await fireEvent.press(menu.getByLabelText('Mute all'));
    expect(mockApi.put).toHaveBeenCalledTimes(1);
    expect(mockApi.put).toHaveBeenCalledWith('/community/cohorts/c-chat/notifications', { mode: 'mute_all' });
    // Still the plain bell while the server has not answered; it says it is working and takes no second tap.
    const bell = r.getByTestId('space-chat-bell');
    expect(bell.props.accessibilityLabel).toBe(BELL);
    expect(bell.props.accessibilityState).toEqual(expect.objectContaining({ busy: true }));
    await fireEvent.press(bell);
    expect(r.queryByTestId('space-bell-menu')).toBeNull();
    await act(async () => { answer.resolve({ data: notify('mute_all') }); });
    await waitFor(() => expect(r.getByTestId('space-chat-bell').props.accessibilityLabel).toBe(BELL_MUTED));
    expect(mockApi.put).toHaveBeenCalledTimes(1);
  });

  it('L3: Mute all offline: the failure line says so, nothing is lost silently, the bell stays plain', async () => {
    const r = await open();
    mockApi.put.mockImplementationOnce(async () => { throw offline(); });
    const menu = within(await openMenu(r));
    await waitFor(() => expect(menu.getByLabelText('Mute low priority').props.accessibilityState).toEqual(expect.objectContaining({ checked: true })));
    await fireEvent.press(menu.getByLabelText('Mute all'));
    const toast = await r.findByTestId('space-toast');
    expect(within(toast).getByText(OFFLINE_LINE)).toBeTruthy();
    expect(within(toast).getByText('Try again')).toBeTruthy();
    expect(r.getByTestId('space-chat-bell').props.accessibilityLabel).toBe(BELL);
    // Try again sends the same choice once more.
    await fireEvent.press(within(toast).getByText('Try again'));
    await waitFor(() => expect(r.getByTestId('space-chat-bell').props.accessibilityLabel).toBe(BELL_MUTED));
    expect(mockApi.put).toHaveBeenCalledTimes(2);
    expect(mockApi.put.mock.calls[1]).toEqual(['/community/cohorts/c-chat/notifications', { mode: 'mute_all' }]);
  });

  it('L4: Mute for 8 hours posts the silence; Unmute clears it, and on Mute all also sets the default mode (R4)', async () => {
    const r = await open();
    let menu = within(await openMenu(r));
    await waitFor(() => expect(menu.getByLabelText('Mute for 8 hours')).toBeTruthy());
    await fireEvent.press(menu.getByLabelText('Mute for 8 hours'));
    expect(mockApi.post).toHaveBeenCalledWith('/community/cohorts/c-chat/notifications/silence', { hours: 8 });
    await waitFor(() => expect(r.getByTestId('space-chat-bell').props.accessibilityLabel).toBe(BELL_MUTED));
    menu = within(await openMenu(r));
    expect(menuLabels(menu)[0]).toBe('Unmute');
    expect(menu.getByLabelText('Mute low priority').props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    await fireEvent.press(menu.getByLabelText('Unmute'));
    await waitFor(() => expect(r.getByTestId('space-chat-bell').props.accessibilityLabel).toBe(BELL));
    expect(calls('delete', '/c-chat/notifications/silence')).toHaveLength(1);
    expect(mockApi.put).not.toHaveBeenCalled(); // the chosen mode was not Mute all: it stays

    // On Mute all with a silence running: Unmute clears the silence and sets the default (never a mode she did not pick).
    notifyAnswer = notify('mute_all', { silenced_until: '2026-11-28T00:30:00.000Z' });
    mockApi.delete.mockImplementationOnce(async () => ({ data: notify('mute_all') }));
    await act(async () => { await client.invalidateQueries(); });
    menu = within(await openMenu(r));
    await waitFor(() => expect(menuLabels(menu)[0]).toBe('Unmute'));
    await fireEvent.press(menu.getByLabelText('Unmute'));
    await waitFor(() => expect(mockApi.put).toHaveBeenCalledWith('/community/cohorts/c-chat/notifications', { mode: 'mute_low' }));
    expect(calls('delete', '/c-chat/notifications/silence')).toHaveLength(2);
    await waitFor(() => expect(r.getByTestId('space-chat-bell').props.accessibilityLabel).toBe(BELL));
  });
});

describe('LEAVE-MUTE-M leave, Undo and Join again', () => {
  let alert: jest.SpyInstance;
  beforeEach(() => { alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); });
  afterEach(() => alert.mockRestore());
  const confirmButtons = () => alert.mock.calls[alert.mock.calls.length - 1][2] as Array<{ text: string; style?: string; onPress?: () => void }>;

  it('L5: Leave asks first (LM-10, LM-11, Leave space, Cancel); Cancel calls nothing; Leave posts once and she lands on Home with "You left {space}." and Undo, which joins again', async () => {
    const r = await open();
    let menu = within(await openMenu(r));
    await waitFor(() => expect(menu.getByLabelText('Leave space')).toBeTruthy());
    await fireEvent.press(menu.getByLabelText('Leave space'));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(alert.mock.calls[0][0]).toBe('Leave Morning crew?');
    expect(alert.mock.calls[0][1]).toBe("You'll stop getting its messages and notifications. You can join again from Spaces you left.");
    expect(confirmButtons().map((b) => [b.text, b.style])).toEqual([['Cancel', 'cancel'], ['Leave space', 'destructive']]);
    await act(async () => { confirmButtons()[0].onPress?.(); });
    expect(calls('post', '/leave')).toHaveLength(0);

    menu = within(await openMenu(r));
    await fireEvent.press(menu.getByLabelText('Leave space'));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
    const answer = deferred<{ data: unknown }>();
    mockApi.post.mockImplementationOnce(() => answer.promise);
    await act(async () => { confirmButtons()[1].onPress?.(); });
    expect(calls('post', '/community/cohorts/c-chat/leave')).toHaveLength(1);
    // Nothing moves before the server answers (R3).
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(r.queryByTestId('space-chat-composer-field')).not.toBeNull();
    mockLeft.set('c-chat', '2026-11-27T16:00:00.000Z');
    await act(async () => { answer.resolve({ data: { cohort_id: 'c-chat', left_at: '2026-11-27T16:00:00.000Z' } }); });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('CommunityTab'));
    expect(calls('post', '/leave')).toHaveLength(1);

    // Home's toast: LM-12 with Undo; Undo posts join once.
    const toastMod = maybe(() => require('../../../components/community/space-chat/SpaceToast'));
    expect(toastMod?.SpaceLeftToastHost).toBeTruthy();
    const Host = toastMod?.SpaceLeftToastHost as React.ComponentType;
    const home = await render(<QueryClientProvider client={client}><Host /></QueryClientProvider>);
    const toast = await home.findByTestId('space-left-toast');
    expect(within(toast).getByText('You left Morning crew.')).toBeTruthy();
    await fireEvent.press(within(toast).getByText('Undo'));
    await waitFor(() => expect(calls('post', '/community/cohorts/c-chat/join')).toHaveLength(1));
    await waitFor(() => expect(home.queryByTestId('space-left-toast')).toBeNull());
  });

  it.each([
    ['409 community.space.cannot_leave', () => fail(409, 'community.space.cannot_leave'), CHANGED_LINE],
    ['404 community.cohort.not_found', () => fail(404, 'community.cohort.not_found'), GONE_LINE],
    ['offline', offline, OFFLINE_LINE],
  ])('L6: a leave refused (%s) says so and leaves the space as it was', async (_n, error, line) => {
    const r = await open();
    const menu = within(await openMenu(r));
    await waitFor(() => expect(menu.getByLabelText('Leave space')).toBeTruthy());
    await fireEvent.press(menu.getByLabelText('Leave space'));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    mockApi.post.mockImplementationOnce(async () => { throw error(); });
    await act(async () => { confirmButtons()[1].onPress?.(); });
    const toast = await r.findByTestId('space-toast');
    expect(within(toast).getByText(line)).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(r.queryByTestId('space-chat-left')).toBeNull();
    expect(r.queryByTestId('space-chat-composer-field')).not.toBeNull();
    expect(r.getByTestId('space-chat-bell')).toBeTruthy();
  });

  it('L7: a left space opened from the tree: its rows, the band with LM-14 and Join again where the box was, no box and no bell; Join again posts once and the box comes back after the answer', async () => {
    mockLeft.set('c-chat', '2026-11-27T16:00:00.000Z');
    const r = await open();
    const band = await r.findByTestId('space-chat-left');
    expect(within(band).getByText('You left this space.')).toBeTruthy();
    expect(r.getByText('body m1', HIDDEN)).toBeTruthy();
    expect(r.getByText('Morning crew')).toBeTruthy();
    expect(r.getByText('13 members')).toBeTruthy();
    expect(r.queryByTestId('space-chat-composer-field')).toBeNull();
    expect(r.queryByTestId('space-chat-bell')).toBeNull();
    expect(calls('get', '/c-chat/notifications')).toHaveLength(0);
    const answer = deferred<{ data: unknown }>();
    mockApi.post.mockImplementationOnce((url: string) => { expect(url).toBe('/community/cohorts/c-chat/join'); return answer.promise; });
    const join = within(band).getByText('Join again');
    await fireEvent.press(join);
    await fireEvent.press(within(r.getByTestId('space-chat-left')).getByTestId('space-chat-join'));
    expect(calls('post', '/join')).toHaveLength(1);
    expect(r.getByTestId('space-chat-join').props.accessibilityState).toEqual(expect.objectContaining({ busy: true }));
    expect(r.queryByTestId('space-chat-composer-field')).toBeNull();
    mockLeft.delete('c-chat');
    await act(async () => { answer.resolve({ data: { cohort_id: 'c-chat', left_at: null } }); });
    await waitFor(() => expect(r.queryByTestId('space-chat-composer-field')).not.toBeNull());
    expect(r.queryByTestId('space-chat-left')).toBeNull();
    expect(calls('post', '/join')).toHaveLength(1);
  });

  it('L8: a left space the server now refuses (404 on the read): the closed band, not the left band (closed beats left)', async () => {
    mockLeft.set('c-chat', '2026-11-27T16:00:00.000Z');
    readNoAccess = true;
    const r = await open();
    await r.findByTestId('space-chat-no-access');
    expect(r.queryByTestId('space-chat-left')).toBeNull();
    expect(r.queryByText('Join again')).toBeNull();
    expect(r.queryByTestId('space-chat-bell')).toBeNull();
    expect(r.queryByTestId('space-chat-composer-field')).toBeNull();
  });
});

describe('LEAVE-MUTE-M "{name} left" (D2d op 2)', () => {
  it('L10: the lines from GET .../left sit between messages by time, in range only; a block takes the line of that person at once; a rejoin keeps it', async () => {
    leftAnswer = { 'c-chat': [
      { user_id: 'u-old', name: 'Ben Cole', left_at: '2026-11-20T09:00:00.000Z' }, // before the loaded range (older pages)
      { user_id: 'u-riley', name: 'Riley Park', left_at: '2026-11-27T15:10:00.000Z' },
      { user_id: 'u-jo', name: 'Jo Lane', left_at: '2026-11-27T14:50:00.000Z' },
    ] };
    mockApi.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/read')) return { data: { last_read_at: null, last_read_message_id: null } };
      if (url.endsWith('/notifications')) return { data: notifyAnswer };
      if (url.endsWith('/threads')) return { data: { cohort_id: 'c-chat', threads: [] } };
      if (url.endsWith('/left')) return { data: { cohort_id: 'c-chat', left: leftAnswer['c-chat'] } };
      return { data: { messages: page, next_before: 'older-page' } };
    });
    const r = await open();
    await r.findByText('Riley Park left');
    expect(r.getByText('Jo Lane left')).toBeTruthy();
    expect(r.queryByText('Ben Cole left')).toBeNull(); // out of the loaded range (R9)
    const keys = (r.getByTestId('space-chat-list').props.data as Array<{ key: string }>).map((i) => i.key).reverse();
    const at = (k: string) => keys.indexOf(k);
    expect(at('m1')).toBeLessThan(at('left-u-jo-2026-11-27T14:50:00.000Z'));
    expect(at('left-u-jo-2026-11-27T14:50:00.000Z')).toBeLessThan(at('m2'));
    expect(at('m2')).toBeLessThan(at('left-u-riley-2026-11-27T15:10:00.000Z'));
    expect(at('left-u-riley-2026-11-27T15:10:00.000Z')).toBeLessThan(at('m3'));
    // A rejoin keeps the line (the server keeps the row): Riley's new message follows it.
    page = [msg('m4', '2026-11-27T15:40:00.000Z', RILEY), ...page];
    await act(async () => { await client.invalidateQueries(); });
    await r.findByText('body m4', HIDDEN);
    expect(r.getByText('Riley Park left')).toBeTruthy();
    // A block of Riley (the row's menu): her rows and her line go at once, before any read.
    mockApi.get.mockImplementation(() => new Promise(() => undefined));
    await fireEvent.press(r.getByTestId('space-chat-menu-m2'));
    await waitFor(() => expect(r.queryByText('Riley Park left')).toBeNull());
    expect(r.queryByText('body m2', HIDDEN)).toBeNull();
    expect(r.getByText('Jo Lane left')).toBeTruthy();
  });

  it('L10: her own leave on her other phone: her own name on the line and the left band', async () => {
    mockLeft.set('c-chat', '2026-11-27T15:20:00.000Z');
    leftAnswer = { 'c-chat': [{ user_id: 'me-1', name: 'Dana Reyes', left_at: '2026-11-27T15:20:00.000Z' }] };
    const r = await open();
    await r.findByText('Dana Reyes left');
    expect(r.getByTestId('space-chat-left')).toBeTruthy();
  });
});

describe('LEAVE-MUTE-M the membership ping (onCommunityPing)', () => {
  const mount = async () => {
    const real = jest.requireActual('../../../hooks/useCommunity') as { useCommunityBadge: (u: string) => unknown };
    const Badge = () => { real.useCommunityBadge('me-1'); return null; };
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = jest.spyOn(client, 'invalidateQueries');
    await render(<QueryClientProvider client={client}><Badge /></QueryClientProvider>);
    await waitFor(() => expect(mockPing.current).toBeTruthy());
    spy.mockClear();
    return spy;
  };
  const keysOf = (spy: jest.SpyInstance) => spy.mock.calls.map(([f]) => JSON.stringify((f as { queryKey?: unknown })?.queryKey ?? null));

  it('L11: community.membership.changed re-reads the space list and the open space\'s left list, once each', async () => {
    const spy = await mount();
    await act(async () => { mockPing.current?.({ event: 'community.membership.changed' }); });
    const keys = keysOf(spy);
    expect(keys.filter((k) => k === JSON.stringify(['community', 'cohorts']))).toHaveLength(1);
    expect(keys.filter((k) => k === JSON.stringify(['community', 'space-left']))).toHaveLength(1);
    expect(keys.filter((k) => k === JSON.stringify(['community', 'me']))).toHaveLength(1);
  });

  it.each(['community.message.created', 'community.post.updated', 'community.reaction.changed'])('L11 (green at both): %s re-reads neither the space list nor a left list', async (event) => {
    const spy = await mount();
    await act(async () => { mockPing.current?.({ event }); });
    const keys = keysOf(spy);
    expect(keys).toContain(JSON.stringify(['community', 'me']));
    expect(keys.filter((k) => k === JSON.stringify(['community', 'cohorts']) || k.startsWith('["community","space-left"'))).toHaveLength(0);
  });
});

describe('LEAVE-MUTE-M a second account (KT-13)', () => {
  it('L15: sign out and in as another member: no notification setting, left list or left space of the first account is shown', async () => {
    mockLeft.set('c-chat', '2026-11-27T16:00:00.000Z');
    leftAnswer = { 'c-chat': [{ user_id: 'me-1', name: 'Dana Reyes', left_at: '2026-11-27T16:00:00.000Z' }] };
    const r = await open();
    await r.findByText('Dana Reyes left');
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey as unknown[]).filter((k) => k[1] === 'space-left' || k[1] === 'space-notify' || k[1] === 'space-threads');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k[2] === 'me-1')).toBe(true);
    expect(client.getQueryCache().getAll().filter((q) => ['space-left', 'space-notify', 'space-threads'].includes(String((q.queryKey as unknown[])[1])))
      .every((q) => q.meta?.persist === false)).toBe(true);
    await r.unmount();
    // The next person: the sign-out clears the client (queryClient.ts); her own keys never hold the first one's rows.
    authEvents.emit('logout');
    client.clear();
    mockUser = { id: 'me-2', name: 'Lee Park', coach_id: 'coach-1' };
    mockLeft.clear();
    leftAnswer = {};
    const second = await render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
    await second.findByText('body m1', HIDDEN);
    expect(second.queryByText('Dana Reyes left')).toBeNull();
    expect(second.queryByTestId('space-chat-left')).toBeNull();
    expect(client.getQueryCache().getAll().map((q) => q.queryKey as unknown[]).filter((k) => k[2] === 'me-1')).toHaveLength(0);
  });
});

// LEAVE-MUTE-M r2, from the renders (GOAL vs BUILT against the owner's pick, Style 1): a failed action's toast puts its
// words over Try again (s1_L11), as the GOAL frame draws it.
describe('LEAVE-MUTE-M renders r2: the failure toast as Style 1 draws it', () => {
  it('s1_L11: a failed action\'s toast stacks its words over Try again', async () => {
    const r = await open();
    mockApi.put.mockImplementationOnce(async () => { throw offline(); });
    const menu = within(await openMenu(r));
    await waitFor(() => expect(menu.getByLabelText('Mute low priority').props.accessibilityState).toEqual(expect.objectContaining({ checked: true })));
    await fireEvent.press(menu.getByLabelText('Mute all'));
    const toast = await r.findByTestId('space-toast');
    const stack = within(toast).getByTestId('space-toast-stack');
    expect(within(stack).getByText(OFFLINE_LINE)).toBeTruthy();
    expect(within(stack).getByText('Try again')).toBeTruthy();
  });
});
