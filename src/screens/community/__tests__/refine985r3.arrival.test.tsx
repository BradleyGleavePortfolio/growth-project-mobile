/**
 * REFINE-985R3 (fix round 2 on m#985), LO-985R2 B1's class. Two promises:
 *   P-A: a community DM the phone learns of, or can learn of, while that person's thread is mounted is drawn in that
 *        thread without her leaving it, by every way the phone has: the push received, the push tapped, the realtime
 *        ping alone, the app coming back to the front.
 *   P-B: a re-read never takes anything already drawn off the screen: not a conversation, not a kept draft, not the
 *        closed line.
 * A1 is the saved B-TEST (LO985R2.pingOnlyReply.btest.test.tsx); it is not repeated here. The harness is that file's:
 * the real thread, list, hooks, push listener and tap router; the HTTP edge, the realtime edge, expo-notifications and
 * AppState's listeners are stand-ins. Names and ids are fictional.
 */
import React from 'react';
import { AppState } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => mockGet(...a),
    post: (...a: unknown[]) => mockPost(...a),
    patch: (...a: unknown[]) => mockPost(...a),
    put: (...a: unknown[]) => mockPost(...a),
    delete: (...a: unknown[]) => mockPost(...a),
  },
  coachApi: {},
}));
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  const on: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(actual.featureFlags)) on[k] = typeof v === 'boolean' ? true : v;
  return { ...actual, featureFlags: on };
});
const mockTheme = () => {
  const tokens = jest.requireActual('../../../theme/tokens');
  return { colors: jest.requireActual('../../../constants/colors').default, tokens: tokens.default, semanticColors: tokens.lightTokens, colorScheme: 'light', isDark: false };
};
jest.mock('../../../theme/useTheme', () => ({ useTheme: () => mockTheme() }));
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => mockTheme() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => {
  const Icon = () => null;
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});
const mockDisk = new Map<string, string>();
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: {
    getString: (k: string) => mockDisk.get(k),
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
  prefsStorage: { getString: () => undefined },
}));
const mockPings = new Set<(ping?: { event?: string }) => void>();
jest.mock('../../../api/communityRealtime', () => {
  const real: Record<string, unknown> = {
    __esModule: true,
    COMMUNITY_BROADCAST_EVENTS: {
      messageCreated: 'community.message.created', messageUpdated: 'community.message.updated',
      postCreated: 'community.post.created', postUpdated: 'community.post.updated',
      reactionChanged: 'community.reaction.changed', membershipChanged: 'community.membership.changed',
    },
    subscribeToCommunityUser: (_userId: string, cb: (ping?: { event?: string }) => void) => {
      mockPings.add(cb);
      return () => { mockPings.delete(cb); };
    },
  };
  return new Proxy(real, { get: (target, key) => (key in target ? target[key as string] : () => () => undefined) });
});
const mockAddReceived = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: (cb: unknown) => mockAddReceived(cb),
  addNotificationResponseReceivedListener: () => ({ remove: jest.fn() }),
  getLastNotificationResponseAsync: () => Promise.resolve(null),
  clearLastNotificationResponseAsync: () => Promise.resolve(),
  AndroidImportance: { MAX: 5 },
}));
const mockUser = { id: '00000010-0000-4000-8000-000000000000', role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: '00000020-0000-4000-8000-000000000000' };
jest.mock('../../../hooks/useCurrentUser', () => ({
  ...jest.requireActual('../../../hooks/useCurrentUser'),
  useCurrentUser: () => mockUser,
}));
let mockParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), addListener: () => () => undefined, setOptions: () => undefined }),
    useRoute: () => ({ params: mockParams }),
    useFocusEffect: (cb: () => void | (() => void)) => R.useEffect(() => cb(), [cb]),
    useIsFocused: () => true,
  };
});
jest.mock('../../../components/community/SafetyMenu', () => (p: { authorName?: string; testID?: string }) =>
  require('react').createElement(require('react-native').Text, { testID: p.testID }, `menu:${p.authorName}`));

