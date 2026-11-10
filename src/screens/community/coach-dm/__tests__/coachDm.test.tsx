/**
 * COACH-DM-M (owner 203-D3, Studio look #203-E25; PLAN on m#962): every way a coach reaches a community DM with a
 * client opens that one client's thread, with that client's roster name, or the closed line the server's answer gives.
 *
 * The real coach Community stack (CoachCommunityNavigator) is mounted in a tab navigator that holds SettingsStack, as
 * CoachNavigator does, so Back, New message's replace and BAM-2a's Settings link run on real stack state. Only the HTTP
 * edge (services/api get/post and coachApi.getClients), the theme, icons, the device store, the signed-in person, the
 * one-time terms gate, the dashboard hook of today's home and the six other Community screens are stubbed. Fixtures copy
 * the server's answers key for key (backend lines cited at main 1462408a and b#1243 e760b3e0). Names are fictional.
 */
import React from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── The HTTP edge ───────────────────────────────────────────────────────────────────────────────────────────────────
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockGetClients = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => mockGet(...a),
    post: (...a: unknown[]) => mockPost(...a),
    patch: (...a: unknown[]) => mockPost(...a),
    put: (...a: unknown[]) => mockPost(...a),
    delete: (...a: unknown[]) => mockPost(...a),
  },
  coachApi: { getClients: (...a: unknown[]) => mockGetClients(...a) },
}));

// Every switch on ([R27]); the cases flip communityDm and coachTabsV2.
const mockFlags: Record<string, unknown> = {};
jest.mock('../../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../../config/featureFlags');
  for (const [k, v] of Object.entries(actual.featureFlags)) mockFlags[k] = typeof v === 'boolean' ? true : v;
  return { ...actual, featureFlags: mockFlags };
});
const mockTheme = () => {
  const tokens = jest.requireActual('../../../../theme/tokens');
  return { colors: jest.requireActual('../../../../constants/colors').default, tokens: tokens.default, semanticColors: tokens.lightTokens, colorScheme: 'light', isDark: false };
};
jest.mock('../../../../theme/useTheme', () => ({ useTheme: () => mockTheme() }));
jest.mock('../../../../theme/ThemeProvider', () => ({
  useTheme: () => mockTheme(),
  LightTheme: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => {
  const Icon = () => null;
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});
const mockDisk = new Map<string, string>();
jest.mock('../../../../storage/mmkv', () => ({
  cacheStorage: {
    getString: (k: string) => mockDisk.get(k),
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
}));
let mockUser: { id: string; role: string; name: string; firstName: string; coach_id: string | null } | null = null;
jest.mock('../../../../hooks/useCurrentUser', () => ({
  ...jest.requireActual('../../../../hooks/useCurrentUser'),
  useCurrentUser: () => mockUser,
}));
// Apple 1.2's one-time terms gate is not under test: the stack behind it is.
jest.mock('../../../../components/community/CommunityTermsGate', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
// Today's home reads its own dashboard; its three cards are not under test, only the one Direct messages row beside them.
jest.mock('../../../../hooks/useCoachCommunity', () => ({
  ...jest.requireActual('../../../../hooks/useCoachCommunity'),
  useCoachDashboard: () => ({
    data: { unread_inbox_count: 2, active_cohort_count: 1, flagged_today_count: 0 },
    isLoading: false, isError: false, isRefetching: false, refetch: jest.fn(),
  }),
  useCoachEmptyStatePayload: () => ({ status: 'loading', retry: jest.fn() }),
}));
for (const name of ['CoachCommunityInboxScreen', 'CoachCommunityCohortsScreen', 'CoachCommunityCohortDetailScreen',
  'CoachCommunityPostDetailScreen', 'CoachCommunityModerationScreen', 'CoachCommunityEventsScreen',
  'CommunityWearablePromptsScreen', 'CommunityVoiceNoteDetail']) {
  jest.doMock(`../../${name}`, () => ({ __esModule: true, default: () => null, InboxNoticeCard: () => null }));
}

const CoachCommunityNavigator = require('../../../../navigation/CoachCommunityNavigator').default;
const { settleAndClearQueryCache } = require('../../../../services/queryClient');
const { authEvents } = require('../../../../utils/authEvents');
const { resolveAppLink } = require('../../../../navigation/incomingLinks');
const router = require('../../../../services/pushTapRouter');
const { normalizeNotification } = require('../../../../services/notificationsApi');
const { useBlockedUsersStore } = require('../../../../store/blockedUsersStore');

// ─── Ids and the server's answers ────────────────────────────────────────────────────────────────────────────────────
const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1);
const COACH = uuid(20);
const COACH_B = uuid(21);
const JORDAN = uuid(30); // roster page 1
const RILEY = uuid(31); // roster page 1
const MAYA = uuid(32); // roster page 2
const MARCUS = uuid(33); // archived (status=all only)
const PRIYA = uuid(34); // active, never opened Community
const NONAME = uuid(35); // a roster row with an empty name
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LIST_URL = `/community/workspaces/${WS}/dms`;
const msgsUrl = (other: string) => `/community/workspaces/${WS}/dms/${other}/messages`;
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** GET /community/me for a workspace coach: their own workspace, no membership (community.service.ts:110-183). */
const ME = (communityDm = true, workspaceId: string | null = WS) => ({
  feature_flag_state: 'enabled', workspace_id: workspaceId, membership: null,
  unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  flags: { community_api: true, community_dm: communityDm, community_realtime: false, community_push: true, community_telemetry: false },
});
/** A DM list row, strict (community-dm.dto.ts:25-33; b#1243 community-dms.service.ts listThreads). */
const thread = (other: string, lastAt: string, me = COACH) => ({
  thread_id: `${WS}:${[me, other].sort().join(':')}`, workspace_id: WS, other_user_id: other, created_at: null, last_message_at: lastAt,
});
/** A DM message (community-dm.dto.ts:51-60; community-dms.service.ts messageView). */
const msg = (id: number, from: string, to: string, body: string, at: string) => ({
  id: uuid(id), thread_id: `${WS}:${[from, to].sort().join(':')}`, sender_user_id: from, recipient_user_id: to, body, created_at: at, deleted: false,
});
/** A GET /coach/clients row (coach.service.ts:179-204 findMany on User, roster fields; coach.controller.ts:64-78). */
const client = (id: string, name: string, archivedAt: string | null = null) => ({
  id, email: `${id.slice(0, 8)}@example.com`, name, role: 'student', coach_id: COACH, archived_at: archivedAt,
  created_at: '2026-10-01T00:00:00.000Z', activity: null,
});
const PAGE1 = [client(JORDAN, 'Jordan Lee'), client(RILEY, 'Riley Park'), ...Array.from({ length: 48 }, (_, i) => client(uuid(500 + i), `Filler ${i}`))];
const PAGE2 = [client(MAYA, 'Maya Chen'), client(MARCUS, 'Marcus Bell', '2026-11-01T00:00:00.000Z'), client(PRIYA, 'Priya Shah'), client(NONAME, '  ')];
/** status=all, 50 a page, cursor = the last row's id (coach.service.ts:191-202). Active only for status=active. */
function roster(status: string, cursor?: string) {
  const all = [...PAGE1, ...PAGE2].filter((c) => status === 'all' || (status === 'active' && !c.archived_at) || (status === 'archived' && c.archived_at));
  const start = cursor ? all.findIndex((c) => c.id === cursor) + 1 : 0;
  return { data: all.slice(start, start + 50) };
}
const axiosErr = (status: number, data: Record<string, unknown> = {}) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data } });
const NOT_FOUND = axiosErr(404, { error: 'not_found', code: 'community.dm.not_found' });
const DISABLED = axiosErr(403, { error: 'forbidden', code: 'community.dm.disabled' });
const BLOCKED_BY_YOU = axiosErr(403, { error: 'forbidden', code: 'community.dm.blocked_by_you' });
const BLOCKED_BY_THEM = axiosErr(403, { error: 'forbidden', code: 'community.dm.blocked_by_them' });
const OFFLINE = Object.assign(new Error('Network Error'), { isAxiosError: true });

