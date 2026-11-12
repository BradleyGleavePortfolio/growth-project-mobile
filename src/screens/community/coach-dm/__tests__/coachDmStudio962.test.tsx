/**
 * REFINE-962 (fix round 1 on m#962; owner #203-E31 "another round heading towards the goal", Studio look #203-E25): each
 * difference from the Studio frames that a number can pin (planning/COACH-DM-MOCK/src/html/S_<state>_ios.html at ctx
 * 7b3dae88; the CSS line is quoted beside each case) is drawn as Studio draws it on the coach DM screens, and the same
 * shared pieces drawn without the coach's opt-in props stay as they were for every other caller.
 *
 * The harness is coachDm.test.tsx's (the real coach Community stack in a tab navigator holding SettingsStack, the HTTP
 * edge stubbed with the server's answers); icons draw as a host element so their glyph, size and colour can be read.
 * Names and words are fictional and neutral.
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
// Icons draw as a host element carrying their props, so a case can read the glyph, its size and its colour.
jest.mock('@expo/vector-icons', () => {
  const R = require('react');
  const Icon = (p: Record<string, unknown>) => R.createElement('Icon', p);
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

const tokens = jest.requireActual('../../../../theme/tokens');
const { forestPop: fp, colors, brand, neutral, lightTokens } = tokens;
const { dayLabel } = require('../coachDm');
const schedulingApi = require('../../../../api/schedulingApi');
const flat = (el: { props: { style?: unknown } }): Record<string, unknown> =>
  (StyleSheet.flatten(el.props.style as never) ?? {}) as Record<string, unknown>;
type Found = { props: Record<string, unknown> };
/** The icon drawn with `name` inside a rendered scope (the mock draws a host element named Icon). */
const iconIn = (scope: unknown, name: string): Found | null =>
  (scope as { UNSAFE_queryAllByType: (t: unknown) => Found[] }).UNSAFE_queryAllByType('Icon').find((i) => i.props.name === name) ?? null;

const atLocal = (daysAgo: number, h: number, m: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const CONVERSATION = [ // newest first
  msg(905, JORDAN, COACH, 'Great. Should I still do my own run on Friday then?', atLocal(0, 8, 15)),
  msg(904, COACH, JORDAN, 'There is. Bring water and come ten minutes early.', atLocal(1, 19, 2)),
  msg(903, JORDAN, COACH, 'Is there room for one more on Saturday?', atLocal(1, 18, 40)),
  msg(902, COACH, JORDAN, 'Yes. We move under the stand, same time.', atLocal(3, 17, 31)),
  msg(901, JORDAN, COACH, 'Is the Saturday session still on if it rains?', atLocal(3, 17, 10)),
];

describe('a. the deep bar on the coach DM screens (S_list_ios.html:49 .brow padding 6px 12px 12px 6px, gap 10px; :50 .btitle 18px, 600, line-height 1.2; back svg width 26)', () => {
  const expectStudioBar = (view: Awaited<ReturnType<typeof mount>>, header: string, title: string) => {
    const bar = view.getByTestId(header);
    expect(flat(within(bar).getByText(title))).toEqual(expect.objectContaining({ fontSize: 18, lineHeight: 22, fontWeight: '600' }));
    expect(flat(bar)).toEqual(expect.objectContaining({ paddingLeft: 6, paddingRight: 12, paddingTop: 6, paddingBottom: 12, gap: 10 }));
  };
  it('the list: 18 pt title, Studio padding and gap, a 26 pt Back', async () => {
    serve(base());
    const view = await openList();
    await waitFor(() => expect(view.getByTestId(`coach-dm-row-${JORDAN}`)).toBeTruthy());
    expectStudioBar(view, 'coach-dm-list-header', 'Direct messages');
    expect(iconIn(within(view.getByTestId('coach-dm-list-header')), 'chevron-back')?.props.size).toBe(26);
  });
  it('the thread and New message: the same bar', async () => {
    serve(base({ [msgsUrl(JORDAN)]: { messages: CONVERSATION } }));
    const view = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(view.getByTestId(`coach-dm-message-${uuid(905)}`)).toBeTruthy());
    expectStudioBar(view, 'coach-dm-thread-header', 'Jordan Lee');
    await go('CoachCommunityDmNew');
    await waitFor(() => expect(view.getByTestId('coach-dm-new-header')).toBeTruthy());
    expectStudioBar(view, 'coach-dm-new-header', 'New message');
  });
  it('a4. the thread bar\'s initials tile (:52-:54 .mono.cl 44px, radius 12px, #2C4A36 letters, inset 1px #C9D8CD)', async () => {
    serve(base({ [msgsUrl(JORDAN)]: { messages: CONVERSATION } }));
    const view = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(view.getByTestId(`coach-dm-message-${uuid(905)}`)).toBeTruthy());
    expect(flat(within(view.getByTestId('coach-dm-thread-header')).getByText('JL')).color).toBe(fp.forest);
    expect(flat(view.getByTestId('coach-dm-thread-header-tile'))).toEqual(expect.objectContaining({ width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: fp.sageLine }));
  });
});

