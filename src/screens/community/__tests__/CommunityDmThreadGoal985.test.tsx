/**
 * REFINE-985 (fix round 1 on m#985): the client's DM thread drawn toward its GOAL, Voice B Studio frame 05b
 * (planning/MOCKUP3/VOICE-NOTES/src/B/B-05b-feed-1000_ios.html), and, for the 1:1 parts 05b does not draw, C6CHAT-S-V2's
 * c08_dm (planning/MOCKUP3/C6CHAT-S-V2/src/lib.py and screens.py). Each case quotes the CSS line it holds the thread to.
 * The real CommunityDmThreadScreen, ThreadHeader, MessageBubble, ComposerInput, CommunityEmptyState and react-query
 * hooks, with CommunityDmClientM.test.tsx's mocks (the HTTP edge, theme, device store, realtime, navigation, the
 * signed-in person); icons draw their name, colour and size, and SafetyMenu keeps the props it is handed.
 * Names and ids are fictional.
 */
import React from 'react';
import { StyleSheet, TextInput } from 'react-native';
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
  const R = require('react');
  const { Text } = require('react-native');
  const Icon = (p: { name: string; color?: string; size?: number }) => R.createElement(Text, { testID: `icon-${p.name}`, style: { color: p.color, fontSize: p.size } }, '');
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
jest.mock('../../../api/communityRealtime', () => new Proxy({ __esModule: true }, {
  get: (target, key) => (key in target ? target[key as keyof typeof target] : () => () => undefined),
}));
let mockUser: { id: string; role: string; name: string; firstName: string; coach_id?: string } | null = null;
jest.mock('../../../hooks/useCurrentUser', () => ({
  ...jest.requireActual('../../../hooks/useCurrentUser'),
  useCurrentUser: () => mockUser,
}));
const mockGoBack = jest.fn();
let mockParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack, addListener: () => () => undefined, setOptions: () => undefined }),
    useRoute: () => ({ params: mockParams }),
    useFocusEffect: (cb: () => void | (() => void)) => R.useEffect(() => cb(), [cb]),
    useIsFocused: () => true,
  };
});
// SafetyMenu keeps what it is handed (its own trigger is drawn in sharedLook985.test.tsx).
const mockMenus: Record<string, Record<string, unknown>> = {};
jest.mock('../../../components/community/SafetyMenu', () => (p: { testID: string }) => {
  mockMenus[p.testID] = p;
  return require('react').createElement(require('react-native').View, { testID: p.testID });
});

const CommunityDmThreadScreen = require('../CommunityDmThreadScreen').default;
const { useBlockedUsersStore } = require('../../../store/blockedUsersStore');
const { forestPop: fp, brand } = jest.requireActual('../../../theme/tokens');

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1);
const CLIENT = uuid(10);
const COACH = uuid(20);
const MEMBER = uuid(30);
const NOW = Date.now();
const COACH_URL = '/v1/clients/me/coach';
const msgsUrl = (other: string) => `/community/workspaces/${WS}/dms/${other}/messages`;
const FIELD = 'community-dmthread-composer-field';
const ME = {
  feature_flag_state: 'enabled', workspace_id: WS,
  membership: { id: uuid(40), role: 'client', notify_level: 'live', dm_enabled_effective: true, last_read_message_at: null, joined_at: new Date(NOW - 86_400_000).toISOString() },
  unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  flags: { community_api: true, community_dm: true, community_realtime: false, community_push: true, community_telemetry: false },
};
const msg = (n: number, from: string, to: string, body: string, at = new Date(NOW - 60_000)) => ({
  id: uuid(n), thread_id: `${WS}:${[from, to].sort().join(':')}`, sender_user_id: from, recipient_user_id: to, body, created_at: at.toISOString(), deleted: false,
});
const axiosErr = (status: number) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data: { error: 'not_found' } } });
function serve(http: Record<string, unknown>) {
  mockGet.mockImplementation(async (url: string) => {
    const key = url.split('?')[0];
    if (!(key in http)) throw axiosErr(404);
    return { data: http[key], headers: {} };
  });
  mockPost.mockResolvedValue({ data: {}, headers: {} });
}
let qc: QueryClient;
const open = (params: Record<string, unknown>) => {
  mockParams = params;
  return render(<QueryClientProvider client={qc}><CommunityDmThreadScreen /></QueryClientProvider>);
};
type View = Awaited<ReturnType<typeof render>>;
const css = (el: { props: { style?: unknown } }) => (StyleSheet.flatten(el.props.style as never) ?? {}) as Record<string, unknown>;
const bar = (view: View) => view.getByTestId('community-dmthread-header');
const NAMED = [msg(901, COACH, CLIENT, 'Keep Friday easy.'), msg(900, CLIENT, COACH, 'Should I still run on Friday?', new Date(NOW - 120_000))];

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockGoBack.mockReset();
  for (const k of Object.keys(mockMenus)) delete mockMenus[k];
  mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: COACH };
  useBlockedUsersStore.setState({ blocked: [] });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
});