const CommunityDmThreadScreen = require('../CommunityDmThreadScreen').default;
const CommunityDmListScreen = require('../CommunityDmListScreen').default;
const { useCommunityBadge } = require('../../../hooks/useCommunity');
const { queryClient } = require('../../../services/queryClient');
const { attachOpenScreenCheck, foregroundBannerStore } = require('../../../store/foregroundBannerStore');
const { opensOpenScreen } = require('../../../components/ForegroundNotificationBanner');
const { installForegroundHandler, pushTapOf } = require('../../../services/pushNotifications');
const { __resetPushTapRouterForTests, attachPushNavigator, routePushTap, setPushSession } = require('../../../services/pushTapRouter');

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1);
const CLIENT = uuid(10);
const COACH = uuid(20);
const MEMBER_A = uuid(30);
const MEMBER_B = uuid(31);
const CLIENT_TABS = ['Home', 'WorkoutTab', 'Log', 'MoreTab', 'CalendarTab', 'CommunityTab'];
const ME_URL = '/community/me';
const THREADS_URL = `/community/workspaces/${WS}/dms`;
const MSGS_URL = `${THREADS_URL}/${COACH}/messages`;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ME = {
  feature_flag_state: 'enabled', workspace_id: WS,
  membership: { id: uuid(40), role: 'client', notify_level: 'live', dm_enabled_effective: true, last_read_message_at: null, joined_at: ago(86_400_000) },
  unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  flags: { community_api: true, community_dm: true, community_realtime: true, community_push: true, community_telemetry: false },
};
const msg = (n: number, from: string, body: string, ageMs = 60_000) => ({
  id: uuid(n), thread_id: `${WS}:${[CLIENT, COACH].sort().join(':')}`, sender_user_id: from, recipient_user_id: from === CLIENT ? COACH : CLIENT, body, created_at: ago(ageMs), deleted: false,
});
const thread = (other: string, ageMs: number) => ({
  thread_id: `${WS}:${[CLIENT, other].sort().join(':')}`, workspace_id: WS, other_user_id: other, created_at: ago(86_400_000), last_message_at: ago(ageMs),
});
const FIRST = msg(900, COACH, 'See you Monday', 180_000);
const SECOND = msg(899, CLIENT, 'Sounds good', 120_000);
const REPLY = msg(901, COACH, 'Change of plan, Tuesday', 30_000);
const dmPush = (id: string, from = COACH, target = REPLY.id) => ({
  request: { identifier: id, content: { title: 'Direct message', body: 'You have a new direct message.',
    data: { kind: 'community_dm_received', category: 'community', target_type: 'dm', target_id: target, deepLink: `tgp://community/dm/${from}` } } },
});
const reads = (url: string) => mockGet.mock.calls.filter((c) => String(c[0]).split('?')[0] === url).length;
const dmReads = () => mockGet.mock.calls.filter((c) => String(c[0]).split('?')[0].startsWith(THREADS_URL)).length;
const httpError = (status: number, data: Record<string, unknown> = { error: 'x' }) =>
  Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data } });
const offlineError = () => Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });

function Badge(): null {
  useCommunityBadge(CLIENT); // the one realtime subscription, as ClientNavigator mounts it
  return null;
}

/** What the server would answer; a test changes it, then sends the phone a ping, a push or 'active'. */
let server: { messages: unknown[]; threads: unknown[]; fail?: () => Error; hold?: Promise<unknown>; me?: Promise<unknown> };
let focused: { name: string; params?: Record<string, unknown> };
let stopReceived: () => void;
let detachCheck: () => void;
let receive: (n: unknown) => void;
const navigate = jest.fn();
/** AppState's 'change' listeners, as the app's own code added them (react-native's jest AppState keeps none). */
const appListeners: { cb: (state: string) => void; remove: jest.Mock }[] = [];
let appSpy: jest.SpyInstance;
const appState = async (state: string) => { await act(async () => { for (const l of [...appListeners]) l.cb(state); }); };
const ping = async (p?: { event?: string }) => { await act(async () => { for (const cb of [...mockPings]) cb(p); }); };
const settle = async (ms = 60) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