describe('b. New message is a pencil (S_list_ios.html: the New message svg, a pencil, width 22)', () => {
  it('Ionicons pencil-outline, 22 pt', async () => {
    serve(base());
    const view = await openList();
    await waitFor(() => expect(view.getByTestId('coach-dm-new')).toBeTruthy());
    const pencil = iconIn(within(view.getByTestId('coach-dm-new')), 'pencil-outline');
    expect(pencil?.props.size).toBe(22);
  });
});

describe('c. the day row (S_thread_ios.html:70 .sep; the frame reads "Monday" for a day earlier this week)', () => {
  const PT = 'America/Los_Angeles';
  beforeEach(() => { jest.spyOn(schedulingApi, 'resolveClientTimezone').mockReturnValue(PT); });
  const NOW = new Date('2026-11-12T20:00:00.000Z'); // Thursday 12:00 in the phone's zone
  it.each([
    ['0 days back', '2026-11-12T16:00:00.000Z', 'Today'],
    ['1 day back', '2026-11-11T20:00:00.000Z', 'Yesterday'],
    ['2 days back: the weekday', '2026-11-10T20:00:00.000Z', 'Tuesday'],
    ['6 days back: the weekday', '2026-11-06T20:00:00.000Z', 'Friday'],
    ['7 days back: the date (no Studio frame draws an older row)', '2026-11-05T20:00:00.000Z', 'Thursday, November 5'],
  ])('%s', (_label, iso, label) => {
    expect(dayLabel(iso, NOW)).toBe(label);
  });
  it('just after local midnight, the day is the phone\'s calendar day, not 24 hours', () => {
    const now = new Date('2026-11-12T08:10:00.000Z'); // Thursday 00:10
    expect(dayLabel('2026-11-12T08:05:00.000Z', now)).toBe('Today'); // 00:05
    expect(dayLabel('2026-11-12T07:55:00.000Z', now)).toBe('Yesterday'); // Wednesday 23:55
    expect(dayLabel('2026-11-10T08:30:00.000Z', now)).toBe('Tuesday'); // Tuesday 00:30, 47 h 40 min before
  });
  it('across the clock change (Sunday November 1 2026): days are counted on the calendar', () => {
    const now = new Date('2026-11-03T08:30:00.000Z'); // Tuesday November 3, 00:30 PST
    expect(dayLabel('2026-11-01T06:30:00.000Z', now)).toBe('Saturday'); // Saturday October 31, 23:30 PDT
    expect(dayLabel('2026-10-28T07:30:00.000Z', now)).toBe('Wednesday'); // Wednesday October 28, 00:30 PDT: 6 days
    expect(dayLabel('2026-10-27T07:30:00.000Z', now)).toBe('Tuesday, October 27'); // 7 days: the date
    // Sunday 00:30 PDT to Monday 23:45 PST is 48 h 15 min, but one calendar day.
    expect(dayLabel('2026-11-01T07:30:00.000Z', new Date('2026-11-03T07:45:00.000Z'))).toBe('Yesterday');
  });
  it('on the thread: the client\'s message from three days back sits under its weekday', async () => {
    jest.restoreAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    serve(base({ [msgsUrl(JORDAN)]: { messages: CONVERSATION } }));
    const view = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(view.getByTestId(`coach-dm-message-${uuid(901)}`)).toBeTruthy());
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: schedulingApi.resolveClientTimezone() }).format(new Date(CONVERSATION[4].created_at));
    expect(view.getByText(weekday)).toBeTruthy();
  });
});

