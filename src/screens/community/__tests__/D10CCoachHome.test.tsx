/**
 * D10-BUILD-COMMUNITY H1 to H7: the coach's S v2 Community Home (C6CHAT-S-V2 k01 with the Studio entry's band), drawn
 * by the real coach Community stack with every switch on ([R27]); the cases flip one switch at a time.
 *
 * Only the HTTP edge (services/api), the theme, icons (a host element carrying its props), the device store, the
 * signed-in coach, haptics, the one-time terms gate and the stack's other pages (labelled leaves) are stubbed. The
 * app's own StatusBarBand is drawn beside the stack so the strip's colour is read. Ids, names and counts are made up.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { InfiniteQueryObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
  coachApi: { getClients: async () => ({ data: [] }) },
}));
const mockFlags: Record<string, unknown> = {};
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  for (const [k, v] of Object.entries(actual.featureFlags)) mockFlags[k] = typeof v === 'boolean' ? true : v;
  return { ...actual, featureFlags: mockFlags };
});
const mockTheme = () => {
  const tokens = jest.requireActual('../../../theme/tokens');
  return { colors: jest.requireActual('../../../constants/colors').default, tokens: tokens.default, semanticColors: tokens.lightTokens, colorScheme: 'light', isDark: false };
};
jest.mock('../../../theme/useTheme', () => ({ useTheme: () => mockTheme() }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => mockTheme(),
  LightTheme: ({ children }: { children: React.ReactNode }) => children,
}));
// A phone with a 47 pt status bar, so the app's strip (StatusBarBand) draws.
jest.mock('react-native-safe-area-context', () => ({
  ...require('react-native-safe-area-context/jest/mock').default,
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => {
  const R = require('react');
  const Icon = (p: Record<string, unknown>) => R.createElement('Icon', p);
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});
jest.mock('../../../storage/mmkv', () => {
  const disk = new Map<string, string>();
  return {
    cacheStorage: {
      getString: (k: string) => disk.get(k), getStringAsync: async (k: string) => disk.get(k),
      set: async (k: string, v: string) => { disk.set(k, v); }, delete: async (k: string) => { disk.delete(k); },
      getAllKeys: async () => [...disk.keys()],
    },
    prefsStorage: { getString: () => undefined },
  };
});
jest.mock('../../../hooks/useCurrentUser', () => ({
  ...jest.requireActual('../../../hooks/useCurrentUser'),
  useCurrentUser: () => ({ id: 'coach-sam', role: 'coach', name: 'Sam Rivera', firstName: 'Sam', coach_id: null }),
}));
const mockHaptics = { selection: jest.fn(), success: jest.fn(), error: jest.fn(), warning: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(), heavyImpact: jest.fn(), lightImpact: jest.fn() };
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: mockHaptics }));
jest.mock('../../../components/community/CommunityTermsGate', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
// Every other page of the stack is a labelled leaf (read from the navigator's own import lines).
{
  const fs = jest.requireActual('fs');
  const path = jest.requireActual('path');
  const source: string = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'navigation', 'CoachCommunityNavigator.tsx'), 'utf8');
  for (const match of source.matchAll(/^import (?!type\b)[^;]*? from '\.\.\/(screens\/[^']+)'/gm)) {
    const modulePath = match[1] as string;
    if (modulePath.endsWith('/CoachSpacesHomeScreen')) continue;
    const label = modulePath.split('/').pop() as string;
    // The inbox page's shared helpers (membersLabel, alertCoachFailure) stay real; only its page is a leaf.
    const keep = modulePath.endsWith('/CoachCommunityInboxScreen') ? `../../../${modulePath}` : null;
    jest.doMock(`../../../${modulePath}`, () => ({
      ...(keep ? jest.requireActual(keep) : {}),
      __esModule: true,
      default: () => require('react').createElement(require('react-native').Text, null, label),
    }));
  }
}

/* eslint-disable @typescript-eslint/no-var-requires */
const CoachCommunityNavigator = require('../../../navigation/CoachCommunityNavigator').default;
const { StatusBarBand } = require('../../../components/StatusBarBand');
const { coachCommunityKeys, dropAuthorFromCoachInbox } = require('../../../hooks/useCoachCommunity');
const { coachCommunityApi } = require('../../../api/coachCommunityApi');
const { useBlockedUsersStore } = require('../../../store/blockedUsersStore');
const { forestPop: fp, lightTokens, schemeCard } = require('../../../theme/tokens');
/* eslint-enable @typescript-eslint/no-var-requires */

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1);
const LIST_URL = `/community/workspaces/${WS}/dms`;
const ME = { feature_flag_state: 'enabled', workspace_id: WS, membership: null,
  unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  flags: { community_api: true, community_dm: true, community_realtime: false, community_push: true, community_telemetry: false } };
