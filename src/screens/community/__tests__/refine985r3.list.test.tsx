/**
 * REFINE-985R3 LIST-1, LIST-2: the client's DM list toward the owner's pick 203-P2, DM-LIST-MOCK Style 1 "Coach first"
 * (planning/DM-LIST-MOCK on tgp-agent-context#578's branch; the numbers are src/html/S1_L1_ios.html's CSS). Her own
 * coach in a forest card on top, with or without a thread; "Conversations" over every other thread, each "Direct
 * message" with a blank tile; the empty list in the drawing's order. What the phone has no read for is never drawn: a
 * name or a letter for anyone else, "Former coach", a count. The list, DmRow, the card and the hooks are real; the HTTP
 * edge is a stand-in. Names and ids are fictional.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
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
let mockUser: Record<string, unknown> | null = { id: '00000010-0000-4000-8000-000000000000', role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: '00000020-0000-4000-8000-000000000000' };
jest.mock('../../../hooks/useCurrentUser', () => ({
  ...jest.requireActual('../../../hooks/useCurrentUser'),
  useCurrentUser: () => mockUser,
}));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));
jest.mock('../../../components/community/SafetyMenu', () => (p: { authorName?: string; testID?: string }) =>
  require('react').createElement(require('react-native').Text, { testID: p.testID }, `menu:${p.authorName}`));


const CommunityDmListScreen = require('../CommunityDmListScreen').default;
const { DmRow } = require('../../../components/community');
const { queryClient } = require('../../../services/queryClient');
const { forestPop: fp, brand, colors } = jest.requireActual('../../../theme/tokens');

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1);
const CLIENT = uuid(10);
const COACH = uuid(20);
const FORMER = uuid(21);
const MEMBER_A = uuid(30);
const MEMBER_B = uuid(31);
const MIN = 60_000;
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const thread = (other: string, lastAgo: number | null) => ({
  thread_id: `${WS}:${[CLIENT, other].sort().join(':')}`, workspace_id: WS, other_user_id: other, created_at: ago(30 * 24 * HOUR), last_message_at: lastAgo === null ? null : ago(lastAgo),
});
const idOf = (other: string) => thread(other, null).thread_id;
const HIDDEN = { includeHiddenElements: true } as const;
const css = (el: { props: { style?: unknown } }) => (StyleSheet.flatten(el.props.style as never) ?? {}) as Record<string, unknown>;

let coachName: string | null;
let threads: unknown[];
beforeEach(() => {
  coachName = 'Sam Carter';
  threads = [thread(COACH, 3 * MIN), thread(MEMBER_A, HOUR), thread(FORMER, 2 * 24 * HOUR), thread(MEMBER_B, 5 * 24 * HOUR)];
  mockUser = { id: CLIENT, role: 'student', name: 'Jordan Lee', firstName: 'Jordan', coach_id: COACH };
  mockNavigate.mockReset();
  mockGet.mockReset().mockImplementation(async (url: string) => {
    const key = url.split('?')[0];
    if (key === '/v1/clients/me/coach' && coachName) return { data: { id: COACH, name: coachName }, headers: {} };
    if (key === `/community/workspaces/${WS}/dms`) return { data: { threads }, headers: {} };
    throw Object.assign(new Error('HTTP 404'), { isAxiosError: true, response: { status: 404, data: { error: 'not_found' } } });
  });
  mockPost.mockReset().mockResolvedValue({ data: {}, headers: {} });
  queryClient.clear();
});
afterEach(() => queryClient.clear());

type View = Awaited<ReturnType<typeof render>>;
const open = async (): Promise<View> => {
  const view = await render(<QueryClientProvider client={queryClient}><CommunityDmListScreen embedded workspaceId={WS} /></QueryClientProvider>);
  await waitFor(() => expect(mockGet.mock.calls.some((c) => String(c[0]).split('?')[0].endsWith('/dms'))).toBe(true));
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return view;
};
/** Every piece of text on the list, top to bottom, hidden pieces too. */
const said = (n: { props: { children?: unknown } }) => ([] as unknown[]).concat(n.props.children ?? []).join('');
const words = (view: View) => view.queryAllByText(/[\s\S]+/, HIDDEN).map(said);
const card = (view: View) => view.getByTestId(`dm-row-${idOf(COACH)}`);
const rowIds = (view: View) => view.getAllByTestId(/^dm-row-/).map((n) => String(n.props.testID)).filter((id) => id !== `dm-row-${idOf(COACH)}`);