describe('d. Report and Block sits at the client\'s bubble edge (S_thread_ios.html:71 .mrow2 gap 0; :73 .bub max-width 74%)', () => {
  it('the bubble\'s box takes the bubble\'s width up to 74%, with the 44 pt mark right after it', async () => {
    serve(base({ [msgsUrl(JORDAN)]: { messages: CONVERSATION } }));
    const view = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(view.getByTestId(`coach-dm-message-${uuid(905)}`)).toBeTruthy());
    for (const id of [905, 904]) {
      const box = flat(view.getByTestId(`coach-dm-bubble-box-${uuid(id)}`));
      expect(box).toEqual(expect.objectContaining({ maxWidth: '74%', flexShrink: 1 }));
      expect(box.width).toBeUndefined();
    }
    expect(view.getByLabelText('Report or block Jordan')).toBeTruthy();
  });
});

describe('e. the coach thread\'s composer (S_thread_ios.html:79 .comp, :80 .field, :82-:83 .sendb)', () => {
  const FIELD = 'coach-dm-thread-composer-field';
  const SEND = 'coach-dm-thread-composer-send';
  it('empty: a 46 pt pale sage disc with a forest arrow, still disabled; with words: forest with a light arrow', async () => {
    serve(base({ [msgsUrl(JORDAN)]: { messages: CONVERSATION } }));
    const view = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(view.getByTestId(SEND)).toBeTruthy());
    const send = () => view.getByTestId(SEND);
    expect(flat(send())).toEqual(expect.objectContaining({ width: 46, height: 46, borderRadius: 23, backgroundColor: fp.sage }));
    expect(send().props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    expect(iconIn(within(send()), 'arrow-up')?.props.color).toBe(fp.forest);
    await fireEvent.changeText(view.getByTestId(FIELD), 'See you Saturday');
    expect(flat(send()).backgroundColor).toBe(fp.forest);
    expect(send().props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
    expect(iconIn(within(send()), 'arrow-up')?.props.color).toBe(fp.onDeep);
  });
  it('the box is a white pill with a 1.5 pt sage line and 16 pt words; the bar has a 1 pt sage line', async () => {
    serve(base({ [msgsUrl(JORDAN)]: { messages: CONVERSATION } }));
    const view = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(view.getByTestId(FIELD)).toBeTruthy());
    expect(flat(view.getByTestId(FIELD))).toEqual(expect.objectContaining({
      minHeight: 46, borderRadius: 23, borderWidth: 1.5, borderColor: fp.sageLine, backgroundColor: neutral[0], fontSize: 16, paddingHorizontal: 18,
    }));
    expect(flat(view.getByTestId('coach-dm-thread-composer'))).toEqual(expect.objectContaining({
      borderTopWidth: 1, borderTopColor: fp.sageLine, paddingTop: 12, paddingBottom: 8, paddingHorizontal: 14, gap: 10,
    }));
  });
});

