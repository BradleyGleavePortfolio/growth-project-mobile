/**
 * COACH-ROW-CHAT-PUSH-M (owner 203-D4, #203-E22: "open the clients chat"): a coach's message notification, by each of
 * its three ways in (the lock-screen tap, a cold start, the in-app slip), ends on that client's chat through the
 * Messages list's own row: the row's own call and name, as her own tap on that row, with Back to the list. The push is
 * b#1242's key for key (CONTRACT 6762179206): the client's id and no name. No row (a block either way, a client who
 * moved or is not hers, a failed read): she stays on the list, as today, and the id is spent so nothing opens later.
 *
 * Real: CoachNavigator in a NavigationContainer, the push handlers (installNotificationResponseHandler,
 * installForegroundHandler), the router attached to the container ref, the slip and its store, coachInbox, the coach's
 * MessagesScreen with both lists (CoachInboxV2 and the older list) and the roster store. Stand-ins: HTTP, realtime, the
 * signed-in coach, the server switches (useFeatureFlags), the theme, icons, the header entries, the drafts card,
 * expo-notifications at its edge, and every other screen of the navigator (labels, as coachTabsV2.test.tsx does).
 * The chat is a probe that prints its route's clientId and clientName and keeps unsent text through useUnsentReply.
 */
import React from 'react';
import { Animated, Platform, Text, TextInput } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, useRoute, type ParamListBase } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
const mockFlags = { coachCommunity: true, mwbPrograms: true, teamMode: true, coachBrief: true, coachBriefGate: false, coachTabsV2: true, romanChat: true };
jest.mock('../../config/featureFlags', () => ({ featureFlags: mockFlags }));
jest.mock('../../hooks/useCoachRoleType', () => ({ useCoachTeamStatus: () => ({ role: 'head_coach', hasSubCoaches: false }) }));
jest.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../theme/tokens').lightTokens, colors: new Proxy({}, { get: () => '#000000' }) }),
  ThemeColors: {},
}));
const mockGet = jest.fn();
const mockGetClients = jest.fn();
const mockGetUnread = jest.fn();
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  coachApi: { getClients: (...a: unknown[]) => mockGetClients(...a), getUnreadCounts: () => mockGetUnread() },
}));
jest.mock('../../services/realtime', () => ({ subscribeToMessages: () => () => undefined, onRealtimeAuthRefresh: () => () => undefined }));
const COACH = 'c0ac4000-0000-4000-8000-0000000000c1';
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'c0ac4000-0000-4000-8000-0000000000c1', role: 'coach' }) }));
// The server switches: messaging_core_v2 and whether the switch read is still out, from variables.
const mockSwitches = { v2: true, loading: false, seen: new Set<() => void>() };
jest.mock('../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => {
    const R = jest.requireActual('react');
    R.useSyncExternalStore(
      (l: () => void) => { mockSwitches.seen.add(l); return () => mockSwitches.seen.delete(l); },
      () => `${mockSwitches.v2}:${mockSwitches.loading}`,
    );
    return { flags: { messaging_core_v2: mockSwitches.v2 }, isLoading: mockSwitches.loading };
  },
}));
jest.mock('../../screens/coach/broadcasts/BroadcastsEntry', () => ({ BroadcastsEntry: () => null }));
jest.mock('../../screens/coach/CommunityReportsEntry', () => ({ CommunityReportsEntry: () => null }));
jest.mock('../../screens/coach/CommunityEntry', () => ({ CommunityEntry: () => null }));
jest.mock('../../screens/coach/inboxStyleB', () => ({
  ...jest.requireActual('../../screens/coach/inboxStyleB'),
  RomanDraftsHero: () => null, // the drafts card has its own tests (draftsCountM.test.tsx)
  useRomanDrafts: () => ({ total: 0, kinds: [] }),
}));
jest.mock('../../components/home/PushPermissionCard', () => () => null);
jest.mock('../../hooks/useMacros', () => ({ useCurrentMacrosForClient: () => ({ isSuccess: false }) }));
jest.mock('../../services/notificationsApi', () => ({ fetchUnreadCount: async () => 0 }));
jest.mock('../../services/commandCenterApi', () => ({ __USING_MOCK_DATA: true }));
jest.mock('../../components/NotificationBadge', () => () => null);
jest.mock('../../components/purchases/withNonP2PPurchaseGate', () => ({ withNonP2PPurchaseGate: (screen: unknown) => screen }));
jest.mock('../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), softImpact: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => require('react').createElement(require('react-native').Text, { testID: name }, name),
}));
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

