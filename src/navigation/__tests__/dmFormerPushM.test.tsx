/**
 * DM-FORMER-PUSH-M (the operator's call, two-way, undo "push tap v1.1"; owner ALM-P1 Style 3, ALM-D5 op 1, #ALM-E12):
 * a former coach's message notification (the lock-screen tap, a cold start, the in-app slip, the notification list's
 * row) and its tgp://community/dm link open that coach's thread for a client with no coach too: the locked Community
 * page finishes the tap through its own card's step and spends it.
 * Real: a NavigationContainer the real router is attached to, a bottom-tab navigator with ClientNavigator's tab names
 * (Home a probe; CommunityTab the real CommunityNavigator: CoachOnlyGate, the locked page, the real CommunityTermsGate,
 * the native stack, CommunityDmThreadScreen and the FormerCoach parts), pushNotifications, pushTapRouter, incomingLinks,
 * ForegroundNotificationBanner and its store, routeNotification and routeAppLink, communityApi and the react-query
 * hooks. Stood in: HTTP, realtime, the signed-in client, the terms record, messageCoach, the theme, icons, the safety
 * menus, expo-notifications at its edge, and the stack's other screens (shallow). Every switch on. Fictional people.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Animated, BackHandler, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, hashKey, hydrate } from '@tanstack/react-query';
import { CommonActions, createNavigationContainerRef, NavigationContainer, type NavigationState, type ParamListBase } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

const mockAddResponse = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
const mockAddReceived = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
const mockGetLast = jest.fn(() => Promise.resolve(null as unknown));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: (cb: unknown) => mockAddReceived(cb),
  addNotificationResponseReceivedListener: (cb: unknown) => mockAddResponse(cb),
  getLastNotificationResponseAsync: () => mockGetLast(),
  clearLastNotificationResponseAsync: () => Promise.resolve(),
  AndroidImportance: { MAX: 5 },
}));
const mockFlags: Record<string, unknown> = {};
jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  for (const [k, v] of Object.entries(actual.featureFlags)) mockFlags[k] = typeof v === 'boolean' ? true : v;
  return { ...actual, featureFlags: mockFlags };
});
const mockTheme = () => {
  const tokens = jest.requireActual('../../theme/tokens');
  return { colors: jest.requireActual('../../constants/colors').default, tokens: tokens.default, semanticColors: tokens.lightTokens, colorScheme: 'light', isDark: false };
};
jest.mock('../../theme/useTheme', () => ({ useTheme: () => mockTheme() }));
jest.mock('../../theme/ThemeProvider', () => ({ useTheme: () => mockTheme(), LightTheme: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => {
  const R = require('react');
  const { Text: T } = require('react-native');
  const Icon = (p: { name: string }) => R.createElement(T, { testID: `icon-${p.name}` }, '');
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});
// The terms record (as formerCoachReach.test.tsx stands in for its prefs) and the query cache's disk.
const mockPrefs = new Map<string, string>();
jest.mock('../../storage/mmkv', () => ({
  cacheStorage: {
    getString: () => undefined, getStringAsync: async () => undefined, set: async () => undefined,
    delete: async () => undefined, getAllKeys: async () => [],
  },
  prefsStorage: {
    getString: (k: string) => mockPrefs.get(k),
    getStringAsync: async (k: string) => mockPrefs.get(k),
    set: async (k: string, v: string) => { mockPrefs.set(k, v); },
  },
}));
jest.mock('../../api/communityRealtime', () => new Proxy({ __esModule: true }, {
  get: (target, key) => (key in target ? target[key as keyof typeof target] : () => () => undefined),
}));
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), patch: (...a: unknown[]) => mockPost(...a),
    put: (...a: unknown[]) => mockPost(...a), delete: (...a: unknown[]) => mockPost(...a),
  },
  coachApi: { getClients: async () => ({ data: [] }) },
}));
// The signed-in client: coach_id null (no coach) or her coach now.
let mockUser: { id: string; role: string; name: string; firstName: string; coach_id: string | null } | null = null;
jest.mock('../../hooks/useCurrentUser', () => ({ ...jest.requireActual('../../hooks/useCurrentUser'), useCurrentUser: () => mockUser }));
jest.mock('../../lib/userCache', () => ({ ...jest.requireActual('../../lib/userCache'), readUserCacheSync: () => mockUser }));
const mockMessageCoach = jest.fn();
jest.mock('../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ messageCoach: () => mockMessageCoach(), entitlementActive: true, confirmedActive: true, status: 'active' }),
}));
jest.mock('../../components/community/SafetyMenu', () => (p: { testID: string }) =>
  require('react').createElement(require('react-native').View, { testID: p.testID }));
// The stack's other screens are shallow (read from CommunityNavigator's own imports); the thread is real.
for (const match of fs.readFileSync(path.join(__dirname, '..', 'CommunityNavigator.tsx'), 'utf8')
  .matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+)'/gm)) {
  const modulePath = match[1];
  if (modulePath.endsWith('/CommunityDmThreadScreen')) continue;
  jest.doMock(`../${modulePath}`, () => ({ __esModule: true, default: () => require('react').createElement(require('react-native').Text, null, `leaf ${modulePath}`) }));
}

// Required after the switches are pinned (an import would run before mockFlags exists).
const CommunityNavigator = require('../CommunityNavigator').default;
const ForegroundNotificationBanner = require('../../components/ForegroundNotificationBanner').default;
const { foregroundBannerStore } = require('../../store/foregroundBannerStore');
const { installForegroundHandler, installNotificationResponseHandler } = require('../../services/pushNotifications');
const push = require('../../services/pushTapRouter');
const { incomingLinkPath } = require('../incomingLinks');
const { routeNotification } = require('../../screens/notifications/NotificationCenterScreen');
const { normalizeNotification } = require('../../services/notificationsApi');
const { communityTermsKey } = require('../../components/community/CommunityTermsGate');
const { useBlockedUsersStore } = require('../../store/blockedUsersStore');

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1); // her community now (with a coach: Lee's)
const WS2 = uuid(2); // Maya's community, where she is a former client
const WS3 = uuid(3);
const CLIENT = uuid(10);
const OTHER_ACCOUNT = uuid(11);
const LEE = uuid(20);
const MAYA = uuid(30);
const RILEY = uuid(31);
const NOBODY = uuid(99);
const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

// GET /community/me as the server answers (b#1253, b#1260: the one most recent former coach, with the name).
const FLAGS = { community_api: true, community_dm: true, community_realtime: false, community_push: true, community_telemetry: false };
const UNREAD = { cohort_messages: 0, dm_messages: 0, mentions: 0 };
const MEMBERSHIP = { id: uuid(50), role: 'client', notify_level: 'live', dm_enabled_effective: true, last_read_message_at: null, joined_at: ago(9000) };
const OLD_NOCOACH = { feature_flag_state: 'enabled', workspace_id: null, membership: null, unread: UNREAD, flags: FLAGS }; // production today
const formerItem = (ws: string, coach: string, name: string) => ({ workspace_id: ws, coach_user_id: coach, coach_display_name: name });
const NOCOACH_ME = (former: unknown[] = [formerItem(WS2, MAYA, 'Maya Brooks')]) => ({ ...OLD_NOCOACH, former_coach_dms: former });
const OLD_COACHED = { ...OLD_NOCOACH, workspace_id: WS, membership: MEMBERSHIP };
const COACHED_ME = (former: unknown[] = [formerItem(WS2, MAYA, 'Maya Brooks')]) => ({ ...OLD_COACHED, former_coach_dms: former });
const msg = (n: number, from: string, to: string, body: string, at = ago(12)) => ({
  id: uuid(n), thread_id: `${WS2}:x`, sender_user_id: from, recipient_user_id: to, body, created_at: at, deleted: false,
});
const MAYA_MSGS = { messages: [msg(902, MAYA, CLIENT, 'Same time next Saturday?'), msg(901, CLIENT, MAYA, 'Thanks for keeping my spot.', ago(40)), msg(900, MAYA, CLIENT, 'Great work today.', ago(60))] };
const mayaMsgs = `/community/workspaces/${WS2}/dms/${MAYA}/messages`;
const httpError = (status: number, code?: string) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data: code ? { code } : {} } });
const BASE: Record<string, unknown> = {
  '/v1/clients/me/coach': { id: LEE, name: 'Lee Tanaka' },
  [`/community/workspaces/${WS}/dms`]: { threads: [] },
  [`/community/workspaces/${WS2}/dms`]: { threads: [{ thread_id: `${WS2}:${MAYA}`, workspace_id: WS2, other_user_id: MAYA, created_at: null, last_message_at: ago(12) }] },
  [mayaMsgs]: MAYA_MSGS,
};
type Answer = unknown | (() => never) | { deferred: Promise<unknown> };
let http: Record<string, Answer> = {};
function serve(answers: Record<string, Answer>) {
  http = { ...BASE, ...answers };
}
const meReads = () => mockGet.mock.calls.filter((c) => c[0] === '/community/me').length;

// The push, key for key as the server sends it (community-dms.service.ts:254-262; community-notifications.service.ts:265-275).
let seq = 0;
const dmData = (sender = MAYA) => ({
  kind: 'community_dm_received', category: 'COACH_DIRECT', target_type: 'dm', target_id: uuid(700 + (seq += 1)),
  deepLink: `tgp://community/dm/${sender}?workspace=${WS2}`,
});
const notification = (data: Record<string, unknown>) => {
  seq += 1;
  return { date: NOW / 1000 + seq, request: { identifier: `dfp-${seq}`, content: { title: 'Direct message', body: 'New direct message', data } } };
};

let qc: QueryClient;
let tapListener: (r: unknown) => void;
let stopResponse: () => void;
let receive: (n: unknown) => void;
const backHandlers: (() => boolean)[] = [];
const ME_KEY = ['community', 'me'];

type Ref = ReturnType<typeof createNavigationContainerRef<ParamListBase>>;
const Tab = createBottomTabNavigator();
const HomeProbe = () => <Text>home probe</Text>;
function App({ navRef }: { navRef: Ref }) {
  return (
    <QueryClientProvider client={qc}>
      <NavigationContainer ref={navRef}>
        <Tab.Navigator screenOptions={{ headerShown: false }}>
          <Tab.Screen name="Home" component={HomeProbe} />
          <Tab.Screen name="CommunityTab" component={CommunityNavigator} />
        </Tab.Navigator>
        <ForegroundNotificationBanner />
      </NavigationContainer>
    </QueryClientProvider>
  );
}

const coachless = () => { mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: null }; };
const coached = () => { mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: LEE }; };
const agreed = () => mockPrefs.set(communityTermsKey(CLIENT), '2026-11-01T00:00:00.000Z');
/** /me saved to the phone in an earlier visit (queryClient.ts persists it), stale now. */
const restoreMe = (data: unknown) => qc.setQueryData(ME_KEY, data, { updatedAt: NOW - 10 * 60_000 });
/** /me saved in the error state with its old data (hydration.ts:283-286). */
const restoreErroredMe = (data: unknown) => hydrate(qc, {
  mutations: [],
  queries: [{
    queryKey: ME_KEY, queryHash: hashKey(ME_KEY),
    state: {
      data, dataUpdateCount: 1, dataUpdatedAt: NOW - 10 * 60_000, error: httpError(503), errorUpdateCount: 1,
      errorUpdatedAt: NOW - 5 * 60_000, fetchFailureCount: 1, fetchFailureReason: httpError(503), fetchMeta: null,
      isInvalidated: false, status: 'error', fetchStatus: 'idle',
    },
  }],
} as never);