beforeEach(() => {
  server = { messages: [SECOND, FIRST], threads: [thread(MEMBER_A, 3_600_000), thread(MEMBER_B, 7_200_000)] };
  mockParams = { recipientId: COACH };
  focused = { name: 'CommunityDmThread', params: { recipientId: COACH } };
  mockGet.mockReset().mockImplementation(async (url: string) => {
    const key = url.split('?')[0];
    if (key === ME_URL) return server.me ?? { data: ME, headers: {} };
    if (key === '/v1/clients/me/coach') return { data: { id: COACH, name: 'Alex Morgan' }, headers: {} };
    if (key === THREADS_URL) return { data: { threads: server.threads }, headers: {} };
    if (key === MSGS_URL) {
      if (server.hold) await server.hold;
      if (server.fail) throw server.fail();
      return { data: { messages: server.messages }, headers: {} };
    }
    throw httpError(404, { error: 'not_found' });
  });
  mockPost.mockReset().mockResolvedValue({ data: {}, headers: {} });
  queryClient.clear();
  __resetPushTapRouterForTests();
  navigate.mockReset();
  attachPushNavigator({ isReady: () => true, navigate, getRootState: () => ({ routeNames: CLIENT_TABS, routes: [] }) });
  setPushSession({ kind: 'app', userId: CLIENT, role: 'student' });
  detachCheck = attachOpenScreenCheck((p: unknown) => opensOpenScreen({
    isReady: () => true, getCurrentRoute: () => focused, getRootState: () => ({ routeNames: CLIENT_TABS }),
  } as never, p as never));
  appListeners.length = 0;
  appSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((type: string, cb: (state: string) => void) => {
    const remove = jest.fn(() => {
      const i = appListeners.findIndex((l) => l.cb === cb);
      if (i >= 0) appListeners.splice(i, 1);
    });
    if (type === 'change') appListeners.push({ cb, remove });
    return { remove };
  }) as never);
  stopReceived = installForegroundHandler();
  receive = mockAddReceived.mock.calls[mockAddReceived.mock.calls.length - 1][0] as (n: unknown) => void;
});
afterEach(async () => {
  stopReceived();
  detachCheck();
  await act(async () => foregroundBannerStore.getState().reset());
  queryClient.clear();
  appSpy.mockRestore();
});

const wrap = (ui: React.ReactNode) => <QueryClientProvider client={queryClient}><Badge />{ui}</QueryClientProvider>;
async function mountThread() {
  const view = await render(wrap(<CommunityDmThreadScreen />));
  await waitFor(() => expect(view.getByTestId(`dm-message-${FIRST.id}`)).toBeTruthy());
  expect(mockPings.size).toBeGreaterThan(0);
  return view;
}
type View = Awaited<ReturnType<typeof mountThread>>;
const drawn = (view: View, id: string) => view.queryAllByTestId(`dm-message-${id}`).length;