// Every screen CoachNavigator imports is a label (coachTabsV2.test.tsx:50-54), except the coach's real Messages list.
const navSource = fs.readFileSync(path.join(__dirname, '..', 'CoachNavigator.tsx'), 'utf8');
for (const match of navSource.matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+)'/gm)) {
  const modulePath = match[1];
  if (modulePath === '../screens/coach/MessagesScreen') continue;
  jest.doMock(`../${modulePath}`, () => ({ __esModule: true, default: () => <Text>{modulePath}</Text> }));
}
jest.doMock('../../screens/coach/ClientMessagesScreen', () => ({
  __esModule: true,
  default: function ChatProbe() {
    const { clientId, clientName, initialDraft } = useRoute().params as { clientId: string; clientName: string; initialDraft?: string };
    const [text, setText] = require('../coachInbox').useUnsentReply(clientId, initialDraft);
    return (
      <>
        <Text testID="chat">{`chat ${clientId} ${clientName}`}</Text>
        <TextInput accessibilityLabel="Message text" value={text} onChangeText={setText} />
      </>
    );
  },
}));
jest.doMock('../../screens/coach/ed/FirstPaymentWowHost', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
for (const name of ['ProgramsStackNavigator', 'CoachCommunityNavigator']) {
  jest.doMock(`../${name}`, () => ({ __esModule: true, default: () => <Text>{name}</Text> }));
}
const CoachNavigator = require('../CoachNavigator').default;
const ForegroundNotificationBanner = require('../../components/ForegroundNotificationBanner').default;
const { foregroundBannerStore } = require('../../store/foregroundBannerStore');
const { installForegroundHandler, installNotificationResponseHandler } = require('../../services/pushNotifications');
const { __resetPushTapRouterForTests, attachPushNavigator, routePushTap, setPushSession } = require('../../services/pushTapRouter');
const { useCoachStore } = require('../../store/coachStore');
const { useBlockedUsersStore } = require('../../store/blockedUsersStore');
const { coachInboxKey } = require('../../screens/coach/CoachInboxV2');

// Fictional people, UUID ids.
const DANA = { id: '0b9a2a52-6f0e-4c39-9d43-2f1f3c1f6a01', name: 'Dana Cruz' };
const RAY = { id: '5d3c1e7a-8b2f-4a6d-9e10-7f4b2c8d9a02', name: 'Ray Lowe' };
const NOT_HERS = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e03';
type Person = { id: string; name: string };

// The server's inbox row and page (CoachInboxV2.test.tsx:63-87, UUID ids; messaging-inbox.service.ts:213-240).
function thread(p: Person, over: Record<string, unknown> = {}) {
  return {
    thread_id: p.id, kind: 'coach_client', coach_id: COACH, client_id: p.id,
    counterpart: { user_id: p.id, display_name: p.name },
    last_message: { id: `m-${p.id}`, sender_id: p.id, is_mine: false, kind: 'text', preview: 'See you Monday', created_at: '2026-11-27T10:00:00.000Z', edited: false },
    unread_count: 1, muted: false, muted_until: null, pinned: false, blocked_by_me: false, closed: false,
    last_activity_at: '2026-11-27T10:00:00.000Z', ...over,
  };
}
const page = (items: object[], closed: string[] = []) => ({ data: { items, next_cursor: null, total_unread: items.length, closed_client_ids: closed } });
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const FAILED = { isAxiosError: true, response: { status: 500, data: {} } };
const DISABLED = { isAxiosError: true, response: { status: 503, data: { code: 'messaging.feature_disabled', error: 'messaging.feature_disabled' } } };
let inbox: (url: string) => Promise<unknown>;
const inboxReads = () => mockGet.mock.calls.filter(([u]) => String(u).startsWith('/coach/messages/inbox')).length;
// The roster (GET /coach/clients rows) and the older list's unread read (closed_client_ids).
const rosterRow = (p: Person) => ({ id: p.id, name: p.name, role: 'student', coach_id: COACH, created_at: '2026-01-01T00:00:00.000Z' });
let roster: () => Promise<unknown>;
let unread: () => Promise<unknown>;

// b#1242's push for a coach, key for key; every delivery its own identifier and date (m#1005, tapIdOf).
let delivery = 0;
const pushData = (clientId: string) => ({ actionScreen: 'Messages', actionParams: { clientId }, deepLink: `tgp://messages/${clientId}`, kind: 'message_received' });
const notification = (data: object) => {
  delivery += 1;
  return { date: 1795800000 + delivery, request: { identifier: `message-${delivery}`, content: { title: 'New message', body: 'You have a new message. Open the app to read it.', data } } };
};
const SLIP = 'New message. You have a new message. Open the app to read it.. Tap to view.';

const ref = createNavigationContainerRef<ParamListBase>();
type Nav = { index: number; routes: { name: string; params?: Record<string, unknown>; state?: Nav }[] };
const rootState = () => ref.getRootState() as unknown as Nav;
const focusedTab = () => rootState().routes[rootState().index].name;
const tab = (name: string) => rootState().routes.find((r) => r.name === name);
const stackOf = (name: string) => tab(name)?.state?.routes.map((r) => r.name);
const topRoute = () => ref.getCurrentRoute();
/** The list's route: MessagesInbox with the six tabs, the Messages tab itself without. */
const listRoute = () => (mockFlags.coachTabsV2 ? tab('Messages')?.state?.routes[0] : tab('Messages'));
const chatOf = (p: Person, name = p.name) => ({ clientId: p.id, clientName: name });
/** Route names and params, keys left out; a param whose value is undefined counts as absent. */
function shape(s: Nav | undefined): unknown {
  if (!s) return undefined;
  const clean = (v: unknown): unknown => {
    if (!v || typeof v !== 'object') return v;
    const out = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, clean(x)]));
    return Object.keys(out).length > 0 ? out : undefined;
  };
  return { index: s.index, routes: s.routes.map((r) => ({ name: r.name, params: clean(r.params), state: shape(r.state) })) };
}