async function launch() {
  const ref = createNavigationContainerRef<ParamListBase>();
  const view = await render(<App navRef={ref} />);
  push.attachPushNavigator(ref);
  await act(async () => push.setPushSession({ kind: 'app', userId: CLIENT, role: 'student' }));
  return { ref, view };
}
const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
const focusedTab = (ref: Ref) => ref.getRootState().routes[ref.getRootState().index].name;
const tabRoute = (ref: Ref) => ref.getRootState().routes.find((r) => r.name === 'CommunityTab');
/** A tab opened as its tab bar button opens it (BottomTabBar.tsx: navigate(route.name, route.params)). */
const openTab = (ref: Ref, name: string) => act(async () => {
  ref.dispatch(CommonActions.navigate(name, ref.getRootState().routes.find((r) => r.name === name)?.params));
});
const tabParams = (ref: Ref) => tabRoute(ref)?.params as { screen?: unknown; params?: unknown; initial?: unknown } | undefined;
/** Spent: no defined screen, params or initial on the tab (setParams leaves { screen: undefined, ... }). */
const spent = (ref: Ref) => {
  const p = tabParams(ref);
  return !p || (p.screen === undefined && p.params === undefined && p.initial === undefined);
};
const stackOf = (ref: Ref) => (tabRoute(ref)?.state as NavigationState | undefined)?.routes.map((r) => r.name);
type View = Awaited<ReturnType<typeof launch>>['view'];
const threadOpen = (view: View) => view.queryByTestId('former-thread-masthead') !== null;
const onPage = (view: View) => view.queryByTestId('community-coach-lock') !== null;
const hasCard = (view: View) => view.queryByTestId('community-coach-lock-former') !== null;
async function androidBack() {
  await act(async () => {
    for (let i = backHandlers.length - 1; i >= 0; i -= 1) if (backHandlers[i]()) return;
  });
}
/** /me read again (its 60 s poll). */
const pollMe = () => act(async () => { await qc.invalidateQueries({ queryKey: ME_KEY }); });

