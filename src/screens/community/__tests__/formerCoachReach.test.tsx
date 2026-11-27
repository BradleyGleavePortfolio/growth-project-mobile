/**
 * COMMUNITY-DM-FORMER-REACH-M (owner ALM-P1, #ALM-E12, ALM-D5; 203-D12, 203-D51): Style 3 "Coaches first".
 * The real list, thread, locked page (CoachOnlyGate), coach's list, FormerCoach parts, communityApi and react-query
 * hooks; only the HTTP edge, theme, icons, storage, realtime, navigation, the signed-in person and the terms gate are
 * stood in. Each case is one acceptance line of the job's tier header. Names and ids are fictional.
 */
import React from 'react';
import { Alert, Text } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockGetClients = jest.fn();
jest.mock('../../../services/api', () => ({
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
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => mockTheme(), LightTheme: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => {
  const R = require('react');
  const { Text: T } = require('react-native');
  const Icon = (p: { name: string }) => R.createElement(T, { testID: `icon-${p.name}` }, '');
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
  prefsStorage: { getString: () => undefined, getStringAsync: async () => undefined, set: () => undefined },
}));
jest.mock('../../../api/communityRealtime', () => new Proxy({ __esModule: true }, {
  get: (target, key) => (key in target ? target[key as keyof typeof target] : () => () => undefined),
}));
let mockUser: { id: string; role: string; name: string; firstName: string; coach_id?: string } | null = null;
jest.mock('../../../hooks/useCurrentUser', () => ({ ...jest.requireActual('../../../hooks/useCurrentUser'), useCurrentUser: () => mockUser }));
let mockCoachless = false;
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => mockCoachless }));
jest.mock('../../../lib/userCache', () => ({ ...jest.requireActual('../../../lib/userCache'), readUserCacheSync: () => null }));
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ messageCoach: jest.fn() }) }));
// The terms gate is its own suite (CommunityTermsGate.test.tsx); here it marks that the locked page's thread is behind it.
// FIX-DMFR-M-1 C1 draws the real gate (mockRealGate) to show its pages' Back in front of the locked page's thread.
let mockRealGate = false;
jest.mock('../../../components/community/CommunityTermsGate', () => {
  const R = require('react');
  const { View } = require('react-native');
  const Real = jest.requireActual('../../../components/community/CommunityTermsGate').default;
  return {
    __esModule: true,
    default: (p: { children: React.ReactNode }) => (mockRealGate ? R.createElement(Real, p) : R.createElement(View, { testID: 'terms-gate' }, p.children)),
  };
});
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn(), addListener: () => () => undefined, setOptions: () => undefined };
let mockParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    NavigationContext: R.createContext(undefined),
    useNavigation: () => mockNav,
    useRoute: () => ({ params: mockParams }),
    useFocusEffect: (cb: () => void | (() => void)) => R.useEffect(() => cb(), [cb]),
    useIsFocused: () => true,
  };
});
// The per-message menus keep what they are handed (SafetyMenu is its own suite).
const mockMenus: Record<string, Record<string, unknown>> = {};
jest.mock('../../../components/community/SafetyMenu', () => (p: { testID: string }) => {
  mockMenus[p.testID] = p;
  return require('react').createElement(require('react-native').View, { testID: p.testID });
});

const CommunityDmListScreen = require('../CommunityDmListScreen').default;
const CommunityDmThreadScreen = require('../CommunityDmThreadScreen').default;
const CoachDmListScreen = require('../coach-dm/CoachDmListScreen').default;
const { CoachOnlyGate, COMMUNITY_LOCK_BODY, COMMUNITY_LOCK_TITLE } = require('../../../components/coachless/JoinCoachState');
const { CommunityMeResponseSchema } = require('../../../api/communityApi');
const { FORMER_CLOSED_LINE, formerReachLine } = require('../../../components/community/FormerCoach');
const { CLOSED_LINE } = require('../../../components/messaging/ConversationClosed');
const { useBlockedUsersStore } = require('../../../store/blockedUsersStore');

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1); // her community now (Lee's)
const WS2 = uuid(2); // Maya's community, where she is a former client
const WS3 = uuid(3); // a second former community the server lists (never drawn)
const CLIENT = uuid(10);
const LEE = uuid(20);
const MAYA = uuid(30);
const RILEY = uuid(31);
const SAM = uuid(40);
const JORDAN = uuid(41);
const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const FLAGS = { community_api: true, community_dm: true, community_realtime: false, community_push: true, community_telemetry: false };
const UNREAD = { cohort_messages: 0, dm_messages: 0, mentions: 0 };
const MEMBERSHIP = { id: uuid(50), role: 'client', notify_level: 'live', dm_enabled_effective: true, last_read_message_at: null, joined_at: ago(9000) };
const OLD_ME = { feature_flag_state: 'enabled', workspace_id: WS, membership: MEMBERSHIP, unread: UNREAD, flags: FLAGS }; // production today
const formerItem = (ws: string, coach: string, name?: string | null) => ({ workspace_id: ws, coach_user_id: coach, ...(name !== undefined ? { coach_display_name: name } : {}) });
const ME = { ...OLD_ME, former_coach_dms: [formerItem(WS2, MAYA, 'Maya Brooks'), formerItem(WS3, RILEY, 'Riley Shah')] };
const thread = (ws: string, other: string, at: string, extra: Record<string, unknown> = {}) => ({
  thread_id: `${ws}:${other}`, workspace_id: ws, other_user_id: other, created_at: null, last_message_at: at, ...extra,
});
const msg = (n: number, from: string, to: string, body: string, at = ago(12)) => ({
  id: uuid(n), thread_id: `${WS2}:x`, sender_user_id: from, recipient_user_id: to, body, created_at: at, deleted: false,
});
const MAYA_MSGS = { messages: [msg(901, MAYA, CLIENT, 'Same time next Saturday?'), msg(900, CLIENT, MAYA, 'Thanks for keeping my spot.', ago(60))] };
const closedErr = () => Object.assign(new Error('HTTP 404'), { isAxiosError: true, response: { status: 404, data: { code: 'community.dm.not_found' } } });
const notFound = () => Object.assign(new Error('HTTP 404'), { isAxiosError: true, response: { status: 404, data: {} } });
const mayaMsgs = `/community/workspaces/${WS2}/dms/${MAYA}/messages`;