let qc: QueryClient;
let stopResponses: () => void = () => undefined;
let stopReceived: () => void = () => undefined;
async function mount(seed?: object[]) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  if (seed) qc.setQueryData(coachInboxKey('all'), { pages: [page(seed).data], pageParams: [null] }); // pages restored at a cold start
  const view = await render(
    <QueryClientProvider client={qc}>
      <NavigationContainer ref={ref}>
        <CoachNavigator />
        <ForegroundNotificationBanner />
      </NavigationContainer>
    </QueryClientProvider>,
  );
  attachPushNavigator(ref);
  return view;
}
/** Lets every answered read land and every decision run; a read held on purpose stays out. */
const settle = () => act(async () => {
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    if (i >= 6 && (!qc || qc.isFetching() === 0)) break;
  }
});
const signIn = () => setPushSession({ kind: 'app', userId: COACH, role: 'coach' });
/** The lock-screen tap with the app alive (pushNotifications.ts:256-258). */
async function lockTap(clientId: string, data: object = pushData(clientId)) {
  const listener = mockAddResponse.mock.calls[mockAddResponse.mock.calls.length - 1][0] as (r: unknown) => void;
  await act(async () => listener({ notification: notification(data) }));
  await settle();
}
/** The slip: received while the app is open, drawn unless its tap would land where she is, pressed. */
async function receive(clientId: string) {
  const listener = mockAddReceived.mock.calls[mockAddReceived.mock.calls.length - 1][0] as (n: unknown) => void;
  await act(async () => listener(notification(pushData(clientId))));
  await settle();
}
const openMessagesTab = async (view: Awaited<ReturnType<typeof render>>) => {
  await fireEvent.press(view.getByRole('tab', { name: /^Messages/ }));
  await settle();
};
const pressRow = async (view: Awaited<ReturnType<typeof render>>, p: Person) => {
  await fireEvent.press(await view.findByLabelText(new RegExp(`^Open messages with ${p.name}`)));
  await settle();
};
const box = (view: Awaited<ReturnType<typeof render>>) => view.getByLabelText('Message text').props.value;
const onTheList = () => [focusedTab(), topRoute()?.name];
const LIST = () => (mockFlags.coachTabsV2 ? ['Messages', 'MessagesInbox'] : ['Messages', 'Messages']);
const inChat = (p: Person, name = p.name) => expect([focusedTab(), topRoute()?.name, topRoute()?.params]).toEqual(
  [mockFlags.coachTabsV2 ? 'Messages' : 'ClientsStack', 'ClientMessages', { ...chatOf(p, name), initialDraft: undefined }],
);
const chatRoutes = () => [...(tab('Messages')?.state?.routes ?? []), ...(tab('ClientsStack')?.state?.routes ?? [])].filter((r) => r.name === 'ClientMessages');