describe('f. the centred states (S_list_ios.html:64-:68 .state, h2, p, .btn, .btn.ghost; the state svgs)', () => {
  it('list_empty: a 34 pt forest bubble, a 20 pt title, a 15 pt line, a 48 pt forest button', async () => {
    serve(base({ [LIST_URL]: { threads: [] } }));
    const view = await openList();
    await waitFor(() => expect(view.getByTestId('coach-dm-list-empty')).toBeTruthy());
    const state = within(view.getByTestId('coach-dm-list-empty'));
    expect(iconIn(state, 'chatbox-outline')?.props).toEqual(expect.objectContaining({ size: 34, color: fp.forest }));
    expect(flat(state.getByText('No conversations yet'))).toEqual(expect.objectContaining({ fontSize: 20 }));
    expect(flat(state.getByText('When a client sends you a direct message in your community, it shows here.'))).toEqual(expect.objectContaining({ fontSize: 15, color: colors.charcoal }));
    expect(flat(view.getByTestId('coach-dm-list-start'))).toEqual(expect.objectContaining({ backgroundColor: fp.forest, minHeight: 48, paddingHorizontal: 18 }));
    expect(flat(state.getByText('Message a client')).fontSize).toBe(16);
    expect(flat(view.getByTestId('coach-dm-list-empty'))).toEqual(expect.objectContaining({ gap: 12, paddingHorizontal: 30 }));
  });
  it('list_error: a 30 pt alert, and Try again outlined with a 1.5 pt sage line and forest words', async () => {
    serve(base({ [LIST_URL]: OFFLINE }));
    const view = await openList();
    await waitFor(() => expect(view.getByTestId('coach-dm-list-error')).toBeTruthy());
    expect(iconIn(within(view.getByTestId('coach-dm-list-error')), 'alert-circle-outline')?.props.size).toBe(30);
    expect(flat(view.getByTestId('coach-dm-list-retry'))).toEqual(expect.objectContaining({ borderWidth: 1.5, borderColor: fp.sageLine, minHeight: 48 }));
    expect(flat(within(view.getByTestId('coach-dm-list-retry')).getByText('Try again')).color).toBe(fp.forest);
  });
  it('list_off: the square bubble at 34 pt (Studio\'s slash is listed: Ionicons has none)', async () => {
    serve(base({ [LIST_URL]: DISABLED }));
    const view = await openList();
    await waitFor(() => expect(view.getByTestId('coach-dm-list-off')).toBeTruthy());
    expect(iconIn(within(view.getByTestId('coach-dm-list-off')), 'chatbox-outline')?.props.size).toBe(34);
  });
});

describe('h. the closed bar (S_closed_you_ios.html:84-:85 .closedbar, a; the no-entry svg 20)', () => {
  it('BAM-2a: a 20 pt no-entry glyph, a 15 pt charcoal line and a forest Settings link', async () => {
    serve(base({ [msgsUrl(JORDAN)]: BLOCKED_BY_YOU }));
    const view = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(view.getByTestId('coach-dm-thread-closed')).toBeTruthy());
    const bar = within(view.getByTestId('coach-dm-thread-closed'));
    expect(iconIn(bar, 'ban-outline')?.props.size).toBe(20);
    expect(flat(bar.getByText('Settings')).color).toBe(fp.forest);
    expect(flat(view.getByTestId('coach-dm-thread-closed'))).toEqual(expect.objectContaining({ borderTopWidth: 1, borderTopColor: fp.sageLine, paddingVertical: 16, paddingHorizontal: 20 }));
  });
  it('BAM-1 and BAM-2b keep the lock (Studio draws one there), at 20 pt', async () => {
    serve(base({ [msgsUrl(JORDAN)]: BLOCKED_BY_THEM }));
    const view = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(view.getByText('Jordan Lee has blocked you')).toBeTruthy());
    expect(iconIn(within(view.getByTestId('coach-dm-thread-closed')), 'lock-closed-outline')?.props.size).toBe(20);
  });
});