// The five ways in, each as the app makes it.
const lockScreenTap = (sender = MAYA) => act(async () => tapListener({ notification: notification(dmData(sender)) }));
async function slip(view: View, sender = MAYA) {
  await act(async () => receive(notification(dmData(sender))));
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue({
    start: (done?: (r: { finished: boolean }) => void) => done?.({ finished: true }), stop: jest.fn(), reset: jest.fn(),
  } as never);
  await fireEvent.press(view.getByLabelText('Direct message. New direct message. Tap to view.'));
  timing.mockRestore();
}
const listRow = (sender = MAYA) => act(async () => {
  const row = normalizeNotification({
    id: uuid(600 + (seq += 1)), kind: 'community_dm_received', title: 'Direct message', body: 'New direct message',
    read_at: null, created_at: ago(1), deep_link: `tgp://community/dm/${sender}?workspace=${WS2}`, payload: {},
  });
  routeNotification(row, { navigate: jest.fn() });
});
const appLink = (sender = MAYA) => act(async () => push.routeAppLink(incomingLinkPath(`tgp://community/dm/${sender}?workspace=${WS2}`)));

beforeAll(() => {
  stopResponse = () => undefined;
  installForegroundHandler();
  receive = mockAddReceived.mock.calls[mockAddReceived.mock.calls.length - 1][0] as (n: unknown) => void;
});
beforeEach(() => {
  for (const k of Object.keys(mockFlags)) if (typeof mockFlags[k] === 'boolean') mockFlags[k] = true;
  push.__resetPushTapRouterForTests();
  mockGetLast.mockReset().mockImplementation(() => Promise.resolve(null));
  stopResponse = installNotificationResponseHandler(push.routePushTap);
  tapListener = mockAddResponse.mock.calls[mockAddResponse.mock.calls.length - 1][0] as (r: unknown) => void;
  mockGet.mockReset().mockImplementation(async (url: string) => {
    const key = url.split('?')[0];
    if (!(key in http)) throw httpError(404);
    const v = http[key];
    if (typeof v === 'function') (v as () => never)();
    if (v && typeof v === 'object' && 'deferred' in (v as object)) return { data: await (v as { deferred: Promise<unknown> }).deferred, headers: {} };
    return { data: v, headers: {} };
  });
  mockPost.mockReset().mockImplementation(async () => ({ data: {}, headers: {} }));
  mockMessageCoach.mockReset();
  mockPrefs.clear();
  useBlockedUsersStore.setState({ blocked: [] });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  backHandlers.length = 0;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e: unknown, h: unknown) => {
    backHandlers.push(h as () => boolean);
    return { remove: () => { const i = backHandlers.indexOf(h as () => boolean); if (i >= 0) backHandlers.splice(i, 1); } } as never;
  });
  coachless();
  agreed();
  serve({ '/community/me': NOCOACH_ME() });
});
afterEach(async () => {
  stopResponse();
  await act(async () => foregroundBannerStore.getState().reset());
  jest.restoreAllMocks();
});

