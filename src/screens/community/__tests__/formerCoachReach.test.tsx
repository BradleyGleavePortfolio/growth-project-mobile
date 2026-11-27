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
  prefsStorage: { getString: () => undefined, set: () => undefined },
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
jest.mock('../../../components/community/CommunityTermsGate', () => {
  const R = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: ({ children }: { children: React.ReactNode }) => R.createElement(View, { testID: 'terms-gate' }, children) };
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
    expect(view.getByTestId(`dm-day-${uuid(900)}`)).toBeTruthy(); // S3 .sep: the oldest message opens its day
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
    expect(view.getByTestId('former-thread-closed-coach').props.accessibilityLabel).toBe('Open conversation with Lee Tanaka, your coach');
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