// ─── A. Arrival ──────────────────────────────────────────────────────────────────────────────────────────────────────
describe('A. every way a DM reaches the phone while its thread is open', () => {
  it.each([
    ['no ping body', undefined],
    ['a ping with no event', {}],
    ['a ping with an unknown event', { event: 'community.something.new' }],
  ])('A2 %s: the reply is drawn in the open thread', async (_name, body) => {
    const view = await mountThread();
    server.messages = [REPLY, SECOND, FIRST];
    await ping(body as { event?: string } | undefined);
    await waitFor(() => expect(drawn(view, REPLY.id)).toBe(1), { timeout: 8000 });
    await view.unmount();
  }, 30_000);

  it.each([
    'community.message.updated', 'community.post.created', 'community.post.updated', 'community.reaction.changed',
    'community.membership.changed',
  ])('A3 a ping of another known event (%s) sends no DM read', async (event) => {
    const view = await mountThread();
    const before = dmReads();
    const meBefore = reads(ME_URL);
    server.messages = [REPLY, SECOND, FIRST];
    await ping({ event });
    await waitFor(() => expect(reads(ME_URL)).toBeGreaterThan(meBefore)); // the ping reached the app
    await settle(300);
    expect(dmReads()).toBe(before);
    expect(drawn(view, REPLY.id)).toBe(0);
    await view.unmount();
  }, 30_000);

  it('A4 the app returns to the front with the thread open: the reply is drawn; going behind reads nothing', async () => {
    const view = await mountThread();
    const before = dmReads();
    server.messages = [REPLY, SECOND, FIRST];
    await appState('inactive');
    await appState('background');
    await settle(300);
    expect(dmReads()).toBe(before);
    expect(drawn(view, REPLY.id)).toBe(0);
    await appState('active');
    await waitFor(() => expect(drawn(view, REPLY.id)).toBe(1), { timeout: 8000 });
    expect(reads(MSGS_URL)).toBeGreaterThan(0);
    await view.unmount();
  }, 30_000);

  it('A5 a ping and the return to the front with no DM screen mounted send no DM read at all', async () => {
    const view = await render(wrap(null));
    await waitFor(() => expect(mockPings.size).toBeGreaterThan(0));
    await waitFor(() => expect(reads(ME_URL)).toBeGreaterThan(0));
    await ping({ event: 'community.message.created' });
    await ping();
    await appState('active');
    await settle(300);
    expect(dmReads()).toBe(0);
    await view.unmount();
  }, 30_000);

  it('A6 the list mounted and a ping: the threads read goes out again and the rows take the server\'s order', async () => {
    const [a, b] = server.threads as { thread_id: string }[];
    const view = await render(wrap(<CommunityDmListScreen embedded workspaceId={WS} />));
    await waitFor(() => expect(view.getByTestId(`dm-row-${a.thread_id}`)).toBeTruthy());
    const order = () => view.getAllByTestId(/^dm-row-/).map((n: { props: { testID?: string } }) => n.props.testID)
      .filter((id: string | undefined) => id === `dm-row-${a.thread_id}` || id === `dm-row-${b.thread_id}`);
    expect(order()).toEqual([`dm-row-${a.thread_id}`, `dm-row-${b.thread_id}`]);
    const before = reads(THREADS_URL);
    server.threads = [thread(MEMBER_B, 1000), thread(MEMBER_A, 3_600_000)];
    await ping({ event: 'community.message.created' });
    await waitFor(() => expect(reads(THREADS_URL)).toBe(before + 1), { timeout: 8000 });
    await waitFor(() => expect(order()).toEqual([`dm-row-${b.thread_id}`, `dm-row-${a.thread_id}`]));
    await view.unmount();
  }, 30_000);

  it('A7 the thread open and its DM push tapped: the messages read goes out once more, one navigate, the reply drawn', async () => {
    const view = await mountThread();
    const before = reads(MSGS_URL);
    server.messages = [REPLY, SECOND, FIRST];
    const tap = pushTapOf(dmPush('a7').request.content.data);
    await act(async () => routePushTap(tap.actionScreen, tap.actionParams, 'a7', tap.deepLink));
    await waitFor(() => expect(drawn(view, REPLY.id)).toBe(1), { timeout: 8000 });
    await settle(300);
    expect(reads(MSGS_URL)).toBe(before + 1);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]).toEqual(['CommunityTab', { screen: 'CommunityDmThread', params: { recipientId: COACH }, initial: false }]);
    await view.unmount();
  }, 30_000);

  it('A8 a push of another kind sends no DM read', async () => {
    const view = await mountThread();
    const before = dmReads();
    server.messages = [REPLY, SECOND, FIRST];
    await act(async () => receive({ request: { identifier: 'a8', content: { title: 'Workout ready', body: 'Your coach posted a workout.',
      data: { kind: 'workout_assigned', category: 'training', deepLink: 'tgp://workouts' } } } }));
    await settle(300);
    expect(dmReads()).toBe(before);
    expect(drawn(view, REPLY.id)).toBe(0);
    await view.unmount();
  }, 30_000);

  it('A9 installing the foreground handler twice adds one AppState listener; its cleanup removes it', () => {
    stopReceived(); // beforeEach's install
    const base = appListeners.length;
    const stop = installForegroundHandler();
    expect(appListeners.length).toBe(base + 1);
    const mine = appListeners[appListeners.length - 1];
    const stopAgain = installForegroundHandler();
    expect(appListeners.length).toBe(base + 1);
    stopAgain(); // the second call installed nothing, so it removes nothing
    expect(mine.remove).not.toHaveBeenCalled();
    stop();
    expect(mine.remove).toHaveBeenCalledTimes(1);
    expect(appListeners.length).toBe(base);
    stopReceived = installForegroundHandler(); // afterEach stops this one
  });

  it('A10 a ping before /community/me has answered throws nothing and sends no DM read', async () => {
    let answer: (v: unknown) => void = () => undefined;
    server.me = new Promise((r) => { answer = r; });
    const view = await render(wrap(<CommunityDmThreadScreen />));
    await waitFor(() => expect(mockPings.size).toBeGreaterThan(0));
    await ping({ event: 'community.message.created' });
    await ping();
    await appState('active');
    await settle(200);
    expect(dmReads()).toBe(0);
    expect(view.queryByText('Loading messages…')).not.toBeNull();
    await act(async () => { answer({ data: ME, headers: {} }); });
    await waitFor(() => expect(drawn(view, FIRST.id)).toBe(1), { timeout: 8000 });
    await view.unmount();
  }, 30_000);
});