type Answer = unknown | ((url: string, config?: { params?: Record<string, string> }) => unknown);
let http: Record<string, Answer> = {};
function serve(answers: Record<string, Answer>) {
  http = answers;
  mockGet.mockImplementation(async (url: string, config?: { params?: Record<string, string> }) => {
    const key = url.split('?')[0];
    if (!(key in http)) throw axiosErr(404, { error: 'not_found' });
    const a = http[key];
    const value = typeof a === 'function' ? (a as (u: string, c?: unknown) => unknown)(url, config) : a;
    if (value instanceof Error) throw value;
    if (value === PENDING) return new Promise(() => undefined);
    return { data: value, headers: {} };
  });
}
const PENDING = Symbol('pending');
const THREE = [thread(JORDAN, ago(1 * HOUR)), thread(RILEY, ago(5 * HOUR)), thread(MAYA, ago(26 * HOUR))];
const base = (extra: Record<string, Answer> = {}) => ({ '/community/me': ME(), [LIST_URL]: { threads: THREE }, ...extra });

// ─── The mounted coach tabs: Community (the real stack) and Settings (its Blocked users) ─────────────────────────────
const Tab = createBottomTabNavigator();
const SettingsStack = createNativeStackNavigator();
const Probe = ({ label }: { label: string }) => <Text>{label}</Text>;
function SettingsStackNavigator() {
  return (
    <SettingsStack.Navigator>
      <SettingsStack.Screen name="SettingsHome">{() => <Probe label="settings-home" />}</SettingsStack.Screen>
      <SettingsStack.Screen name="BlockedUsers">{() => <Probe label="blocked-users" />}</SettingsStack.Screen>
    </SettingsStack.Navigator>
  );
}
const ref = createNavigationContainerRef<ParamListBase>();
let qc: QueryClient;
async function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity } } });
  return await render(
    <QueryClientProvider client={qc}>
      <NavigationContainer ref={ref}>
        <Tab.Navigator initialRouteName="CommunityStack">
          <Tab.Screen name="CommunityStack" component={CoachCommunityNavigator} />
          <Tab.Screen name="SettingsStack" component={SettingsStackNavigator} />
        </Tab.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}