describe('L1: the coach first, then Conversations', () => {
  it('her coach\'s card: the name, "Your coach" on its own line, the time, one serif letter; then "Conversations"; then every other thread in the server\'s order', async () => {
    const view = await open();
    await waitFor(() => expect(within(card(view)).getByText('Sam Carter')).toBeTruthy());
    expect(words(view)).toEqual([
      'S', 'Sam Carter', 'Your coach', 'Active 3m ago',
      'Conversations',
      'Direct message', 'Active 1h ago', 'Direct message', 'Active 2d ago', 'Direct message', 'Active 5d ago',
    ]);
    expect(rowIds(view)).toEqual([MEMBER_A, FORMER, MEMBER_B].map((o) => `dm-row-${idOf(o)}`));
    expect(css(card(view))).toMatchObject({ backgroundColor: fp.deep, borderRadius: 16, marginTop: 12, marginHorizontal: 16, marginBottom: 4, paddingVertical: 12, paddingHorizontal: 14, gap: 14 });
    const tile = within(card(view)).getByTestId(`dm-row-${idOf(COACH)}-tile`, HIDDEN);
    expect(css(tile)).toMatchObject({ width: 48, height: 48, borderRadius: 12, backgroundColor: fp.forest, borderWidth: 1, borderColor: brand[500] });
    expect(css(within(tile).getByText('S', HIDDEN))).toMatchObject({ fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 24, color: fp.sage });
    expect(css(within(card(view)).getByText('Sam Carter'))).toMatchObject({ fontFamily: 'Inter_600SemiBold', fontSize: 17, lineHeight: 21.25, color: fp.onDeep });
    expect(css(within(card(view)).getByText('Your coach'))).toMatchObject({ fontSize: 14.5, color: fp.onDeepMuted });
    expect(css(within(card(view)).getByText('Active 3m ago'))).toMatchObject({ fontSize: 13.5, color: fp.onDeepMuted });
    expect(css(view.getByText('Conversations'))).toMatchObject({ fontSize: 11.5, letterSpacing: 1.61, textTransform: 'uppercase', color: brand[500], paddingTop: 16, paddingHorizontal: 18, paddingBottom: 6 });
  });

  it('every other row is the Studio row: "Direct message", a blank sage tile, 64 pt, no letter, no name, no count, no mark', async () => {
    const view = await open();
    await waitFor(() => expect(rowIds(view)).toHaveLength(3));
    for (const other of [MEMBER_A, FORMER, MEMBER_B]) {
      const row = view.getByTestId(`dm-row-${idOf(other)}`);
      expect(css(row)).toMatchObject({ minHeight: 64, paddingHorizontal: 18, paddingVertical: 8, gap: 14, borderBottomWidth: 1, borderBottomColor: fp.sageLine });
      const tile = view.getByTestId(`tile-dm-row-${idOf(other)}`);
      expect(css(tile)).toMatchObject({ width: 44, height: 44, borderRadius: 12, backgroundColor: fp.sage });
      expect(within(tile).queryAllByText(/[\s\S]+/, HIDDEN)).toHaveLength(0); // no letter from "Direct message"
      expect(within(row).getByText('Direct message')).toBeTruthy();
      expect(within(row).queryByText(/your coach|former coach|coach|Sam|Carter/i)).toBeNull();
      expect(within(row).queryByText(/^\d+$/)).toBeNull();
    }
    expect(view.queryAllByText('Your coach')).toHaveLength(1);
    expect(view.queryByTestId('dm-row-roman', HIDDEN)).toBeNull();
    expect(view.queryByText(/Former coach/i)).toBeNull();
  });

  it('spoken: the card says who and "your coach"; another row says "Direct message" and its own time, so no two rows read alike', async () => {
    const view = await open();
    await waitFor(() => expect(rowIds(view)).toHaveLength(3));
    expect(card(view).props).toMatchObject({ accessibilityRole: 'button', accessibilityLabel: 'Open conversation with Sam Carter', accessibilityValue: { text: 'your coach' } });
    const spoken = [MEMBER_A, FORMER, MEMBER_B].map((o) => view.getByTestId(`dm-row-${idOf(o)}`).props).map((p) => `${p.accessibilityLabel}, ${p.accessibilityValue.text}`);
    expect(spoken).toEqual([
      'Open conversation with Direct message, active 1h ago', 'Open conversation with Direct message, active 2d ago', 'Open conversation with Direct message, active 5d ago',
    ]);
    expect(view.getByTestId(`dm-row-${idOf(COACH)}-tile`, HIDDEN).props).toMatchObject({ importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true });
  });

  it('taps: the card opens her coach\'s thread, a row its own, with the route and param the list has always used', async () => {
    const view = await open();
    await waitFor(() => expect(rowIds(view)).toHaveLength(3));
    await act(async () => { fireEvent.press(card(view)); });
    await act(async () => { fireEvent.press(view.getByTestId(`dm-row-${idOf(FORMER)}`)); });
    expect(mockNavigate.mock.calls).toEqual([['CommunityDmThread', { recipientId: COACH }], ['CommunityDmThread', { recipientId: FORMER }]]);
  });

  it('"Conversations" is drawn only when another row is', async () => {
    threads = [thread(COACH, 3 * MIN)];
    const view = await open();
    await waitFor(() => expect(within(card(view)).getByText('Sam Carter')).toBeTruthy());
    expect(view.queryByText('Conversations')).toBeNull();
    expect(words(view)).toEqual(['S', 'Sam Carter', 'Your coach', 'Active 3m ago']);
  });
});