function serve(http: Record<string, unknown | (() => never)>) {
  mockGet.mockImplementation(async (url: string) => {
    const key = url.split('?')[0];
    if (!(key in http)) throw notFound();
    const v = http[key];
    if (typeof v === 'function') (v as () => never)();
    return { data: v, headers: {} };
  });
  mockPost.mockImplementation(async (url: string, body?: { user_id?: string }) => ({
    data: url === '/community/blocks' ? { blocked_user_id: body?.user_id, blocked: true } : {}, headers: {},
  }));
}
const BASE = {
  '/v1/clients/me/coach': { id: LEE, name: 'Lee Tanaka' },
  [`/community/workspaces/${WS}/dms`]: { threads: [thread(WS, LEE, ago(3))] },
  [`/community/workspaces/${WS2}/dms`]: { threads: [thread(WS2, MAYA, ago(12))] },
  [`/community/workspaces/${WS3}/dms`]: { threads: [thread(WS3, RILEY, ago(1))] },
};
let qc: QueryClient;
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
const list = () => wrap(<CommunityDmListScreen embedded workspaceId={WS} prerequisiteLoading={false} prerequisiteError={false} />);
const openThread = (recipientId: string) => {
  mockParams = { recipientId };
  return wrap(<CommunityDmThreadScreen />);
};

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockGetClients.mockReset();
  Object.values(mockNav).forEach((f) => (typeof f === 'function' && 'mockReset' in f ? (f as jest.Mock).mockReset() : undefined));
  for (const k of Object.keys(mockMenus)) delete mockMenus[k];
  mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: LEE };
  mockCoachless = false;
  mockRealGate = false;
  useBlockedUsersStore.setState({ blocked: [] });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity } } });
});

describe('her list (Style 3 S3_listv, row 1b)', () => {
  it('shows former_coach_dms[0] only, under her coach\'s card: overline, serif name, the time; no message text, no count', async () => {
    serve({ ...BASE, '/community/me': ME });
    const view = await list();
    const card = await waitFor(() => view.getByTestId('dm-former-coach'));
    await waitFor(() => expect(within(card).getByText('Active 12m ago')).toBeTruthy());
    expect(within(card).getByText('Former coach')).toBeTruthy();
    expect(within(card).getByText('Maya Brooks')).toBeTruthy();
    expect(within(card).getByText('M', { includeHiddenElements: true })).toBeTruthy(); // the tile's letter (hidden: the name is read)
    expect(view.queryByText('Riley Shah')).toBeNull(); // the second listed community is never drawn (#ALM-E12: one)
    expect(mockGet.mock.calls.map((c) => c[0])).not.toContain(`/community/workspaces/${WS3}/dms`);
    expect(card.props.accessibilityLabel).toBe('Open conversation with Maya Brooks, former coach');
    expect(card.props.accessibilityValue).toEqual({ text: 'active 12m ago' });
    expect(view.queryByText('No conversations yet')).toBeNull();
    await fireEvent.press(card);
    expect(mockNav.navigate).toHaveBeenCalledWith('CommunityDmThread', { recipientId: MAYA });
  });

  it('with no coach_display_name (the server today) the title is "Former coach", never blank, with no overline and a blank tile', async () => {
    serve({ ...BASE, '/community/me': { ...OLD_ME, former_coach_dms: [formerItem(WS2, MAYA), formerItem(WS3, RILEY, null)] } });
    const view = await list();
    const card = await waitFor(() => view.getByTestId('dm-former-coach'));
    expect(within(card).getAllByText('Former coach')).toHaveLength(1);
    expect(within(view.getByTestId('dm-former-coach-tile', { includeHiddenElements: true })).queryByText(/./, { includeHiddenElements: true })).toBeNull();
    expect(card.props.accessibilityLabel).toBe('Open conversation with your former coach');
    serve({ ...BASE, '/community/me': { ...OLD_ME, former_coach_dms: [formerItem(WS2, MAYA, '   ')] } });
    await act(async () => { await qc.invalidateQueries(); });
    expect(within(view.getByTestId('dm-former-coach')).getByText('Former coach')).toBeTruthy();
  });

  it('the old server answer (no field) still parses and renders: her coach\'s card and no former card', async () => {
    expect(CommunityMeResponseSchema.parse(OLD_ME).former_coach_dms).toBeUndefined();
    serve({ ...BASE, '/community/me': OLD_ME });
    const view = await list();
    await waitFor(() => expect(view.getByText('Lee Tanaka')).toBeTruthy());
    expect(view.queryByTestId('dm-former-coach')).toBeNull();
  });
});