const current = () => ref.getCurrentRoute();
const go = (screen: string, params?: object) => act(async () => { ref.navigate('CommunityStack', { screen, params, initial: false }); });
async function openThread(recipientId: string, name?: string) {
  const view = await mount();
  await waitFor(() => expect(ref.isReady()).toBe(true));
  await go('CommunityDmThread', name ? { recipientId, name } : { recipientId });
  return view;
}
async function openList() {
  const view = await mount();
  await waitFor(() => expect(ref.isReady()).toBe(true));
  await go('CoachCommunityDmList');
  return view;
}

beforeEach(async () => {
  for (const k of Object.keys(mockFlags)) if (typeof mockFlags[k] === 'boolean') mockFlags[k] = true;
  mockUser = { id: COACH, role: 'coach', name: 'Sam Rivera', firstName: 'Sam', coach_id: null };
  mockGet.mockReset();
  mockPost.mockReset();
  mockGetClients.mockReset().mockImplementation(async (status: string, cursor?: string) => roster(status, cursor));
  router.__resetPushTapRouterForTests();
  useBlockedUsersStore.setState?.({ blocked: [] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  authEvents.emit('logout'); // no draft or closed refusal from the case before
  await waitFor(() => expect([...mockDisk.keys()].filter((k) => k.startsWith('chat_draft_'))).toEqual([]));
});
afterEach(() => jest.restoreAllMocks());

// ─── 1, 14. The entry row ────────────────────────────────────────────────────────────────────────────────────────────
describe('1. the Direct messages row on today\'s coach Community home', () => {
  it('both switches on: one row, and one tap opens the list', async () => {
    serve(base());
    const view = await mount();
    await waitFor(() => expect(view.getAllByTestId('coach-dm-entry')).toHaveLength(1));
    expect(view.getByText('Direct messages')).toBeTruthy();
    const routesBefore = ref.getRootState().routes.find((r) => r.name === 'CommunityStack')?.state?.routes?.length ?? 1;
    await act(async () => { fireEvent.press(view.getByTestId('coach-dm-entry')); });
    await waitFor(() => expect(current()?.name).toBe('CoachCommunityDmList'));
    expect(ref.getRootState().routes.find((r) => r.name === 'CommunityStack')?.state?.routes).toHaveLength(routesBefore + 1);
  });

  it('communityDm off: no row, and the coach link resolves to nothing', async () => {
    mockFlags.communityDm = false;
    serve(base());
    const view = await mount();
    await waitFor(() => expect(view.getByText('Unread in your inbox')).toBeTruthy());
    expect(view.queryByTestId('coach-dm-entry')).toBeNull();
    expect(resolveAppLink(`community/dm/${JORDAN}`, 'coach')).toBeNull();
  });

  it('14. coachTabsV2 off: the row still opens the list from the Community tab\'s home', async () => {
    mockFlags.coachTabsV2 = false;
    serve(base());
    const view = await mount();
    await waitFor(() => expect(view.getByTestId('coach-dm-entry')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('coach-dm-entry')); });
    await waitFor(() => expect(current()?.name).toBe('CoachCommunityDmList'));
  });
});

// ─── 2. The row's count ──────────────────────────────────────────────────────────────────────────────────────────────
describe('2. "{n} conversations" only on a whole read', () => {
  const countOf = async (answers: Record<string, Answer>) => {
    serve(answers);
    const view = await mount();
    await waitFor(() => expect(view.getByTestId('coach-dm-entry')).toBeTruthy());
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    return view;
  };
  it('a short page (3 of the 100 asked) shows "3 conversations"; the list asks ?limit=100', async () => {
    const view = await countOf(base());
    await waitFor(() => expect(within(view.getByTestId('coach-dm-entry')).getByText('3 conversations')).toBeTruthy());
    expect(mockGet).toHaveBeenCalledWith(LIST_URL, { params: { limit: '100' } });
  });
  it('a full page (100 rows) shows no count', async () => {
    const full = Array.from({ length: 100 }, (_, i) => thread(uuid(600 + i), ago(i * HOUR)));
    const view = await countOf(base({ [LIST_URL]: { threads: full } }));
    expect(within(view.getByTestId('coach-dm-entry')).queryByText(/conversation/)).toBeNull();
  });
  it.each([
    ['DMs off (403 community.dm.disabled)', { [LIST_URL]: DISABLED }],
    ['a failed read', { [LIST_URL]: OFFLINE }],
    ['the server switch off (flags.community_dm false)', { '/community/me': ME(false) }],
  ])('%s: no count', async (_label, extra) => {
    const view = await countOf(base(extra as Record<string, Answer>));
    expect(within(view.getByTestId('coach-dm-entry')).queryByText(/conversation/)).toBeNull();
  });
});

// ─── 3, 4, 5. The list ───────────────────────────────────────────────────────────────────────────────────────────────
describe('3. list names from the roster, newest first', () => {
  it('A, B and C show the roster name, initials and "Active {time} ago"; page 2 and an archived client are named', async () => {
    serve(base({ [LIST_URL]: { threads: [...THREE, thread(MARCUS, ago(50 * HOUR))] } }));
    const view = await openList();
    await waitFor(() => expect(view.getByTestId(`coach-dm-row-${JORDAN}`)).toBeTruthy());
    const rows = view.getAllByTestId(/^coach-dm-row-/).map((r) => r.props.testID);
    expect(rows).toEqual([JORDAN, RILEY, MAYA, MARCUS].map((id) => `coach-dm-row-${id}`));
    const row = (id: string) => within(view.getByTestId(`coach-dm-row-${id}`));
    expect(row(JORDAN).getByText('Jordan Lee')).toBeTruthy();
    expect(row(JORDAN).getByText('JL')).toBeTruthy();
    expect(row(JORDAN).getByText('Active 1h ago')).toBeTruthy();
    expect(row(RILEY).getByText('Riley Park')).toBeTruthy();
    expect(row(MAYA).getByText('Maya Chen')).toBeTruthy(); // roster page 2
    expect(row(MAYA).getByText('Active 1d ago')).toBeTruthy();
    expect(row(MARCUS).getByText('Marcus Bell')).toBeTruthy(); // archived: named from status=all
    expect(mockGetClients).toHaveBeenCalledWith('all', undefined, 50);
    expect(mockGetClients).toHaveBeenCalledWith('all', PAGE1[49].id, 50);
    expect(view.queryByText('Coach')).toBeNull();
  });

  it('the shared coach roster is never written (archived rows stay out of coachStore)', async () => {
    const { useCoachStore } = require('../../../../store/coachStore');
    useCoachStore.getState().reset();
    serve(base());
    const view = await openList();
    await waitFor(() => expect(view.getByText('Maya Chen')).toBeTruthy());
    expect(useCoachStore.getState().clients).toEqual([]);
  });

  it('a thread whose client has no roster name reads "Direct message", never a blank, an id or an email', async () => {
    serve(base({ [LIST_URL]: { threads: [thread(NONAME, ago(HOUR))] } }));
    const view = await openList();
    await waitFor(() => expect(view.getByTestId(`coach-dm-row-${NONAME}`)).toBeTruthy());
    const row = within(view.getByTestId(`coach-dm-row-${NONAME}`));
    expect(row.getByText('Direct message')).toBeTruthy();
    expect(row.queryByText(/example\.com|Unnamed client|Coach|0000/)).toBeNull();
  });
});

describe('4. list states', () => {
  it('403 community.dm.disabled: list_off, with no switch and no New message', async () => {
    serve(base({ [LIST_URL]: DISABLED }));
    const view = await openList();
    await waitFor(() => expect(view.getByText('Direct messages are off')).toBeTruthy());
    expect(view.getByText('Your clients cannot send you direct messages in your community yet.')).toBeTruthy();
    expect(view.queryByRole('switch')).toBeNull();
    expect(view.queryByTestId('coach-dm-new')).toBeNull();
  });
  it('a failed read: list_error, and Try again reads again', async () => {
    let failing = true;
    let calls = 0;
    serve(base({ [LIST_URL]: () => (++calls, failing ? OFFLINE : { threads: THREE }) }));
    const view = await openList();
    await waitFor(() => expect(view.getByText('Your conversations did not load. Check your connection, then try again.')).toBeTruthy());
    failing = false;
    const before = calls;
    await act(async () => { fireEvent.press(view.getByTestId('coach-dm-list-retry')); });
    await waitFor(() => expect(view.getByText('Jordan Lee')).toBeTruthy());
    expect(calls).toBe(before + 1);
  });
  it('loading', async () => {
    serve(base({ [LIST_URL]: PENDING }));
    const view = await openList();
    await waitFor(() => expect(view.getByTestId('coach-dm-list-loading')).toBeTruthy());
    expect(view.getByText('Loading…')).toBeTruthy();
  });
  it('empty: list_empty, whose Message a client opens New message', async () => {
    serve(base({ [LIST_URL]: { threads: [] } }));
    const view = await openList();
    await waitFor(() => expect(view.getByText('No conversations yet')).toBeTruthy());
    expect(view.getByText('When a client sends you a direct message in your community, it shows here.')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByText('Message a client')); });
    await waitFor(() => expect(current()?.name).toBe('CoachCommunityDmNew'));
  });
});

