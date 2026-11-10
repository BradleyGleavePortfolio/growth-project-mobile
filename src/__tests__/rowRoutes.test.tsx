/**
 * ROW-ROUTE-TEST: every inbox and community row, built from what the server really sends, opens the right screen.
 * Backend wire lines are at growth-project-backend 76a1de0c.
 *
 * The promise: with every switch on, one tap by the person who sees a row causes exactly one navigate, to a route
 * registered on a navigator mounted for that role and reachable from that row's stack (REACHABLE RULE below), with the
 * params the destination reads, holding this row's own ids. The only other outcomes are a row listed "complete in
 * place" or a marked gap. The fixtures below copy the server's own writes (raw wire objects, key for key) and run
 * through the real mappers and the real screens; only HTTP, the navigation hooks, icons, the theme and the signed-in
 * person (useCurrentUser and three session context hooks) are stubbed. Names and ids are fictional.
 *
 * WHEN THIS GOES RED:
 *   - "not in the row table: <name>": you added a row kind (a COACH_INBOX_ROW_KINDS value, a moderation target, a
 *     search kind or a SpaceTarget kind), or a list screen under the universe search. Give it a row in ROWS (or say why
 *     it is outside in OUTSIDE), then make the row open its right screen.
 *   - a row case failed: a row stopped opening its right screen, or lost its route registration. Fix the opener.
 *   - a "still a gap" case failed: you fixed a gap (flip that row's gap(...) to opens(...) so it is enforced from now
 *     on), or you broke the harness (fix the harness). A gap row has two marks on purpose: the real assertion under
 *     it.failing with the right screen written in it, and a plain case asserting today's symptom, because it.failing
 *     alone also passes when the harness breaks.
 *
 * Space chat: when communitySpaceChat lands in featureFlags (m#945), SPACE_CHAT_SHIPPED turns A2 to A5 and N3 into
 * plain opens rows to CommunitySpaceChat with their own ids, with no one editing this file. Until then A2 is the voice
 * note and A3 to A5 and N3 are gaps. See "Found, not fixed" on the PR for each gap's row id, file:line and follow-up.
 *
 * REACHABLE RULE (@react-navigation/core 7.21.1, useOnAction.tsx): navigate(name) runs on the current navigator's
 * router and bubbles up through onActionParent; it never goes down into a child navigator (that branch needs
 * navigationInChildEnabled, which src never sets). So a bare name is reachable only when it is on the row's own
 * navigator or an ancestor; a name inside a sibling navigator needs the nested form navigate('Tab', { screen: name }),
 * and that name must be on the navigator mounted at that tab. registrationOf() applies this per row, reading the
 * navigator sources with every switch treated as on.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Stubs: HTTP, navigation, icons, theme, the signed-in person ─────────────────────────────────────────────────────

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockGetClients = jest.fn();
const mockGetUnreadCounts = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => mockGet(...a),
    post: (...a: unknown[]) => mockPost(...a),
    patch: (...a: unknown[]) => mockPost(...a),
    put: (...a: unknown[]) => mockPost(...a),
    delete: (...a: unknown[]) => mockPost(...a),
  },
  coachApi: {
    getClients: (...a: unknown[]) => mockGetClients(...a),
    getUnreadCounts: (...a: unknown[]) => mockGetUnreadCounts(...a),
  },
}));

// Every switch these screens read is on, read once at module scope by several of them ([R27]).
jest.mock('../config/featureFlags', () => {
  const actual = jest.requireActual('../config/featureFlags');
  const on: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(actual.featureFlags)) on[k] = typeof v === 'boolean' ? true : v;
  return { ...actual, featureFlags: on, NOTIFICATIONS_MOCK_ENABLED: false };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: Record<string, unknown> | undefined;
const mockNavObject = {
  navigate: (...a: unknown[]) => mockNavigate(...a),
  goBack: mockGoBack,
  canGoBack: () => true,
  addListener: () => () => undefined,
  setOptions: () => undefined,
  replace: (...a: unknown[]) => mockNavigate(...a),
  dispatch: () => undefined,
  getParent: () => undefined,
  getState: () => undefined,
};
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    NavigationContext: R.createContext(undefined),
    useNavigation: () => mockNavObject,
    useRoute: () => ({ params: mockRouteParams }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      R.useEffect(() => cb(), [cb]);
    },
    useIsFocused: () => true,
    useScrollToTop: () => undefined,
  };
});
jest.mock('@expo/vector-icons', () => {
  const Icon = () => null;
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const R = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: (props: { testID?: string }) => R.createElement(View, props) };
});
const mockThemeValue = () => {
  const tokens = jest.requireActual('../theme/tokens');
  const colors = jest.requireActual('../constants/colors').default;
  return { colors, tokens: tokens.default, semanticColors: tokens.lightTokens, colorScheme: 'light', isDark: false };
};
jest.mock('../theme/ThemeProvider', () => ({ useTheme: () => mockThemeValue() }));
jest.mock('../theme/useTheme', () => ({ useTheme: () => mockThemeValue() }));
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return { ...actual, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

// The signed-in person: set per row.
let mockCurrentUser: { id: string; coach_id?: string | null; name?: string; firstName?: string } = { id: 'unset' };
let mockNeedsCoach = false;
const mockMessageCoach = jest.fn();
const mockOpenSupport = jest.fn();
jest.mock('../hooks/useCurrentUser', () => ({
  ...jest.requireActual('../hooks/useCurrentUser'),
  useCurrentUser: () => mockCurrentUser,
}));
jest.mock('../components/coachless/JoinCoachState', () => ({
  ...jest.requireActual('../components/coachless/JoinCoachState'),
  useClientNeedsCoach: () => mockNeedsCoach,
}));
jest.mock('../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ messageCoach: mockMessageCoach }),
}));
jest.mock('../components/ai/useOpenSupport', () => ({ useOpenSupport: () => mockOpenSupport }));
jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isConnected: true, isInternetReachable: true }),
  isEffectivelyOnline: () => true,
}));
jest.mock('../services/realtime', () => new Proxy({ __esModule: true }, {
  get: (target, key) => (key in target ? target[key as keyof typeof target] : () => () => undefined),
}));

// ─── Screens, mappers and the router under test (after the switches are pinned) ──────────────────────────────────────

import { COACH_INBOX_ROW_KINDS, COACH_MOD_TARGET_TYPES } from '../api/coachCommunityApi';
import { SEARCH_KINDS } from '../api/communitySearchApi';
import {
  __resetPushTapRouterForTests,
  attachPushNavigator,
  setPushSession,
  type PushNavigator,
} from '../services/pushTapRouter';
import CoachCommunityInboxScreen from '../screens/community/CoachCommunityInboxScreen';
import CoachCommunityModerationScreen from '../screens/community/CoachCommunityModerationScreen';
import CoachCommunityHomeScreen from '../screens/community/CoachCommunityHomeScreen';
import CoachCommunityCohortsScreen from '../screens/community/CoachCommunityCohortsScreen';
import CoachCommunityCohortDetailScreen from '../screens/community/CoachCommunityCohortDetailScreen';
import CoachCommunityEventsScreen from '../screens/community/CoachCommunityEventsScreen';
import MessagesScreen from '../screens/coach/MessagesScreen';
import { CommunityReportsEntry } from '../screens/coach/CommunityReportsEntry';
import CommandCenterInboxScreen from '../screens/coach/command-center/InboxScreen';
import MessagesInboxScreen from '../screens/client/MessagesInboxScreen';
import ClientWinsScreen from '../screens/client/CommunityScreen';
import ClientNudgesScreen from '../screens/client/NotificationsScreen';
import CommunitySpaceScreen from '../screens/community/CommunitySpaceScreen';
import CommunityDmListScreen from '../screens/community/CommunityDmListScreen';
import CommunityFindScreen from '../screens/community/CommunityFindScreen';
import CommunityChallengesScreen from '../screens/community/CommunityChallengesScreen';
import CommunityClassroomScreen from '../screens/community/CommunityClassroomScreen';
import CommunityTodayScreen from '../screens/community/CommunityTodayScreen';
import CommunityHomeScreen from '../screens/community/CommunityHomeScreen';
import CommunityWearablePromptsScreen from '../screens/community/CommunityWearablePromptsScreen';
import NotificationCenterScreen from '../screens/notifications/NotificationCenterScreen';

// m#945's switch. Pinned true above only when the real featureFlags has the key, so this file also runs at m#945.
const SPACE_CHAT_SHIPPED = 'communitySpaceChat' in jest.requireActual('../config/featureFlags').featureFlags;

const SRC = path.resolve(__dirname, '..');
const NAV = path.join(SRC, 'navigation');

// ─── Ids ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1);
const COHORT = uuid(2);
const COHORT_2 = uuid(3);
const CLIENT = uuid(10);
const CLIENT_2 = uuid(11);
const COACH_USER = uuid(20);
const CREATED = '2026-11-08T17:00:00.000Z';

// ─── Coach Community inbox rows (GET /community/me/coach-inbox) ──────────────────────────────────────────────────────

/** community-coach-inbox.service.ts:92-120 (messageItem). */
const inboxMessage = (id: string, kind: 'text' | 'voice' | 'photo', preview: string, extra: object = {}) => ({
  id,
  type: 'message',
  cohort_id: COHORT,
  cohort_name: 'Spring block',
  author_user_id: CLIENT,
  author_display_name: 'Dana Cruz',
  preview,
  created_at: CREATED,
  item_url_path: `/community/cohorts/${COHORT}/messages/${id}`,
  kind,
  ack: { state: 'none', sla_state: 'within' },
  ...extra,
});
/** community-coach-inbox.service.ts:142-160 (postItem): a post row is always kind text. */
const inboxPost = (id: string) => ({
  id,
  type: 'post',
  cohort_id: COHORT,
  cohort_name: 'Spring block',
  author_user_id: CLIENT,
  author_display_name: 'Dana Cruz',
  preview: 'Form check on my squat',
  created_at: CREATED,
  item_url_path: `/community/cohorts/${COHORT}/posts/${id}`,
  kind: 'text',
});
const inboxPage = (...items: object[]) => ({ items, next_cursor: null });
const EMPTY_STATES = { '/community/coach/empty-states': { surfaces: [] } };