describe('the card with no thread, and the time line it can stand behind (KT-10)', () => {
  it('a client who has never written: the same card with "No messages yet"; a tap opens the thread with her coach', async () => {
    threads = [thread(MEMBER_A, HOUR)];
    const view = await open();
    await waitFor(() => expect(view.queryByTestId('dm-coach-card')).not.toBeNull());
    const c = view.getByTestId('dm-coach-card');
    expect(words(view)).toEqual(['S', 'Sam Carter', 'Your coach', 'No messages yet', 'Conversations', 'Direct message', 'Active 1h ago']);
    expect(c.props).toMatchObject({ accessibilityLabel: 'Open conversation with Sam Carter', accessibilityValue: { text: 'your coach, no messages yet' } });
    await act(async () => { fireEvent.press(c); });
    expect(mockNavigate.mock.calls).toEqual([['CommunityDmThread', { recipientId: COACH }]]);
  });

  it('a full page without her coach\'s thread cannot say there is none: no time line, and nothing spoken about messages', async () => {
    threads = Array.from({ length: 30 }, (_x, i) => thread(uuid(100 + i), (i + 1) * HOUR));
    const view = await open();
    await waitFor(() => expect(view.queryByTestId('dm-coach-card')).not.toBeNull());
    const c = view.getByTestId('dm-coach-card');
    expect(within(c).queryAllByText(/[\s\S]+/, HIDDEN).map(said)).toEqual(['S', 'Sam Carter', 'Your coach']);
    expect(c.props.accessibilityValue).toEqual({ text: 'your coach' });
  });
});

describe('L2: the first minute', () => {
  it('"Active now" in the drawing\'s weight and colour and the leaf ring on the tile, on the card and on a row; no ring after it', async () => {
    threads = [thread(COACH, 20_000), thread(MEMBER_A, 30_000), thread(MEMBER_B, 90_000)];
    const view = await open();
    await waitFor(() => expect(within(card(view)).getByText('Active now')).toBeTruthy());
    expect(css(within(card(view)).getByText('Active now'))).toMatchObject({ fontFamily: 'Inter_600SemiBold', color: fp.onDeep });
    const ring = { position: 'absolute', top: -5, left: -5, right: -5, bottom: -5, borderWidth: 2, borderRadius: 16, borderColor: fp.leaf };
    expect(css(view.getByTestId(`dm-row-${idOf(COACH)}-ring`, HIDDEN))).toMatchObject(ring);
    const now = view.getByTestId(`dm-row-${idOf(MEMBER_A)}`);
    expect(css(within(now).getByText('Active now'))).toMatchObject({ fontFamily: 'Inter_600SemiBold', color: fp.forest, fontSize: 13.5 });
    expect(css(view.getByTestId(`ring-dm-row-${idOf(MEMBER_A)}`))).toMatchObject(ring);
    expect(now.props.accessibilityValue).toEqual({ text: 'active now' });
    const later = view.getByTestId(`dm-row-${idOf(MEMBER_B)}`);
    expect(css(within(later).getByText('Active 1m ago'))).toMatchObject({ color: fp.n700 });
    expect(view.queryByTestId(`ring-dm-row-${idOf(MEMBER_B)}`)).toBeNull();
    expect(view.queryByText(/now ago/)).toBeNull();
  });
});