describe('5. a list row opens that client\'s thread', () => {
  it('opens {recipientId: other_user_id, name}; Back returns to the list', async () => {
    serve(base({ [msgsUrl(RILEY)]: { messages: [] } }));
    const view = await openList();
    await waitFor(() => expect(view.getByTestId(`coach-dm-row-${RILEY}`)).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId(`coach-dm-row-${RILEY}`)); });
    await waitFor(() => expect(current()?.name).toBe('CommunityDmThread'));
    expect(current()?.params).toEqual({ recipientId: RILEY, name: 'Riley Park' });
    await act(async () => { fireEvent.press(view.getByTestId('coach-dm-thread-header-back')); });
    await waitFor(() => expect(current()?.name).toBe('CoachCommunityDmList'));
  });
});

// ─── 6 to 9. The thread ──────────────────────────────────────────────────────────────────────────────────────────────
const DAY = 24 * HOUR;
const atLocal = (daysAgo: number, h: number, m: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const clock = (iso: string) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const CONVERSATION = [ // newest first (community-dms.repository.ts listThread orders created_at desc)
  msg(905, JORDAN, COACH, 'Great. Should I still do my own run on Friday then?', atLocal(0, 8, 15)),
  msg(904, COACH, JORDAN, 'There is. Bring water and come ten minutes early.', atLocal(1, 19, 2)),
  msg(903, JORDAN, COACH, 'Is there room for one more on Saturday?', atLocal(1, 18, 40)),
  msg(902, COACH, JORDAN, 'Yes. We move under the stand, same time.', atLocal(3, 17, 31)),
  msg(901, JORDAN, COACH, 'Is the Saturday session still on if it rains?', atLocal(3, 17, 10)),
];

describe('6. thread content', () => {
  it('messages both ways (mine by sender_user_id), times in the bubbles, Today and Yesterday rows, Report and Block on client messages', async () => {
    serve(base({ [msgsUrl(JORDAN)]: { messages: CONVERSATION } }));
    const view = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(view.getByTestId(`coach-dm-message-${uuid(905)}`)).toBeTruthy());
    const header = within(view.getByTestId('coach-dm-thread-header'));
    expect(header.getByText('Jordan Lee')).toBeTruthy();
    expect(header.getByText('Direct message')).toBeTruthy();
    expect(header.getByText('JL')).toBeTruthy();
    const align = (id: number) => StyleSheet.flatten(view.getByTestId(`coach-dm-message-${uuid(id)}`).props.style).alignItems;
    expect(align(904)).toBe('flex-end'); // the coach's own
    expect(align(905)).toBe('flex-start');
    for (const m of CONVERSATION) {
      expect(within(view.getByTestId(`coach-dm-message-${m.id}`)).getByText(clock(m.created_at))).toBeTruthy();
    }
    expect(view.getByText('Today')).toBeTruthy();
    expect(view.getByText('Yesterday')).toBeTruthy();
    for (const id of [901, 903, 905]) expect(view.getByTestId(`coach-dm-message-safety-${uuid(id)}`)).toBeTruthy();
    for (const id of [902, 904]) expect(view.queryByTestId(`coach-dm-message-safety-${uuid(id)}`)).toBeNull();
    await act(async () => { fireEvent.press(view.getByTestId(`coach-dm-message-safety-${uuid(905)}`)); });
    await waitFor(() => expect(view.getByTestId(`coach-dm-message-safety-${uuid(905)}-report`)).toBeTruthy());
    expect(view.getByTestId(`coach-dm-message-safety-${uuid(905)}-block`)).toBeTruthy();
    expect(view.getByLabelText('Block Jordan Lee')).toBeTruthy();
  });

  it('opened by link with no name: the thread reads the roster for the header', async () => {
    serve(base({ [msgsUrl(MAYA)]: { messages: [] } }));
    const view = await openThread(MAYA);
    await waitFor(() => expect(within(view.getByTestId('coach-dm-thread-header')).getByText('Maya Chen')).toBeTruthy());
  });
});