// ─── Moderation queue (GET /community/moderation/flagged) ────────────────────────────────────────────────────────────

/** community-moderation.service.ts:770 listFlagged: the phone's getFlagged reads only these keys. */
const flagged = (id: string, target_type: string, target_id: string, content: string, extra: object = {}) => ({
  id,
  target_type,
  target_id,
  content,
  author_name: 'Dana Cruz',
  cohort_name: 'Spring block',
  reason: 'spam',
  author_user_id: CLIENT,
  created_at: CREATED,
  respond_by: '2026-11-09T17:00:00.000Z',
  overdue: false,
  removed: false,
  ...extra,
});

// ─── The row table ───────────────────────────────────────────────────────────────────────────────────────────────────

type Role = 'coach' | 'client';
/** Where a row is drawn: the navigator chain, outermost first (the tab bar, then its stack). */
type Host = readonly string[];
const COACH_COMMUNITY_HOST: Host = ['Tab@CoachNavigator', 'CoachCommunityStack@CoachCommunityNavigator'];
const COACH_MESSAGES_HOST: Host = ['Tab@CoachNavigator', 'MessagesStack@CoachNavigator'];
const CLIENT_COMMUNITY_HOST: Host = ['Tab@ClientNavigator', 'CommunityStack@CommunityNavigator'];
const CLIENT_HOME_HOST: Host = ['Tab@ClientNavigator', 'HomeStackNav@ClientNavigator'];
const CLIENT_MORE_HOST: Host = ['Tab@ClientNavigator', 'MoreStackNav@ClientNavigator'];