const originalOS = Platform.OS;
let timing: jest.SpyInstance;
beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  mockFlags.coachTabsV2 = true;
  mockSwitches.v2 = true;
  mockSwitches.loading = false;
  mockGet.mockReset();
  mockGetClients.mockReset();
  mockGetUnread.mockReset();
  inbox = () => Promise.resolve(page([thread(RAY), thread(DANA)]));
  roster = () => Promise.resolve({ data: [rosterRow(RAY), rosterRow(DANA)] });
  unread = () => Promise.resolve({ data: { total: 1, by_client: { [DANA.id]: 1 }, closed_client_ids: [] } });
  mockGet.mockImplementation((url: string) => (String(url).startsWith('/coach/messages/inbox') ? inbox(url) : Promise.resolve({ data: {} })));
  mockGetClients.mockImplementation(() => roster());
  mockGetUnread.mockImplementation(() => unread());
  useCoachStore.getState().reset();
  useBlockedUsersStore.setState({ blocked: [] });
  require('../../utils/authEvents').authEvents.emit('logout'); // no kept reply carries from one test to the next
  __resetPushTapRouterForTests();
  mockAddResponse.mockClear();
  mockAddReceived.mockClear();
  stopResponses = installNotificationResponseHandler(routePushTap);
  stopReceived = installForegroundHandler();
  timing = jest.spyOn(Animated, 'timing').mockReturnValue({
    start: (done?: (r: { finished: boolean }) => void) => done?.({ finished: true }), stop: jest.fn(), reset: jest.fn(),
  } as never);
});
afterEach(async () => {
  stopResponses();
  stopReceived();
  timing.mockRestore();
  await act(async () => foregroundBannerStore.getState().reset());
});
afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS }));

/** S1's ending, the same by every way in: the chat over the list, the id spent, Back to the list, nothing re-opens. */
async function endsOnHerChat(p: Person = DANA) {
  await waitFor(() => inChat(p));
  expect(stackOf('Messages')).toEqual(['MessagesInbox', 'ClientMessages']);
  expect(listRoute()?.params?.clientId).toBeUndefined();
  await act(async () => ref.goBack());
  await settle();
  await act(async () => { await qc.refetchQueries(); });
  await settle();
  expect(onTheList()).toEqual(LIST());
}