/** Opened the Community tab, waited for the page with his card, then left it for Home (work line 7 (a)). */
async function visitAndLeave(ref: Ref, view: View) {
  await openTab(ref, 'CommunityTab');
  await waitFor(() => expect(hasCard(view)).toBe(true));
  await openTab(ref, 'Home');
}

describe('a. S1 by each way in: his thread on the locked page, the tab spent, Back to the page, nothing again', () => {
  const WAYS: [string, (view: View) => Promise<unknown>][] = [
    ['the lock-screen tap', () => lockScreenTap()],
    ['the slip', (view) => slip(view)],
    ['the notification list\'s row', () => listRow()],
    ['the tgp://community/dm link', () => appLink()],
  ];
  describe.each([['never opened', false], ['opened, left for Home, the app behind', true]])('the Community tab %s', (_n, visited) => {
    it.each(WAYS)('%s', async (_w, way) => {
      const { ref, view } = await launch();
      if (visited) await visitAndLeave(ref, view);
      await way(view);
      await waitFor(() => expect(threadOpen(view)).toBe(true));
      expect(focusedTab(ref)).toBe('CommunityTab');
      expect(spent(ref)).toBe(true);
      await waitFor(() => expect(view.getByText('Same time next Saturday?')).toBeTruthy());
      if (visited) await androidBack();
      else await fireEvent.press(view.getByTestId('former-thread-back'));
      expect(onPage(view)).toBe(true);
      expect(hasCard(view)).toBe(true);
      await pollMe();
      await settle();
      expect(threadOpen(view)).toBe(false);
    });
  });

  it('the cold start (session unknown, then onboarding, then the app): opens once her tabs mount and /me lists him', async () => {
    stopResponse();
    push.__resetPushTapRouterForTests();
    mockGetLast.mockReturnValueOnce(Promise.resolve({ notification: notification(dmData()) }));
    stopResponse = installNotificationResponseHandler(push.routePushTap);
    await settle();
    push.setPushSession({ kind: 'onboarding', userId: CLIENT });
    const ref = createNavigationContainerRef<ParamListBase>();
    const view = await render(<App navRef={ref} />);
    push.attachPushNavigator(ref);
    expect(focusedTab(ref)).toBe('Home');
    await act(async () => push.setPushSession({ kind: 'app', userId: CLIENT, role: 'student' }));
    await waitFor(() => expect(threadOpen(view)).toBe(true));
    expect(spent(ref)).toBe(true);
    await fireEvent.press(view.getByTestId('former-thread-back'));
    expect(hasCard(view)).toBe(true);
    await pollMe();
    await settle();
    expect(threadOpen(view)).toBe(false);
  });
});