interface OpensExpect { kind: 'opens'; route: string; params?: Record<string, unknown> }
interface GapExpect { kind: 'gap'; right: OpensExpect; why: string; symptom: (ctx: RowCtx) => void }
interface InPlaceExpect { kind: 'inPlace'; reason: string; drawn: (ctx: RowCtx) => void }
interface SheetExpect { kind: 'sheet'; testID: string }
interface NoRowExpect { kind: 'noRow'; reason: string; absent: string[]; neighbour?: { testID: string; opens: OpensExpect } }
type Expected = OpensExpect | GapExpect | InPlaceExpect | SheetExpect | NoRowExpect;

interface RowCtx { view: Awaited<ReturnType<typeof render>> }
interface Row {
  id: string;
  title: string;
  role: Role;
  host: Host;
  /** The raw server answers, by URL path. */
  http: Record<string, unknown>;
  screen: () => React.ReactElement;
  /** How to find the row (never added to a product file: an existing testID or accessibility label). */
  tap: { testID: string } | { label: RegExp };
  /** What must be on screen before tapping (defaults to the row itself). */
  waitFor?: { testID: string } | { text: string };
  before?: () => void;
  expected: Expected;
}

const opens = (route: string, params?: Record<string, unknown>): OpensExpect => ({ kind: 'opens', route, params });
const inboxScreen = () => <CoachCommunityInboxScreen navigation={mockNavObject as never} />;
const spaceChat = (cohortId: string, messageId: string) => opens('CommunitySpaceChat', { cohortId, messageId });