describe('i. Report and Block names the first name (S_report_menu_ios.html: "Block Jordan", aria "Report or block Jordan")', () => {
  it('the mark, the sheet\'s Block row and its question use "Jordan"', async () => {
    serve(base({ [msgsUrl(JORDAN)]: { messages: CONVERSATION } }));
    const view = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(view.getByTestId(`coach-dm-message-safety-${uuid(905)}`)).toBeTruthy());
    expect(view.getByTestId(`coach-dm-message-safety-${uuid(905)}`).props.accessibilityLabel).toBe('Report or block Jordan');
    await act(async () => { fireEvent.press(view.getByTestId(`coach-dm-message-safety-${uuid(905)}`)); });
    await waitFor(() => expect(view.getByLabelText('Block Jordan')).toBeTruthy());
    expect(within(view.getByTestId('coach-dm-thread-header')).getByText('Jordan Lee')).toBeTruthy(); // the bar keeps the full name
  });
});

describe('j. the Direct messages row on today\'s home moves toward Studio\'s row (S_entry_ios.html: .row :56 with #E0EBE4, .nm :57, .meta :58)', () => {
  it('a sage row, 64 pt, the square bubble at 22 pt in forest, 16.5 pt name and 13.5 pt count', async () => {
    serve(base());
    const view = await mount();
    await waitFor(() => expect(view.getByTestId('coach-dm-entry-count')).toBeTruthy());
    const row = view.getByTestId('coach-dm-entry');
    expect(flat(row)).toEqual(expect.objectContaining({ backgroundColor: fp.sage, minHeight: 64, paddingHorizontal: 18, gap: 14 }));
    expect(iconIn(within(row), 'chatbox-outline')?.props).toEqual(expect.objectContaining({ size: 22, color: fp.forest }));
    expect(flat(within(row).getByText('Direct messages'))).toEqual(expect.objectContaining({ fontSize: 16.5, color: colors.ink }));
    expect(flat(view.getByTestId('coach-dm-entry-count'))).toEqual(expect.objectContaining({ fontSize: 13.5, color: fp.n700 }));
  });
});

describe('l. rows, bubbles, day rows and New message (S_thread_ios.html :52-:59, :70, :73-:77, :91)', () => {
  it('l1. a list row: 64 pt, padding 18, gap 14, a 44 pt tile with forest letters, 16.5 pt name, 13.5 pt time, a 1 pt sage divider', async () => {
    serve(base());
    const view = await openList();
    await waitFor(() => expect(view.getByTestId(`coach-dm-row-${JORDAN}`)).toBeTruthy());
    const row = view.getByTestId(`coach-dm-row-${JORDAN}`);
    expect(flat(row)).toEqual(expect.objectContaining({ minHeight: 64, paddingHorizontal: 18, gap: 14, borderBottomWidth: 1, borderBottomColor: fp.sageLine }));
    expect(flat(within(row).getByText('JL')).color).toBe(fp.forest);
    expect(flat(view.getByTestId(`coach-dm-row-${JORDAN}-tile`))).toEqual(expect.objectContaining({ width: 44, height: 44, borderWidth: 1, borderColor: fp.sageLine }));
    expect(flat(within(row).getByText('Jordan Lee')).fontSize).toBe(16.5);
    expect(flat(within(row).getByText('Active 1h ago'))).toEqual(expect.objectContaining({ fontSize: 13.5, color: fp.n700 }));
  });
  it('l2. bubbles: 16 pt words, 12.5 pt times, radius 18, the client\'s white with a 1.5 pt sage line', async () => {
    serve(base({ [msgsUrl(JORDAN)]: { messages: CONVERSATION } }));
    const view = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(view.getByTestId(`coach-dm-message-${uuid(905)}`)).toBeTruthy());
    const words = within(view.getByTestId(`coach-dm-message-${uuid(905)}`)).getByText(CONVERSATION[0].body);
    expect(flat(words)).toEqual(expect.objectContaining({ fontSize: 16, lineHeight: 22 }));
    expect(flat(view.getByTestId(`coach-dm-message-${uuid(905)}-bubble`))).toEqual(expect.objectContaining({ borderRadius: 18, borderWidth: 1.5, borderColor: fp.sageLine, backgroundColor: neutral[0] }));
    expect(flat(view.getByTestId(`coach-dm-message-${uuid(904)}-bubble`))).toEqual(expect.objectContaining({ borderRadius: 18, borderBottomRightRadius: 4 }));
    const time = within(view.getByTestId(`coach-dm-message-${uuid(904)}`)).getByText(new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(CONVERSATION[1].created_at)));
    expect(flat(time)).toEqual(expect.objectContaining({ fontSize: 12.5, marginTop: 6, color: fp.onDeepMuted }));
  });
  it('l4. the day row: charcoal, 10 above and 6 below', async () => {
    serve(base({ [msgsUrl(JORDAN)]: { messages: CONVERSATION } }));
    const view = await openThread(JORDAN, 'Jordan Lee');
    await waitFor(() => expect(view.getByText('Today')).toBeTruthy());
    expect(flat(view.getByText('Today'))).toEqual(expect.objectContaining({ color: colors.charcoal, paddingTop: 10, paddingBottom: 6, fontSize: 13 }));
  });
  it('l5. New message: 58 pt rows, a 40 pt tile, 16.5 pt names at 500, the section in moss caps at 11.5 pt', async () => {
    serve(base());
    const view = await openList();
    await go('CoachCommunityDmNew');
    await waitFor(() => expect(view.getByText('Your clients')).toBeTruthy());
    await fireEvent.changeText(view.getByTestId('coach-dm-new-search'), 'jordan');
    const row = view.getByTestId(`coach-dm-new-row-${JORDAN}`);
    expect(flat(row)).toEqual(expect.objectContaining({ minHeight: 58, paddingHorizontal: 18, gap: 14 }));
    expect(flat(within(row).getByText('Jordan Lee'))).toEqual(expect.objectContaining({ fontSize: 16.5, fontWeight: '500' }));
    expect(flat(view.getByTestId(`coach-dm-new-row-${JORDAN}-tile`))).toEqual(expect.objectContaining({ width: 40, height: 40, borderRadius: 11, borderWidth: 1, borderColor: fp.sageLine }));
    expect(flat(view.getByText('Your clients'))).toEqual(expect.objectContaining({ fontSize: 11.5, fontWeight: '700', color: brand[500] }));
  });
});

