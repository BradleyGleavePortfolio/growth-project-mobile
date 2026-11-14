/**
 * COACH-DM-CLIENT-M (cases 9 to 13, PLAN question 3): every place the client's DM screens name the other person names
 * them truly. "Coach", "your coach" and Roman's mark only for the client's own current coach (client.coach_id), with the
 * coach's name where the phone has it (useMyCoachName, GET /v1/clients/me/coach), else "Coach"; anyone else (another
 * member, a former coach) is NO_NAME "Direct message" (coach-dm/coachDm.tsx:27), never "Coach". "Start the
 * conversation" focuses the message box, and a row in its first minute reads "Active now".
 * The real CommunityDmListScreen, CommunityDmThreadScreen, DmRow, ComposerInput and react-query hooks; only the HTTP edge
 * (services/api), the theme, icons, the device store, realtime, navigation, the signed-in person and SafetyMenu (drawn
 * as its authorName) are stubbed. Fixtures copy the server's answers key for key (b#1243 CONTRACT 6767820759 "The list
 * row": {thread_id, workspace_id, other_user_id, created_at, last_message_at}). Names and ids are fictional.
 */
import React from 'react';
import { TextInput } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── The HTTP edge ───────────────────────────────────────────────────────────────────────────────────────────────────
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
jest.mock('../../../api/communityRealtime', () => new Proxy({ __esModule: true }, {
  get: (target, key) => (key in target ? target[key as keyof typeof target] : () => () => undefined),
}));
let mockUser: { id: string; role: string; name: string; firstName: string; coach_id?: string } | null = null;
jest.mock('../../../hooks/useCurrentUser', () => ({
  ...jest.requireActual('../../../hooks/useCurrentUser'),
  useCurrentUser: () => mockUser,
}));
const mockNavigate = jest.fn();
let mockParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), addListener: () => () => undefined, setOptions: () => undefined }),
    useRoute: () => ({ params: mockParams }),
    useFocusEffect: (cb: () => void | (() => void)) => R.useEffect(() => cb(), [cb]),
    useIsFocused: () => true,
  };
});
// SafetyMenu draws the name it is handed (its own behaviour is tested beside it).
jest.mock('../../../components/community/SafetyMenu', () => (p: { authorName?: string; testID?: string }) =>
  require('react').createElement(require('react-native').Text, { testID: p.testID }, `menu:${p.authorName}`));

const CommunityDmListScreen = require('../CommunityDmListScreen').default;
const CommunityDmThreadScreen = require('../CommunityDmThreadScreen').default;
const DmRow = require('../../../components/community/DmRow').default;
const { useBlockedUsersStore } = require('../../../store/blockedUsersStore');

// ─── Ids and the server's answers ────────────────────────────────────────────────────────────────────────────────────
const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1);
const CLIENT = uuid(10);
const COACH = uuid(20);
const FORMER_COACH = uuid(21);
const MEMBER = uuid(30);
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const COACH_URL = '/v1/clients/me/coach';
const LIST_URL = `/community/workspaces/${WS}/dms`;
const msgsUrl = (other: string) => `/community/workspaces/${WS}/dms/${other}/messages`;
const FIELD = 'community-dmthread-composer-field';
const PENDING = Symbol('pending');
const NOT_FOUND = Symbol('404');

/** GET /community/me for a member client (community.service.ts:110-183). */
const ME = {
  feature_flag_state: 'enabled', workspace_id: WS,
  membership: { id: uuid(40), role: 'client', notify_level: 'live', dm_enabled_effective: true, last_read_message_at: null, joined_at: ago(86_400_000) },
  unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  flags: { community_api: true, community_dm: true, community_realtime: false, community_push: true, community_telemetry: false },
};
/** A DM list row (b#1243 community-dms.service.ts listThreads; CONTRACT 6767820759 "The list row"). */
const thread = (other: string, lastAt: string | null) => ({
  thread_id: `${WS}:${[CLIENT, other].sort().join(':')}`, workspace_id: WS, other_user_id: other, created_at: null, last_message_at: lastAt,
});
/** A DM message (community-dms.service.ts messageView). */
const msg = (n: number, from: string, to: string, body: string) => ({
  id: uuid(n), thread_id: `${WS}:${[from, to].sort().join(':')}`, sender_user_id: from, recipient_user_id: to, body, created_at: ago(60_000), deleted: false,
});
const axiosErr = (status: number, data: Record<string, unknown>) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data } });
const BLOCKED_BY_THEM = axiosErr(403, { error: 'forbidden', code: 'community.dm.blocked_by_them' });