/** A row with no press handler: the symptom of a dead end today. */
const noPressHandler = (testID: string) => (ctx: RowCtx) => {
  expect(ctx.view.getByTestId(testID).props.onPress).toBeUndefined();
  expect(ctx.view.getByTestId(testID).props.onClick).toBeUndefined();
  expect(mockNavigate).not.toHaveBeenCalled();
};

/** A3 to A5: a typed or photo message row. Opens its space chat at that message once it ships; a dead end today. */
const inboxMessageRow = (id: string, title: string, row: object): Row => {
  const testID = `coach-community-inbox-row-${row && (row as { id: string }).id}`;
  return {
    id,
    title,
    role: 'coach',
    host: COACH_COMMUNITY_HOST,
    http: {
      ...EMPTY_STATES,
      '/community/me/coach-inbox': inboxPage(inboxMessage(uuid(100), 'text', 'neighbour row'), row),
    },
    screen: inboxScreen,
    tap: { testID },
    expected: SPACE_CHAT_SHIPPED
      ? spaceChat(COHORT, (row as { id: string }).id)
      : {
          kind: 'gap',
          right: spaceChat(COHORT, (row as { id: string }).id),
          why: 'CommunitySpaceChatScreen is not on main; the row is a plain View with no opener (CoachCommunityInboxScreen.tsx:263, :796-804)',
          symptom: noPressHandler(testID),
        },
  };
};

const ROWS: Row[] = [
  // ── A: coach Community inbox ──────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'A1',
    title: 'post row',
    role: 'coach',
    host: COACH_COMMUNITY_HOST,
    http: { ...EMPTY_STATES, '/community/me/coach-inbox': inboxPage(inboxPost(uuid(101)), inboxPost(uuid(102))) },
    screen: inboxScreen,
    tap: { testID: `coach-community-inbox-row-${uuid(102)}` },
    expected: opens('CoachCommunityPostDetail', { postId: uuid(102) }),
  },
  {
    id: 'A2',
    title: 'voice row',
    role: 'coach',
    host: COACH_COMMUNITY_HOST,
    http: {
      ...EMPTY_STATES,
      // voice.note_id is the message id (community-coach-inbox.service.ts:113, community-coach-inbox.repository.ts:78-81).
      '/community/me/coach-inbox': inboxPage(
        inboxMessage(uuid(103), 'voice', 'Voice note', { voice: { note_id: uuid(103), duration_ms: 42000 } }),
        inboxMessage(uuid(104), 'voice', 'Voice note', { voice: { note_id: uuid(104), duration_ms: 12000 } }),
      ),
    },
    screen: inboxScreen,
    tap: { testID: `coach-community-inbox-row-${uuid(104)}` },
    expected: SPACE_CHAT_SHIPPED
      ? spaceChat(COHORT, uuid(104))
      : opens('CommunityVoiceNoteDetail', { voiceNoteId: uuid(104) }),
  },
  inboxMessageRow('A3', 'text row', inboxMessage(uuid(105), 'text', 'How do I log this?')),
  inboxMessageRow('A4', 'photo row with a caption', inboxMessage(uuid(106), 'photo', 'My lunch today')),
  // community-coach-inbox.service.ts:109: a photo with no caption reads "Photo".
  inboxMessageRow('A5', 'photo row with no caption', inboxMessage(uuid(107), 'photo', 'Photo')),

  // ── B: moderation queue ───────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'B1',
    title: 'flagged post',
    role: 'coach',
    host: COACH_COMMUNITY_HOST,
    http: {
      ...EMPTY_STATES,
      '/community/moderation/flagged': { items: [flagged(uuid(200), 'post', uuid(300), 'first post'), flagged(uuid(201), 'post', uuid(301), 'a reported post')] },
    },
    screen: () => <CoachCommunityModerationScreen navigation={mockNavObject as never} />,
    tap: { testID: `coach-community-flagged-content-${uuid(201)}` },
    expected: opens('CoachCommunityPostDetail', { postId: uuid(301), flagged: true }),
  },
  moderationInPlace('B2', 'flagged message', 'message', flagged(uuid(202), 'message', uuid(302), 'a reported message')),
  moderationInPlace(
    'B3',
    'flagged voice note',
    'voice_note',
    flagged(uuid(203), 'voice_note', uuid(303), 'Voice note', { media: { kind: 'voice_note', url: 'https://audio.example/n.m4a', duration_ms: 42000, mime_type: 'audio/mp4' } }),
  ),
  moderationInPlace('B4', 'flagged win', 'win', flagged(uuid(204), 'win', uuid(304), 'New PR today')),
];