describe('7. send', () => {
  const FIELD = 'coach-dm-thread-composer-field';
  const SEND = 'coach-dm-thread-composer-send';
  it('one POST with the draft\'s send-once key', async () => {
    serve(base({ [msgsUrl(JORDAN)]: { messages: CONVERSATION } }));
    mockPost.mockResolvedValue({ data: { message: msg(950, COACH, JORDAN, 'See you Saturday', new Date().toISOString()) }, headers: {} });
    const view = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(view.getByTestId(FIELD)).toBeTruthy());
    await fireEvent.changeText(view.getByTestId(FIELD), 'See you Saturday');
    await act(async () => { fireEvent.press(view.getByTestId(SEND)); });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(msgsUrl(JORDAN), { body: 'See you Saturday' }, { headers: { 'Idempotency-Key': expect.stringMatching(KEY) } });
  });
  it.each([
    ['offline', OFFLINE, 'Message not sent'],
    ['a 422 (the words were refused)', axiosErr(422, { code: 'community.content.rejected' }), 'Please rephrase'],
  ])('a failed send (%s) says so and keeps the draft', async (_label, err, title) => {
    serve(base({ [msgsUrl(JORDAN)]: { messages: CONVERSATION } }));
    mockPost.mockRejectedValue(err);
    const view = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(view.getByTestId(FIELD)).toBeTruthy());
    await fireEvent.changeText(view.getByTestId(FIELD), 'Keep Friday easy');
    await act(async () => { fireEvent.press(view.getByTestId(SEND)); });
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(title, expect.any(String)));
    await waitFor(() => expect(view.getByTestId(FIELD).props.value).toBe('Keep Friday easy'));
  });
});