describe('b. the same as her press on his card', () => {
  const seen = (ref: Ref, view: View) => ({ tab: focusedTab(ref), spent: spent(ref), stack: stackOf(ref), thread: threadOpen(view), page: onPage(view), text: view.queryByText('Same time next Saturday?') !== null });
  it('after the notification, the screen and the tab equal those after pressing his card on a fresh mount', async () => {
    const first = await launch();
    await lockScreenTap();
    await waitFor(() => expect(threadOpen(first.view)).toBe(true));
    await waitFor(() => expect(first.view.getByText('Same time next Saturday?')).toBeTruthy());
    const byTap = seen(first.ref, first.view);
    await first.view.unmount();
    push.__resetPushTapRouterForTests();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const second = await launch();
    await openTab(second.ref, 'CommunityTab');
    await fireEvent.press(await waitFor(() => second.view.getByTestId('community-coach-lock-former')));
    await waitFor(() => expect(second.view.getByText('Same time next Saturday?')).toBeTruthy());
    expect(seen(second.ref, second.view)).toEqual(byTap);
    expect(byTap).toEqual({ tab: 'CommunityTab', spent: true, stack: undefined, thread: true, page: false, text: true });
  });
});

describe('c. S2: /me restored from disk', () => {
  it.each([
    ['(i) restored stale, listing him', NOCOACH_ME()],
    ['(ii) restored stale, not listing him', NOCOACH_ME([])],
  ])('%s, then read in this visit with him: opens once, after that read', async (_n, saved) => {
    let answer: (v: unknown) => void = () => undefined;
    serve({ '/community/me': { deferred: new Promise((r) => { answer = r; }) } });
    restoreMe(saved);
    const { ref, view } = await launch();
    await lockScreenTap();
    await settle();
    expect(threadOpen(view)).toBe(false); // never from the restored copy alone
    expect(spent(ref)).toBe(false); // waits un-spent
    await act(async () => answer(NOCOACH_ME()));
    await waitFor(() => expect(threadOpen(view)).toBe(true));
    expect(spent(ref)).toBe(true);
  });

  it('(iii) restored in the error state with the copy listing him, the new read pending: nothing before it ends; then once', async () => {
    let answer: (v: unknown) => void = () => undefined;
    serve({ '/community/me': { deferred: new Promise((r) => { answer = r; }) } });
    restoreErroredMe(NOCOACH_ME());
    const { ref, view } = await launch();
    await lockScreenTap();
    await settle();
    expect(threadOpen(view)).toBe(false);
    expect(spent(ref)).toBe(false);
    await act(async () => answer(NOCOACH_ME()));
    await waitFor(() => expect(threadOpen(view)).toBe(true));
    expect(spent(ref)).toBe(true);
    await fireEvent.press(view.getByTestId('former-thread-back'));
    await pollMe();
    await settle();
    expect(threadOpen(view)).toBe(false);
  });
});

describe('d. S3: /me answers without him: the page stays, the tap is spent, a later /me listing him opens nothing', () => {
  it.each([
    ['/me lists nobody (a block, a ban, a removal, his thread not kept)', NOCOACH_ME([]), MAYA],
    ['/me lists another former coach', NOCOACH_ME([formerItem(WS3, RILEY, 'Riley Shah')]), MAYA],
    ['the push names an id that is no one\'s', NOCOACH_ME(), NOBODY],
    ['the old server (no former_coach_dms)', OLD_NOCOACH, MAYA],
  ])('%s', async (_n, me, sender) => {
    serve({ '/community/me': me });
    const { ref, view } = await launch();
    await lockScreenTap(sender);
    await waitFor(() => expect(meReads()).toBeGreaterThan(0));
    await waitFor(() => expect(spent(ref)).toBe(true));
    expect(onPage(view)).toBe(true);
    expect(threadOpen(view)).toBe(false);
    serve({ '/community/me': NOCOACH_ME() });
    await pollMe();
    await waitFor(() => expect(hasCard(view)).toBe(true));
    await settle();
    expect(threadOpen(view)).toBe(false);
  });
});

describe('e. S4: this visit\'s /me read fails', () => {
  it('with his card in the copy: opens his thread, as her press would', async () => {
    serve({ '/community/me': () => { throw httpError(503); } });
    restoreMe(NOCOACH_ME());
    const { ref, view } = await launch();
    await lockScreenTap();
    await waitFor(() => expect(threadOpen(view)).toBe(true));
    expect(spent(ref)).toBe(true);
  });

  it('with his card in the copy and his thread\'s read failing too: the thread with its own failed look', async () => {
    serve({ '/community/me': () => { throw httpError(503); }, [mayaMsgs]: () => { throw httpError(503); } });
    restoreMe(NOCOACH_ME());
    const { view } = await launch();
    await lockScreenTap();
    await waitFor(() => expect(threadOpen(view)).toBe(true));
    await waitFor(() => expect(view.getByTestId('community-dmthread-retry')).toBeTruthy());
  });

  it('with no copy: the page as today, the tap spent', async () => {
    serve({ '/community/me': () => { throw httpError(503); } });
    const { ref, view } = await launch();
    await lockScreenTap();
    await waitFor(() => expect(meReads()).toBeGreaterThan(0));
    await waitFor(() => expect(spent(ref)).toBe(true));
    expect(onPage(view)).toBe(true);
    expect(threadOpen(view)).toBe(false);
  });
});