describe('C1 S1: each way in ends on her chat through her row', () => {
  it('the lock-screen tap, the app alive on another tab', async () => {
    await mount();
    signIn();
    await lockTap(DANA.id);
    await endsOnHerChat();
  });

  it('the cold start: held while the session is unknown, then onboarding, then the app', async () => {
    setPushSession({ kind: 'unknown' });
    mockGetLast.mockReturnValueOnce(Promise.resolve({ notification: notification(pushData(DANA.id)) }));
    stopResponses();
    stopResponses = installNotificationResponseHandler(routePushTap);
    await settle();
    await mount();
    setPushSession({ kind: 'onboarding', userId: COACH });
    expect(focusedTab()).not.toBe('Messages');
    await act(async () => signIn());
    await settle();
    await endsOnHerChat();
  });

  it('the cold start with her row in the pages restored for this coach', async () => {
    setPushSession({ kind: 'unknown' });
    mockGetLast.mockReturnValueOnce(Promise.resolve({ notification: notification(pushData(DANA.id)) }));
    stopResponses();
    stopResponses = installNotificationResponseHandler(routePushTap);
    await settle();
    const late = deferred<unknown>();
    inbox = () => late.promise; // the mount's own read is still out: the restored row decides
    await mount([thread(RAY), thread(DANA)]);
    await act(async () => signIn());
    await settle();
    inChat(DANA);
    await act(async () => late.resolve(page([thread(RAY), thread(DANA)])));
    await endsOnHerChat();
  });

  it('the slip: received on another tab, drawn, pressed', async () => {
    const view = await mount();
    signIn();
    await receive(DANA.id);
    await fireEvent.press(view.getByLabelText(SLIP));
    await settle();
    await endsOnHerChat();
  });

  it('the slip received on the list itself (no id there): drawn and pressed', async () => {
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    await receive(DANA.id);
    await fireEvent.press(view.getByLabelText(SLIP));
    await settle();
    await endsOnHerChat();
  });
});

describe('C2: the state after the notification tap equals the state after her own tap on that row', () => {
  it.each([
    ['v2 list, six tabs', true, true],
    ['v2 list, six tabs off', true, false],
    ['older list, six tabs', false, true],
    ['older list, six tabs off', false, false],
  ])('%s', async (_name, v2, tabs) => {
    mockSwitches.v2 = v2;
    mockFlags.coachTabsV2 = tabs;
    const own = await mount();
    await openMessagesTab(own);
    await pressRow(own, DANA);
    const byHand = shape(rootState());
    await own.unmount();
    useCoachStore.getState().reset();
    __resetPushTapRouterForTests();
    await mount();
    signIn();
    await lockTap(DANA.id);
    await waitFor(() => inChat(DANA));
    expect(shape(rootState())).toEqual(byHand);
  });
});

describe('C3 S2 and S3: the row not in memory yet, one read of the list for the tap', () => {
  it('S2 the first read still out (a cold start, nothing restored): the skeleton, then the chat; one read in all', async () => {
    const late = deferred<unknown>();
    inbox = () => late.promise;
    await mount();
    signIn();
    await lockTap(DANA.id);
    expect(onTheList()).toEqual(LIST());
    await act(async () => late.resolve(page([thread(RAY), thread(DANA)])));
    await settle();
    await waitFor(() => inChat(DANA));
    expect(inboxReads()).toBe(1); // the mount's own read, which the tap joined
    await endsOnHerChat();
  });

  it('S3 rows in memory without her, the list in front: one re-read brings her and the chat opens', async () => {
    inbox = () => Promise.resolve(page([thread(RAY)]));
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    const before = inboxReads();
    inbox = () => Promise.resolve(page([thread(DANA), thread(RAY)]));
    await lockTap(DANA.id);
    await waitFor(() => inChat(DANA));
    expect(inboxReads()).toBe(before + 1);
  });
});