const space = (n: number, name: string, extra: Record<string, unknown> = {}) => ({
  id: uuid(n), workspace_id: WS, name, member_count: 12, is_default: false, kind: 'chat', visibility: 'clients', unread_count: 0, ...extra,
});
const FULL = [
  space(11, 'Announcements', { kind: 'announcement', visibility: 'clients', is_default: true }),
  space(12, 'Everyone', { is_default: true }),
  space(13, 'Spring 8-week plan', { kind: 'section', visibility: 'package' }),
  space(14, 'Program chat', { visibility: 'package' }),
  space(15, 'Morning Mobility', { visibility: 'public', member_count: 212 }),
  space(16, 'Older group', { visibility: 'members' }),
  space(17, 'Later', { visibility: 'future_kind' }),
];
const axiosErr = (status: number) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data: {} } });
const PENDING = Symbol('pending');
type Answer = unknown | (() => unknown);
let http: Record<string, Answer> = {};
function serve(answers: Record<string, Answer>) {
  http = answers;
  mockGet.mockImplementation(async (url: string) => {
    const key = url.split('?')[0];
    if (!(key in http)) throw axiosErr(404);
    const a = http[key];
    const value = typeof a === 'function' ? (a as () => unknown)() : a;
    if (value instanceof Error) throw value;
    if (value === PENDING) return new Promise(() => undefined);
    return { data: value, headers: {} };
  });
}
const base = (extra: Record<string, Answer> = {}) => ({
  '/community/me': ME, [LIST_URL]: { threads: [] }, '/community/cohorts': { cohorts: FULL }, ...extra,
});
const cohortReads = () => mockGet.mock.calls.filter(([url]) => url === '/community/cohorts').length;

const Root = createNativeStackNavigator();
const ref = createNavigationContainerRef<ParamListBase>();
let qc: QueryClient;
const Probe = ({ label }: { label: string }) => <Text>{label}</Text>;
async function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity } } });
  const view = await render(
    <QueryClientProvider client={qc}>
      <NavigationContainer ref={ref}>
        <Root.Navigator screenOptions={{ headerShown: false }}>
          <Root.Screen name="Messages">{() => <Probe label="messages-tab" />}</Root.Screen>
          <Root.Screen name="CommunityStack" component={CoachCommunityNavigator} />
        </Root.Navigator>
      </NavigationContainer>
      <StatusBarBand />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(ref.isReady()).toBe(true));
  await act(async () => { ref.navigate('CommunityStack', { screen: 'CoachCommunityHome' }); });
  return view;
}
const flat = (node: { props: { style?: unknown } }) => (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
/** The icons drawn inside a rendered element, in order (the mock draws a host element named Icon). */
function iconsIn(scope: unknown, out: unknown[] = []): unknown[] {
  const node = scope as { type?: unknown; props?: Record<string, unknown>; children?: unknown[] } | null;
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'Icon') out.push(node.props?.name);
  for (const child of node.children ?? []) iconsIn(child, out);
  return out;
}
const ready = async (view: Awaited<ReturnType<typeof mount>>) => waitFor(() => expect(view.getByTestId('coach-home-new-space')).toBeTruthy());

beforeEach(() => {
  for (const k of Object.keys(mockFlags)) if (typeof mockFlags[k] === 'boolean') mockFlags[k] = true;
  mockGet.mockReset();
  mockPost.mockReset();
  Object.values(mockHaptics).forEach((f) => f.mockReset());
});