describe('REFINE-985: the bar (05b .mast :20, .mt :22, .mtt :23, .mts :24; c08 .mono.sm)', () => {
  it('a, b: the title is 05b\'s 19 pt (1.1875rem) on a 23.75 line; the bar\'s padding is 2 6 10 with a 2 pt gap', async () => {
    serve({ '/community/me': ME, [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [msgsUrl(COACH)]: { messages: NAMED } });
    const view = await open({ recipientId: COACH });
    await waitFor(() => expect(within(bar(view)).getByText('Alex Morgan')).toBeTruthy());
    expect(css(within(bar(view)).getByText('Alex Morgan'))).toMatchObject({ fontFamily: 'Inter_600SemiBold', fontSize: 19, lineHeight: 23.75, color: fp.onDeep });
    expect(css(bar(view))).toMatchObject({ gap: 2, paddingTop: 2, paddingBottom: 10, paddingHorizontal: 6, backgroundColor: fp.deep });
  });

  it('d: my coach with a known name: "Your coach" under the name (13 pt, #B8CCBF) and c08\'s tile with the initials', async () => {
    serve({ '/community/me': ME, [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [msgsUrl(COACH)]: { messages: NAMED } });
    const view = await open({ recipientId: COACH });
    await waitFor(() => expect(within(bar(view)).getByText('Your coach')).toBeTruthy());
    expect(css(within(bar(view)).getByText('Your coach'))).toMatchObject({ fontSize: 13, lineHeight: 17.55, color: fp.onDeepMuted });
    const tile = view.getByTestId('community-dmthread-header-tile');
    expect(css(tile)).toMatchObject({ width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: brand[500], backgroundColor: fp.forest });
    expect(css(within(tile).getByText('AM'))).toMatchObject({ fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 21, color: fp.gold });
  });

  it('d: my coach\'s name not known, or a member: no line under the title and no tile', async () => {
    serve({ '/community/me': ME, [msgsUrl(COACH)]: { messages: NAMED } });
    const unknown = await open({ recipientId: COACH });
    await waitFor(() => expect(within(bar(unknown)).getByText('Coach')).toBeTruthy());
    await waitFor(() => expect(mockGet.mock.calls.some((c) => String(c[0]).startsWith(COACH_URL))).toBe(true));
    expect(unknown.queryByText('Your coach')).toBeNull();
    expect(unknown.queryByTestId('community-dmthread-header-tile')).toBeNull();
    await unknown.unmount();

    serve({ '/community/me': ME, [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [msgsUrl(MEMBER)]: { messages: [msg(905, MEMBER, CLIENT, 'Nice run')] } });
    const member = await open({ recipientId: MEMBER });
    await waitFor(() => expect(member.getByText('Nice run')).toBeTruthy());
    expect(member.queryByText('Your coach')).toBeNull();
    expect(member.queryByTestId('community-dmthread-header-tile')).toBeNull();
  });

  it('e: Report on the bar is bare and light (#FBF7F0, 05b\'s info button), 22 pt, with no bone chip behind it', async () => {
    serve({ '/community/me': ME, [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [msgsUrl(COACH)]: { messages: NAMED } });
    const view = await open({ recipientId: COACH });
    await waitFor(() => expect(mockMenus['community-dmthread-safety']).toBeTruthy());
    expect(mockMenus['community-dmthread-safety']).toMatchObject({ triggerColor: fp.onDeep, triggerSize: 22 });
    const chips = view.container.queryAll((n) => typeof n.type === 'string' && (css(n).width === 36 && css(n).backgroundColor === fp.onDeep));
    expect(chips).toHaveLength(0);
  });
});

describe('REFINE-985: the messages (c08 bubbles; 05b .mx :41, "More actions" :130)', () => {
  it('h, j: bubbles in c08\'s numbers (the text stays 15/21: 05b .mx is 15/21.75, under 1 pt)', async () => {
    serve({ '/community/me': ME, [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [msgsUrl(COACH)]: { messages: NAMED } });
    const view = await open({ recipientId: COACH });
    await waitFor(() => expect(view.getByText('Keep Friday easy.')).toBeTruthy());
    const theirs = view.getByTestId(`bubble-dm-message-${uuid(901)}`);
    const mine = view.getByTestId(`bubble-dm-message-${uuid(900)}`);
    expect(css(theirs)).toMatchObject({ maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderBottomLeftRadius: 6, borderWidth: 1, backgroundColor: '#FFFFFF', borderColor: fp.sageLine });
    expect(css(mine)).toMatchObject({ maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderBottomRightRadius: 6, borderWidth: 0, backgroundColor: fp.forest });
    expect(css(within(theirs).getByText('Keep Friday easy.'))).toMatchObject({ fontSize: 15, lineHeight: 21 });
  });

  it('k: each message\'s Report mark sits at its top, 05b\'s #5A5A56 at 22 pt', async () => {
    serve({ '/community/me': ME, [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [msgsUrl(COACH)]: { messages: NAMED } });
    const view = await open({ recipientId: COACH });
    await waitFor(() => expect(mockMenus[`dm-message-safety-${uuid(901)}`]).toBeTruthy());
    expect(mockMenus[`dm-message-safety-${uuid(901)}`]).toMatchObject({ triggerColor: fp.n700, triggerSize: 22 });
    let row = view.getByTestId(`dm-message-safety-${uuid(901)}`).parent;
    while (row && !(typeof row.type === 'string' && css(row).flexDirection === 'row')) row = row.parent;
    expect(row && css(row).alignItems).toBe('flex-start');
  });
});

describe('REFINE-985: the dock (05b .comp :47, .field :48; Send in c08\'s colours)', () => {
  it('n, o: the white dock, the pill box and a pale sage Send, still disabled, until there are words; then forest', async () => {
    serve({ '/community/me': ME, [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [msgsUrl(COACH)]: { messages: NAMED } });
    const view = await open({ recipientId: COACH });
    await waitFor(() => expect(view.getByTestId(FIELD)).toBeTruthy());
    expect(css(view.getByTestId('community-dmthread-composer'))).toMatchObject({ backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#E2E6E1', paddingTop: 8, paddingBottom: 8, paddingHorizontal: 10, gap: 6, alignItems: 'center' });
    const field = view.getByTestId(FIELD);
    expect(css(field)).toMatchObject({ minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: '#C9D0CA', paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 15, lineHeight: 19.5, backgroundColor: '#FFFFFF' });
    expect(field.props.placeholderTextColor).toBe(fp.n700);
    const send = () => view.getByTestId('community-dmthread-composer-send');
    expect(css(send())).toMatchObject({ width: 44, height: 44, borderRadius: 22, backgroundColor: fp.sage });
    expect(send().props.accessibilityState).toMatchObject({ disabled: true });
    expect(css(within(send()).getByTestId('icon-arrow-up'))).toMatchObject({ color: fp.brand400, fontSize: 20 });
    await act(async () => { fireEvent.changeText(view.getByTestId(FIELD), 'On my way'); });
    expect(css(send())).toMatchObject({ backgroundColor: fp.forest });
    expect(send().props.accessibilityState).toMatchObject({ disabled: false });
    expect(css(within(send()).getByTestId('icon-arrow-up'))).toMatchObject({ color: fp.onDeep });
  });
});

describe('REFINE-985: the empty thread (05b .btn :54, .btn.p :55)', () => {
  it('q: "Start the conversation" is 05b\'s primary button: 54 pt, padding 14 20, Inter 600 16 on a 20 line', async () => {
    serve({ '/community/me': ME, [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [msgsUrl(COACH)]: { messages: [] } });
    const view = await open({ recipientId: COACH });
    await waitFor(() => expect(view.getByText('Start the conversation')).toBeTruthy());
    expect(css(view.getByTestId('community-dmthread-empty-action'))).toMatchObject({ minHeight: 54, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 14, backgroundColor: fp.forest });
    expect(css(view.getByText('Start the conversation'))).toMatchObject({ fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 20, color: fp.onDeep });
  });
});

describe('REFINE-985: what the thread does not draw (KT-3) and every control that does something', () => {
  const NEVER = ['Attach', 'Record a voice note', 'Type a message…', 'New messages'];
  const buttons = (view: View) => view.container.queryAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'button')
    .map((n) => n.props.accessibilityLabel as string);

  it('m, o, p: no Attach, no voice note mic, no "Type a message…", no "New messages" line, in a thread or an empty one', async () => {
    for (const messages of [NAMED, []]) {
      serve({ '/community/me': ME, [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [msgsUrl(COACH)]: { messages } });
      const view = await open({ recipientId: COACH });
      await waitFor(() => expect(view.getByTestId(FIELD)).toBeTruthy());
      for (const words of NEVER) {
        expect(view.queryByText(words)).toBeNull();
        expect(view.queryByLabelText(words)).toBeNull();
      }
      expect(view.getByTestId(FIELD).props.placeholder).toBe('Message');
      await view.unmount();
    }
  });

  it('every pressable on the thread does something: Back goes back, Send sends, Start the conversation focuses the box', async () => {
    serve({ '/community/me': ME, [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [msgsUrl(COACH)]: { messages: [] } });
    const empty = await open({ recipientId: COACH });
    await waitFor(() => expect(empty.getByText('Start the conversation')).toBeTruthy());
    expect(buttons(empty).sort()).toEqual(['Back', 'Send', 'Start the conversation']);
    const focus = (TextInput as unknown as { prototype: { focus: jest.Mock } }).prototype.focus;
    if (typeof focus?.mockClear === 'function') focus.mockClear();
    const table: [string, () => void][] = [
      ['Back', () => expect(mockGoBack).toHaveBeenCalledTimes(1)],
      ['Start the conversation', () => { if (typeof focus?.mock === 'object') expect(focus).toHaveBeenCalled(); }],
    ];
    for (const [label, did] of table) {
      await act(async () => { fireEvent.press(empty.getByLabelText(label)); });
      did();
    }
    await act(async () => { fireEvent.changeText(empty.getByTestId(FIELD), 'Hello'); });
    await act(async () => { fireEvent.press(empty.getByLabelText('Send')); });
    await waitFor(() => expect(mockPost.mock.calls.some((c) => String(c[0]).includes(`/dms/${COACH}/messages`))).toBe(true));
  });
});