describe('f. S5 and S6', () => {
  it('S5: she blocked him: no card, nothing opens, spent', async () => {
    useBlockedUsersStore.setState({ blocked: [{ id: MAYA }] });
    const { ref, view } = await launch();
    await lockScreenTap();
    await waitFor(() => expect(meReads()).toBeGreaterThan(0));
    await waitFor(() => expect(spent(ref)).toBe(true));
    expect(hasCard(view)).toBe(false);
    expect(threadOpen(view)).toBe(false);
  });

  it('S6: the phone\'s DM switch off: the page as before, no card, no /me read, nothing opens, spent', async () => {
    mockFlags.communityDm = false;
    const { ref, view } = await launch();
    await lockScreenTap();
    await waitFor(() => expect(spent(ref)).toBe(true));
    expect(onPage(view)).toBe(true);
    expect(hasCard(view)).toBe(false);
    expect(threadOpen(view)).toBe(false);
    expect(meReads()).toBe(0);
  });
});

describe('g. S7: no saved terms agreement on this phone', () => {
  it('the guidelines with Back first; Back returns to the page; agreeing opens his thread', async () => {
    mockPrefs.clear();
    serve({ '/community/me': NOCOACH_ME(), '/me/onboarding': { consent_recorded: false, answers: {} } });
    const { ref, view } = await launch();
    await lockScreenTap();
    await waitFor(() => expect(view.getByTestId('community-terms-gate')).toBeTruthy());
    expect(spent(ref)).toBe(true);
    expect(view.queryByText('Same time next Saturday?')).toBeNull();
    await fireEvent.press(view.getByTestId('community-terms-back'));
    expect(hasCard(view)).toBe(true);
    await fireEvent.press(view.getByTestId('community-coach-lock-former'));
    await fireEvent.press(await waitFor(() => view.getByTestId('community-terms-agree')));
    await waitFor(() => expect(threadOpen(view)).toBe(true));
  });

  it('the tap itself goes through the guidelines too: agreeing there opens his thread', async () => {
    mockPrefs.clear();
    serve({ '/community/me': NOCOACH_ME(), '/me/onboarding': { consent_recorded: false, answers: {} } });
    const { view } = await launch();
    await lockScreenTap();
    await fireEvent.press(await waitFor(() => view.getByTestId('community-terms-agree')));
    await waitFor(() => expect(threadOpen(view)).toBe(true));
  });
});