function moderationInPlace(id: string, title: string, target: string, item: { id: string }): Row {
  return {
    id,
    title,
    role: 'coach',
    host: COACH_COMMUNITY_HOST,
    http: { ...EMPTY_STATES, '/community/moderation/flagged': { items: [item] } },
    screen: () => <CoachCommunityModerationScreen navigation={mockNavObject as never} />,
    tap: { testID: `coach-community-flagged-content-${item.id}` },
    expected: {
      kind: 'inPlace',
      reason: `a reported ${target} is drawn whole beside the decisions: the content, photo or player and Hide, Warn, Ban, Dismiss, so the row names nothing it does not show`,
      drawn: (ctx) => {
        expect(ctx.view.getByTestId(`coach-community-flagged-row-${item.id}`)).toBeTruthy();
        expect(ctx.view.getByTestId(`coach-community-flagged-hide-${item.id}`)).toBeTruthy();
      },
    },
  };
}

// ─── Reading the navigators (the registration check) ─────────────────────────────────────────────────────────────────

function navigatorScreens(host: string): Set<string> {
  const [varName, file] = host.split('@');
  const src = fs.readFileSync(path.join(NAV, `${file}.tsx`), 'utf8');
  const names = new Set<string>();
  const re = new RegExp(`<${varName}\\.Screen\\s+name="([^"]+)"`, 'g');
  for (const m of src.matchAll(re)) names.add(m[1]);
  return names;
}
/** The navigator mounted at each tab route (read from the Tab.Screen components in the navigator files). */
const CHILD_NAVIGATOR: Record<string, string> = {
  'coach:Messages': 'MessagesStack@CoachNavigator',
  'coach:ClientsStack': 'ClientsStack@CoachNavigator',
  'coach:CommunityStack': 'CoachCommunityStack@CoachCommunityNavigator',
  'client:Home': 'HomeStackNav@ClientNavigator',
  'client:MoreTab': 'MoreStackNav@ClientNavigator',
  'client:CommunityTab': 'CommunityStack@CommunityNavigator',
};

/** REACHABLE RULE: where a navigate lands, or why it cannot. */
function registrationOf(role: Role, host: Host, route: string, params?: Record<string, unknown>): string | null {
  for (let i = host.length - 1; i >= 0; i--) {
    if (navigatorScreens(host[i]).has(route)) {
      const nested = params?.screen as string | undefined;
      if (nested) {
        const child = CHILD_NAVIGATOR[`${role}:${route}`];
        if (!child) return `no navigator recorded at ${role}:${route}`;
        if (!navigatorScreens(child).has(nested)) return `${nested} is not registered on ${child}`;
      }
      return null;
    }
  }
  return `${route} is not on any navigator reachable from ${host.join(' > ')}`;
}