describe('H1: the spaces, in the server\'s order, with who each is for', () => {
  it('one row per visibility (clients, package, public, members, an unknown value); a section is not listed; public says its members', async () => {
    serve(base());
    const view = await mount();
    await ready(view);
    const rows = view.getAllByTestId(/^coach-home-space-/);
    expect(rows.map((r) => r.props.testID)).toEqual([11, 12, 14, 15, 16, 17].map((n) => `coach-home-space-${uuid(n)}`));
    expect(view.queryByText('Spring 8-week plan')).toBeNull();
    const row = (n: number) => view.getByTestId(`coach-home-space-${uuid(n)}`);
    expect(row(11).props.accessibilityLabel).toBe('Announcements, Clients');
    expect(iconsIn(row(11))).toEqual(['megaphone-outline', 'people-outline']);
    expect(row(12).props.accessibilityLabel).toBe('Everyone, Clients');
    expect(within(row(12)).getByText('#', { includeHiddenElements: true })).toBeTruthy();
    expect(row(14).props.accessibilityLabel).toBe('Program chat, Package');
    expect(iconsIn(row(14))).toEqual(['cube-outline']);
    expect(row(15).props.accessibilityLabel).toBe('Morning Mobility, Public, 212 members');
    expect(within(row(15)).getByText('212 members')).toBeTruthy();
    expect(iconsIn(row(15))).toEqual(['globe-outline', 'globe-outline']);
    for (const n of [16, 17]) {
      expect(within(row(n)).queryByTestId('coach-home-tag', { includeHiddenElements: true })).toBeNull();
      expect(iconsIn(row(n))).toEqual([]);
    }
    expect(row(16).props.accessibilityLabel).toBe('Older group');
    // The tags as k01 draws them: Clients outlined, Package a pale fill, Public deep with light words.
    const tag = (n: number, word: string) => {
      const t = within(row(n)).getByTestId('coach-home-tag', { includeHiddenElements: true });
      expect(within(t).getByText(word, { includeHiddenElements: true })).toBeTruthy();
      return t;
    };
    expect(flat(tag(11, 'Clients'))).toEqual(expect.objectContaining({ borderColor: fp.sageLine, borderWidth: 1 }));
    expect(flat(tag(12, 'Clients'))).toEqual(expect.objectContaining({ borderColor: fp.sageLine, borderWidth: 1 }));
    expect(flat(tag(14, 'Package'))).toEqual(expect.objectContaining({ backgroundColor: fp.sage }));
    expect(flat(tag(15, 'Public'))).toEqual(expect.objectContaining({ backgroundColor: fp.deep }));
    expect(flat(within(row(15)).getByText('Public', { includeHiddenElements: true }))).toEqual(expect.objectContaining({ color: fp.onDeep }));
  });

  it('the SPACES fold: a selection tick, and its state for a screen reader', async () => {
    serve(base());
    const view = await mount();
    await ready(view);
    const head = view.getByTestId('coach-home-spaces');
    expect(head.props.accessibilityState).toEqual({ expanded: true });
    await act(async () => { fireEvent.press(head); });
    expect(mockHaptics.selection).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('coach-home-spaces').props.accessibilityState).toEqual({ expanded: false });
    expect(view.queryAllByTestId(/^coach-home-space-/)).toHaveLength(0);
    expect(view.getByTestId('coach-home-new-space')).toBeTruthy();
  });

  it('New space opens New space; a row the Home has not drawn before carries the leaf edge, gone after 2 s', async () => {
    serve(base());
    const view = await mount();
    await ready(view);
    expect(flat(view.getByTestId(`coach-home-space-${uuid(11)}`)).borderLeftColor).toBe('transparent');
    await act(async () => { qc.setQueryData(coachCommunityKeys.cohorts(), (old: unknown[]) => [...old, { ...space(18, 'Food on the go'), member_count: 0 }]); });
    const fresh = await waitFor(() => view.getByTestId(`coach-home-space-${uuid(18)}`));
    expect(flat(fresh)).toEqual(expect.objectContaining({ borderLeftWidth: 4, borderLeftColor: fp.leaf }));
    expect(flat(fresh).backgroundColor).toBeUndefined();
    expect(flat(view.getByTestId(`coach-home-space-${uuid(11)}`)).borderLeftColor).toBe('transparent');
    await act(async () => { await new Promise((r) => setTimeout(r, 2100)); });
    await waitFor(() => expect(flat(view.getByTestId(`coach-home-space-${uuid(18)}`)).borderLeftColor).toBe('transparent'));
    await act(async () => { fireEvent.press(view.getByTestId('coach-home-new-space')); });
    expect(ref.getCurrentRoute()?.name).toBe('CoachCommunityNewSpace');
  });
});

describe('H2: a space opens its chat, or its page with the chat off', () => {
  it('communitySpaceChat on: CommunitySpaceChat { cohortId }', async () => {
    serve(base());
    const view = await mount();
    await ready(view);
    await act(async () => { fireEvent.press(view.getByTestId(`coach-home-space-${uuid(12)}`)); });
    expect(ref.getCurrentRoute()).toEqual(expect.objectContaining({ name: 'CommunitySpaceChat', params: { cohortId: uuid(12) } }));
  });
  it('communitySpaceChat off (communityHomeV2 on): CoachCommunityCohortDetail { cohortId, cohortName }', async () => {
    mockFlags.communitySpaceChat = false;
    serve(base());
    const view = await mount();
    await ready(view);
    await act(async () => { fireEvent.press(view.getByTestId(`coach-home-space-${uuid(12)}`)); });
    expect(ref.getCurrentRoute()).toEqual(expect.objectContaining({ name: 'CoachCommunityCohortDetail', params: { cohortId: uuid(12), cohortName: 'Everyone' } }));
  });
});