describe('every other caller draws as before (the coach\'s props are opt-in)', () => {
  const { ThreadHeader, DmRow, MessageBubble, ComposerInput } = require('../../../../components/community');
  it('ThreadHeader deep, no studio: 20 pt title, today\'s padding, a 24 pt Back', async () => {
    const view = await render(<ThreadHeader tone="deep" title="Voice note" onBack={() => undefined} testID="h" />);
    expect(flat(view.getByText('Voice note'))).toEqual(expect.objectContaining({ fontSize: 20, lineHeight: 25 }));
    expect(flat(view.getByTestId('h')).paddingLeft).toBeUndefined();
    expect(iconIn(view, 'chevron-back')?.props.size).toBe(24);
  });
  it('DmRow with no initials, MessageBubble with no studio, ComposerInput with no studio: as at main', async () => {
    const row = await render(<DmRow thread={thread(JORDAN, ago(HOUR))} participantLabel="Jordan Lee" onPress={() => undefined} testID="r" />);
    expect(flat(row.getByTestId('r'))).toEqual(expect.objectContaining({ minHeight: 48, paddingHorizontal: 16, borderBottomColor: lightTokens.border }));
    expect(flat(row.getByText('Jordan Lee')).fontSize).toBe(15);
    const bubble = await render(<MessageBubble message={CONVERSATION[0]} myUserId={COACH} testID="b" />);
    expect(flat(bubble.getByText(CONVERSATION[0].body)).fontSize).toBe(15);
    const box = await render(<ComposerInput placeholder="Message" maxLength={4000} onSubmit={() => undefined} testID="c" />);
    expect(flat(box.getByTestId('c-send')).backgroundColor).toBe(lightTokens.disabledBg);
    expect(flat(box.getByTestId('c-field')).borderRadius).toBe(12);
  });
});