describe('8. closed', () => {
  it('404: BAM-1, no composer, no messages', async () => {
    serve(base({ [msgsUrl(JORDAN)]: NOT_FOUND }));
    const view = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(view.getByText('This conversation is closed')).toBeTruthy());
    expect(view.queryByTestId('coach-dm-thread-composer-field')).toBeNull();
    expect(view.queryAllByTestId(/^coach-dm-message-/)).toEqual([]);
  });
  it('403 blocked_by_you: BAM-2a, and Settings opens Settings > Blocked users', async () => {
    serve(base({ [msgsUrl(JORDAN)]: BLOCKED_BY_YOU }));
    const view = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(view.getByLabelText('You blocked them. Unblock in Settings')).toBeTruthy());
    expect(view.queryByTestId('coach-dm-thread-composer-field')).toBeNull();
    await act(async () => { fireEvent.press(view.getByTestId('coach-dm-thread-closed')); });
    await waitFor(() => expect(current()?.name).toBe('BlockedUsers'));
    const settings = ref.getRootState().routes.find((r) => r.name === 'SettingsStack');
    expect(settings?.state?.routes.map((r) => r.name)).toEqual(['SettingsHome', 'BlockedUsers']);
  });
  it('403 blocked_by_them: BAM-2b with the roster name', async () => {
    serve(base({ [msgsUrl(JORDAN)]: BLOCKED_BY_THEM }));
    const view = await openThread(JORDAN);
    await waitFor(() => expect(view.getByText('Jordan Lee has blocked you')).toBeTruthy());
  });
  it('403 blocked_by_them with no roster name: BAM-1, never a made-up name', async () => {
    serve(base({ [msgsUrl(NONAME)]: BLOCKED_BY_THEM }));
    const view = await openThread(NONAME);
    await waitFor(() => expect(view.getByText('This conversation is closed')).toBeTruthy());
    expect(within(view.getByTestId('coach-dm-thread-header')).getByText('Direct message')).toBeTruthy();
    expect(view.queryByText(/has blocked you/)).toBeNull();
  });
  it('the server\'s DMs off on the thread read: the off lines, no composer', async () => {
    serve(base({ [msgsUrl(JORDAN)]: DISABLED }));
    const view = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(view.getByText('Direct messages are off')).toBeTruthy());
    expect(view.queryByTestId('coach-dm-thread-composer-field')).toBeNull();
  });
});

describe('9. a new thread', () => {
  it('"Say hello", the coach\'s line, the composer, and no dead button', async () => {
    serve(base({ [msgsUrl(PRIYA)]: { messages: [] } }));
    const view = await openThread(PRIYA, 'Priya Shah');
    await waitFor(() => expect(view.getByText('Say hello')).toBeTruthy());
    expect(view.getByText('Nothing here yet. Only Priya sees what you write here.')).toBeTruthy();
    expect(view.getByTestId('coach-dm-thread-composer-field')).toBeTruthy();
    expect(view.queryByText('Start the conversation')).toBeNull();
    expect(within(view.getByTestId('coach-dm-thread-new')).queryAllByRole('button')).toEqual([]);
  });
});