// FIX-D10C-1 (D10C-OP1): the Reports count is the report queue's length (CommunityReportsEntry's read); the Inbox
// count is the rows of the inbox's first server page the Inbox page would draw (my blocks left out at once).
const FLAGGED_URL = '/community/moderation/flagged';
const INBOX_URL = '/community/me/coach-inbox';
const WS_URL = `/community/workspaces/${WS}`;
const report = (n: number) => ({
  id: uuid(200 + n), target_type: 'post', target_id: uuid(300 + n), content: 'A reported post', author_name: 'Member',
  cohort_name: 'Everyone', reason: 'spam', author_user_id: uuid(400 + n), created_at: '2026-11-27T00:00:00.000Z',
});
const reports = (count: number) => ({ items: Array.from({ length: count }, (_, i) => report(i + 1)) });
const CLIENT_A = uuid(31);
const CLIENT_B = uuid(32);
const inboxRow = (n: number, author: string) => ({
  id: uuid(500 + n), type: 'post', cohort_id: uuid(12), cohort_name: 'Everyone', author_user_id: author,
  author_display_name: 'Client', preview: 'Morning check-in', created_at: '2026-11-27T00:00:00.000Z',
});
const inboxPage = (rows: unknown[], next: string | null = null) => ({ items: rows, next_cursor: next });
const THREE = inboxPage([inboxRow(1, CLIENT_A), inboxRow(2, CLIENT_A), inboxRow(3, CLIENT_B)]);
const inboxReads = () => mockGet.mock.calls.filter(([url]) => url === INBOX_URL).length;
const badge = (view: Awaited<ReturnType<typeof mount>>, row: string) => view.queryByTestId(`${row}-badge`);

describe('H3: Reports shows how many reports are waiting (D10C-OP1)', () => {
  it('H3: none waiting: the title alone, no badge, the queue\'s label, and it opens the report queue', async () => {
    serve(base({ [FLAGGED_URL]: reports(0) }));
    const view = await mount();
    await ready(view);
    await waitFor(() => expect(view.getByTestId('coach-home-reports').props.accessibilityLabel).toBe('Open community reports, none waiting'));
    const row = view.getByTestId('coach-home-reports');
    expect(within(row).queryByText(/waiting/)).toBeNull();
    expect(badge(view, 'coach-home-reports')).toBeNull();
    await act(async () => { fireEvent.press(row); });
    expect(ref.getCurrentRoute()?.name).toBe('CoachCommunityModeration');
  });
  it('H3: one waiting: "1 report waiting" and the leaf badge 1', async () => {
    serve(base({ [FLAGGED_URL]: reports(1) }));
    const view = await mount();
    await ready(view);
    const b = await waitFor(() => view.getByTestId('coach-home-reports-badge'));
    expect(within(b).getByText('1')).toBeTruthy();
    expect(flat(b)).toEqual(expect.objectContaining({ backgroundColor: fp.leaf }));
    const row = view.getByTestId('coach-home-reports');
    expect(within(row).getByText('1 report waiting')).toBeTruthy();
    expect(row.props.accessibilityLabel).toBe('Open community reports, 1 waiting for review');
  });
  it('H3: 120 waiting: "120 reports waiting" and the badge "99+"', async () => {
    serve(base({ [FLAGGED_URL]: reports(120) }));
    const view = await mount();
    await ready(view);
    const b = await waitFor(() => view.getByTestId('coach-home-reports-badge'));
    expect(within(b).getByText('99+')).toBeTruthy();
    const row = view.getByTestId('coach-home-reports');
    expect(within(row).getByText('120 reports waiting')).toBeTruthy();
    expect(row.props.accessibilityLabel).toBe('Open community reports, 120 waiting for review');
  });
  it('H3: a failed report read: the title alone, and it still opens the report queue', async () => {
    serve(base({ [FLAGGED_URL]: axiosErr(503) }));
    const view = await mount();
    await ready(view);
    await waitFor(() => expect(mockGet.mock.calls.some(([url]) => url === FLAGGED_URL)).toBe(true));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const row = view.getByTestId('coach-home-reports');
    expect(row.props.accessibilityLabel).toBe('Reports');
    expect(within(row).queryByText(/waiting/)).toBeNull();
    expect(badge(view, 'coach-home-reports')).toBeNull();
    await act(async () => { fireEvent.press(row); });
    expect(ref.getCurrentRoute()?.name).toBe('CoachCommunityModeration');
  });
});