describe('C4 S4: no row for her, she stays on the list and nothing opens later', () => {
  const cases: [string, () => void][] = [
    ['her chat closed (t.closed)', () => { inbox = () => Promise.resolve(page([thread(RAY), thread(DANA, { closed: true })])); }],
    ['blocked by me (blocked_by_me)', () => { inbox = () => Promise.resolve(page([thread(RAY), thread(DANA, { blocked_by_me: true })])); }],
    ['closed by her block (closed_client_ids)', () => { inbox = () => Promise.resolve(page([thread(RAY)], [DANA.id])); }],
    ['in my own block list', () => useBlockedUsersStore.setState({ blocked: [{ id: DANA.id, displayName: DANA.name, blockedAt: '2026-11-27T09:00:00.000Z' }] })],
    ['not in the answer (moved to another coach)', () => { inbox = () => Promise.resolve(page([thread(RAY)])); }],
  ];
  it.each(cases)('%s', async (_name, arrange) => {
    arrange();
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    await lockTap(DANA.id);
    expect(onTheList()).toEqual(LIST());
    expect(chatRoutes()).toEqual([]);
    useBlockedUsersStore.setState({ blocked: [] });
    inbox = () => Promise.resolve(page([thread(DANA), thread(RAY)]));
    await act(async () => { await qc.refetchQueries(); });
    await settle();
    expect(onTheList()).toEqual(LIST());
    expect(chatRoutes()).toEqual([]);
  });

  it('an id that is not one of her clients', async () => {
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    await lockTap(NOT_HERS);
    expect([onTheList(), chatRoutes()]).toEqual([LIST(), []]);
  });

  it('the Unread chip on, her row read elsewhere', async () => {
    inbox = (url) => Promise.resolve(page(url.includes('filter=unread') ? [thread(RAY)] : [thread(RAY), thread(DANA, { unread_count: 0 })]));
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    await fireEvent.press(view.getByLabelText('Unread conversations'));
    await settle();
    await lockTap(DANA.id);
    expect([onTheList(), chatRoutes()]).toEqual([LIST(), []]);
  });

  it('the id is spent once the answer has no row (Back, a refresh and the slip never see it again)', async () => {
    inbox = () => Promise.resolve(page([thread(RAY)]));
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    await lockTap(DANA.id);
    await waitFor(() => expect(listRoute()?.params?.clientId).toBeUndefined());
  });
});

describe('C5 S5: the read fails', () => {
  it('the first read fails: "Inbox did not load", nothing opens, Try again opens nothing', async () => {
    inbox = () => Promise.reject(FAILED);
    const view = await mount();
    signIn();
    await lockTap(DANA.id);
    expect(await view.findByText('Inbox did not load')).toBeTruthy();
    expect([onTheList(), chatRoutes()]).toEqual([LIST(), []]);
    inbox = () => Promise.resolve(page([thread(DANA)]));
    await fireEvent.press(view.getByLabelText('Try again'));
    await settle();
    expect([onTheList(), chatRoutes()]).toEqual([LIST(), []]);
  });

  it('a re-read fails with rows kept: nothing opens', async () => {
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    inbox = () => Promise.reject(FAILED);
    await lockTap(NOT_HERS); // not in the rows: the tap's re-read is made, and fails
    expect(view.getByLabelText(new RegExp(`^Open messages with ${DANA.name}`))).toBeTruthy();
    expect([onTheList(), chatRoutes()]).toEqual([LIST(), []]);
  });
});

describe('C6 S6: no usable id, today\'s landing, no read started by the tap', () => {
  it.each([
    ['an older push with no actionParams', { actionScreen: 'Messages', deepLink: `tgp://messages/${DANA.id}`, kind: 'message_received' }],
    ['a clientId that is not a UUID', { ...pushData(DANA.id), actionParams: { clientId: 'dana' } }],
    ['a bare tgp://messages link', { deepLink: 'tgp://messages', kind: 'message_received' }],
  ])('%s', async (_name, data) => {
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    const before = inboxReads();
    await lockTap(DANA.id, data);
    expect([onTheList(), chatRoutes(), inboxReads()]).toEqual([LIST(), [], before]);
  });
});

describe('C7 S7 and S8: the switches and the two lists', () => {
  it('S7 the switches still loading at the tap, then v2 on: decided once, by the v2 list (its row\'s name)', async () => {
    mockSwitches.loading = true;
    mockSwitches.v2 = false;
    inbox = () => Promise.resolve(page([thread(RAY), thread({ id: DANA.id, name: 'Dana C.' })])); // the v2 row's name
    await mount();
    signIn();
    await lockTap(DANA.id);
    expect(onTheList()).toEqual(LIST());
    await act(async () => { mockSwitches.loading = false; mockSwitches.v2 = true; mockSwitches.seen.forEach((l) => l()); });
    await settle();
    await waitFor(() => inChat(DANA, 'Dana C.'));
    expect(chatRoutes()).toHaveLength(1);
  });

  it('S8 the v2 list hands back to the older list (503) with the tap un-spent: decided by the older list (its row\'s name)', async () => {
    inbox = () => Promise.reject(DISABLED);
    await mount();
    signIn();
    await lockTap(DANA.id);
    await waitFor(() => inChat(DANA));
    expect(chatRoutes()).toHaveLength(1);
  });
});