describe('KT-2: a block, a ban, a removal or a departure', () => {
  const blockMaya = () => act(async () => {
    useBlockedUsersStore.setState({ blocked: [{ id: MAYA, displayName: 'Maya Brooks', blockedAt: '2026-11-26T00:00:00Z' }] });
  });
  it('KT-2: my block of my former coach takes her card off my list at once', async () => {
    serve({ ...BASE, '/community/me': ME });
    const view = await list();
    await waitFor(() => expect(view.getByTestId('dm-former-coach')).toBeTruthy());
    await blockMaya();
    expect(view.queryByTestId('dm-former-coach')).toBeNull();
    expect(view.queryByText('Maya Brooks')).toBeNull();
  });

  it('KT-2: my block of my former coach takes her card off the locked page at once', async () => {
    mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana' };
    mockCoachless = true;
    serve({ ...BASE, '/community/me': { ...OLD_ME, workspace_id: null, membership: null, former_coach_dms: [formerItem(WS2, MAYA, 'Maya Brooks')] } });
    const locked = await wrap(
      <CoachOnlyGate title={COMMUNITY_LOCK_TITLE} body={COMMUNITY_LOCK_BODY} testID="community-coach-lock"><Text>the stack</Text></CoachOnlyGate>,
    );
    await waitFor(() => expect(locked.getByTestId('community-coach-lock-former')).toBeTruthy());
    await blockMaya();
    expect(locked.queryByTestId('community-coach-lock-former')).toBeNull();
    expect(locked.getByText(COMMUNITY_LOCK_TITLE)).toBeTruthy();
  });

  it('KT-2: when the server stops listing her (her block, a ban, a removal, she left) the card goes on the next /me read', async () => {
    serve({ ...BASE, '/community/me': ME });
    const view = await list();
    await waitFor(() => expect(view.getByTestId('dm-former-coach')).toBeTruthy());
    serve({ ...BASE, '/community/me': { ...ME, former_coach_dms: [] } });
    await act(async () => { await qc.invalidateQueries({ queryKey: ['community', 'me'] }); });
    await waitFor(() => expect(view.queryByTestId('dm-former-coach')).toBeNull());
    expect(view.getByText('Lee Tanaka')).toBeTruthy();
  });
});