// ─── The harness ─────────────────────────────────────────────────────────────────────────────────────────────────────

function respond(http: Record<string, unknown>) {
  mockGet.mockImplementation(async (url: string) => {
    const key = url.split('?')[0];
    if (key in http) return { data: http[key] };
    throw Object.assign(new Error(`no fixture for ${url}`), { response: { status: 404 } });
  });
  mockPost.mockResolvedValue({ data: {} });
}

function renderRow(row: Row) {
  mockCurrentUser = row.role === 'coach'
    ? { id: COACH_USER, name: 'Coach Kim', firstName: 'Kim' }
    : { id: CLIENT, coach_id: COACH_USER, name: 'Dana Cruz', firstName: 'Dana' };
  respond(row.http);
  row.before?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{row.screen()}</QueryClientProvider>);
}

/** The row on screen and tapped once. */
async function tapRow(row: Row): Promise<RowCtx> {
  const view = await renderRow(row);
  const find = () => 'testID' in row.tap ? view.getByTestId(row.tap.testID) : view.getByLabelText(row.tap.label);
  await waitFor(() => expect(find()).toBeTruthy());
  await act(async () => {
    fireEvent.press(find());
  });
  return { view };
}

function expectOneNavigate(want: OpensExpect) {
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith(...(want.params === undefined ? [want.route] : [want.route, want.params]));
}

beforeEach(() => {
  __resetPushTapRouterForTests();
  mockGet.mockReset();
  mockPost.mockReset();
  mockGetClients.mockReset();
  mockGetUnreadCounts.mockReset();
  mockNavigate.mockReset();
  mockGoBack.mockReset();
  mockMessageCoach.mockReset();
  mockOpenSupport.mockReset();
  mockRouteParams = undefined;
  mockNeedsCoach = false;
});

describe.each(ROWS.filter((r) => r.expected.kind === 'opens'))('$id $title', (row) => {
  const want = row.expected as OpensExpect;
  it(`one tap opens ${want.route} with this row's own ids`, async () => {
    await tapRow(row);
    expectOneNavigate(want);
  });
  it(`${want.route} is registered and reachable from the row's stack`, () => {
    expect(registrationOf(row.role, row.host, want.route, want.params)).toBeNull();
  });
});

describe.each(ROWS.filter((r) => r.expected.kind === 'gap'))('$id $title (gap)', (row) => {
  const gap = row.expected as GapExpect;
  it.failing(`one tap opens ${gap.right.route} (flip this row to opens(...) when the gap closes)`, async () => {
    await tapRow(row);
    expectOneNavigate(gap.right);
  });
  it(`still a gap: ${gap.why}`, async () => {
    const ctx = await tapRow(row);
    gap.symptom(ctx);
  });
});

describe.each(ROWS.filter((r) => r.expected.kind === 'inPlace'))('$id $title (complete in place)', (row) => {
  const { drawn, reason } = row.expected as InPlaceExpect;
  it(`complete in place: ${reason}`, async () => {
    const ctx = await tapRow(row);
    drawn(ctx);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// keep imports used while the table grows
void COACH_INBOX_ROW_KINDS;
void COACH_MOD_TARGET_TYPES;
void SEARCH_KINDS;
void attachPushNavigator;
void setPushSession;
void (undefined as unknown as PushNavigator);
void [COHORT_2, CLIENT_2, CoachCommunityHomeScreen, CoachCommunityCohortsScreen, CoachCommunityCohortDetailScreen, CoachCommunityEventsScreen, MessagesScreen, CommunityReportsEntry, CommandCenterInboxScreen, MessagesInboxScreen, ClientWinsScreen, ClientNudgesScreen, CommunitySpaceScreen, CommunityDmListScreen, CommunityFindScreen, CommunityChallengesScreen, CommunityClassroomScreen, CommunityTodayScreen, CommunityHomeScreen, CommunityWearablePromptsScreen, NotificationCenterScreen, WS, CLIENT_HOME_HOST, CLIENT_MORE_HOST, COACH_MESSAGES_HOST, CLIENT_COMMUNITY_HOST];