describe('L4: the empty list', () => {
  it('the card, then "Send your coach a message", then "No conversations yet" and Roman\'s line; the action opens what it always has', async () => {
    threads = [];
    const view = await open();
    await waitFor(() => expect(view.queryByTestId('community-dmlist-empty')).not.toBeNull());
    const all = words(view);
    expect(all.slice(0, 6)).toEqual(['S', 'Sam Carter', 'Your coach', 'No messages yet', 'Send your coach a message', 'No conversations yet']);
    expect(all).toHaveLength(7);
    expect(all[6]).toMatch(/Jordan/); // Roman's line, with her first name
    expect(view.queryByText('Conversations')).toBeNull();
    expect(view.queryByTestId('community-empty-roman', HIDDEN)).toBeNull();
    const action = view.getByTestId('community-dmlist-empty-action');
    expect(css(action)).toMatchObject({ minHeight: 48, borderRadius: 12, backgroundColor: fp.forest, paddingHorizontal: 20 });
    expect(css(view.getByText('No conversations yet'))).toMatchObject({ fontSize: 20, lineHeight: 25, color: fp.ink });
    expect(css(view.getByText(all[6]))).toMatchObject({ fontSize: 15, lineHeight: 21.75, color: colors.charcoal });
    await act(async () => { fireEvent.press(action); });
    await act(async () => { fireEvent.press(view.getByTestId('dm-coach-card')); });
    expect(mockNavigate.mock.calls).toEqual([['CommunityComposer', { mode: 'dm', recipientId: '' }], ['CommunityDmThread', { recipientId: COACH }]]);
  });
});

describe('L5 and L6: the name', () => {
  it('L5 the coach\'s name not yet known: "Coach" on the card and a blank tile (no letter from "Coach")', async () => {
    coachName = null;
    const view = await open();
    await waitFor(() => expect(within(card(view)).getByText('Coach')).toBeTruthy());
    expect(within(view.getByTestId(`dm-row-${idOf(COACH)}-tile`, HIDDEN)).queryAllByText(/[\s\S]+/, HIDDEN)).toHaveLength(0);
    expect(within(card(view)).getByText('Your coach')).toBeTruthy();
    expect(card(view).props.accessibilityLabel).toBe('Open conversation with Coach');
  });

  it('L6 a 40-character name is read whole (it wraps, never cut), and "Your coach" is never cut', async () => {
    coachName = 'Maximilian Bartholomew Featherstonehaugh';
    expect(coachName.length).toBe(40);
    const view = await open();
    await waitFor(() => expect(within(card(view)).getByText(coachName as string)).toBeTruthy());
    for (const text of [coachName, 'Your coach', 'Active 3m ago']) {
      const node = within(card(view)).getByText(text);
      expect(node.props.numberOfLines).toBeUndefined();
      expect(node.props.ellipsizeMode).toBeUndefined();
    }
    expect(within(view.getByTestId(`dm-row-${idOf(COACH)}-tile`, HIDDEN)).getByText('M', HIDDEN)).toBeTruthy();
  });
});

describe('never for anyone but her own coach', () => {
  it('a client with no coach: no card, no "Your coach", every thread a row; her empty list is as before', async () => {
    mockUser = { id: CLIENT, role: 'student', name: 'Jordan Lee', firstName: 'Jordan' };
    const view = await open();
    await waitFor(() => expect(view.getAllByTestId(/^dm-row-/)).toHaveLength(4));
    expect(view.queryByTestId('dm-coach-card')).toBeNull();
    expect(view.queryByText(/your coach/i)).toBeNull();
    expect(words(view).filter((w) => w === 'Direct message')).toHaveLength(4);
    expect(mockGet.mock.calls.some((c) => String(c[0]).startsWith('/v1/clients/me/coach'))).toBe(false);
    await view.unmount();

    threads = [];
    queryClient.clear();
    const empty = await open();
    await waitFor(() => expect(empty.queryByTestId('community-dmlist-empty')).not.toBeNull());
    expect(empty.queryByTestId('dm-coach-card')).toBeNull();
    expect(empty.queryByTestId('community-empty-roman')).not.toBeNull();
  });

  it('before the signed-in person is known: no card, no row, no heading', async () => {
    mockUser = null;
    const view = await open();
    expect(words(view)).toEqual([]);
  });
});

describe('the coach app\'s rows (DmRow without the new prop) draw and read as before', () => {
  it('no ring in the first minute, the time in its own colour, no spoken value', async () => {
    const row = await render(<DmRow thread={thread(MEMBER_A, 20_000)} participantLabel="Jordan Lee" initials="JL" chevron onPress={() => undefined} testID="r" />);
    expect(row.queryByTestId('ring-r')).toBeNull();
    expect(css(row.getByText('Active now'))).toMatchObject({ fontSize: 13.5, color: fp.n700 });
    expect(css(row.getByText('Active now')).fontFamily).toBeUndefined();
    expect(row.getByTestId('r').props.accessibilityValue?.text).toBeUndefined();
    expect(row.getByTestId('r').props.accessibilityLabel).toBe('Open conversation with Jordan Lee');
  });
});