describe('C8 S9 and S10: dropped, never late', () => {
  const lateRead = () => {
    const late = deferred<unknown>();
    inbox = () => late.promise;
    return late;
  };
  it('she opens another row before the answer: her chat stays, the answer opens nothing', async () => {
    inbox = () => Promise.resolve(page([thread(RAY)]));
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    const late = lateRead();
    await lockTap(DANA.id);
    await pressRow(view, RAY);
    await act(async () => late.resolve(page([thread(RAY), thread(DANA)])));
    await settle();
    expect([stackOf('Messages'), topRoute()?.params]).toEqual([['MessagesInbox', 'ClientMessages'], { ...chatOf(RAY), initialDraft: undefined }]);
    await act(async () => ref.goBack());
    await settle();
    expect(onTheList()).toEqual(LIST());
  });

  it('she switches tab before the answer: the tab stays, the answer opens nothing', async () => {
    inbox = () => Promise.resolve(page([thread(RAY)]));
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    const late = lateRead();
    await lockTap(DANA.id);
    await fireEvent.press(view.getByRole('tab', { name: /^Clients/ }));
    await act(async () => late.resolve(page([thread(RAY), thread(DANA)])));
    await settle();
    expect([focusedTab(), chatRoutes()]).toEqual(['ClientsStack', []]);
    await fireEvent.press(view.getByRole('tab', { name: /^Messages/ }));
    await settle();
    expect([onTheList(), chatRoutes()]).toEqual([LIST(), []]);
  });

  it('a newer tap for another client before the answer: the older one never opens', async () => {
    inbox = () => Promise.resolve(page([thread(RAY)]));
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    const late = lateRead();
    await lockTap(DANA.id);
    await lockTap('2e4f6a8c-0b1d-4e3f-9a5b-7c9d1e3f5a04'); // newer, and not in the answer
    await act(async () => late.resolve(page([thread(RAY), thread(DANA)])));
    await settle();
    expect([onTheList(), chatRoutes()]).toEqual([LIST(), []]);
  });

  it('a newer tap for another client before the answer: only the newest opens (C8 opens)', async () => {
    inbox = () => Promise.resolve(page([]));
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    const late = lateRead();
    await lockTap(DANA.id);
    await lockTap(RAY.id);
    await act(async () => late.resolve(page([thread(RAY), thread(DANA)])));
    await settle();
    await waitFor(() => inChat(RAY));
    expect(chatRoutes()).toHaveLength(1);
  });
});

describe('C9 S11 and S12: a chat already open in Messages', () => {
  it('S11 another client\'s chat with unsent text: [list, the asked chat], the other text kept', async () => {
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    await pressRow(view, RAY);
    await fireEvent.changeText(view.getByLabelText('Message text'), 'See you at six');
    await lockTap(DANA.id);
    await waitFor(() => inChat(DANA));
    expect([stackOf('Messages'), box(view)]).toEqual([['MessagesInbox', 'ClientMessages'], '']);
    await act(async () => ref.goBack());
    await settle();
    await pressRow(view, RAY);
    expect(box(view)).toBe('See you at six');
  });

  it('S12 her own chat with unsent text: one chat route for her, her text back in the box', async () => {
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    await pressRow(view, DANA);
    await fireEvent.changeText(view.getByLabelText('Message text'), 'Half a thought');
    await lockTap(DANA.id);
    await waitFor(() => inChat(DANA));
    expect([stackOf('Messages'), chatRoutes().length, box(view)]).toEqual([['MessagesInbox', 'ClientMessages'], 1, 'Half a thought']);
  });
});

