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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
const { coachCommunityKeys } = require('../../../hooks/useCoachCommunity');
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

describe('H3 and H4: Reports and Inbox stay one tap away (their counts wait for a KT-2 row, PLAN 1a)', () => {
  it('Reports: the title alone, no count read, and it opens the report queue', async () => {
    serve(base());
    const view = await mount();
    await ready(view);
    const reports = view.getByTestId('coach-home-reports');
    expect(reports.props.accessibilityLabel).toBe('Reports');
    expect(within(reports).queryByText(/waiting/)).toBeNull();
    expect(iconsIn(reports)).toEqual(['flag-outline']);
    expect(mockGet.mock.calls.some(([url]) => String(url).includes('/moderation/flagged'))).toBe(false);
    await act(async () => { fireEvent.press(reports); });
    expect(ref.getCurrentRoute()?.name).toBe('CoachCommunityModeration');
  });
  it('Inbox: its words, no inbox read, and it opens the inbox', async () => {
    serve(base());
    const view = await mount();
    await ready(view);
    const inbox = view.getByTestId('coach-home-inbox');
    expect(within(inbox).getByText('Inbox')).toBeTruthy();
    expect(within(inbox).getByText('Unread in your inbox')).toBeTruthy();
    expect(iconsIn(inbox)).toEqual(['mail-outline']);
    expect(mockGet.mock.calls.some(([url]) => String(url).includes('coach-inbox'))).toBe(false);
    await act(async () => { fireEvent.press(inbox); });
    expect(ref.getCurrentRoute()?.name).toBe('CoachCommunityInbox');
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
