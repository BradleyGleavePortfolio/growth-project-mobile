/**
 * STRIP-945-M (203-D59 read as option 1, owner #ALM-E5 "d59 and d60 looks approved"; sheet ctx#595 S2b): the app's top
 * strip (App.tsx mounts StatusBarBand over every screen) is the bar's own deep green with light clock and icons while
 * the space chat is in front, in every state, and the page colour again once it is not; and the space name's box starts
 * 76 pt from the left edge (80 before) in every state that shows a name, as the picked Style 2 frames s2_S2b and s2_S3 put
 * it. The real screen, hook and rows (FIX945R4SpaceStates.test.tsx's stand-ins), the real StatusBarBand beside it.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authEvents } from '../../../utils/authEvents';
import { forestPop } from '../../../theme/tokens';
import { STATUS_BAR_BONE, StatusBarBand } from '../../../components/StatusBarBand';

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
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { communitySpaceChat: true, communityVoiceNotes: true } }));
const mockParams: { current: { cohortId: string } } = { current: { cohortId: 'c-a' } };
const mockNav = { routes: ['CommunityTab', 'CommunitySpaceChat'], focused: true };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), getState: () => ({ routeNames: mockNav.routes }) }),
  useRoute: () => ({ params: mockParams.current }),
  useIsFocused: () => mockNav.focused,
}));
// The phone's clock and icons: StatusBarBand asks for the light style while a screen owns it (DM test's stand-in).
jest.mock('expo-status-bar', () => ({ StatusBar: ({ style }: { style: string }) =>
  require('react').createElement(require('react-native').Text, null, `icons-${style}`) }));
jest.mock('../../../components/community/SpaceDrawer', () => {
  const { Text } = jest.requireActual('react-native');
  return { SpaceListButton: ({ label, testID = 'space-list-open' }: { label?: string; testID?: string }) => <Text testID={testID}>{label ?? 'list'}</Text> };
});
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me-1', name: 'Dana Reyes', coach_id: 'coach-1' }) }));
jest.mock('react-native-safe-area-context', () => {
  const { createContext, createElement } = require('react');
  const { View } = require('react-native');
  const insets = { top: 47, right: 0, bottom: 34, left: 0 };
  return {
    SafeAreaView: ({ children, style, testID }: { children?: unknown; style?: unknown; testID?: string }) => createElement(View, { style, testID }, children),
    SafeAreaInsetsContext: createContext(insets),
    useSafeAreaInsets: () => insets,
  };
});
const mockNet = { isOnline: true };
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: mockNet.isOnline, isInternetReachable: null }),
  isEffectivelyOnline: jest.requireActual('../../../hooks/useNetworkStatus').isEffectivelyOnline,
}));
const mockSpaces = { role: 'client', failed: false };
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityCohorts: () => (mockSpaces.failed
    ? { data: undefined, isLoading: false, isError: true, error: new Error('HTTP 500'), refetch: jest.fn() }
    : { data: { feature_flag_state: 'on', cohorts: [
      { id: 'c-a', workspace_id: 'ws', name: 'Running', is_default: true, kind: 'default', member_count: 12, my_role: mockSpaces.role },
      { id: 'c-b', workspace_id: 'ws', name: 'Strength', is_default: false, kind: 'default', member_count: 8, my_role: mockSpaces.role },
      { id: 'c-new', workspace_id: 'ws', name: 'Fresh start', is_default: false, kind: 'default', member_count: 3, my_role: mockSpaces.role },
      { id: 'c-ann', workspace_id: 'ws', name: 'Announcements', is_default: false, kind: 'announcement', posting_policy: 'coach', member_count: 24, my_role: mockSpaces.role },
    ] }, isLoading: false, isError: false, refetch: jest.fn() }),
  useCommunityMe: () => ({ dataUpdatedAt: 0 }),
  communityKeys: { cohorts: () => ['community', 'cohorts'], me: () => ['community', 'me'] },
}));
jest.mock('../../../components/community/VoiceNotePlayer', () => () => null);
jest.mock('../../../api/communityVoiceApi', () => ({ communityVoiceApi: { getOne: jest.fn(), remove: jest.fn() } }));
jest.mock('../../../hooks/useVoiceOutbox', () => ({ useVoiceOutbox: () => ({ items: [], online: true, send: jest.fn(), retry: jest.fn(), discard: jest.fn() }) }));
jest.mock('../../../components/community/VoiceRecordSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/community/SafetyMenu', () => () => null);
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
const mockApi = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock('../../../services/api', () => ({ __esModule: true, default: mockApi }));

const Screen = require('../CommunitySpaceChatScreen').default;

const fail = (status: number) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data: {} } });
const row = (id: string, at: string, cohort: string) => ({
  id, cohort_id: cohort, sender_user_id: 'u-2', body: `body ${id}`, kind: 'text', created_at: at, updated_at: at, edited: false,
  deleted: false, parent_message_id: null, voice_note: null, sender: { id: 'u-2', name: 'jo b.', avatar_url: null, is_coach: false },
});
type Space = { page: unknown[]; refuse?: number; hold?: boolean };
let spaces: Record<string, Space> = {};
let client: QueryClient;

beforeEach(() => {
  authEvents.emit('logout');
  mockDisk.clear();
  (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store.set('supabase_token', 'tok-me-1');
  Object.assign(mockNav, { routes: ['CommunityTab', 'CommunitySpaceChat'], focused: true });
  Object.assign(mockSpaces, { role: 'client', failed: false });
  mockNet.isOnline = true;
  mockParams.current = { cohortId: 'c-a' };
  spaces = {
    'c-a': { page: [row('a2', '2026-10-22T10:05:00.000Z', 'c-a'), row('a1', '2026-10-22T09:30:00.000Z', 'c-a')] },
    'c-b': { page: [row('b1', '2026-10-01T10:30:00.000Z', 'c-b')] },
    'c-new': { page: [] },
    'c-ann': { page: [] },
  };
  mockApi.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/community/voice-consent') return { data: { seen: true, seen_at: '2026-10-20T10:00:00.000Z' } };
    const [, id, what] = /^\/community\/cohorts\/([^/]+)\/(messages|read|members)$/.exec(url) ?? [];
    const space = spaces[id];
    if (!space) throw fail(404);
    if (what === 'members') return { data: { members: [], next_cursor: null } };
    if (what === 'read') return { data: { last_read_at: null, last_read_message_id: null } };
    if (space.refuse) throw fail(space.refuse);
    if (space.hold) return new Promise(() => undefined);
    return { data: { messages: space.page, next_before: null } };
  });
  mockApi.post.mockReset().mockResolvedValue({ data: { ok: true } });
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
});
afterEach(() => client.clear());

// The phone: the screen (or nothing in front) with the app's own strip drawn after it, as App.tsx does.
const phone = (screen: boolean) => (
  <QueryClientProvider client={client}>{screen ? <Screen /> : null}<StatusBarBand /></QueryClientProvider>
);
type R = Awaited<ReturnType<typeof render>>;
const strip = (r: R) => StyleSheet.flatten(r.getByTestId('status-bar-band').props.style).backgroundColor;
const lightIcons = (r: R) => !!r.queryByText('icons-light');
// Every test starts from the page colour (the strip's owners are module-level), then puts the screen in front.
const front = async () => {
  const r = await render(phone(false));
  expect(strip(r)).toBe(STATUS_BAR_BONE);
  expect(lightIcons(r)).toBe(false);
  await r.rerender(phone(true));
  return r;
};
const closeWhileOpen = (status: number) => async (r: R) => {
  await r.findByTestId('space-chat-row-a2');
  spaces['c-a'].refuse = status;
  await act(async () => { await client.refetchQueries(); });
};

// Four entries on every row: jest reads a callback with more parameters than the row has as taking 'done'.
type State = [string, () => void, string, ((r: R) => Promise<void>) | null];
const STATES: State[] = [
  ['the open chat with rows', () => undefined, 'space-chat-row-a2', null],
  ["a new space's first row", () => { mockParams.current = { cohortId: 'c-new' }; }, 'space-chat-start', null],
  ['loading', () => { spaces['c-a'].hold = true; }, 'space-chat-loading', null],
  ['a failed read of the messages', () => { spaces['c-a'].refuse = 500; }, 'space-chat-error', null],
  ['a failed read of the space list', () => { mockSpaces.failed = true; }, 'space-chat-error', null],
  ['offline with nothing kept', () => { mockNet.isOnline = false; spaces['c-a'].hold = true; }, 'space-chat-error', null],
  ['closed by a 403 while she reads', () => undefined, 'space-chat-no-access', closeWhileOpen(403)],
  ['closed by a 404 while she reads', () => undefined, 'space-chat-no-access', closeWhileOpen(404)],
  ['closed on arrival, the space not in her list', () => { mockParams.current = { cohortId: 'c-gone' }; }, 'space-chat-no-access', null],
  ['Announcements for a member', () => { mockParams.current = { cohortId: 'c-ann' }; }, 'space-chat-hint', null],
  ["the coach's stack", () => { mockSpaces.role = 'coach'; mockNav.routes = ['CoachCommunityCohorts', 'CommunitySpaceChat', 'CoachCommunityCohortDetail']; }, 'space-chat-row-a2', null],
  ['Space info open over the chat (a Modal: no focus change)', () => undefined, 'space-info-sheet', async (r) => {
    await r.findByTestId('space-chat-row-a2');
    await fireEvent.press(r.getByTestId('space-chat-info'));
  }],
];

describe('STRIP-945-M A: the top strip is the bar\'s deep green with light icons while the space chat is in front', () => {
  it.each(STATES)('in front, %s: the strip is forestPop.deep with light icons', async (_name, setup, ready, then) => {
    setup();
    const r = await front();
    if (then) await then(r);
    expect(await r.findByTestId(ready)).toBeTruthy();
    expect(strip(r)).toBe(forestPop.deep);
    expect(lightIcons(r)).toBe(true);
    await r.unmount();
  });

  it('not in front (useIsFocused false): the page colour, no light icons', async () => {
    mockNav.focused = false;
    const r = await front();
    await r.findByTestId('space-chat-row-a2');
    expect(strip(r)).toBe(STATUS_BAR_BONE);
    expect(lightIcons(r)).toBe(false);
    await r.unmount();
  });

  it('in front, not in front, in front again on one mounted tree: deep, page colour, deep', async () => {
    const r = await front();
    await r.findByTestId('space-chat-row-a2');
    const seen: unknown[] = [strip(r)];
    for (const focused of [false, true]) {
      mockNav.focused = focused;
      await r.rerender(phone(true));
      seen.push(strip(r));
    }
    expect(seen).toEqual([forestPop.deep, STATUS_BAR_BONE, forestPop.deep]);
    await r.unmount();
  });

  it('the screen unmounts while the strip stays mounted: the page colour, no light icons', async () => {
    const r = await front();
    await r.findByTestId('space-chat-row-a2');
    await r.rerender(phone(false));
    expect(strip(r)).toBe(STATUS_BAR_BONE);
    expect(lightIcons(r)).toBe(false);
    await r.unmount();
  });

  it('another space while mounted (a link: SpaceChat remounts by key): deep before and after, then the page colour once it goes', async () => {
    const r = await front();
    await r.findByTestId('space-chat-row-a2');
    expect(strip(r)).toBe(forestPop.deep);
    mockParams.current = { cohortId: 'c-b' };
    await r.rerender(phone(true));
    await r.findByTestId('space-chat-row-b1');
    expect(strip(r)).toBe(forestPop.deep);
    expect(lightIcons(r)).toBe(true);
    await r.rerender(phone(false)); // an owner left behind by the first mount would keep it deep
    expect(strip(r)).toBe(STATUS_BAR_BONE);
    await r.unmount();
  });
});

// The left edge of a host element, from the flattened styles on its way up to the screen: each parent's left padding;
// in a row, every earlier sibling's width and side margins and the gaps; the element's own left margin.
type Host = { type: unknown; props: { style?: unknown; testID?: string }; parent: Host | null; children: Array<Host | string> };
const css = (n: Host) => (StyleSheet.flatten(n.props.style as object) ?? {}) as Record<string, number | string | undefined>;
const num = (...v: Array<number | string | undefined>) => Number(v.find((x) => typeof x === 'number') ?? 0);
const hostParent = (n: Host) => { let p = n.parent; while (p && typeof p.type !== 'string') p = p.parent; return p; };
const hostKids = (n: Host): Host[] => n.children.flatMap((c) => (typeof c === 'string' ? [] : typeof c.type === 'string' ? [c] : hostKids(c)));
const leftOf = (el: Host): number => {
  let x = num(css(el).marginLeft, css(el).marginHorizontal, css(el).margin);
  for (let n = el, p = hostParent(n); p && n.props.testID !== 'space-chat-screen'; n = p, p = hostParent(p)) {
    const ps = css(p);
    x += num(ps.paddingLeft, ps.paddingHorizontal, ps.padding);
    if (ps.flexDirection === 'row') {
      const before = hostKids(p).slice(0, hostKids(p).indexOf(n));
      x += before.length * num(ps.columnGap, ps.gap);
      for (const b of before) x += num(css(b).width) + num(css(b).marginLeft, css(b).marginHorizontal, css(b).margin) + num(css(b).marginRight, css(b).marginHorizontal, css(b).margin);
    }
    if (hostParent(p) && p.props.testID !== 'space-chat-screen') x += num(ps.marginLeft, ps.marginHorizontal, ps.margin);
  }
  return x;
};

describe('STRIP-945-M B: the space name sits where the picked Style 2 frames put it, one bar for every state', () => {
  it.each([
    ['the open chat', 'c-a', 'Running', 'space-chat-row-a2', null],
    ["a new space's first row", 'c-new', 'Fresh start', 'space-chat-start', null],
    ['closed while she reads', 'c-a', 'Running', 'space-chat-no-access', closeWhileOpen(403)],
  ] as const)('%s: the name\'s box starts 76 pt from the left edge; the hash and the member count stay at 56', async (_n, cohortId, name, ready, then) => {
    mockParams.current = { cohortId };
    const r = await front();
    if (then) await then(r);
    await r.findByTestId(ready);
    const title = r.getAllByText(name).find((t) => hostParent(t as unknown as Host) && hostKids(hostParent(t as unknown as Host)!).some((k) => k.props.testID === 'space-chat-hash'));
    expect(title).toBeTruthy();
    const hash = hostKids(hostParent(title as unknown as Host)!).find((k) => k.props.testID === 'space-chat-hash')!;
    expect([leftOf(hash), leftOf(title as unknown as Host)]).toEqual([56, 76]);
    const count = hostKids(hostParent(hostParent(title as unknown as Host)!)!)[1];
    expect(leftOf(count)).toBe(56);
    await r.unmount();
  });

  it("the glyph's own box stays 18 wide with a 6 pt right margin: in the bar, in the first row's tile and in Space info", async () => {
    mockParams.current = { cohortId: 'c-new' };
    const r = await front();
    await r.findByTestId('space-chat-start');
    await fireEvent.press(r.getByTestId('space-chat-info'));
    const sheet = await r.findByTestId('space-info-sheet');
    const hidden = { includeHiddenElements: true }; // the glyph is hidden from VoiceOver and TalkBack
    const boxes = [...r.getAllByTestId('space-chat-hash', hidden), within(sheet).getByTestId('space-chat-hash', hidden)]
      .map((h) => { const st = css(h as unknown as Host); return [st.width, st.marginRight]; });
    expect(boxes.length).toBeGreaterThanOrEqual(3);
    for (const b of boxes) expect(b).toEqual([18, 6]);
    await waitFor(() => expect(within(sheet).getByText('Fresh start')).toBeTruthy());
    await r.unmount();
  });
});