describe('the thread (Style 3 S3_thread: a Style C page)', () => {
  it('reads the former coach\'s community (from /me, no new route param) and draws the masthead, not 05b\'s bar', async () => {
    serve({ ...BASE, '/community/me': ME, [mayaMsgs]: MAYA_MSGS });
    const view = await openThread(MAYA);
    await waitFor(() => expect(view.getByText('Same time next Saturday?')).toBeTruthy());
    expect(mockGet.mock.calls.map((c) => c[0])).toContain(mayaMsgs);
    const mast = view.getByTestId('former-thread-masthead');
    expect(within(mast).getByText('Former coach')).toBeTruthy();
    expect(within(mast).getByText('Maya Brooks')).toBeTruthy();
    expect(view.queryByTestId('community-dmthread-header')).toBeNull();
    // S3 .sep: the oldest message opens its day, above it in one cell (an inverted cell lays siblings out column-reverse).
    const cell = view.getByTestId(`dm-cell-${uuid(900)}`);
    expect(cell.children[0]).toBe(view.getByTestId(`dm-day-${uuid(900)}`));
    expect(within(cell).getByText('Thanks for keeping my spot.')).toBeTruthy();
    expect(view.getByTestId('community-dmthread-composer')).toBeTruthy();
    // 203-D51: her old coach is not her coach now, so each of Maya's messages keeps Report and Block.
    expect(mockMenus[`dm-message-safety-${uuid(901)}`]).toMatchObject({ authorUserId: MAYA, authorName: 'Maya Brooks', viewerCoachId: LEE });
    await fireEvent.press(view.getByTestId('former-thread-back'));
    expect(mockNav.goBack).toHaveBeenCalled();
  });

  it('closed: the server\'s one answer (404 not_found) shows the page with no reason, her coach now, and no box', async () => {
    serve({ ...BASE, '/community/me': ME, [mayaMsgs]: () => { throw closedErr(); } });
    const view = await openThread(MAYA);
    const page = await waitFor(() => view.getByTestId('former-thread-closed'));
    expect(within(page).getByText(CLOSED_LINE)).toBeTruthy();
    expect(within(page).getByText(FORMER_CLOSED_LINE)).toBeTruthy();
    expect(within(page).getByText('Your coach')).toBeTruthy();
    await waitFor(() => expect(within(page).getByText('Lee Tanaka')).toBeTruthy());
    expect(view.queryByTestId('community-dmthread-composer')).toBeNull();
    expect(view.queryByTestId('former-thread-about')).toBeNull();
    // W13 (OPERATOR RULING 7213408207 item 3): the row says its visible words in reading order.
    expect(view.getByTestId('former-thread-closed-coach').props.accessibilityLabel).toBe('Your coach, Lee Tanaka');
    await fireEvent.press(view.getByTestId('former-thread-closed-action'));
    expect(mockNav.replace).toHaveBeenCalledWith('CommunityDmThread', { recipientId: LEE });
  });

  it('Block per 203-D51: the three dots\' sheet says why, then Block asks with the approved words and blocks her old coach', async () => {
    serve({ ...BASE, '/community/me': ME, [mayaMsgs]: MAYA_MSGS });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = await openThread(MAYA);
    await waitFor(() => expect(view.getByText('Same time next Saturday?')).toBeTruthy());
    await fireEvent.press(view.getByTestId('former-thread-about'));
    const sheet = view.getByTestId('former-sheet');
    expect(within(sheet).getByText(formerReachLine('Maya Brooks'))).toBeTruthy();
    expect(within(sheet).getByText("You are still in Maya's community, so you can message each other here.")).toBeTruthy();
    expect(within(sheet).getByText('Report')).toBeTruthy();
    // The Modal's onDismiss, read while the sheet is up (the jest Modal draws nothing once closed), as SafetyMenu.test.tsx.
    let node = sheet as unknown as { props: Record<string, unknown>; parent: unknown } | null;
    while (node && typeof node.props.onDismiss !== 'function') node = node.parent as typeof node;
    const dismissed = node?.props.onDismiss as () => void;
    await fireEvent.press(within(sheet).getByText('Block Maya Brooks'));
    expect(alert).not.toHaveBeenCalled(); // iOS: the confirm waits for the sheet to go
    await act(async () => dismissed());
    expect(alert).toHaveBeenCalledWith('Block Maya Brooks?',
      "You and Maya Brooks will no longer see each other's posts, comments, messages or voice notes, and neither of you can message the other. In a direct message they see that you blocked them; nobody else is told. You can unblock them from Community safety.",
      expect.any(Array));
    const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => Promise<void> }>;
    await act(async () => { await buttons.find((b) => b.text === 'Block')?.onPress?.(); });
    expect(mockPost).toHaveBeenCalledWith('/community/blocks', { user_id: MAYA }, expect.anything());
    expect(alert).toHaveBeenCalledTimes(1); // no failure after the confirm
    expect(mockNav.goBack).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('Report in the sheet reports her old coach\'s latest message with the reasons list', async () => {
    serve({ ...BASE, '/community/me': ME, [mayaMsgs]: MAYA_MSGS });
    const view = await openThread(MAYA);
    await waitFor(() => expect(view.getByText('Same time next Saturday?')).toBeTruthy());
    await fireEvent.press(view.getByTestId('former-thread-about'));
    await fireEvent.press(view.getByTestId('former-sheet-report'));
    expect(view.getByText('Why are you reporting this?')).toBeTruthy();
    await fireEvent.press(view.getByTestId('former-sheet-reason-spam'));
    expect(mockPost).toHaveBeenCalledWith('/community/moderation/reports', expect.objectContaining({ target_type: 'message', target_id: uuid(901), reason: 'spam' }), expect.anything());
  });
});

describe('no coach now (ALM-D5, S3_nocoach)', () => {
  const lock = () => wrap(
    <CoachOnlyGate title={COMMUNITY_LOCK_TITLE} body={COMMUNITY_LOCK_BODY} testID="community-coach-lock"><Text>the stack</Text></CoachOnlyGate>,
  );
  const COACHLESS_ME = { ...OLD_ME, workspace_id: null, membership: null, former_coach_dms: [formerItem(WS2, MAYA, 'Maya Brooks')] };

  it('the locked page carries her former coach\'s card, and the card opens that thread here, behind the terms; Back returns', async () => {
    mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana' };
    mockCoachless = true;
    serve({ ...BASE, '/community/me': COACHLESS_ME, [mayaMsgs]: MAYA_MSGS });
    const view = await lock();
    expect(view.getByText(COMMUNITY_LOCK_TITLE)).toBeTruthy();
    expect(view.queryByText('the stack')).toBeNull();
    const card = await waitFor(() => view.getByTestId('community-coach-lock-former'));
    await waitFor(() => expect(within(card).getByText('Active 12m ago')).toBeTruthy());
    await fireEvent.press(card);
    await waitFor(() => expect(view.getByText('Same time next Saturday?')).toBeTruthy());
    expect(within(view.getByTestId('terms-gate')).getByTestId('former-thread-masthead')).toBeTruthy();
    expect(mockGet.mock.calls.map((c) => c[0])).toContain(mayaMsgs);
    expect(view.getByTestId('community-dmthread-composer')).toBeTruthy(); // open: the server answered for this pair
    await fireEvent.press(view.getByTestId('former-thread-back'));
    expect(view.getByText(COMMUNITY_LOCK_TITLE)).toBeTruthy();
    expect(mockNav.goBack).not.toHaveBeenCalled();
  });

  it('closed with no coach: the page has no "Your coach" row and no button (nothing that leads nowhere)', async () => {
    mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana' };
    mockCoachless = true;
    serve({ ...BASE, '/community/me': COACHLESS_ME, [mayaMsgs]: () => { throw closedErr(); } });
    const view = await lock();
    await fireEvent.press(await waitFor(() => view.getByTestId('community-coach-lock-former')));
    const page = await waitFor(() => view.getByTestId('former-thread-closed'));
    expect(within(page).getByText(FORMER_CLOSED_LINE)).toBeTruthy();
    expect(view.queryByTestId('former-thread-closed-coach')).toBeNull();
    expect(view.queryByTestId('former-thread-closed-action')).toBeNull();
  });

  it('the old server answer (no field): the locked page as before, with no card', async () => {
    mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana' };
    mockCoachless = true;
    serve({ ...BASE, '/community/me': { ...OLD_ME, workspace_id: null, membership: null } });
    const view = await lock();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/community/me'));
    await act(async () => Promise.resolve());
    expect(view.getByText(COMMUNITY_LOCK_TITLE)).toBeTruthy();
    expect(view.queryByTestId('community-coach-lock-former')).toBeNull();
  });
});

describe('the coach\'s side (S3_coach: "Former client")', () => {
  const COACH_ME = { ...OLD_ME, workspace_id: WS2, membership: null };
  it('a row not on her roster is a client who left: the server\'s name, "Former client", spoken after the name', async () => {
    mockUser = { id: MAYA, role: 'coach', name: 'Maya Brooks', firstName: 'Maya' };
    mockGetClients.mockResolvedValue({ data: [{ id: JORDAN, name: 'Jordan Lee', archived_at: null }] });
    serve({ '/community/me': COACH_ME, [`/community/workspaces/${WS2}/dms`]: { threads: [
      thread(WS2, SAM, ago(12), { other_display_name: 'Sam Rivera' }), thread(WS2, JORDAN, ago(60), { other_display_name: 'Jordan Lee' }),
    ] } });
    const view = await wrap(<CoachDmListScreen />);
    const sam = await waitFor(() => view.getByTestId(`coach-dm-row-${SAM}`));
    expect(within(sam).getByText('Sam Rivera')).toBeTruthy();
    expect(within(sam).getByText('Former client')).toBeTruthy();
    expect(within(sam).getByText('Active 12m ago')).toBeTruthy();
    expect(sam.props.accessibilityLabel).toBe('Open conversation with Sam Rivera, former client');
    const jordan = view.getByTestId(`coach-dm-row-${JORDAN}`);
    expect(within(jordan).queryByText('Former client')).toBeNull();
    expect(jordan.props.accessibilityLabel).toBe('Open conversation with Jordan Lee');
  });

  it('the old server answer (no other_display_name): "Direct message" with "Former client", never a made-up name', async () => {
    mockUser = { id: MAYA, role: 'coach', name: 'Maya Brooks', firstName: 'Maya' };
    mockGetClients.mockResolvedValue({ data: [] });
    serve({ '/community/me': COACH_ME, [`/community/workspaces/${WS2}/dms`]: { threads: [thread(WS2, SAM, ago(12))] } });
    const view = await wrap(<CoachDmListScreen />);
    const sam = await waitFor(() => view.getByTestId(`coach-dm-row-${SAM}`));
    expect(within(sam).getByText('Direct message')).toBeTruthy();
    expect(within(sam).getByText('Former client')).toBeTruthy();
  });
});

// LO-DMFR-M-1 B1 (LO lens, round 1): "not on her roster" means "a client who left" only when the roster was read after
// the thread list. The app's saved query cache (services/queryClient.ts, 24 h) restores yesterday's roster at once, so
// a client who joined since then is missing from it until the roster is read again (coachDm.tsx useDmRoster, several
// pages), and stays missing for the visit when that read fails while the thread list answered.
describe('LO-DMFR-M-1 B1: a saved roster from before a client joined', () => {
  const COACH_ME = { ...OLD_ME, workspace_id: WS2, membership: null };
  it('LO-DMFR B1: a current client missing from a saved roster is not called "Former client" while the roster is read again', async () => {
    mockUser = { id: MAYA, role: 'coach', name: 'Maya Brooks', firstName: 'Maya' };
    qc.setQueryData(['coach', 'dm-roster', MAYA], { [JORDAN]: { name: 'Jordan Lee', archived: false } }, { updatedAt: NOW - 3_600_000 });
    mockGetClients.mockImplementation(() => new Promise(() => {})); // today's roster read has not answered yet
    // Sam became Maya's client this morning (on today's roster, not on the saved one) and wrote to her first.
    serve({ '/community/me': COACH_ME, [`/community/workspaces/${WS2}/dms`]: { threads: [
      thread(WS2, SAM, ago(2), { other_display_name: 'Sam Rivera' }), thread(WS2, JORDAN, ago(60), { other_display_name: 'Jordan Lee' }),
    ] } });
    const view = await wrap(<CoachDmListScreen />);
    const sam = await waitFor(() => view.getByTestId(`coach-dm-row-${SAM}`));
    expect(within(sam).getByText('Sam Rivera')).toBeTruthy();
    expect(within(sam).queryByText('Former client')).toBeNull();
    expect(sam.props.accessibilityLabel).toBe('Open conversation with Sam Rivera');
  });
});

// FIX-DMFR-M-1 (fix round 1, OPERATOR RULING 7213408207 items 1-4): one row per finding.
describe('FIX-DMFR-M-1 B1 class: "Former client" only from a roster read in this visit, read again for a new arrival', () => {
  const COACH_ME = { ...OLD_ME, workspace_id: WS2, membership: null };
  const ROSTER_KEY = ['coach', 'dm-roster', MAYA];
  const SAVED = { [JORDAN]: { name: 'Jordan Lee', archived: false } }; // the roster the phone saved before Sam joined
  const client = (id: string, name: string) => ({ id, name, archived_at: null });
  let threads: unknown[] = [];
  const coachServe = () => {
    mockGet.mockImplementation(async (url: string) => {
      const key = url.split('?')[0];
      if (key === '/community/me') return { data: COACH_ME, headers: {} };
      if (key === `/community/workspaces/${WS2}/dms`) return { data: { threads }, headers: {} };
      throw notFound();
    });
  };
  const row = (view: ReturnType<typeof render>, id: string) => view.getByTestId(`coach-dm-row-${id}`);
  const chip = (view: ReturnType<typeof render>, id: string) => within(row(view, id)).queryByText('Former client');
  const arrive = async (next: unknown[]) => {
    threads = next;
    await act(async () => { await qc.invalidateQueries({ queryKey: ['community'] }); });
  };
  type Case = { name: string; run: () => Promise<void> };
  const cases: Case[] = [
    { name: 'a saved roster whose read is still out: no chip on anyone (LO B-TEST shape)', run: async () => {
      qc.setQueryData(ROSTER_KEY, SAVED, { updatedAt: NOW - 3_600_000 });
      mockGetClients.mockImplementation(() => new Promise(() => {}));
      threads = [thread(WS2, SAM, ago(2), { other_display_name: 'Sam Rivera' })];
      const view = await wrap(<CoachDmListScreen />);
      await waitFor(() => expect(row(view, SAM)).toBeTruthy());
      expect(chip(view, SAM)).toBeNull();
      expect(row(view, SAM).props.accessibilityLabel).toBe('Open conversation with Sam Rivera');
    } },
    { name: 'a saved roster whose read fails: the list stays, and no chip for the whole visit', run: async () => {
      qc.setQueryData(ROSTER_KEY, SAVED, { updatedAt: NOW - 3_600_000 });
      mockGetClients.mockRejectedValue(new Error('offline'));
      threads = [thread(WS2, SAM, ago(2), { other_display_name: 'Sam Rivera' }), thread(WS2, JORDAN, ago(60))];
      const view = await wrap(<CoachDmListScreen />);
      await waitFor(() => expect(row(view, SAM)).toBeTruthy());
      await waitFor(() => expect(qc.getQueryState(ROSTER_KEY)?.status).toBe('error'));
      expect(chip(view, SAM)).toBeNull();
      expect(within(row(view, SAM)).getByText('Sam Rivera')).toBeTruthy(); // the server's name, as before this PR
      expect(within(row(view, JORDAN)).getByText('Jordan Lee')).toBeTruthy(); // names still come from the saved roster
      expect(mockGetClients).toHaveBeenCalledTimes(1);
    } },
    { name: 'a roster read in this visit without her: "Former client", and no second roster read', run: async () => {
      mockGetClients.mockResolvedValue({ data: [client(JORDAN, 'Jordan Lee')] });
      threads = [thread(WS2, SAM, ago(2), { other_display_name: 'Sam Rivera' }), thread(WS2, JORDAN, ago(60))];
      const view = await wrap(<CoachDmListScreen />);
      await waitFor(() => expect(chip(view, SAM)).toBeTruthy());
      expect(chip(view, JORDAN)).toBeNull();
      await act(async () => Promise.resolve());
      expect(mockGetClients).toHaveBeenCalledTimes(1);
    } },
    { name: 'her first message arrives while the list is open: the roster is read again and has her, so no chip', run: async () => {
      mockGetClients.mockResolvedValue({ data: [client(JORDAN, 'Jordan Lee')] });
      threads = [thread(WS2, JORDAN, ago(60))];
      const view = await wrap(<CoachDmListScreen />);
      await waitFor(() => expect(row(view, JORDAN)).toBeTruthy());
      mockGetClients.mockResolvedValue({ data: [client(SAM, 'Sam Rivera'), client(JORDAN, 'Jordan Lee')] });
      await arrive([thread(WS2, SAM, ago(0), { other_display_name: 'Sam Rivera' }), thread(WS2, JORDAN, ago(60))]);
      await waitFor(() => expect(row(view, SAM)).toBeTruthy());
      expect(chip(view, SAM)).toBeNull();
      await waitFor(() => expect(mockGetClients).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(within(row(view, SAM)).getByText('Sam Rivera')).toBeTruthy());
      expect(chip(view, SAM)).toBeNull();
    } },
    { name: 'a client who left writes while the list is open: "Former client" once the roster read again leaves her out', run: async () => {
      mockGetClients.mockResolvedValue({ data: [client(JORDAN, 'Jordan Lee')] });
      threads = [];
      const view = await wrap(<CoachDmListScreen />);
      await waitFor(() => expect(view.getByTestId('coach-dm-list-empty')).toBeTruthy()); // the visit's first list is empty
      await arrive([thread(WS2, SAM, ago(0), { other_display_name: 'Sam Rivera' })]);
      await waitFor(() => expect(mockGetClients).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(chip(view, SAM)).toBeTruthy());
      expect(row(view, SAM).props.accessibilityLabel).toBe('Open conversation with Sam Rivera, former client');
    } },
  ];
  it.each(cases.map((c) => [c.name, c]))('B1 class: %s', async (_n, c) => {
    mockUser = { id: MAYA, role: 'coach', name: 'Maya Brooks', firstName: 'Maya' };
    coachServe();
    await (c as Case).run();
  });
});

describe('FIX-DMFR-M-1 C1-C6 and the words (OPERATOR RULING 7213408207 items 2-4)', () => {
  const lock = () => wrap(
    <CoachOnlyGate title={COMMUNITY_LOCK_TITLE} body={COMMUNITY_LOCK_BODY} testID="community-coach-lock"><Text>the stack</Text></CoachOnlyGate>,
  );
  const COACHLESS_ME = { ...OLD_ME, workspace_id: null, membership: null, former_coach_dms: [formerItem(WS2, MAYA, 'Maya Brooks')] };
  const coachless = () => {
    mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana' };
    mockCoachless = true;
  };

  it.each([
    ['the guidelines (her saved agreement does not cover them)', { consent_recorded: false, answers: {} }, 'community-terms-gate'],
    ['"Your community did not load" (her record cannot be read)', undefined, 'community-terms-unknown'],
  ])('C1: Back on the terms page in front of the locked page\'s thread: %s', async (_n, record, page) => {
    coachless();
    mockRealGate = true;
    serve({ ...BASE, '/community/me': COACHLESS_ME, [mayaMsgs]: MAYA_MSGS, ...(record ? { '/me/onboarding': record } : {}) });
    const view = await lock();
    await fireEvent.press(await waitFor(() => view.getByTestId('community-coach-lock-former')));
    await waitFor(() => expect(view.getByTestId(page)).toBeTruthy());
    expect(view.queryByText('Same time next Saturday?')).toBeNull(); // nothing of the thread before the terms
    await fireEvent.press(view.getByTestId('community-terms-back'));
    expect(view.getByText(COMMUNITY_LOCK_TITLE)).toBeTruthy();
    expect(view.getByTestId('community-coach-lock-former')).toBeTruthy();
    expect(mockNav.goBack).not.toHaveBeenCalled();
  });

  it.each([
    ['nobody named (removed, banned, gone)', null, 'Maya Brooks', FORMER_CLOSED_LINE],
    ['I blocked him', 'me', 'Maya Brooks', 'You blocked them. Unblock in Settings'],
    ['he blocked me, his name known', 'them', 'Maya Brooks', 'Maya Brooks has blocked you'],
    ['he blocked me, no name (the server today)', 'them', null, FORMER_CLOSED_LINE],
  ])('C2: the closed page says "This conversation is closed" once: %s', async (_n, by, name, line) => {
    const { FormerCoachClosed } = require('../../../components/community/FormerCoach');
    const view = await wrap(<FormerCoachClosed by={by} name={name} coachName="Lee Tanaka" onCoach={() => undefined} />);
    expect(view.getAllByText(CLOSED_LINE)).toHaveLength(1);
    expect(view.getByText(line)).toBeTruthy();
  });

  it.each([
    ['nobody named (a ban, a removal)', closedErr, FORMER_CLOSED_LINE],
    ['his block', () => Object.assign(new Error('HTTP 403'), { isAxiosError: true, response: { status: 403, data: { code: 'community.dm.blocked_by_them' } } }), 'Maya Brooks has blocked you'],
  ])('C3: an open thread closes when /me read again no longer lists her old coach: %s', async (_n, refusal, line) => {
    serve({ ...BASE, '/community/me': ME, [mayaMsgs]: MAYA_MSGS });
    const view = await openThread(MAYA);
    await waitFor(() => expect(view.getByTestId('community-dmthread-composer')).toBeTruthy());
    const reads = () => mockGet.mock.calls.filter((c) => c[0].split('?')[0] === mayaMsgs).length;
    const before = reads();
    serve({ ...BASE, '/community/me': { ...ME, former_coach_dms: [] }, [mayaMsgs]: () => { throw refusal(); } });
    await act(async () => { await qc.invalidateQueries({ queryKey: ['community', 'me'] }); }); // the 60 s read of /me
    const page = await waitFor(() => view.getByTestId('former-thread-closed'));
    expect(view.queryByTestId('community-dmthread-composer')).toBeNull();
    expect(view.queryByText('Same time next Saturday?')).toBeNull();
    expect(within(view.getByTestId('former-thread-masthead')).getByText('Maya Brooks')).toBeTruthy(); // the page is kept
    await waitFor(() => expect(within(page).getByText(line)).toBeTruthy());
    expect(reads()).toBe(before + 1); // the thread read once more, in her former community
    expect(within(page).getAllByText(CLOSED_LINE)).toHaveLength(1);
  });

  it('C3: her coach now (she joined him again) is not a closed thread', async () => {
    serve({ ...BASE, '/community/me': ME, [mayaMsgs]: MAYA_MSGS });
    const view = await openThread(MAYA);
    await waitFor(() => expect(view.getByTestId('community-dmthread-composer')).toBeTruthy());
    mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: MAYA };
    serve({ ...BASE, '/community/me': { ...ME, workspace_id: WS2 }, [mayaMsgs]: MAYA_MSGS });
    await act(async () => { await qc.invalidateQueries({ queryKey: ['community', 'me'] }); });
    expect(view.queryByTestId('former-thread-closed')).toBeNull();
    expect(view.getByTestId('community-dmthread-composer')).toBeTruthy();
  });

  it.each([
    ['the phone\'s DM switch off: the locked page as before, with no /me read', false, 'lock'],
    ['an empty former_coach_dms (b#1260 ruling 7209184240): the locked page', true, 'lock'],
    ['an empty former_coach_dms: her list', true, 'list'],
  ])('C4 and item 4: no card anywhere with %s', async (_n, dmOn, where) => {
    const { featureFlags } = require('../../../config/featureFlags');
    featureFlags.communityDm = dmOn;
    try {
      if (where === 'lock') {
        coachless();
        serve({ ...BASE, '/community/me': { ...COACHLESS_ME, ...(dmOn ? { former_coach_dms: [] } : {}) }, [mayaMsgs]: MAYA_MSGS });
        const view = await lock();
        expect(view.getByText(COMMUNITY_LOCK_TITLE)).toBeTruthy();
        if (dmOn) await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/community/me'));
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
        expect(view.queryByTestId('community-coach-lock-former')).toBeNull();
        if (!dmOn) expect(mockGet).not.toHaveBeenCalledWith('/community/me');
      } else {
        serve({ ...BASE, '/community/me': { ...ME, former_coach_dms: [] } });
        const view = await list();
        await waitFor(() => expect(view.getByText('Lee Tanaka')).toBeTruthy());
        expect(view.queryByTestId('dm-former-coach')).toBeNull();
      }
    } finally {
      featureFlags.communityDm = true;
    }
  });

  it('C6: Android\'s back closes the locked page\'s thread only while the Community tab is in front', async () => {
    const { BackHandler } = require('react-native');
    const { NavigationContext } = require('@react-navigation/native');
    const live = new Set<() => boolean>();
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((...a: unknown[]) => {
      const h = a[1] as () => boolean;
      live.add(h);
      return { remove: () => { live.delete(h); } };
    });
    const listeners: Record<string, Set<() => void>> = { focus: new Set(), blur: new Set() };
    const tab = {
      isFocused: () => true,
      addListener: (e: string, cb: () => void) => { listeners[e]?.add(cb); return () => listeners[e]?.delete(cb); },
    };
    const emit = (e: string) => act(async () => { listeners[e].forEach((cb) => cb()); });
    coachless();
    serve({ ...BASE, '/community/me': COACHLESS_ME, [mayaMsgs]: MAYA_MSGS });
    const view = await wrap(
      <NavigationContext.Provider value={tab}>
        <CoachOnlyGate title={COMMUNITY_LOCK_TITLE} body={COMMUNITY_LOCK_BODY} testID="community-coach-lock"><Text>the stack</Text></CoachOnlyGate>
      </NavigationContext.Provider>,
    );
    await fireEvent.press(await waitFor(() => view.getByTestId('community-coach-lock-former')));
    await waitFor(() => expect(view.getByTestId('former-thread-masthead')).toBeTruthy());
    expect(live.size).toBe(1);
    await emit('blur'); // she moved to another tab with the thread left open
    expect(live.size).toBe(0); // another tab's Back is that tab's
    await emit('focus');
    expect(live.size).toBe(1);
    await act(async () => { [...live][0](); });
    expect(view.getByText(COMMUNITY_LOCK_TITLE)).toBeTruthy();
    expect(live.size).toBe(0);
    spy.mockRestore();
  });

  it('W12 (operator, ruling item 3): the three dots say "About this conversation"', async () => {
    serve({ ...BASE, '/community/me': ME, [mayaMsgs]: MAYA_MSGS });
    const view = await openThread(MAYA);
    await waitFor(() => expect(view.getByText('Same time next Saturday?')).toBeTruthy());
    expect(view.getByTestId('former-thread-about').props.accessibilityLabel).toBe('About this conversation');
  });

  it.each([
    ['her coach\'s name known', 'Lee Tanaka', 'Your coach, Lee Tanaka'],
    ['no name known yet', null, 'Your coach'],
  ])('W13 (operator, ruling item 3): the closed page\'s coach row says its visible words in reading order: %s', async (_n, coachName, spoken) => {
    const { FormerCoachClosed } = require('../../../components/community/FormerCoach');
    const view = await wrap(<FormerCoachClosed by={null} name={null} coachName={coachName} onCoach={() => undefined} />);
    const row = view.getByTestId('former-thread-closed-coach');
    expect(row.props.accessibilityLabel).toBe(spoken);
    expect(within(row).getByText('Your coach')).toBeTruthy();
  });
});