// ─── B. A re-read that fails (EMPTY-1, P-B) ──────────────────────────────────────────────────────────────────────────
describe('B. a re-read that fails takes nothing off the screen', () => {
  const stillThere = (view: View) => {
    expect(drawn(view, FIRST.id)).toBe(1);
    expect(drawn(view, SECOND.id)).toBe(1);
    expect(view.queryByText('Say hello')).toBeNull();
    expect(view.queryByText('Start the conversation')).toBeNull();
    expect(view.queryByTestId('community-dmthread-empty')).toBeNull();
    expect(view.queryByTestId('community-dmthread-composer')).not.toBeNull();
  };

  it.each([
    ['B1 a ping, the server failing on every try', () => httpError(503), () => ping({ event: 'community.message.created' })],
    ['B2 the return to the front with no signal', () => offlineError(), () => appState('active')],
  ])('%s: the conversation and the box stay, then a good read draws the reply', async (_name, fail, trigger) => {
    const view = await mountThread();
    const before = reads(MSGS_URL);
    server.fail = fail as () => Error;
    await trigger();
    await waitFor(() => expect(reads(MSGS_URL)).toBeGreaterThanOrEqual(before + 3), { timeout: 15_000 }); // every try
    await settle(200);
    stillThere(view);
    server.fail = undefined;
    server.messages = [REPLY, SECOND, FIRST];
    await trigger();
    await waitFor(() => expect(drawn(view, REPLY.id)).toBe(1), { timeout: 8000 });
    stillThere(view);
    await view.unmount();
  }, 40_000);

  it('B3 a thread whose saved answer is empty: a failed re-read keeps "Say hello", never a blank page', async () => {
    server.messages = [];
    const view = await render(wrap(<CommunityDmThreadScreen />));
    await waitFor(() => expect(view.queryByTestId('community-dmthread-empty')).not.toBeNull());
    const before = reads(MSGS_URL);
    server.fail = () => httpError(503);
    await ping({ event: 'community.message.created' });
    await waitFor(() => expect(reads(MSGS_URL)).toBeGreaterThanOrEqual(before + 3), { timeout: 15_000 });
    await settle(200);
    expect(view.queryByText('Say hello')).not.toBeNull();
    expect(view.queryByText('Start the conversation')).not.toBeNull();
    expect(view.queryByTestId('community-dmthread-composer')).not.toBeNull();
    await view.unmount();
  }, 40_000);

  it.each(['community.dm.blocked_by_them', 'community.dm.blocked_by_you'])(
    'B4 a refused thread (%s): a ping and the return to the front send one read each; the closed line stays, no box, no loop',
    async (code) => {
      server.fail = () => httpError(403, { code, error: 'BLOCKED' });
      const view = await render(wrap(<CommunityDmThreadScreen />));
      await waitFor(() => expect(view.queryByTestId('community-dmthread-closed')).not.toBeNull());
      const closedLine = () => {
        expect(view.queryByTestId('community-dmthread-closed')).not.toBeNull();
        expect(view.queryByText('Loading messages…')).toBeNull();
        expect(view.queryByTestId('community-dmthread-composer')).toBeNull();
      };
      for (const trigger of [() => ping({ event: 'community.message.created' }), () => appState('active')]) {
        const before = reads(MSGS_URL);
        let answer: () => void = () => undefined;
        server.hold = new Promise<void>((r) => { answer = r; });
        await trigger();
        await waitFor(() => expect(reads(MSGS_URL)).toBe(before + 1));
        closedLine(); // while the re-read is in flight
        await act(async () => { answer(); });
        server.hold = undefined;
        await settle(1500); // a refusal is final: no second try
        expect(reads(MSGS_URL)).toBe(before + 1);
        closedLine();
      }
      await view.unmount();
    }, 40_000);

  it('B5 a thread that never loaded says so and offers Try again, as before', async () => {
    server.fail = () => httpError(503);
    const view = await render(wrap(<CommunityDmThreadScreen />));
    await waitFor(() => expect(view.queryByText('Messages did not load. Check your connection, then try again.')).not.toBeNull(), { timeout: 15_000 });
    expect(view.queryByTestId('community-dmthread-retry')).not.toBeNull();
    expect(view.queryByText('Say hello')).toBeNull();
    server.fail = undefined;
    await act(async () => { fireEvent.press(view.getByTestId('community-dmthread-retry')); });
    await waitFor(() => expect(drawn(view, FIRST.id)).toBe(1), { timeout: 8000 });
    await view.unmount();
  }, 40_000);
});