describe('C10 S14, S15, S16', () => {
  it('S14 six tabs off: ClientsStack > ClientMessages over the client list, as her row opens it', async () => {
    mockFlags.coachTabsV2 = false;
    await mount();
    signIn();
    await lockTap(DANA.id);
    await waitFor(() => inChat(DANA));
    expect([stackOf('ClientsStack'), listRoute()?.params?.clientId]).toEqual([['ClientsList', 'ClientMessages'], undefined]);
  });

  it('S15 search typed: her row is found before search, and her search text stays', async () => {
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    await fireEvent.changeText(view.getByLabelText('Search conversations'), 'Ray');
    await settle();
    await lockTap(DANA.id);
    await waitFor(() => inChat(DANA));
    await act(async () => ref.goBack());
    await settle();
    expect(view.getByLabelText('Search conversations').props.value).toBe('Ray');
  });

  it('S15 the Unread chip on: her unread row opens, and the chip stays on', async () => {
    inbox = (url) => Promise.resolve(page(url.includes('filter=unread') ? [thread(DANA)] : [thread(RAY), thread(DANA)]));
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    await fireEvent.press(view.getByLabelText('Unread conversations'));
    await settle();
    await lockTap(DANA.id);
    await waitFor(() => inChat(DANA));
    await act(async () => ref.goBack());
    await settle();
    expect(view.getByLabelText('Unread conversations')).toBeSelected();
  });

  it('S16 the v2 row with no name: the chat opens as "Client", as that row does', async () => {
    inbox = () => Promise.resolve(page([thread(RAY), thread({ id: DANA.id, name: '' })]));
    await mount();
    signIn();
    await lockTap(DANA.id);
    await waitFor(() => inChat(DANA, 'Client'));
  });

  it('S16 the older list, a client with no name: no row, nothing opens', async () => {
    mockSwitches.v2 = false;
    roster = () => Promise.resolve({ data: [rosterRow(RAY), rosterRow({ id: DANA.id, name: '' })] });
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    await lockTap(DANA.id);
    expect([onTheList(), chatRoutes()]).toEqual([LIST(), []]);
  });
});

describe('C11 S17: the slip after a spent tap', () => {
  it('a new push from the same client on the list shows the slip, and its tap opens her chat again', async () => {
    const view = await mount();
    signIn();
    await lockTap(DANA.id);
    await waitFor(() => inChat(DANA));
    await act(async () => ref.goBack());
    await settle();
    await receive(DANA.id);
    await fireEvent.press(view.getByLabelText(SLIP));
    await settle();
    await waitFor(() => inChat(DANA));
  });

  it('in her open chat the same client\'s push is held back; another client\'s shows', async () => {
    const view = await mount();
    signIn();
    await openMessagesTab(view);
    await pressRow(view, DANA);
    await receive(DANA.id);
    expect(view.queryByLabelText(SLIP)).toBeNull();
    await receive(RAY.id);
    expect(view.getByLabelText(SLIP)).toBeTruthy();
  });
});

describe('C12 S19: the older list decides only after its own unread read (R7)', () => {
  it('a client closed by a block, the unread read answered late: nothing opens before or after it answers', async () => {
    mockSwitches.v2 = false;
    const late = deferred<unknown>();
    unread = () => late.promise;
    await mount();
    signIn();
    await lockTap(DANA.id);
    expect([onTheList(), chatRoutes()]).toEqual([LIST(), []]);
    await act(async () => late.resolve({ data: { total: 0, by_client: {}, closed_client_ids: [DANA.id] } }));
    await settle();
    expect([onTheList(), chatRoutes()]).toEqual([LIST(), []]);
  });
});

describe('C13 S20: a client\'s session and a client\'s push', () => {
  it('makes the navigate it makes today, nothing more', () => {
    const navigate = jest.fn();
    attachPushNavigator({ isReady: () => true, navigate, dispatch: jest.fn(), getRootState: () => ({ routeNames: ['Home', 'WorkoutTab', 'MoreTab'], routes: [] }) });
    setPushSession({ kind: 'app', userId: DANA.id, role: 'student' });
    const listener = mockAddResponse.mock.calls[mockAddResponse.mock.calls.length - 1][0] as (r: unknown) => void;
    listener({ notification: notification({ actionScreen: 'Messages', deepLink: `tgp://messages/${DANA.id}`, kind: 'message_received' }) });
    expect(navigate.mock.calls).toEqual([['Home', { screen: 'Messages', params: undefined }]]);
  });
});