let coachAnswer: Promise<unknown> | null = null;
function serve(http: Record<string, unknown>) {
  mockGet.mockImplementation(async (url: string) => {
    const key = url.split('?')[0];
    if (key === COACH_URL && coachAnswer) return coachAnswer;
    if (!(key in http) || http[key] === NOT_FOUND) throw axiosErr(404, { error: 'not_found' });
    if (http[key] === PENDING) return new Promise(() => undefined);
    if (http[key] instanceof Error) throw http[key];
    return { data: http[key], headers: {} };
  });
  mockPost.mockResolvedValue({ data: {}, headers: {} });
}
let qc: QueryClient;
const withQuery = (el: React.ReactElement) => <QueryClientProvider client={qc}>{el}</QueryClientProvider>;
const rowOf = (view: Awaited<ReturnType<typeof render>>, other: string) => view.getByTestId(`dm-row-${thread(other, null).thread_id}`);
const coachCalls = () => mockGet.mock.calls.filter((c) => String(c[0]).split('?')[0] === COACH_URL).length;

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockNavigate.mockReset();
  mockParams = {};
  coachAnswer = null;
  mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: COACH };
  useBlockedUsersStore.setState({ blocked: [] });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
});

// ─── The list (cases 9, 10, 13) ──────────────────────────────────────────────────────────────────────────────────────
describe('the client\'s DM list', () => {
  const list = () => render(withQuery(<CommunityDmListScreen workspaceId={WS} />));

  it('case 9: my coach\'s row shows the coach\'s name with "your coach" and Roman\'s mark, and opens that thread', async () => {
    serve({ [COACH_URL]: { id: COACH, name: '  Alex Morgan ' }, [LIST_URL]: { threads: [thread(COACH, ago(3_600_000))] } });
    const view = await list();
    await waitFor(() => expect(within(rowOf(view, COACH)).getByText(/^Alex Morgan\s+·\s+your coach$/)).toBeTruthy());
    expect(view.getByLabelText('Open conversation with Alex Morgan')).toBeTruthy();
    expect(within(rowOf(view, COACH)).getByTestId('dm-row-roman')).toBeTruthy();
    await act(async () => { fireEvent.press(rowOf(view, COACH)); });
    expect(mockNavigate.mock.calls).toEqual([['CommunityDmThread', { recipientId: COACH }]]);
  });

  it('case 9: my coach\'s name not known (the read failed): "Coach" with "your coach" and Roman\'s mark, as today', async () => {
    serve({ [COACH_URL]: NOT_FOUND, [LIST_URL]: { threads: [thread(COACH, ago(3_600_000))] } });
    const view = await list();
    await waitFor(() => expect(within(rowOf(view, COACH)).getByText(/^Coach\s+·\s+your coach$/)).toBeTruthy());
    expect(within(rowOf(view, COACH)).getByTestId('dm-row-roman')).toBeTruthy();
  });

  it('case 10: another member and a former coach read "Direct message": no mark, no "your coach", no letter, never "Coach"', async () => {
    serve({ [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [LIST_URL]: { threads: [thread(MEMBER, ago(3_600_000)), thread(FORMER_COACH, ago(7_200_000))] } });
    const view = await list();
    await waitFor(() => expect(rowOf(view, MEMBER)).toBeTruthy());
    for (const other of [MEMBER, FORMER_COACH]) {
      const row = within(rowOf(view, other));
      expect(row.getByText('Direct message')).toBeTruthy();
      expect(row.queryByText(/your coach|Coach|Alex Morgan/)).toBeNull();
      expect(row.queryByTestId('dm-row-roman')).toBeNull();
      expect(row.queryByText('D')).toBeNull();
    }
    expect(view.getAllByLabelText('Open conversation with Direct message')).toHaveLength(2);
  });

  it('case 10: a client with no coach: every row is a member\'s row and nothing asks for a coach\'s name', async () => {
    mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana' };
    serve({ [LIST_URL]: { threads: [thread(COACH, ago(3_600_000))] } });
    const view = await list();
    await waitFor(() => expect(within(rowOf(view, COACH)).getByText('Direct message')).toBeTruthy());
    expect(view.queryByTestId('dm-row-roman')).toBeNull();
    expect(coachCalls()).toBe(0);
  });

  it('PLAN 3: before the signed-in person is known no row is drawn (never a name that could be wrong), then the rows', async () => {
    mockUser = null;
    serve({ [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [LIST_URL]: { threads: [thread(COACH, ago(3_600_000)), thread(MEMBER, null)] } });
    const view = await list();
    // The thread list has answered (the only read: no coach id yet, so no coach's name is asked for).
    await waitFor(() => expect(qc.getQueryCache().findAll().filter((q) => q.state.status === 'success')).toHaveLength(1));
    await act(async () => { await Promise.resolve(); });
    expect(view.queryByText(/Coach|Direct message/)).toBeNull();
    expect(view.queryByText('No conversations yet')).toBeNull();
    mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: COACH };
    await view.rerender(withQuery(<CommunityDmListScreen workspaceId={WS} />));
    await waitFor(() => expect(within(rowOf(view, COACH)).getByText(/^Alex Morgan\s+·\s+your coach$/)).toBeTruthy());
    expect(within(rowOf(view, MEMBER)).getByText('Direct message')).toBeTruthy();
  });

  it('case 13: a row in its first minute reads "Active now"; at 90 seconds "Active 1m ago"', async () => {
    serve({ [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [LIST_URL]: { threads: [thread(COACH, ago(20_000)), thread(MEMBER, ago(90_000))] } });
    const view = await list();
    await waitFor(() => expect(within(rowOf(view, COACH)).getByText('Active now')).toBeTruthy());
    expect(within(rowOf(view, MEMBER)).getByText('Active 1m ago')).toBeTruthy();
    expect(view.queryByText(/now ago/)).toBeNull();
  });

  it('case 13: DmRow itself, the client\'s row (no initials): "Active now" under a minute', async () => {
    const row = await render(<DmRow thread={thread(MEMBER, ago(20_000))} participantLabel="Direct message" onPress={() => undefined} testID="r" />);
    expect(row.getByText('Active now')).toBeTruthy();
    expect(row.queryByText('Active now ago')).toBeNull();
  });
});

// ─── The thread (cases 11, 12) ───────────────────────────────────────────────────────────────────────────────────────
describe('the client\'s DM thread', () => {
  const open = (params: Record<string, unknown>) => {
    mockParams = params;
    return render(withQuery(<CommunityDmThreadScreen />));
  };
  const bar = (view: Awaited<ReturnType<typeof render>>) => within(view.getByTestId('community-dmthread-header'));
  /** The name a SafetyMenu was handed (the stub draws it as its own text). */
  const menu = (view: Awaited<ReturnType<typeof render>>, testID: string) => view.getByTestId(testID).props.children;

  it('case 11: my coach\'s thread reached with no name: the bar and both Report menus name the coach', async () => {
    serve({ '/community/me': ME, [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [msgsUrl(COACH)]: { messages: [msg(900, COACH, CLIENT, 'See you Monday')] } });
    const view = await open({ recipientId: COACH });
    await waitFor(() => expect(bar(view).getByText('Alex Morgan')).toBeTruthy());
    await waitFor(() => expect(view.getByTestId(`dm-message-safety-${uuid(900)}`)).toBeTruthy());
    expect(menu(view, 'community-dmthread-safety')).toBe('menu:Alex Morgan');
    expect(menu(view, `dm-message-safety-${uuid(900)}`)).toBe('menu:Alex Morgan');
    expect(view.queryByText(/^Coach$|menu:Coach/)).toBeNull();
  });

  it('case 11: my coach\'s name not known: the bar reads "Coach", as today', async () => {
    serve({ '/community/me': ME, [COACH_URL]: NOT_FOUND, [msgsUrl(COACH)]: { messages: [] } });
    const view = await open({ recipientId: COACH });
    await waitFor(() => expect(view.getByText('Start the conversation')).toBeTruthy());
    expect(bar(view).getByText('Coach')).toBeTruthy();
  });

  it('case 11: a member reached with a name: that name, and no coach\'s name is read', async () => {
    serve({ '/community/me': ME, [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [msgsUrl(MEMBER)]: { messages: [msg(901, MEMBER, CLIENT, 'Nice run')] } });
    const view = await open({ recipientId: MEMBER, participantLabel: 'Jordan Lee' });
    await waitFor(() => expect(view.getByTestId(`dm-message-safety-${uuid(901)}`)).toBeTruthy());
    expect(bar(view).getByText('Jordan Lee')).toBeTruthy();
    expect(menu(view, 'community-dmthread-safety')).toBe('menu:Jordan Lee');
    expect(coachCalls()).toBe(0);
  });

  it('case 11: a member (or a former coach) reached with no name: "Direct message", never "Coach"', async () => {
    serve({ '/community/me': ME, [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [msgsUrl(FORMER_COACH)]: { messages: [msg(902, FORMER_COACH, CLIENT, 'Hi')] } });
    const view = await open({ recipientId: FORMER_COACH });
    await waitFor(() => expect(view.getByTestId(`dm-message-safety-${uuid(902)}`)).toBeTruthy());
    expect(bar(view).getByText('Direct message')).toBeTruthy();
    expect(menu(view, 'community-dmthread-safety')).toBe('menu:Direct message');
    expect(view.queryByText(/^Coach$|menu:Coach|Alex Morgan/)).toBeNull();
  });

  it('case 11: they blocked me: the closed line waits for my coach\'s name, then names them as the bar does', async () => {
    let answer: (v: unknown) => void = () => undefined;
    coachAnswer = new Promise((r) => { answer = r; });
    serve({ '/community/me': ME, [msgsUrl(COACH)]: BLOCKED_BY_THEM });
    const view = await open({ recipientId: COACH });
    await waitFor(() => expect(coachCalls()).toBeGreaterThan(0));
    await waitFor(() => expect(view.queryByTestId(FIELD)).toBeNull());
    await act(async () => { await Promise.resolve(); });
    expect(view.queryByTestId('community-dmthread-closed')).toBeNull();
    expect(view.queryByText(/has blocked you/)).toBeNull();
    await act(async () => { answer({ data: { id: COACH, name: 'Alex Morgan' }, headers: {} }); });
    await waitFor(() => expect(view.getByText('Alex Morgan has blocked you')).toBeTruthy());
    expect(bar(view).getByText('Alex Morgan')).toBeTruthy();
  });

  it('PLAN 3: before the signed-in person is known the bar reads "Direct message", then my coach\'s name', async () => {
    mockUser = null;
    serve({ '/community/me': ME, [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [msgsUrl(COACH)]: { messages: [] } });
    const view = await open({ recipientId: COACH });
    expect(bar(view).getByText('Direct message')).toBeTruthy();
    mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: COACH };
    await view.rerender(withQuery(<CommunityDmThreadScreen />));
    await waitFor(() => expect(bar(view).getByText('Alex Morgan')).toBeTruthy());
  });

  it('case 12: an empty open thread: one tap on "Start the conversation" focuses the message box, once', async () => {
    serve({ '/community/me': ME, [COACH_URL]: { id: COACH, name: 'Alex Morgan' }, [msgsUrl(COACH)]: { messages: [] } });
    const view = await open({ recipientId: COACH });
    await waitFor(() => expect(view.getByText('Start the conversation')).toBeTruthy());
    expect(view.getByTestId(FIELD)).toBeTruthy();
    const focus = (TextInput as unknown as { prototype: { focus: jest.Mock } }).prototype.focus;
    focus.mockClear();
    await act(async () => { fireEvent.press(view.getByText('Start the conversation')); });
    expect(focus).toHaveBeenCalledTimes(1);
    expect((focus.mock.instances[0] as unknown as { props: { testID?: string } }).props.testID).toBe(FIELD);
  });

  it('case 12: not yet open (the read is out) or closed (I blocked them): no "Start the conversation" and no box, as today', async () => {
    serve({ '/community/me': ME, [msgsUrl(MEMBER)]: PENDING });
    const out = await open({ recipientId: MEMBER, participantLabel: 'Jordan Lee' });
    await waitFor(() => expect(out.getByText('Loading messages…')).toBeTruthy());
    expect(out.queryByText('Start the conversation')).toBeNull();
    expect(out.queryByTestId(FIELD)).toBeNull();
    await out.unmount();
    useBlockedUsersStore.setState({ blocked: [{ id: MEMBER, displayName: 'Jordan Lee', blockedAt: '2026-11-01T00:00:00Z' }] });
    serve({ '/community/me': ME, [msgsUrl(MEMBER)]: { messages: [] } });
    const closed = await open({ recipientId: MEMBER, participantLabel: 'Jordan Lee' });
    await waitFor(() => expect(closed.getByTestId('community-dmthread-closed')).toBeTruthy());
    expect(closed.queryByText('Start the conversation')).toBeNull();
    expect(closed.queryByTestId(FIELD)).toBeNull();
  });
});
