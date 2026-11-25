/**
 * B-TEST LS-962R1 B2 (review of m#962 at a6b6abfb): a coach starts a conversation from New message, sends the first
 * message and goes Back to Direct messages. The list read is never made again (useSendDm settles only the thread's
 * messages key; New message's POST /dms touches no key; the list has no pull or focus read), so the page under the
 * thread still says "No conversations yet" and the home row keeps its old count. The harness below is
 * coachDm.test.tsx's, unchanged.
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
  // m#964 (CRISIS-TEXT-M) on main: communityApi.sendDm reads the signed-in account (crisisLineOwner -> readUserCacheSync).
  prefsStorage: { getString: () => undefined },
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

describe('LS-962R1 B2: the list after the coach starts a conversation', () => {
  it('New message, a first send, then Back: the list shows that client\'s conversation', async () => {
    let started = false;
    const sent = msg(960, COACH, MAYA, 'Hello Maya', new Date().toISOString());
    serve(base({
      [LIST_URL]: () => ({ threads: started ? [thread(MAYA, sent.created_at)] : [] }),
      [msgsUrl(MAYA)]: () => ({ messages: started ? [sent] : [] }),
    }));
    mockPost.mockImplementation(async (url: string) => {
      if (url === LIST_URL) return { data: { thread: { ...thread(MAYA, ''), last_message_at: null } }, headers: {} };
      started = true;
      return { data: { message: sent }, headers: {} };
    });
    const view = await openList();
    await waitFor(() => expect(view.getByText('No conversations yet')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByText('Message a client')); });
    await waitFor(() => expect(view.getByText('Your clients')).toBeTruthy());
    await fireEvent.changeText(view.getByTestId('coach-dm-new-search'), 'maya');
    await waitFor(() => expect(view.getByTestId(`coach-dm-new-row-${MAYA}`)).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId(`coach-dm-new-row-${MAYA}`)); });
    await waitFor(() => expect(current()?.name).toBe('CommunityDmThread'));
    await waitFor(() => expect(view.getByTestId('coach-dm-thread-composer-field')).toBeTruthy());
    await fireEvent.changeText(view.getByTestId('coach-dm-thread-composer-field'), 'Hello Maya');
    await act(async () => { fireEvent.press(view.getByTestId('coach-dm-thread-composer-send')); });
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(msgsUrl(MAYA), { body: 'Hello Maya' }, expect.anything()));
    await act(async () => { fireEvent.press(view.getByTestId('coach-dm-thread-header-back')); });
    await waitFor(() => expect(current()?.name).toBe('CoachCommunityDmList'));
    await waitFor(() => expect(view.getByTestId(`coach-dm-row-${MAYA}`)).toBeTruthy(), { timeout: 3000 });
    expect(view.queryByText('No conversations yet')).toBeNull();
  });
});