// ─── C. Over time ────────────────────────────────────────────────────────────────────────────────────────────────────
describe('C. over time', () => {
  it('C1 five pings at once: the last answer is drawn, nothing doubled', async () => {
    const view = await mountThread();
    const LAST = msg(910, COACH, 'Fifth', 1000);
    await act(async () => {
      for (let i = 0; i < 5; i += 1) {
        server.messages = i === 4 ? [LAST, REPLY, SECOND, FIRST] : [REPLY, SECOND, FIRST];
        for (const cb of [...mockPings]) cb({ event: 'community.message.created' });
      }
    });
    await waitFor(() => expect(drawn(view, LAST.id)).toBe(1), { timeout: 8000 });
    await settle(300);
    for (const m of [LAST, REPLY, SECOND, FIRST]) expect(drawn(view, m.id)).toBe(1);
    await view.unmount();
  }, 30_000);

  it('C2 a ping while her own send is in flight: after both settle the list is the server\'s, her message once, the kept draft untouched', async () => {
    const view = await mountThread();
    let answerPost: (v: unknown) => void = () => undefined;
    const MINE = msg(902, CLIENT, 'On my way', 1000);
    mockPost.mockImplementation((url: string) => (String(url).endsWith('/messages')
      ? new Promise((r) => { answerPost = r; })
      : Promise.resolve({ data: {}, headers: {} })));
    const field = () => view.getByTestId('community-dmthread-composer-field');
    await act(async () => { fireEvent.changeText(field(), 'On my way'); });
    await settle();
    await act(async () => { fireEvent.press(view.getByTestId('community-dmthread-composer-send')); });
    await settle(100);
    await act(async () => { fireEvent.changeText(field(), 'One more thing'); }); // a draft typed while the send is out
    // The server has the coach's reply and not yet her row: the ping's re-read lands inside her send.
    server.messages = [REPLY, SECOND, FIRST];
    await ping({ event: 'community.message.created' });
    await waitFor(() => expect(drawn(view, REPLY.id)).toBe(1), { timeout: 8000 });
    expect((field().props as { value?: string }).value).toBe('One more thing');
    server.messages = [MINE, REPLY, SECOND, FIRST];
    await act(async () => { answerPost({ data: { message: MINE }, headers: {} }); });
    await waitFor(() => expect(drawn(view, MINE.id)).toBe(1), { timeout: 8000 });
    await settle(300);
    for (const m of [MINE, REPLY, SECOND, FIRST]) expect(drawn(view, m.id)).toBe(1);
    expect(view.queryAllByTestId(/^dm-message-optimistic:/).length).toBe(0); // no second copy of her message
    expect((field().props as { value?: string }).value).toBe('One more thing');
    expect(mockPost.mock.calls.filter((c) => String(c[0]).endsWith('/messages')).length).toBe(1);
    await view.unmount();
  }, 30_000);

  it('C3 a ping for another person\'s DM while this thread is open: this thread is unchanged', async () => {
    const view = await mountThread();
    const before = reads(MSGS_URL);
    await ping({ event: 'community.message.created' }); // a ping names no one; this thread's answer is the same
    await waitFor(() => expect(reads(MSGS_URL)).toBe(before + 1), { timeout: 8000 });
    await settle(300);
    expect(drawn(view, FIRST.id)).toBe(1);
    expect(drawn(view, SECOND.id)).toBe(1);
    expect(drawn(view, REPLY.id)).toBe(0);
    expect(view.queryByText('Loading messages…')).toBeNull();
    await view.unmount();
  }, 30_000);
});