describe('h. S8, S9 and S10', () => {
  it('S8: his thread open and his next notification: the same thread, one copy, nothing re-mounted', async () => {
    const { ref, view } = await launch();
    await lockScreenTap();
    await waitFor(() => expect(view.getByText('Same time next Saturday?')).toBeTruthy());
    const reads = mockGet.mock.calls.filter((c) => c[0] === mayaMsgs).length;
    const masthead = view.getByTestId('former-thread-masthead');
    await lockScreenTap();
    await waitFor(() => expect(spent(ref)).toBe(true));
    await settle();
    expect(view.getAllByTestId('former-thread-masthead')).toHaveLength(1);
    expect(view.getByTestId('former-thread-masthead')).toBe(masthead);
    expect(mockGet.mock.calls.filter((c) => c[0] === mayaMsgs).length).toBeGreaterThanOrEqual(reads);
  });

  it('S8: a notification for someone else while his thread is open: spent, her open thread stays', async () => {
    const { ref, view } = await launch();
    await lockScreenTap();
    await waitFor(() => expect(threadOpen(view)).toBe(true));
    await lockScreenTap(NOBODY);
    await waitFor(() => expect(spent(ref)).toBe(true));
    await settle();
    expect(threadOpen(view)).toBe(true);
    expect(view.getByText('Same time next Saturday?')).toBeTruthy();
  });

  it.each([
    ['his, then another person\'s: the newest wins, nothing opens', [MAYA, NOBODY], false],
    ['another person\'s, then his: the newest opens his thread', [NOBODY, MAYA], true],
  ])('S9: a newer tap before /me answers: %s', async (_n, senders, opens) => {
    let answer: (v: unknown) => void = () => undefined;
    serve({ '/community/me': { deferred: new Promise((r) => { answer = r; }) } });
    const { ref, view } = await launch();
    for (const s of senders) await lockScreenTap(s);
    await settle();
    await act(async () => answer(NOCOACH_ME()));
    await waitFor(() => expect(spent(ref)).toBe(true));
    await settle();
    expect(threadOpen(view)).toBe(opens);
  });

  it.each([
    ['she switches to another tab', async (ref: Ref) => { await openTab(ref, 'Home'); }],
    ['she presses his card (from the saved copy), then Back', async (_ref: Ref, view: View) => {
      await fireEvent.press(view.getByTestId('community-coach-lock-former'));
      await waitFor(() => expect(threadOpen(view)).toBe(true));
      await fireEvent.press(view.getByTestId('former-thread-back'));
    }],
  ])('S10: %s before /me answers: what she did stays; the answer opens nothing', async (_n, act1) => {
    let answer: (v: unknown) => void = () => undefined;
    serve({ '/community/me': { deferred: new Promise((r) => { answer = r; }) } });
    restoreMe(NOCOACH_ME());
    const { ref, view } = await launch();
    await lockScreenTap();
    await waitFor(() => expect(hasCard(view)).toBe(true));
    await act1(ref, view);
    await act(async () => answer(NOCOACH_ME()));
    await settle();
    expect(threadOpen(view)).toBe(false);
    expect(spent(ref)).toBe(true);
    await openTab(ref, 'CommunityTab');
    await settle();
    expect(threadOpen(view)).toBe(false);
  });

  it('S10: she presses Join a coach before /me answers and joins: the stack at its root, never his thread', async () => {
    let answer: (v: unknown) => void = () => undefined;
    serve({ '/community/me': { deferred: new Promise((r) => { answer = r; }) } });
    const { ref, view } = await launch();
    mockMessageCoach.mockImplementation(() => ref.dispatch(CommonActions.navigate('Home'))); // the coach-code sheet is elsewhere
    await lockScreenTap();
    await fireEvent.press(await waitFor(() => view.getByTestId('community-coach-lock-join')));
    expect(focusedTab(ref)).toBe('Home');
    coached();
    await act(async () => answer(COACHED_ME()));
    await openTab(ref, 'CommunityTab');
    await waitFor(() => expect(stackOf(ref)).toEqual(['CommunityTab']));
    await settle();
    expect(stackOf(ref)).toEqual(['CommunityTab']);
    expect(threadOpen(view)).toBe(false);
  });
});

describe('i. S11: she joins a coach later in the visit', () => {
  it.each([
    ['his notification (his thread opened, then Back)', MAYA],
    ['a notification for an id that is no one\'s', NOBODY],
  ])('after %s, the stack\'s first route is its root, never CommunityDmThread', async (_n, sender) => {
    const { ref, view } = await launch();
    await lockScreenTap(sender);
    await waitFor(() => expect(hasCard(view) || threadOpen(view)).toBe(true));
    await settle();
    // Decided on this visit's /me: at the base nothing reads the tap, so the page is still drawn here.
    if (threadOpen(view)) await fireEvent.press(view.getByTestId('former-thread-back'));
    await openTab(ref, 'Home');
    coached();
    serve({ '/community/me': COACHED_ME() });
    await openTab(ref, 'CommunityTab');
    await waitFor(() => expect(stackOf(ref)).toBeDefined());
    await settle();
    expect(stackOf(ref)).toEqual(['CommunityTab']);
    expect(threadOpen(view)).toBe(false);
  });
});

describe('j. S12: the router\'s own rules drop a held cold-start tap', () => {
  it.each([
    ['sign-out before any account', async () => {
      push.setPushSession({ kind: 'signedOut' });
      push.setPushSession({ kind: 'app', userId: CLIENT, role: 'student' });
    }],
    ['held for her (onboarding), then another account signs in on this phone', async () => {
      push.setPushSession({ kind: 'onboarding', userId: CLIENT });
      push.setPushSession({ kind: 'app', userId: OTHER_ACCOUNT, role: 'student' });
    }],
  ])('%s: nothing opens', async (_n, sessions) => {
    stopResponse();
    push.__resetPushTapRouterForTests();
    mockGetLast.mockReturnValueOnce(Promise.resolve({ notification: notification(dmData()) }));
    stopResponse = installNotificationResponseHandler(push.routePushTap);
    await settle();
    const ref = createNavigationContainerRef<ParamListBase>();
    const view = await render(<App navRef={ref} />);
    push.attachPushNavigator(ref);
    await act(sessions);
    await settle();
    expect(focusedTab(ref)).toBe('Home');
    expect(tabRoute(ref)?.params).toBeUndefined();
    expect(threadOpen(view)).toBe(false);
  });
});