// ─── 10. New message ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('10. New message', () => {
  const openNew = async () => {
    const view = await openList();
    await waitFor(() => expect(view.getByTestId('coach-dm-new')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('coach-dm-new')); });
    await waitFor(() => expect(current()?.name).toBe('CoachCommunityDmNew'));
    return view;
  };
  it('the active roster with search; a tap opens that client\'s thread through POST /dms; Back returns to the list', async () => {
    serve(base({ [msgsUrl(MAYA)]: { messages: [] } }));
    mockPost.mockImplementation(async (url: string, body: { recipient_user_id: string }) => (
      url === LIST_URL ? { data: { thread: { ...thread(body.recipient_user_id, ''), last_message_at: null } }, headers: {} } : { data: {}, headers: {} }));
    const view = await openNew();
    await waitFor(() => expect(view.getByText('Your clients')).toBeTruthy());
    expect(view.getAllByTestId(/^coach-dm-new-row-/).length).toBeGreaterThan(0); // A to Z, rendered as the list scrolls
    await fireEvent.changeText(view.getByTestId('coach-dm-new-search'), 'marcus');
    expect(view.queryByTestId(`coach-dm-new-row-${MARCUS}`)).toBeNull(); // archived
    await fireEvent.changeText(view.getByTestId('coach-dm-new-search'), 'maya');
    await waitFor(() => expect(view.getByTestId(`coach-dm-new-row-${MAYA}`)).toBeTruthy());
    expect(view.queryByTestId(`coach-dm-new-row-${JORDAN}`)).toBeNull();
    expect(view.queryByTestId(`coach-dm-new-row-${NONAME}`)).toBeNull(); // no name to show
    await act(async () => { fireEvent.press(view.getByTestId(`coach-dm-new-row-${MAYA}`)); });
    await waitFor(() => expect(current()?.name).toBe('CommunityDmThread'));
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(LIST_URL, { recipient_user_id: MAYA }, { headers: { 'Idempotency-Key': expect.stringMatching(KEY) } });
    expect(current()?.params).toEqual({ recipientId: MAYA, name: 'Maya Chen' });
    await act(async () => { fireEvent.press(view.getByTestId('coach-dm-thread-header-back')); });
    await waitFor(() => expect(current()?.name).toBe('CoachCommunityDmList'));
  });
  it('a client who never opened Community (404): a true line, not "closed", and no thread', async () => {
    serve(base());
    mockPost.mockRejectedValue(NOT_FOUND);
    const view = await openNew();
    await waitFor(() => expect(view.getByText('Your clients')).toBeTruthy());
    await fireEvent.changeText(view.getByTestId('coach-dm-new-search'), 'priya');
    await waitFor(() => expect(view.getByTestId(`coach-dm-new-row-${PRIYA}`)).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId(`coach-dm-new-row-${PRIYA}`)); });
    await waitFor(() => expect(view.getByText('Priya Shah has not joined your community yet. You can message them here once they do.')).toBeTruthy());
    expect(view.queryByText('This conversation is closed')).toBeNull();
    expect(current()?.name).toBe('CoachCommunityDmNew');
  });
  it('Close returns to where the coach started', async () => {
    serve(base());
    const view = await openNew();
    await act(async () => { fireEvent.press(view.getByTestId('coach-dm-new-header-close')); });
    await waitFor(() => expect(current()?.name).toBe('CoachCommunityDmList'));
  });
});

// ─── 11. The coach's DM row and link (the real normalizer and router) ────────────────────────────────────────────────
describe('11. the coach\'s DM notification row', () => {
  const coachTabs = ['CommandCenter', 'Templates', 'MoneyStack', 'CalendarStack', 'Messages', 'ClientsStack', 'CommunityStack', 'SettingsStack'];
  const clientTabs = ['Home', 'WorkoutTab', 'CommunityTab', 'MoreTab'];
  const nav = jest.fn();
  const attach = (role: 'coach' | 'student', userId: string) => {
    router.attachPushNavigator({ isReady: () => true, navigate: nav, getRootState: () => ({ routeNames: role === 'coach' ? coachTabs : clientTabs }) });
    router.setPushSession({ kind: 'app', userId, role });
  };
  /** community-notifications.service.ts:222-233 at b#1243: the stored row; deep_link from community-dms.service.ts:234. */
  const dmRow = (id: string, link: string) => normalizeNotification({
    id, kind: 'community_dm_received', title: 'Direct message', body: 'J sent you a message', deep_link: link, channel: 'push', read_at: null,
    created_at: '2026-11-10T09:00:00.000Z', payload: { idempotency_key: `community:community_dm_received:${id}`, category: 'COACH_DIRECT', target_type: 'dm', target_id: uuid(990) },
  });
  const tap = (n: { actionScreen?: string; actionParams?: unknown; deepLink?: string }) => router.routePushTap(n.actionScreen, n.actionParams, undefined, n.deepLink);
  beforeEach(() => nav.mockReset());

  it('tgp://community/dm/<client id> opens that thread exactly once; a second row opens the second client\'s thread', () => {
    attach('coach', COACH);
    tap(dmRow('n1', `tgp://community/dm/${JORDAN}`));
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith('CommunityStack', { screen: 'CommunityDmThread', params: { recipientId: JORDAN }, initial: false });
    tap(dmRow('n2', `tgp://community/dm/${RILEY}`));
    expect(nav).toHaveBeenCalledTimes(2);
    expect(nav).toHaveBeenLastCalledWith('CommunityStack', { screen: 'CommunityDmThread', params: { recipientId: RILEY }, initial: false });
  });
  it('an older stored row (community/dms/<workspace>:<lo>:<hi>) opens the id that is not the coach\'s', () => {
    attach('coach', COACH);
    tap(dmRow('n3', `tgp://community/dms/${WS}:${[COACH, MAYA].sort().join(':')}`));
    expect(nav).toHaveBeenCalledWith('CommunityStack', { screen: 'CommunityDmThread', params: { recipientId: MAYA }, initial: false });
  });
  it('an older row naming two other people is never guessed: it stays on the Notifications list', () => {
    attach('coach', COACH);
    tap(dmRow('n4', `tgp://community/dms/${WS}:${[JORDAN, MAYA].sort().join(':')}`));
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith('ClientsStack', { screen: 'NotificationCenter', params: undefined });
  });
  it('with communityDm off the row keeps today\'s landing', () => {
    mockFlags.communityDm = false;
    attach('coach', COACH);
    tap(dmRow('n5', `tgp://community/dm/${JORDAN}`));
    expect(nav).toHaveBeenCalledWith('ClientsStack', { screen: 'NotificationCenter', params: undefined });
  });
  it('the device push (no link, no sender id) keeps today\'s landing', () => {
    attach('coach', COACH);
    router.routePushTap('Community', undefined, 'push-1');
    expect(nav).toHaveBeenCalledWith('ClientsStack', { screen: 'NotificationCenter', params: undefined });
  });
  it('other kinds and links open what they open today', () => {
    attach('coach', COACH);
    // A booking row (actionScreen from the server) and a space row (a community link this job does not read).
    tap(normalizeNotification({ id: 'b1', kind: 'booking_requested', body: 'A client asked for a session', channel: 'inapp', read_at: null, created_at: '2026-11-10T09:00:00.000Z', payload: { actionScreen: 'CoachBookingInbox' } }));
    expect(nav).toHaveBeenLastCalledWith('CalendarStack', { screen: 'CoachBookingInbox', pop: true });
    tap(dmRow('n6', `tgp://community/cohorts/${uuid(2)}`));
    expect(nav).toHaveBeenLastCalledWith('ClientsStack', { screen: 'NotificationCenter', params: undefined });
  });
  it('12. the client\'s own DM row (N2) still lands on the Community root, old and new link alike', () => {
    attach('student', JORDAN);
    tap(dmRow('c1', `tgp://community/dm/${COACH}`));
    tap(dmRow('c2', `tgp://community/dms/${WS}:${[COACH, JORDAN].sort().join(':')}`));
    expect(nav.mock.calls).toEqual([['CommunityTab', undefined], ['CommunityTab', undefined]]);
  });
});