describe('H4: Inbox shows how many are waiting on its first page (D10C-OP1, R9)', () => {
  it('H4: none waiting: "Unread in your inbox", no badge, and it opens the inbox', async () => {
    serve(base({ [INBOX_URL]: inboxPage([]) }));
    const view = await mount();
    await ready(view);
    await waitFor(() => expect(inboxReads()).toBe(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const row = view.getByTestId('coach-home-inbox');
    expect(within(row).getByText('Unread in your inbox')).toBeTruthy();
    expect(row.props.accessibilityLabel).toBe('Inbox, Unread in your inbox');
    expect(badge(view, 'coach-home-inbox')).toBeNull();
    await act(async () => { fireEvent.press(row); });
    expect(ref.getCurrentRoute()?.name).toBe('CoachCommunityInbox');
  });
  it('H4: three waiting: the badge 3 and "Inbox, Unread in your inbox: 3"; the dashboard is never read', async () => {
    serve(base({ [INBOX_URL]: THREE }));
    const view = await mount();
    await ready(view);
    const b = await waitFor(() => view.getByTestId('coach-home-inbox-badge'));
    expect(within(b).getByText('3')).toBeTruthy();
    const row = view.getByTestId('coach-home-inbox');
    expect(within(row).getByText('Unread in your inbox')).toBeTruthy();
    expect(row.props.accessibilityLabel).toBe('Inbox, Unread in your inbox: 3');
    expect(mockGet.mock.calls.some(([url]) => String(url).includes('dashboard'))).toBe(false);
  });
  it('H4: only the first page counts: a second page loaded through the inbox query leaves the number at 3', async () => {
    serve(base({ [INBOX_URL]: inboxPage([inboxRow(1, CLIENT_A), inboxRow(2, CLIENT_A), inboxRow(3, CLIENT_B)], 'page-2') }));
    const inner = mockGet.getMockImplementation() as (url: string, cfg?: { params?: Record<string, string> }) => unknown;
    mockGet.mockImplementation(async (url: string, cfg?: { params?: Record<string, string> }) =>
      (url === INBOX_URL && cfg?.params?.cursor === 'page-2' ? { data: inboxPage([inboxRow(4, CLIENT_B), inboxRow(5, CLIENT_B)]), headers: {} } : inner(url, cfg)));
    const view = await mount();
    await ready(view);
    await waitFor(() => expect(within(view.getByTestId('coach-home-inbox-badge')).getByText('3')).toBeTruthy());
    const more = new InfiniteQueryObserver(qc, {
      queryKey: coachCommunityKeys.inbox(),
      queryFn: ({ pageParam }: { pageParam: string | undefined }) => coachCommunityApi.getInbox({ cursor: pageParam }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: { next_cursor: string | null }) => last.next_cursor ?? undefined,
    });
    await act(async () => { await more.fetchNextPage(); });
    expect((qc.getQueryData(coachCommunityKeys.inbox()) as { pages: unknown[] }).pages).toHaveLength(2);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(within(view.getByTestId('coach-home-inbox-badge')).getByText('3')).toBeTruthy();
    expect(view.getByTestId('coach-home-inbox').props.accessibilityLabel).toBe('Inbox, Unread in your inbox: 3');
  });
});

describe('KT-2: the Home\'s Inbox number never counts a blocked or banned person', () => {
  it('KT-2: a client I block from another screen leaves the Inbox number on the Home at once, with no new inbox read', async () => {
    serve(base({ [INBOX_URL]: THREE }));
    const view = await mount();
    await ready(view);
    await waitFor(() => expect(within(view.getByTestId('coach-home-inbox-badge')).getByText('3')).toBeTruthy());
    const reads = inboxReads();
    try {
      await act(async () => { useBlockedUsersStore.setState({ blocked: [{ id: CLIENT_A, displayName: 'Client', blockedAt: '2026-11-27T00:00:00Z' }] }); });
      expect(within(view.getByTestId('coach-home-inbox-badge')).getByText('1')).toBeTruthy();
      expect(view.getByTestId('coach-home-inbox').props.accessibilityLabel).toBe('Inbox, Unread in your inbox: 1');
      expect(inboxReads()).toBe(reads);
      expect(qc.getQueryState(coachCommunityKeys.inbox())?.fetchStatus).toBe('idle');
    } finally {
      await act(async () => { useBlockedUsersStore.setState({ blocked: [] }); });
    }
  });
  it('KT-2: dropAuthorFromCoachInbox (a block or a ban) drops the rows of that author from the Inbox number on the Home before any re-read answers', async () => {
    serve(base({ [INBOX_URL]: THREE }));
    const view = await mount();
    await ready(view);
    await waitFor(() => expect(within(view.getByTestId('coach-home-inbox-badge')).getByText('3')).toBeTruthy());
    http[INBOX_URL] = PENDING;
    const reads = inboxReads();
    await act(async () => { dropAuthorFromCoachInbox(qc, CLIENT_B); });
    await waitFor(() => expect(within(view.getByTestId('coach-home-inbox-badge')).getByText('2')).toBeTruthy());
    await act(async () => { dropAuthorFromCoachInbox(qc, CLIENT_A); });
    await waitFor(() => expect(badge(view, 'coach-home-inbox')).toBeNull());
    expect(view.getByTestId('coach-home-inbox').props.accessibilityLabel).toBe('Inbox, Unread in your inbox');
    // The drop's own re-read went out and is still unanswered: the number dropped from the cache alone.
    expect(inboxReads()).toBeGreaterThan(reads);
    expect(qc.getQueryState(coachCommunityKeys.inbox())?.fetchStatus).toBe('fetching');
  });
});

describe('H6 name: the community\'s name in the masthead', () => {
  it('H6: the community\'s name once /community/me and the workspace answer, with its monogram; a pull reads the workspace again', async () => {
    serve(base({ [WS_URL]: { name: 'Northside Strength Club' } }));
    const view = await mount();
    await ready(view);
    const head = await waitFor(() => view.getByRole('header', { name: 'Northside Strength Club' }));
    expect(head.props.numberOfLines).toBe(1);
    expect(view.getByText('N', { includeHiddenElements: true })).toBeTruthy();
    expect(view.queryByText('C', { includeHiddenElements: true })).toBeNull();
    const wsReads = () => mockGet.mock.calls.filter(([url]) => url === WS_URL).length;
    const before = wsReads();
    http[WS_URL] = { name: 'Northside Strength' };
    await act(async () => { await view.getByTestId('coach-home-list').props.refreshControl.props.onRefresh(); });
    await waitFor(() => expect(wsReads()).toBe(before + 1));
    await waitFor(() => expect(view.getByRole('header', { name: 'Northside Strength' })).toBeTruthy());
  });
  it('H6: "Community" and its monogram while the name loads, as the client Home draws them', async () => {
    serve(base({ [WS_URL]: PENDING }));
    const view = await mount();
    await ready(view);
    await waitFor(() => expect(mockGet.mock.calls.some(([url]) => url === WS_URL)).toBe(true));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(view.getByRole('header', { name: 'Community' })).toBeTruthy();
    expect(view.getByText('C', { includeHiddenElements: true })).toBeTruthy();
    expect(qc.getQueryState(['community', 'workspace', WS])?.fetchStatus).toBe('fetching');
  });
  it('H6: "Community" with its monogram when the workspace read fails', async () => {
    serve(base({ [WS_URL]: axiosErr(503) }));
    const view = await mount();
    await ready(view);
    await waitFor(() => expect(mockGet.mock.calls.some(([url]) => url === WS_URL)).toBe(true));
    await waitFor(() => expect(view.getByText('C', { includeHiddenElements: true })).toBeTruthy());
    expect(view.getByRole('header', { name: 'Community' })).toBeTruthy();
  });
  it('H6: "Community" with its monogram and no workspace read when there is no workspace', async () => {
    serve(base({ '/community/me': { ...ME, feature_flag_state: 'disabled', workspace_id: null } }));
    const view = await mount();
    await ready(view);
    await waitFor(() => expect(mockGet.mock.calls.some(([url]) => url === '/community/me')).toBe(true));
    await waitFor(() => expect(view.getByText('C', { includeHiddenElements: true })).toBeTruthy());
    expect(view.getByRole('header', { name: 'Community' })).toBeTruthy();
    expect(mockGet.mock.calls.some(([url]) => String(url).startsWith(WS_URL) && url !== LIST_URL)).toBe(false);
  });
});

describe('H6 reads: a failed count or name read never blanks the page', () => {
  it('H6: a failed report, inbox or name read keeps every row and the spaces', async () => {
    serve(base({ [FLAGGED_URL]: axiosErr(503), [INBOX_URL]: axiosErr(503), [WS_URL]: axiosErr(503) }));
    const view = await mount();
    await ready(view);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    for (const id of ['coach-home-reports', 'coach-dm-entry', 'coach-home-inbox', 'coach-home-events', 'coach-home-spaces', 'coach-home-new-space']) {
      expect(view.getByTestId(id)).toBeTruthy();
    }
    expect(view.getAllByTestId(/^coach-home-space-/)).toHaveLength(6);
    expect(view.getByRole('header', { name: 'Community' })).toBeTruthy();
    expect(badge(view, 'coach-home-reports')).toBeNull();
    expect(badge(view, 'coach-home-inbox')).toBeNull();
    expect(view.queryByTestId('coach-home-error')).toBeNull();
  });
});

describe('E1 and P1: the new row', () => {
  it('E1: a create, then a second list change inside the 2 s with no new id: the leaf edge is gone 2 s after the create', async () => {
    serve(base());
    const view = await mount();
    await ready(view);
    await act(async () => { qc.setQueryData(coachCommunityKeys.cohorts(), (old: unknown[]) => [...old, { ...space(18, 'Food on the go'), member_count: 0 }]); });
    const row = () => view.getByTestId(`coach-home-space-${uuid(18)}`);
    await waitFor(() => expect(flat(row()).borderLeftColor).toBe(fp.leaf));
    await act(async () => { await new Promise((r) => setTimeout(r, 1000)); });
    await act(async () => {
      qc.setQueryData(coachCommunityKeys.cohorts(), (old: { id: string }[]) => old.map((c) => (c.id === uuid(12) ? { ...c, member_count: 13 } : c)));
    });
    expect(flat(row()).borderLeftColor).toBe(fp.leaf);
    await act(async () => { await new Promise((r) => setTimeout(r, 1150)); });
    expect(flat(row()).borderLeftColor).toBe('transparent');
  });
  it('P1: the provisional row opens nothing until the server\'s row replaces it, then opens its chat', async () => {
    serve(base());
    const view = await mount();
    await ready(view);
    const provisional = { id: 'optimistic:Food on the go', name: 'Food on the go', member_count: 0, unread_count: 0, kind: 'chat', visibility: 'clients' };
    await act(async () => { qc.setQueryData(coachCommunityKeys.cohorts(), (old: unknown[]) => [provisional, ...old]); });
    const row = await waitFor(() => view.getByTestId('coach-home-space-optimistic:Food on the go'));
    expect(row.props.accessibilityLabel).toBe('Food on the go, Clients');
    await act(async () => { fireEvent.press(row); });
    expect(ref.getCurrentRoute()?.name).toBe('CoachCommunityHome');
    await act(async () => {
      qc.setQueryData(coachCommunityKeys.cohorts(), (old: { id: string }[]) => [space(40, 'Food on the go'), ...old.filter((c) => c.id !== provisional.id)]);
    });
    const landed = await waitFor(() => view.getByTestId(`coach-home-space-${uuid(40)}`));
    await act(async () => { fireEvent.press(landed); });
    expect(ref.getCurrentRoute()).toEqual(expect.objectContaining({ name: 'CommunitySpaceChat', params: { cohortId: uuid(40) } }));
  });
});

describe('H5: Direct messages, Events and Back follow their switches', () => {
  it('communityDm on: the Studio band (full width, square, hairlines, the scheme card); it opens the DM list', async () => {
    serve(base({ [LIST_URL]: { threads: [] } }));
    const view = await mount();
    await ready(view);
    const band = view.getByTestId('coach-dm-entry');
    expect(flat(band)).toEqual(expect.objectContaining({
      ...schemeCard, borderRadius: 0, minHeight: 64, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
      borderTopColor: lightTokens.border, borderBottomColor: lightTokens.border,
    }));
    await waitFor(() => expect(within(band).getByText('No conversations yet')).toBeTruthy());
    await act(async () => { fireEvent.press(band); });
    expect(ref.getCurrentRoute()?.name).toBe('CoachCommunityDmList');
  });
  it('communityDm off: no band, and Reports draws its own hairline', async () => {
    mockFlags.communityDm = false;
    serve(base());
    const view = await mount();
    await ready(view);
    expect(view.queryByTestId('coach-dm-entry')).toBeNull();
    expect(flat(view.getByTestId('coach-home-reports')).borderBottomWidth).toBe(StyleSheet.hairlineWidth);
  });
  it.each([true, false])('communityEvents %s: the Events row only with it, and it opens Events', async (on) => {
    mockFlags.communityEvents = on;
    serve(base());
    const view = await mount();
    await ready(view);
    if (!on) {
      expect(view.queryByTestId('coach-home-events')).toBeNull();
      return;
    }
    const events = view.getByTestId('coach-home-events');
    expect(events.props.accessibilityLabel).toBe('Events: schedule and manage live sessions');
    expect(within(events).getByText('Schedule and manage live sessions')).toBeTruthy();
    expect(iconsIn(events)).toEqual(['calendar-outline', 'chevron-forward']);
    await act(async () => { fireEvent.press(events); });
    expect(ref.getCurrentRoute()?.name).toBe('CoachCommunityEvents');
  });
  it.each([true, false])('coachTabsV2 %s: Back only with it, and it goes back', async (on) => {
    mockFlags.coachTabsV2 = on;
    serve(base());
    const view = await mount();
    await ready(view);
    if (!on) {
      expect(view.queryByTestId('community-back')).toBeNull();
      return;
    }
    const back = view.getByTestId('community-back');
    expect(back.props.accessibilityLabel).toBe('Back');
    expect(flat(back)).toEqual(expect.objectContaining({ width: 44, height: 44 }));
    await act(async () => { fireEvent.press(back); });
    expect(ref.getCurrentRoute()?.name).toBe('Messages');
  });
  it('the masthead: deep forest to the top edge, the monogram and "Community" in one serif line', async () => {
    serve(base());
    const view = await mount();
    await ready(view);
    const name = view.getByRole('header', { name: 'Community' });
    expect(name.props.numberOfLines).toBe(1);
    expect(flat(name)).toEqual(expect.objectContaining({ color: fp.onDeep, fontFamily: 'CormorantGaramond_400Regular' }));
    expect(flat(view.getByTestId('coach-home')).backgroundColor).toBe(fp.surface);
    expect(view.getByText('C', { includeHiddenElements: true })).toBeTruthy();
  });
});

describe('H6: loading, failed, Try again and a failed refresh', () => {
  it('the first read: the still skeleton, "Loading your community", busy', async () => {
    serve(base({ '/community/cohorts': PENDING }));
    const view = await mount();
    const loading = await waitFor(() => view.getByTestId('coach-home-loading'));
    expect(loading.props.accessibilityLabel).toBe('Loading your community');
    expect(loading.props.accessibilityState).toEqual({ busy: true });
    expect(view.queryByTestId('coach-home-new-space')).toBeNull();
  });

  it('a failed first read: the rows stay, the words and Try again; Try again re-reads; a second failure ticks an error', async () => {
    serve(base({ '/community/cohorts': axiosErr(503) }));
    const view = await mount();
    await waitFor(() => expect(view.getByTestId('coach-home-error')).toBeTruthy());
    expect(view.getByText('Your community did not load. Check your connection, then try again.')).toBeTruthy();
    expect(view.getByTestId('coach-home-reports')).toBeTruthy();
    expect(view.getByTestId('coach-dm-entry')).toBeTruthy();
    expect(view.getByRole('header', { name: 'Community' })).toBeTruthy();
    expect(view.queryByTestId('coach-home-new-space')).toBeNull();
    const before = cohortReads();
    await act(async () => { fireEvent.press(view.getByTestId('coach-home-retry')); });
    await waitFor(() => expect(mockHaptics.error).toHaveBeenCalledTimes(1));
    expect(cohortReads()).toBe(before + 1);
    http['/community/cohorts'] = { cohorts: FULL };
    await act(async () => { fireEvent.press(view.getByTestId('coach-home-retry')); });
    await ready(view);
    expect(view.queryByTestId('coach-home-error')).toBeNull();
    expect(mockHaptics.error).toHaveBeenCalledTimes(1);
  });

  it('a failed pull keeps the rows on screen; the pull re-reads the spaces and the DM list', async () => {
    serve(base());
    const view = await mount();
    await ready(view);
    http['/community/cohorts'] = axiosErr(503);
    const dmReads = () => mockGet.mock.calls.filter(([url]) => url === LIST_URL).length;
    const [spaces, dms] = [cohortReads(), dmReads()];
    await act(async () => { await view.getByTestId('coach-home-list').props.refreshControl.props.onRefresh(); });
    await waitFor(() => expect(cohortReads()).toBe(spaces + 1));
    await waitFor(() => expect(dmReads()).toBe(dms + 1));
    expect(view.getAllByTestId(/^coach-home-space-/)).toHaveLength(6);
    expect(view.queryByTestId('coach-home-error')).toBeNull();
  });
});

describe('H7: the strip is the masthead\'s deep green while the Home is in front', () => {
  it('the app\'s StatusBarBand reads fp.deep on the Home and gives the strip back on another page', async () => {
    serve(base());
    const view = await mount();
    await ready(view);
    expect(flat(view.getByTestId('status-bar-band')).backgroundColor).toBe(fp.deep);
    await act(async () => { fireEvent.press(view.getByTestId('coach-home-inbox')); });
    expect(ref.getCurrentRoute()?.name).toBe('CoachCommunityInbox');
    await waitFor(() => expect(flat(view.getByTestId('status-bar-band')).backgroundColor).not.toBe(fp.deep));
  });
});