describe('k. S13 to S17 with a coach (unchanged; R4): his thread over the tab\'s root', () => {
  beforeEach(() => coached());
  it('S13: /me lists him: Style 3\'s page over the root; Back to the root', async () => {
    serve({ '/community/me': COACHED_ME() });
    const { ref, view } = await launch();
    await lockScreenTap();
    await waitFor(() => expect(threadOpen(view)).toBe(true));
    expect(stackOf(ref)).toEqual(['CommunityTab', 'CommunityDmThread']);
    expect(ref.getCurrentRoute()?.params).toEqual({ recipientId: MAYA });
    await fireEvent.press(view.getByTestId('former-thread-back'));
    await waitFor(() => expect(stackOf(ref)).toEqual(['CommunityTab']));
  });

  it('S14: a message from her coach now: his thread as today', async () => {
    serve({ '/community/me': COACHED_ME(), [`/community/workspaces/${WS}/dms/${LEE}/messages`]: { messages: [msg(910, LEE, CLIENT, 'See you Monday.')] } });
    const { ref, view } = await launch();
    await lockScreenTap(LEE);
    await waitFor(() => expect(view.getByText('See you Monday.')).toBeTruthy());
    expect(stackOf(ref)).toEqual(['CommunityTab', 'CommunityDmThread']);
    expect(threadOpen(view)).toBe(false);
  });

  it('S15: a former coach /me does not list: the plain thread, read in her own community and refused: closed', async () => {
    serve({ '/community/me': COACHED_ME([]), [`/community/workspaces/${WS}/dms/${MAYA}/messages`]: () => { throw httpError(404, 'community.dm.not_found'); } });
    const { ref, view } = await launch();
    await lockScreenTap();
    await waitFor(() => expect(view.getByTestId('community-dmthread-closed')).toBeTruthy());
    expect(stackOf(ref)).toEqual(['CommunityTab', 'CommunityDmThread']);
    expect(threadOpen(view)).toBe(false);
  });

  it('S16: a cold start with /me restored from before her move: the thread ends open once /me lists him', async () => {
    restoreMe({ ...OLD_COACHED, workspace_id: WS2, former_coach_dms: [] });
    serve({ '/community/me': COACHED_ME() });
    stopResponse();
    push.__resetPushTapRouterForTests();
    mockGetLast.mockReturnValueOnce(Promise.resolve({ notification: notification(dmData()) }));
    stopResponse = installNotificationResponseHandler(push.routePushTap);
    await settle();
    const { ref, view } = await launch();
    await waitFor(() => expect(threadOpen(view)).toBe(true));
    await waitFor(() => expect(view.getByTestId('community-dmthread-composer')).toBeTruthy());
    expect(stackOf(ref)).toEqual(['CommunityTab', 'CommunityDmThread']);
  });

  it('S17: the old server (no former_coach_dms): the plain thread as today', async () => {
    serve({ '/community/me': OLD_COACHED, [`/community/workspaces/${WS}/dms/${MAYA}/messages`]: () => { throw httpError(404, 'community.dm.not_found'); } });
    const { ref, view } = await launch();
    await lockScreenTap();
    await waitFor(() => expect(view.getByTestId('community-dmthread-closed')).toBeTruthy());
    expect(stackOf(ref)).toEqual(['CommunityTab', 'CommunityDmThread']);
  });
});

describe('l. S18: a coach\'s session and a coach\'s DM push', () => {
  it('the navigate it makes today: that client\'s thread in the coach\'s Community stack', async () => {
    const navigate = jest.fn();
    push.attachPushNavigator({ isReady: () => true, navigate, getRootState: () => ({ routeNames: ['CommandCenter', 'ClientsStack', 'CommunityStack'], routes: [] }) });
    push.setPushSession({ kind: 'app', userId: LEE, role: 'coach' });
    await act(async () => tapListener({ notification: notification({ ...dmData(), deepLink: `tgp://community/dm/${CLIENT}?workspace=${WS}` }) }));
    expect(navigate.mock.calls).toEqual([['CommunityStack', { screen: 'CommunityDmThread', params: { recipientId: CLIENT }, initial: false }]]);
  });
});

describe('m. S19: with a coach the stack takes the tap; later in the visit she has no coach', () => {
  it('the locked page with his card; the old params spent; nothing opens, also after a /me poll; a new tap opens', async () => {
    coached();
    serve({ '/community/me': COACHED_ME() });
    const { ref, view } = await launch();
    await lockScreenTap();
    await waitFor(() => expect(threadOpen(view)).toBe(true));
    expect(stackOf(ref)).toEqual(['CommunityTab', 'CommunityDmThread']);
    await openTab(ref, 'Home');
    coachless();
    serve({ '/community/me': NOCOACH_ME() });
    await openTab(ref, 'CommunityTab');
    await waitFor(() => expect(hasCard(view)).toBe(true));
    await settle();
    expect(threadOpen(view)).toBe(false);
    await waitFor(() => expect(spent(ref)).toBe(true));
    await pollMe();
    await settle();
    expect(threadOpen(view)).toBe(false);
    await lockScreenTap();
    await waitFor(() => expect(threadOpen(view)).toBe(true));
    expect(spent(ref)).toBe(true);
  });
});