// ─── 12. The client app's own DM thread draws as at base ─────────────────────────────────────────────────────────────
describe('12. the client\'s DM thread', () => {
  it('draws no bubble times, no day rows and its own header (the shared pieces\' new props stay unused)', async () => {
    mockUser = { id: JORDAN, role: 'student', name: 'Jordan Lee', firstName: 'Jordan', coach_id: COACH };
    serve({ '/community/me': ME(true), [msgsUrl(COACH)]: { messages: CONVERSATION.map((m) => ({ ...m })) } });
    const ClientThread = require('../../CommunityDmThreadScreen').default;
    const Stack = createNativeStackNavigator();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
    const view = await render(
      <QueryClientProvider client={qc}>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="CommunityDmThread" component={ClientThread} initialParams={{ recipientId: COACH, participantLabel: 'Sam Rivera' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(view.getByTestId(`dm-message-${uuid(905)}`)).toBeTruthy());
    expect(view.queryByText(clock(CONVERSATION[0].created_at))).toBeNull();
    expect(view.queryByText('Today')).toBeNull();
    expect(view.queryByText('Yesterday')).toBeNull();
    expect(within(view.getByTestId('community-dmthread-header')).queryByText('Direct message')).toBeNull();
  });
});

// ─── 13. Sign-out and another account ────────────────────────────────────────────────────────────────────────────────
describe('13. sign-out and another account on the same phone', () => {
  it('coach B sees no DM row, thread or draft from coach A (same workspace id)', async () => {
    serve(base({ [msgsUrl(JORDAN)]: { messages: CONVERSATION } }));
    const a = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(a.getByTestId(`coach-dm-message-${uuid(905)}`)).toBeTruthy());
    await fireEvent.changeText(a.getByTestId('coach-dm-thread-composer-field'), 'A private note to Jordan');
    await waitFor(() => expect([...mockDisk.values()].some((v) => v.includes('A private note to Jordan'))).toBe(true));
    // signOut's cache and draft steps (authActions.ts:644 settleAndClearQueryCache; 'logout' empties chatDrafts.ts:54-63).
    await act(async () => { await settleAndClearQueryCache(qc); authEvents.emit('logout'); });
    await a.unmount();
    mockUser = { id: COACH_B, role: 'coach', name: 'Kim Ode', firstName: 'Kim', coach_id: null };
    mockGetClients.mockImplementation(async () => ({ data: [] }));
    serve({ '/community/me': ME(), [LIST_URL]: { threads: [] }, [msgsUrl(JORDAN)]: NOT_FOUND });
    const b = await openList();
    await waitFor(() => expect(b.getByText('No conversations yet')).toBeTruthy());
    expect(b.queryByText('Jordan Lee')).toBeNull();
    await go('CommunityDmThread', { recipientId: JORDAN });
    await waitFor(() => expect(b.getByText('This conversation is closed')).toBeTruthy());
    expect(b.queryByText(/Should I still do my own run/)).toBeNull();
    expect(b.queryByDisplayValue('A private note to Jordan')).toBeNull();
    expect([...mockDisk.values()].some((v) => v.includes('A private note to Jordan'))).toBe(false);
  });
});
