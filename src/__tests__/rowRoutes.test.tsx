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
 * Space chat: when communitySpaceChat lands in featureFlags (m#945), SPACE_CHAT_SHIPPED turns A2 to A5, N3 and N3c
 * into plain opens rows to CommunitySpaceChat with their own ids, moves C5 (a coach's cohort row) to CommunitySpaceChat
 * {cohortId}, and turns F1 (a SpaceTree space row) from a gap into a plain opens row to CommunitySpaceChat {cohortId},
 * as m#945 draws them, with no one editing this file. Until then A2 is the voice note, C5 opens the coach's cohort
 * screen, and A3 to A5, N3, N3c and F1 are gaps. F1 is a gap because its destination drops the id it is sent: the
 * cohort screen CommunitySpace reads no route params, so every space row lands on the Hall feed (LO-956R1 B1). F16
 * (the Today cohort card) sends the same and stays a gap in both cases until its own fix: m#945 does not change
 * CommunityTodayScreen.
 *
 * Server switch-off rows (D8 the older Messages list, F13a and F13b the Find notices) need a server switch off; the
 * "All switches on" job forces every server switch on (ALL_SWITCHES_ON_NAMES set), so there they are left out. See "Found, not fixed" on the PR for each gap's row id, file:line and follow-up.
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
  nudgesApi: {
    list: () => mockGet('/nudges'),
    unreadCount: () => mockGet('/nudges/unread-count'),
    markRead: (id: string) => mockPost(`/nudges/${id}/read`),
    markAllRead: () => mockPost('/nudges/read-all'),
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
import CommandCenterScreen from '../screens/coach/command-center/CommandCenterScreen';
import { useCoachStore } from '../store/coachStore';
import { CommunityReportsEntry } from '../screens/coach/CommunityReportsEntry';
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

// The "All switches on" job (.github/all-switches-on) forces every server switch on: no switch-off row can exist there.
const SERVER_SWITCHES_FORCED_ON = !!process.env.ALL_SWITCHES_ON_NAMES;

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

/** community-moderation.service.ts:950-968 listFlagged: the row shape, key for key. */
const flagged = (id: string, target_type: string, target_id: string, content: string, extra: object = {}) => ({
  id,
  workspace_id: WS,
  target_type,
  target_id,
  content,
  media: null,
  removed: false,
  author_user_id: CLIENT,
  author_name: 'Dana Cruz',
  cohort_name: 'Spring block',
  reason: 'spam',
  notes: null,
  created_at: CREATED,
  respond_by: '2026-11-09T17:00:00.000Z',
  overdue: false,
  can_act: true,
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
interface SheetExpect { kind: 'sheet'; testID: string; shows?: string }
interface NoRowExpect { kind: 'noRow'; reason: string; absent: string[]; present?: string; neighbour?: OpensExpect }
interface CallsExpect { kind: 'calls'; fn: jest.Mock; reason: string }
interface DisabledExpect { kind: 'disabled'; testID: string; reason: string }
type Expected = OpensExpect | GapExpect | InPlaceExpect | SheetExpect | NoRowExpect | CallsExpect | DisabledExpect;

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
  tap: { testID: string; index?: number } | { label: RegExp };
  /** What must be on screen before tapping (defaults to the row itself). */
  waitFor?: { testID: string } | { text: string };
  before?: () => void;
  /** Runs against the mounted view before the row can exist (typing a search). */
  beforeTap?: (view: Awaited<ReturnType<typeof render>>) => void;
  /** Seeds the query cache before the mount (a row that exists only on this phone). */
  seedQueries?: (qc: QueryClient) => void;
  /** The row exists only with a server switch off (left out where every server switch is forced on). */
  serverSwitchOff?: true;
  expected: Expected;
}

/** A read that never answers: the row under test is one this phone holds, not one the server sent. */
const PENDING = Symbol('pending');
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
    screen: () => <CoachCommunityModerationScreen />,
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
  {
    // A captionless reported photo: content "", the photo drawn (FlaggedPhoto), decisions beside it (community-moderation.service.ts:936-946 image).
    id: 'B2p', title: 'flagged captionless photo', role: 'coach', host: COACH_COMMUNITY_HOST,
    http: { ...EMPTY_STATES, '/community/moderation/flagged': { items: [flagged(uuid(205), 'message', uuid(305), '', { image: { url: 'https://img.example/p.jpg', width: 600, height: 800, expires_at: '2026-11-09T18:00:00.000Z' } })] } },
    screen: () => <CoachCommunityModerationScreen />,
    tap: { testID: `coach-community-flagged-row-${uuid(205)}` },
    expected: { kind: 'inPlace', reason: 'a reported photo is drawn whole with the decisions beside it, so the row names nothing it does not show', drawn: (ctx) => {
      expect(ctx.view.getByTestId(`coach-community-flagged-photo-${uuid(205)}`)).toBeTruthy();
      expect(ctx.view.getByTestId(`coach-community-flagged-hide-${uuid(205)}`)).toBeTruthy();
      expect(ctx.view.queryByTestId(`coach-community-flagged-content-${uuid(205)}`)).toBeNull();
    } },
  },
];

function moderationInPlace(id: string, title: string, target: string, item: { id: string }): Row {
  return {
    id,
    title,
    role: 'coach',
    host: COACH_COMMUNITY_HOST,
    http: { ...EMPTY_STATES, '/community/moderation/flagged': { items: [item] } },
    screen: () => <CoachCommunityModerationScreen />,
    tap: { testID: `coach-community-flagged-content-${item.id}` },
    expected: {
      kind: 'inPlace',
      reason: `a reported ${target} is drawn whole beside the decisions: the content, photo or player and Hide, Warn, Ban, Dismiss, so the row names nothing it does not show`,
      drawn: (ctx) => {
        expect(ctx.view.getByTestId(`coach-community-flagged-row-${item.id}`)).toBeTruthy();
        expect(ctx.view.getByTestId(`coach-community-flagged-hide-${item.id}`)).toBeTruthy();
        expect(ctx.view.getByTestId(`coach-community-flagged-content-${item.id}`).props.accessibilityState?.disabled).toBe(true);
      },
    },
  };
}

// ─── C: coach Community lists ────────────────────────────────────────────────────────────────────────────────────────

/** community-cohort.dto.ts:27-40 CommunityCohortSummarySchema (GET /community/cohorts). */
const cohortRow = (id: string, name: string) => ({
  id,
  workspace_id: WS,
  name,
  is_default: false,
  kind: 'chat',
  posting_policy: 'all',
  visibility: 'clients',
  description: null,
  member_count: 2,
  my_role: 'coach',
  unread_count: 0,
});
const COHORTS = { feature_flag_state: 'enabled', cohorts: [cohortRow(COHORT, 'Spring block'), cohortRow(COHORT_2, 'Summer block')] };
/** community-me.dto.ts:22-41 (GET /community/me). */
const ME = (role: 'client' | 'coach') => ({
  feature_flag_state: 'enabled',
  workspace_id: WS,
  membership: { id: uuid(30), role, notify_level: 'live', dm_enabled_effective: true, last_read_message_at: null, joined_at: CREATED },
  unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  flags: { community_api: true, community_dm: true, community_realtime: true, community_push: true, community_telemetry: true },
});
const DASHBOARD_HTTP = {
  ...EMPTY_STATES,
  '/community/cohorts': COHORTS,
  '/community/me/coach-inbox': inboxPage(inboxPost(uuid(101))),
  '/community/moderation/flagged': { items: [flagged(uuid(200), 'post', uuid(300), 'a post')] },
};
const coachHomeCard = (id: string, title: string, testID: string, route: string): Row => ({
  id, title, role: 'coach', host: COACH_COMMUNITY_HOST, http: DASHBOARD_HTTP,
  screen: () => <CoachCommunityHomeScreen />, tap: { testID }, expected: opens(route),
});
ROWS.push(
  coachHomeCard('C1', 'Home inbox card', 'coach-community-home-inbox-card', 'CoachCommunityInbox'),
  coachHomeCard('C2', 'Home moderation card', 'coach-community-home-moderation-card', 'CoachCommunityModeration'),
  coachHomeCard('C3', 'Home cohorts card', 'coach-community-home-cohorts-card', 'CoachCommunityCohorts'),
  coachHomeCard('C4', 'Home events card', 'coach-community-home-events-card', 'CoachCommunityEvents'),
  {
    id: 'C5', title: 'cohort row', role: 'coach', host: COACH_COMMUNITY_HOST,
    http: { ...EMPTY_STATES, '/community/cohorts': COHORTS },
    screen: () => <CoachCommunityCohortsScreen />,
    tap: { testID: `coach-community-cohort-row-${COHORT_2}` },
    expected: SPACE_CHAT_SHIPPED
      ? opens('CommunitySpaceChat', { cohortId: COHORT_2 })
      : opens('CoachCommunityCohortDetail', { cohortId: COHORT_2, cohortName: 'Summer block' }),
  },
  {
    id: 'C6', title: 'cohort member row opens its menu', role: 'coach', host: COACH_COMMUNITY_HOST,
    before: () => { mockRouteParams = { cohortId: COHORT, cohortName: 'Spring block' }; },
    http: {
      ...EMPTY_STATES,
      // community-cohort-members.dto.ts:60-81 (GET /community/cohorts/:id/members) and community-cohort.dto.ts:41-64.
      [`/community/cohorts/${COHORT}/members`]: {
        members: [
          { id: uuid(40), user_id: CLIENT, display_name: 'Dana Cruz', role: 'student', status: 'active', email: 'dana@example.com', joined_at: CREATED },
          { id: uuid(41), user_id: CLIENT_2, display_name: 'Sam Lee', role: 'student', status: 'active', email: 'sam@example.com', joined_at: CREATED },
        ],
        next_cursor: null,
      },
      [`/community/cohorts/${COHORT}`]: { ...cohortRow(COHORT, 'Spring block'), created_at: CREATED },
    },
    screen: () => <CoachCommunityCohortDetailScreen />,
    tap: { testID: `coach-community-member-menu-${CLIENT_2}` },
    expected: { kind: 'sheet', testID: 'coach-community-member-menu-sheet', shows: 'Sam Lee' },
  },
  {
    id: 'C7', title: 'event row opens its manage sheet', role: 'coach', host: COACH_COMMUNITY_HOST,
    http: {
      '/community/me': ME('coach'),
      [`/community/workspaces/${WS}/events`]: { events: [eventRow(uuid(50), 'Morning stretch'), eventRow(uuid(51), 'Sunday review')], next_before: null },
    },
    screen: () => <CoachCommunityEventsScreen />,
    tap: { testID: `coach-community-event-row-${uuid(51)}` },
    expected: { kind: 'sheet', testID: 'coach-community-events-manage-modal', shows: 'Sunday review' },
  },
);

/** community-event.dto.ts:168-195 CommunityEventSchema. */
function eventRow(id: string, title: string) {
  return {
    id, workspace_id: WS, cohort_id: null, created_by_user_id: COACH_USER, title, description: null,
    state: 'scheduled', starts_at: '2026-11-20T17:00:00.000Z', ends_at: null, external_url: null, reflected_at: null,
    canceled: false, rsvp_counts: { going: 0, maybe: 0, declined: 0, attended: 0, missed: 0 }, viewer_rsvp_status: null,
    created_at: CREATED, updated_at: CREATED,
  };
}

// ─── D: coach one-to-one (GET /coach/messages/inbox) ─────────────────────────────────────────────────────────────────

const SERVER_FLAGS = (on: Record<string, boolean>) => ({ flags: on, evaluated_at: CREATED });
const V2_ON = { '/me/feature-flags': SERVER_FLAGS({ messaging_core_v2: true }) };
/** messaging-inbox.service.ts:29-48 InboxThreadView (thread_id is the client id). */
const thread = (clientId: string, name: string, last_message: object | null, extra: object = {}) => ({
  thread_id: clientId, kind: 'coach_client', coach_id: COACH_USER, client_id: clientId,
  counterpart: { user_id: clientId, display_name: name },
  last_message, unread_count: 0, muted: false, muted_until: null, pinned: false,
  blocked_by_me: false, closed: false, last_activity_at: CREATED, ...extra,
});
/** messaging-inbox.service.ts:129-141 lastMessageView, one per state the server writes. */
const lastMessage = (kind: 'text' | 'voice' | 'deleted', preview: string, extra: object = {}) => ({
  id: uuid(60), sender_id: CLIENT_2, is_mine: false, kind, preview, created_at: CREATED, edited: false, ...extra,
});
const coachInbox = (...items: object[]) => ({ items, next_cursor: null, total_unread: 0 });
const NEIGHBOUR = thread(CLIENT, 'Dana Cruz', lastMessage('text', 'hello'));
const chatOf = (clientId: string, clientName: string) => opens('Messages', { screen: 'ClientMessages', params: { clientId, clientName }, initial: false });
const resetRoster = () => { useCoachStore.getState().reset(); mockGetClients.mockResolvedValue({ data: [] }); };
const v2Row = (id: string, title: string, last: object | null, extra: object = {}): Row => ({
  id, title, role: 'coach', host: COACH_MESSAGES_HOST, before: resetRoster,
  http: { ...V2_ON, '/coach/messages/inbox': coachInbox(NEIGHBOUR, thread(CLIENT_2, 'Sam Lee', last, extra)) },
  screen: () => <MessagesScreen />,
  tap: { testID: `inbox-row-${CLIENT_2}` },
  expected: chatOf(CLIENT_2, 'Sam Lee'),
});
ROWS.push(
  v2Row('D1', 'thread, last message text', lastMessage('text', 'how was today?')),
  v2Row('D2', 'thread, last message voice', lastMessage('voice', '')),
  v2Row('D3', 'thread, last message deleted', lastMessage('deleted', '')),
  v2Row('D4', 'thread, last message card only', lastMessage('text', '', { card_type: 'workout_card' })),
  v2Row('D5', 'thread, no last message', null),
  {
    id: 'D6', title: 'thread with blocked_by_me draws no row', role: 'coach', host: COACH_MESSAGES_HOST, before: resetRoster,
    http: { ...V2_ON, '/coach/messages/inbox': coachInbox(thread(CLIENT_2, 'Sam Lee', lastMessage('text', 'x'), { blocked_by_me: true }), NEIGHBOUR) },
    screen: () => <MessagesScreen />,
    tap: { testID: `inbox-row-${CLIENT}` },
    waitFor: { testID: `inbox-row-${CLIENT}` },
    expected: {
      kind: 'noRow',
      reason: 'a chat closed by a block is not a row at all (CoachInboxV2.tsx:143-148; the server sends none: messaging-inbox.service.ts:43-46)',
      absent: [`inbox-row-${CLIENT_2}`],
      neighbour: chatOf(CLIENT, 'Dana Cruz'),
    },
  },
  {
    id: 'D7', title: 'client with no thread (start a conversation)', role: 'coach', host: COACH_MESSAGES_HOST,
    before: () => {
      useCoachStore.getState().reset();
      // coach clients list row: the roster the store loads (coachStore.ts:93).
      mockGetClients.mockResolvedValue({ data: [
        { id: CLIENT, name: 'Dana Cruz', role: 'student', email: 'dana@example.com', coach_id: COACH_USER, created_at: CREATED },
        { id: CLIENT_2, name: 'Sam Lee', role: 'student', email: 'sam@example.com', coach_id: COACH_USER, created_at: CREATED },
      ] });
    },
    http: { ...V2_ON, '/coach/messages/inbox': coachInbox() },
    screen: () => <MessagesScreen />,
    tap: { testID: `inbox-client-${CLIENT_2}` },
    expected: chatOf(CLIENT_2, 'Sam Lee'),
  },
  {
    id: 'D8', title: 'legacy Messages row (server flag messaging_core_v2 off)', role: 'coach', host: COACH_MESSAGES_HOST, serverSwitchOff: true,
    before: () => {
      useCoachStore.getState().reset();
      mockGetClients.mockResolvedValue({ data: [
        { id: CLIENT, name: 'Dana Cruz', role: 'student', email: 'dana@example.com', coach_id: COACH_USER, created_at: CREATED },
        { id: CLIENT_2, name: 'Sam Lee', role: 'student', email: 'sam@example.com', coach_id: COACH_USER, created_at: CREATED },
      ] });
      // messaging.service getUnreadCounts: { by_client, closed_client_ids }.
      mockGetUnreadCounts.mockResolvedValue({ data: { by_client: { [CLIENT_2]: 2 }, closed_client_ids: [] } });
    },
    http: { '/me/feature-flags': SERVER_FLAGS({ messaging_core_v2: false }) },
    screen: () => <MessagesScreen />,
    tap: { label: /Open messages with Sam Lee, 2 unread/ },
    expected: chatOf(CLIENT_2, 'Sam Lee'),
  },
  {
    id: 'D9', title: 'Command Center inbox row', role: 'coach', host: ['Tab@CoachNavigator'],
    http: {
      // command-center.service.ts:81-90 InboxThread, GET /coach/command-center/inbox.
      '/coach/command-center/inbox': {
        total_unread: 0,
        threads: [
          { thread_id: CLIENT, client_id: CLIENT, client_name: 'Dana Cruz', last_message_preview: 'hi', last_message_at: CREATED, unread_count: 0, is_coach_turn: false },
          { thread_id: CLIENT_2, client_id: CLIENT_2, client_name: 'Sam Lee', last_message_preview: 'hey', last_message_at: CREATED, unread_count: 0, is_coach_turn: true },
        ],
      },
    },
    screen: () => <CommandCenterScreen initialTab="inbox" />,
    tap: { testID: 'command-center-inbox-row', index: 1 },
    expected: chatOf(CLIENT_2, 'Sam Lee'),
  },
  {
    id: 'D10', title: 'Community reports entry in the Messages header', role: 'coach', host: COACH_MESSAGES_HOST,
    http: { ...EMPTY_STATES, '/community/moderation/flagged': { items: [flagged(uuid(200), 'post', uuid(300), 'a post')] } },
    screen: () => <CommunityReportsEntry />,
    tap: { testID: 'messages-community-reports-entry' },
    expected: opens('CoachCommunityModeration'),
  },
);

// ─── E: client inbox (MessagesInboxScreen) ───────────────────────────────────────────────────────────────────────────

const CLIENT_INBOX_HTTP = {
  ...V2_ON,
  '/v1/clients/me/coach': { id: COACH_USER, name: 'Alex Morgan' },
  '/messages/unread-count': { total: 3 },
  // messaging-inbox.service.ts:29-48: the client's single coach thread.
  '/messages/inbox': coachInbox(thread(COACH_USER, 'Alex Morgan', lastMessage('text', 'see you Monday'))),
  '/me/roman/usage': { used: { messages: 1 }, limits: { messages: 10 } },
  '/messages': {},
};
const clientInboxScreen = () => <MessagesInboxScreen navigation={mockNavObject as never} />;
ROWS.push(
  { id: 'E1', title: 'coach card', role: 'client', host: CLIENT_HOME_HOST, http: CLIENT_INBOX_HTTP, screen: clientInboxScreen, tap: { testID: 'inbox-coach' }, expected: opens('Messages') },
  { id: 'E2', title: 'Roman card', role: 'client', host: CLIENT_HOME_HOST, http: CLIENT_INBOX_HTTP, screen: clientInboxScreen, tap: { testID: 'inbox-roman' }, expected: opens('MoreTab', { screen: 'RomanChat', initial: false }) },
  { id: 'E3', title: 'Your conversations with Roman row', role: 'client', host: CLIENT_HOME_HOST, http: CLIENT_INBOX_HTTP, screen: clientInboxScreen, tap: { label: /never sees this chat/ }, expected: opens('MoreTab', { screen: 'RomanConversations', initial: false }) },
  {
    id: 'E4', title: 'no coach: Join a coach', role: 'client', host: CLIENT_HOME_HOST, http: {},
    before: () => { mockNeedsCoach = true; }, screen: clientInboxScreen, tap: { testID: 'inbox-join' },
    expected: { kind: 'calls', fn: mockMessageCoach, reason: 'useEntitlement().messageCoach is the one way to find a coach' },
  },
  {
    id: 'E5', title: 'no coach: Contact support', role: 'client', host: CLIENT_HOME_HOST, http: {},
    before: () => { mockNeedsCoach = true; }, screen: clientInboxScreen, tap: { testID: 'inbox-support' },
    expected: { kind: 'calls', fn: mockOpenSupport, reason: 'useOpenSupport() is the app’s support entry' },
  },
);

// ─── F: client community ─────────────────────────────────────────────────────────────────────────────────────────────

const HOME_HTTP = {
  '/community/me': ME('client'),
  '/community/cohorts': { ...COHORTS, cohorts: COHORTS.cohorts.map((c) => ({ ...c, my_role: 'client' })) },
  '/v1/clients/me/coach': { id: COACH_USER, name: 'Alex Morgan' },
  '/messages/unread-count': { total: 0 },
  '/messages': {},
};
const homeRow = (id: string, title: string, key: string, expected: Expected): Row => ({
  id, title, role: 'client', host: CLIENT_COMMUNITY_HOST, http: HOME_HTTP,
  screen: () => <CommunityHomeScreen />, tap: { testID: `space-row-${key}` }, expected,
});
/** community-posts.service.ts:89-107 postView. */
const post = (id: string, title: string | null, body: string | null, extra: object = {}) => ({
  id, workspace_id: WS, cohort_id: null, author_user_id: CLIENT_2, author_name: 'Sam', title, body,
  scope: 'hall', type: 'text', pinned: false, created_at: CREATED, updated_at: CREATED, deleted: false, reactions: [], ...extra,
});
const POSTS_URL = `/community/workspaces/${WS}/posts`;
const spaceScreen = () => <CommunitySpaceScreen space="hall" />;

/**
 * F1 and F16 (LO-956R1 B1): the row sends CommunitySpace with space 'cohort' and its cohortId (SpaceTree.tsx:95-96,
 * CommunityTodayScreen.tsx:153), but the destination drops both: CommunitySpaceScreen is mounted as the route itself
 * (CommunityNavigator.tsx:82), takes `space` as a prop that defaults to 'hall' and reads no route params
 * (CommunitySpaceScreen.tsx:78-85), so whichever space a member taps she gets the Hall feed. The right screen is the
 * cohort's own space, CommunitySpaceChat {cohortId}, as F1's shipped case and m#945 draw it. The symptom has two
 * halves so either fix turns a mark red: a sender fix changes the navigate (the it.failing case then passes and the
 * first half fails); a screen fix makes the screen read its route (the second half fails).
 */
const SPACE_SCREEN_FILE = 'screens/community/CommunitySpaceScreen.tsx';
const SPACE_DROPS_WHY = 'CommunitySpace drops the cohortId: CommunitySpaceScreen.tsx:78-85 takes space as a prop defaulting to hall and reads no route params (mounted as the route at CommunityNavigator.tsx:82)';
const spaceGap = (cohortId: string): GapExpect => ({
  kind: 'gap',
  right: opens('CommunitySpaceChat', { cohortId }),
  why: SPACE_DROPS_WHY,
  symptom: () => {
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('CommunitySpace', { space: 'cohort', cohortId });
    const screenSrc = fs.readFileSync(path.join(SRC, SPACE_SCREEN_FILE), 'utf8');
    expect(screenSrc).not.toMatch(/useRoute/);
    expect(screenSrc).not.toMatch(/params/);
  },
});
ROWS.push(
  homeRow('F1', 'SpaceTree space row', COHORT_2, SPACE_CHAT_SHIPPED
    ? opens('CommunitySpaceChat', { cohortId: COHORT_2 })
    : spaceGap(COHORT_2)),
  homeRow('F2', 'SpaceTree coach row', 'coach', opens('Home', { screen: 'Messages' })),
  homeRow('F3', 'SpaceTree Leaderboard row', 'leaderboard', opens('Leaderboard')),
  homeRow('F4', 'SpaceTree Classroom row', 'classroom', opens('CommunityClassroom')),
  {
    id: 'F5', title: 'space post row', role: 'client', host: CLIENT_COMMUNITY_HOST,
    http: { '/community/me': ME('client'), [POSTS_URL]: { posts: [post(uuid(70), 'first', 'one'), post(uuid(71), 'second', 'two')], next_before: null } },
    screen: spaceScreen, tap: { testID: `post-card-${uuid(71)}` }, expected: opens('CommunityThread', { postId: uuid(71) }),
  },
  {
    id: 'F6', title: 'a removed post has no tap', role: 'client', host: CLIENT_COMMUNITY_HOST,
    http: {
      '/community/me': ME('client'),
      // A removed post keeps its place (communityRemovedRows.ts; community-posts.service.ts removal view): title and body null, removed_at, removed_by.
      [POSTS_URL]: { posts: [post(uuid(72), null, null, { removed_at: CREATED, removed_by: { role: 'coach', user_id: COACH_USER, name: 'Kim' } })], next_before: null },
    },
    screen: spaceScreen, tap: { testID: `post-removed-${uuid(72)}` },
    expected: { kind: 'noRow', reason: 'CommunitySpaceScreen.tsx:325-333 draws one quiet line, no card', absent: [`post-card-${uuid(72)}`], present: `post-removed-line-${uuid(72)}` },
  },
  {
    id: 'F7', title: 'an optimistic post is disabled', role: 'client', host: CLIENT_COMMUNITY_HOST,
    http: { '/community/me': ME('client'), [POSTS_URL]: PENDING },
    before: () => undefined,
    seedQueries: (qc) => qc.setQueryData(['community', 'posts', WS], [post('optimistic:1', 'Sending', 'body')]),
    screen: spaceScreen, tap: { testID: 'post-card-optimistic:1' },
    expected: { kind: 'disabled', testID: 'post-card-optimistic:1', reason: 'CommunitySpaceScreen.tsx:274: the row is pressable only once the post has a server id' },
  },
  {
    id: 'F8', title: 'DM row', role: 'client', host: CLIENT_COMMUNITY_HOST,
    http: {
      // community-dms.service.ts:284-289 listThreads.
      [`/community/workspaces/${WS}/dms`]: { threads: [
        { thread_id: `${WS}:${CLIENT}:${CLIENT_2}`, workspace_id: WS, other_user_id: CLIENT_2, created_at: null, last_message_at: CREATED },
        { thread_id: `${WS}:${CLIENT}:${COACH_USER}`, workspace_id: WS, other_user_id: COACH_USER, created_at: null, last_message_at: CREATED },
      ] },
    },
    screen: () => <CommunityDmListScreen workspaceId={WS} />,
    tap: { testID: `dm-row-${WS}:${CLIENT}:${COACH_USER}` },
    expected: opens('CommunityDmThread', { recipientId: COACH_USER }),
  },
  {
    // COACH-DM-M: the coach's own DM list. The coach holds no membership (community.service.ts:137-142); b#1243 lists
    // only threads with their current clients, ?limit=100 (community-dms.service.ts:145-150, :265-300 at e760b3e0);
    // names come from GET /coach/clients?status=all (coach.controller.ts:64-78).
    id: 'F8c', title: 'coach DM row', role: 'coach', host: COACH_COMMUNITY_HOST,
    http: {
      '/community/me': { ...ME('coach'), membership: null },
      [`/community/workspaces/${WS}/dms`]: { threads: [
        { thread_id: `${WS}:${[COACH_USER, CLIENT_2].sort().join(':')}`, workspace_id: WS, other_user_id: CLIENT_2, created_at: null, last_message_at: CREATED },
        { thread_id: `${WS}:${[COACH_USER, CLIENT].sort().join(':')}`, workspace_id: WS, other_user_id: CLIENT, created_at: null, last_message_at: CREATED },
      ] },
    },
    before: () => mockGetClients.mockResolvedValue({ data: [
      { id: CLIENT, email: 'dana@example.com', name: 'Dana Cruz', role: 'student', coach_id: COACH_USER, archived_at: null, created_at: CREATED, activity: null },
      { id: CLIENT_2, email: 'eli@example.com', name: 'Eli Park', role: 'student', coach_id: COACH_USER, archived_at: null, created_at: CREATED, activity: null },
    ] }),
    screen: () => {
      const CoachDmListScreen = require('../screens/community/coach-dm/CoachDmListScreen').default;
      return <CoachDmListScreen />;
    },
    tap: { testID: `coach-dm-row-${CLIENT}` },
    expected: opens('CommunityDmThread', { recipientId: CLIENT, name: 'Dana Cruz' }),
  },
);

const SEARCH_HTTP = (flags: Record<string, boolean>, results: object[]) => ({
  '/community/me': ME('client'),
  '/me/feature-flags': SERVER_FLAGS({ community_search: true, community_classroom: true, community_events: true, ...flags }),
  // community-search.service.ts:114-122; dto SearchResponseSchema.
  [`/community/workspaces/${WS}/search`]: { version: 1, query: 'squat', results, nextCursor: null, tookMs: 4 },
});
const searchHit = (id: string, kind: string, targetId: string) => ({ id, kind, targetId, cohortId: null, authorId: CLIENT_2, excerpt: 'a matching excerpt', createdAt: CREATED });
const findRow = (id: string, title: string, kind: string, expected: Expected, flags: Record<string, boolean> = {}): Row => ({
  id, title, role: 'client', host: CLIENT_COMMUNITY_HOST,
  ...(Object.values(flags).includes(false) ? { serverSwitchOff: true as const } : {}),
  http: SEARCH_HTTP(flags, [searchHit(uuid(80), 'post', uuid(81)), searchHit(uuid(82), kind, uuid(83))]),
  screen: () => <CommunityFindScreen />,
  beforeTap: (view) => fireEvent.changeText(view.getByTestId('community-search-input'), 'squat'),
  tap: { testID: `community-search-result-${uuid(82)}` },
  expected,
});
ROWS.push(
  findRow('F9', 'search result: post', 'post', opens('CommunityThread', { postId: uuid(83) })),
  findRow('F10', 'search result: voice note transcript', 'voice_note_transcript', opens('CommunityVoiceNoteDetail', { voiceNoteId: uuid(83), excerpt: 'a matching excerpt' })),
  findRow('F11', 'search result: classroom lesson', 'classroom_lesson', opens('CommunityLessonDetail', { postId: uuid(83) })),
  findRow('F12', 'search result: event', 'event', opens('CommunityEventDetail', { eventId: uuid(83) })),
  findRow('F13a', 'search lesson with the server classroom switch off shows the notice', 'classroom_lesson', { kind: 'sheet', testID: 'community-find-unavailable-notice', shows: undefined }, { community_classroom: false }),
  findRow('F13b', 'search event with the server events switch off shows the notice', 'event', { kind: 'sheet', testID: 'community-find-unavailable-notice', shows: undefined }, { community_events: false }),
  {
    id: 'F14', title: 'challenge row', role: 'client', host: CLIENT_COMMUNITY_HOST,
    http: { '/community/me': ME('client'), [`/community/workspaces/${WS}/challenges`]: { challenges: [challengeRow(uuid(90)), challengeRow(uuid(91))], next_cursor: null } },
    screen: () => <CommunityChallengesScreen />,
    tap: { testID: `community-challenge-card-${uuid(91)}` }, expected: opens('CommunityChallengeDetail', { challengeId: uuid(91) }),
  },
  {
    id: 'F15', title: 'classroom lesson row', role: 'client', host: CLIENT_COMMUNITY_HOST,
    http: { '/community/me': ME('client'), [`/community/workspaces/${WS}/classroom`]: { posts: [lessonRow(uuid(92)), lessonRow(uuid(93))], next_cursor: null } },
    screen: () => <CommunityClassroomScreen />,
    tap: { testID: `community-lesson-card-${uuid(93)}` }, expected: opens('CommunityLessonDetail', { postId: uuid(93) }),
  },
);

/** community-challenges.dto.ts:218-237 ChallengeSchema. */
function challengeRow(id: string) {
  return {
    id, workspace_id: WS, cohort_id: null, created_by_user_id: COACH_USER, title: `Challenge ${id.slice(4, 8)}`, description: null,
    status: 'active', starts_at: CREATED, ends_at: '2026-12-01T00:00:00.000Z', metric_key: null, target_value: 10, unit: 'days',
    leaderboard_enabled: false, created_at: CREATED, updated_at: CREATED, archived: false,
  };
}
/** community-classroom.service.ts:139-157 postView. */
function lessonRow(id: string) {
  return {
    id, workspace_id: WS, cohort_id: null, coach_id: COACH_USER, title: `Lesson ${id.slice(4, 8)}`, body_markdown: 'read me',
    status: 'published', pinned: false, pinned_order: null, release_at: null, release_locked: false, published_at: CREATED,
    created_at: CREATED, updated_at: CREATED, media: [],
  };
}

// Today (community.service.ts:262-298 getToday; CommunityTodayResponseSchema).
const TODAY_HTTP = {
  '/community/today': {
    feature_flag_state: 'enabled',
    cohort: { id: COHORT, name: 'Spring block', member_count: 12 },
    event: { id: uuid(94), title: 'Morning stretch', starts_at: '2026-11-20T17:00:00.000Z', live_url: null },
    pinned_post: { id: uuid(95), title: 'Read this first', author_user_id: COACH_USER },
    challenge: { id: uuid(96), title: 'Ten day streak', ends_at: '2026-12-01T00:00:00.000Z' },
    empty_reason: null,
  },
};
const todayRow = (id: string, title: string, testID: string, expected: Expected): Row => ({
  id, title, role: 'client', host: CLIENT_COMMUNITY_HOST, http: TODAY_HTTP, screen: () => <CommunityTodayScreen />, tap: { testID }, expected,
});
ROWS.push(
  // A gap in both SPACE_CHAT_SHIPPED cases: m#945 leaves CommunityTodayScreen.tsx:153 and CommunitySpaceScreen as they are.
  todayRow('F16', 'Today cohort card', 'community-today-cohort', spaceGap(COHORT)),
  todayRow('F17', 'Today pinned post card', 'community-today-pinned', opens('CommunityThread', { postId: uuid(95) })),
  todayRow('F18', 'Today event card', 'community-today-event', opens('CommunityEventDetail', { eventId: uuid(94) })),
  todayRow('F19', 'Today challenge card', 'community-today-challenge', opens('CommunityChallengeDetail', { challengeId: uuid(96) })),
);

// ─── W: complete-in-place lists ──────────────────────────────────────────────────────────────────────────────────────

ROWS.push(
  {
    id: 'W1', title: 'member win', role: 'client', host: CLIENT_MORE_HOST,
    // community wins feed row: RawWinSchema in src/api/communityWinsApi.ts mirrors the server's feed row (GET /community/feed).
    http: { '/community/feed': [{ id: uuid(110), user_id: CLIENT_2, display_name: 'Sam', title: 'New PR', description: 'Bench 100kg', created_at: CREATED, is_mine: false }] },
    screen: () => <ClientWinsScreen />,
    tap: { testID: `win-${uuid(110)}` },
    expected: { kind: 'inPlace', reason: 'a win shows its whole title and description; Report and Block are its own controls (the row itself has no press)', drawn: (ctx) => {
      expect(ctx.view.getByTestId(`win-${uuid(110)}`).props.onPress).toBeUndefined();
      expect(ctx.view.getByTestId(`win-menu-${uuid(110)}`)).toBeTruthy();
    } },
  },
  {
    id: 'W2', title: 'coach nudge row', role: 'client', host: CLIENT_HOME_HOST,
    // nudges.service.ts list rows (GET /nudges): the whole note is the row.
    http: { '/nudges': [{ id: uuid(111), client_id: CLIENT, coach_id: COACH_USER, title: null, body: 'How did week 2 feel?', created_at: CREATED, read_at: null }] },
    screen: () => <ClientNudgesScreen />,
    tap: { label: /How did week 2 feel\?/ },
    expected: { kind: 'inPlace', reason: 'a nudge shows its whole note; the tap only marks it read (it stands for nothing it does not show)', drawn: () => undefined },
  },
  {
    id: 'W3', title: 'coach wearable prompt card', role: 'coach', host: COACH_COMMUNITY_HOST,
    before: () => { mockRouteParams = { clientId: CLIENT, clientName: 'Dana' }; },
    http: {
      '/community/me': ME('coach'),
      '/me/feature-flags': SERVER_FLAGS({ coach_community_wearable_prompts: true }),
      // wearable-prompts.dto.ts:80-97 PromptViewSchema (GET /community/workspaces/:id/wearable-prompts).
      [`/community/workspaces/${WS}/wearable-prompts`]: { version: 1, prompts: [{ id: uuid(112), workspaceId: WS, coachId: COACH_USER, clientId: CLIENT, metricKey: 'sleep', promptText: 'Ask Dana about sleep this week.', sources: [], generatedAt: CREATED, dismissedAt: null, actedOnAt: null }] },
    },
    screen: () => <CommunityWearablePromptsScreen />,
    tap: { testID: `wearable-prompt-listitem-${uuid(112)}` },
    expected: { kind: 'inPlace', reason: 'the card shows the whole prompt with Dismiss and Act on in place', drawn: (ctx) => {
      expect(ctx.view.getByTestId(`wearable-prompt-listitem-${uuid(112)}`).props.onPress).toBeUndefined();
    } },
  },
);

ROWS.push({
  id: 'W4', title: 'Hall voice note', role: 'client', host: CLIENT_COMMUNITY_HOST,
  http: {
    '/community/me': ME('client'),
    [POSTS_URL]: { posts: [post(uuid(113), 'a post', 'b')], next_before: null },
    // community-voice.dto.ts:202-226 VoiceNoteViewSchema (GET /community/workspaces/:id/voice-notes).
    [`/community/workspaces/${WS}/voice-notes`]: { voice_notes: [{
      id: uuid(114), workspace_id: WS, cohort_id: null, conversation_id: null, author_id: CLIENT_2,
      url: 'https://audio.example/n.m4a', duration_ms: 42000, bytes: 1000, mime_type: 'audio/mp4', has_waveform: false,
      created_at: CREATED, author_name: 'Sam', author_is_coach: false, waveform_peaks: null, heard_at: null, message_id: null,
    }], next_cursor: null },
  },
  screen: spaceScreen,
  tap: { testID: `community-space-voice-note-${uuid(114)}` },
  expected: { kind: 'inPlace', reason: 'a Hall voice note plays in place with Report and Block in its own menu; the row itself has no press', drawn: (ctx) => {
    expect(ctx.view.getByTestId(`community-space-voice-note-${uuid(114)}`).props.onPress).toBeUndefined();
    expect(ctx.view.getByTestId(`community-space-voice-menu-${uuid(114)}`)).toBeTruthy();
  } },
});

// ─── N: notification center (real normalizer, real routePushTap, fake navigator) ─────────────────────────────────────

const clientTabs = () => [...navigatorScreens('Tab@ClientNavigator')];
const coachTabs = () => [...navigatorScreens('Tab@CoachNavigator')];
const attach = (role: Role) => {
  const nav: PushNavigator = { isReady: () => true, navigate: mockNavigate, getRootState: () => ({ routeNames: role === 'client' ? clientTabs() : coachTabs() }) };
  attachPushNavigator(nav);
  setPushSession({ kind: 'app', userId: role === 'client' ? CLIENT : COACH_USER, role: role === 'client' ? 'student' : 'coach' });
};
/** community-notifications.service.ts:222-233: the stored row carries idempotency_key, category, target_type, target_id only (no actionScreen). */
const communityRow = (id: string, kind: string, body: string, deep_link: string, target: { type: string; id: string }) => ({
  id, kind, body, deep_link, channel: 'push', read_at: null, created_at: CREATED,
  payload: { idempotency_key: `community:${kind}:${id}`, category: 'COACH_DIRECT', target_type: target.type, target_id: target.id },
});
const notifications = (...items: object[]) => ({ items, nextCursor: null, unreadCount: items.length });
const NOTIF_HTTP = (...items: object[]) => ({ '/notifications': notifications(...items), '/notifications/unread-count': { count: items.length } });
const centerScreen = () => <NotificationCenterScreen />;
/** A client's community row today: the Community tab's root, a hub (pushTapRouter.ts:129, :299-304). */
const landsOnCommunityRoot = () => {
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith('CommunityTab', undefined);
};
/** A coach's community row today: 'Community' is not a coach push route, so it stays on the list (pushTapRouter.ts:133, deliver()). */
const staysOnCoachList = () => {
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', { screen: 'NotificationCenter', params: undefined });
};
const notifGap = (id: string, title: string, role: Role, row: { id: string; body: string; kind: string; deep_link: string }, right: OpensExpect, why: string, symptom: () => void): Row => ({
  id, title, role, host: role === 'client' ? ['Tab@ClientNavigator'] : ['Tab@CoachNavigator'],
  http: NOTIF_HTTP(communityRow('n-neighbour', row.kind, `neighbour ${row.kind}`, row.deep_link, { type: 'x', id: uuid(120) }), row),
  before: () => attach(role), screen: centerScreen, tap: { label: new RegExp(row.body) },
  expected: { kind: 'gap', right, why, symptom },
});
const SPACE_LINK_WHY = 'the phone reads no community/cohorts link: notificationsApi.ts:318 maps every community_* row to Community and pushTapRouter.ts:299-304 drops the link';
const NESTED = (root: string, screen: string, params: Record<string, unknown>) => opens(root, { screen, params, initial: false });
// The server's DM key sorts the two user ids (community-dms.repository.ts:23-26 dmKey: [lo, hi] = [a, b].sort()), and
// the push link is tgp://community/dms/${dmKey} (community-dms.service.ts:223). Built once here, in the server's order.
const DM_LINK = `tgp://community/dms/${WS}:${[CLIENT, COACH_USER].sort().join(':')}`;
ROWS.push(
  notifGap('N1', 'community_post_replied (student)', 'client',
    communityRow('n-post', 'community_post_replied', 'Someone replied to your post.', `tgp://community/posts/${uuid(121)}`, { type: 'post', id: uuid(121) }),
    NESTED('CommunityTab', 'CommunityThread', { postId: uuid(121) }),
    'community-posts.service.ts:463 tgp://community/posts/<id> matches no phone link; the row lands on the Community root', landsOnCommunityRoot),
  notifGap('N2', 'community_dm_received (student)', 'client',
    communityRow('n-dm', 'community_dm_received', 'New direct message.', DM_LINK, { type: 'dm', id: uuid(122) }),
    NESTED('CommunityTab', 'CommunityDmThread', { recipientId: COACH_USER }),
    'community-dms.service.ts:223 tgp://community/dms/<dmKey> matches no phone link; the row lands on the Community root', landsOnCommunityRoot),
  // COACH-DM-M: a stored row keeps the older link; the router opens the id of the pair that is not the coach's.
  { id: 'N2c', title: 'community_dm_received (coach, a stored row with the older community/dms/<dmKey> link)', role: 'coach', host: ['Tab@CoachNavigator'],
    http: NOTIF_HTTP(communityRow('n-dmc', 'community_dm_received', 'New direct message for coach.', DM_LINK, { type: 'dm', id: uuid(123) })),
    before: () => attach('coach'), screen: centerScreen, tap: { label: /New direct message for coach\./ },
    expected: NESTED('CommunityStack', 'CommunityDmThread', { recipientId: CLIENT }) },
  // COACH-DM-M: b#1243 writes tgp://community/dm/<sender's user id> (community-dms.service.ts:234 at e760b3e0).
  { id: 'N2d', title: 'community_dm_received (coach, tgp://community/dm/<client>)', role: 'coach', host: ['Tab@CoachNavigator'],
    http: NOTIF_HTTP(communityRow('n-dmd', 'community_dm_received', 'A client sent you a direct message.', `tgp://community/dm/${CLIENT}`, { type: 'dm', id: uuid(131) })),
    before: () => attach('coach'), screen: centerScreen, tap: { label: /A client sent you a direct message\./ },
    expected: NESTED('CommunityStack', 'CommunityDmThread', { recipientId: CLIENT }) },
);
const spaceRow = communityRow('n-space', 'community_message_received', 'New activity in Spring block.', `tgp://community/cohorts/${COHORT}`, { type: 'message', id: uuid(124) });
ROWS.push(
  SPACE_CHAT_SHIPPED
    ? { id: 'N3', title: 'community_message_received (student)', role: 'client', host: ['Tab@ClientNavigator'], http: NOTIF_HTTP(spaceRow), before: () => attach('client'), screen: centerScreen, tap: { label: new RegExp(spaceRow.body) }, expected: NESTED('CommunityTab', 'CommunitySpaceChat', { cohortId: COHORT }) }
    : notifGap('N3', 'community_message_received (student)', 'client', spaceRow, NESTED('CommunityTab', 'CommunitySpaceChat', { cohortId: COHORT }), SPACE_LINK_WHY, landsOnCommunityRoot),
  SPACE_CHAT_SHIPPED
    ? { id: 'N3c', title: 'community_message_received (coach)', role: 'coach', host: ['Tab@CoachNavigator'], http: NOTIF_HTTP(spaceRow), before: () => attach('coach'), screen: centerScreen, tap: { label: new RegExp(spaceRow.body) }, expected: NESTED('CommunityStack', 'CommunitySpaceChat', { cohortId: COHORT }) }
    : notifGap('N3c', 'community_message_received (coach)', 'coach', spaceRow, NESTED('CommunityStack', 'CommunitySpaceChat', { cohortId: COHORT }), SPACE_LINK_WHY, staysOnCoachList),
  notifGap('N4', 'community_event_starting_soon (student)', 'client',
    communityRow('n-event', 'community_event_starting_soon', 'An event you RSVPd to starts soon.', `tgp://community/events/${uuid(125)}`, { type: 'event', id: uuid(125) }),
    NESTED('CommunityTab', 'CommunityEventDetail', { eventId: uuid(125) }),
    'community-events.service.ts:739 tgp://community/events/<id> matches no phone link; the row lands on the Community root', landsOnCommunityRoot),
  notifGap('N5', 'community_challenge_milestone (student)', 'client',
    communityRow('n-challenge', 'community_challenge_milestone', 'You completed a challenge.', `tgp://community/challenges/${uuid(126)}`, { type: 'challenge', id: uuid(126) }),
    NESTED('CommunityTab', 'CommunityChallengeDetail', { challengeId: uuid(126) }),
    'community-challenges.service.ts:502 tgp://community/challenges/<id> matches no phone link; the row lands on the Community root', landsOnCommunityRoot),
  notifGap('N6', 'community_moderation_action_against_me (student)', 'client',
    communityRow('n-mod', 'community_moderation_action_against_me', 'A moderation action was taken on your content.', 'tgp://community/moderation', { type: 'post', id: uuid(127) }),
    NESTED('CommunityTab', 'CommunitySafety', {}),
    'community-moderation.service.ts:598 tgp://community/moderation matches no phone link; the row lands on the Community root', landsOnCommunityRoot),
  notifGap('N7', 'community_moderation_notice (student)', 'client',
    // community-moderation-notices.ts:122-129 writes this row directly: channel inapp, payload idempotency_key, action, moderation_action_id, target_type, target_id.
    { id: 'n-notice', kind: 'community_moderation_notice', body: 'Your post was hidden. Open Community safety to read why.', deep_link: 'tgp://community/safety', channel: 'inapp', read_at: null, created_at: CREATED, payload: { idempotency_key: 'community:moderation_notice:m1:hide', action: 'hide', moderation_action_id: uuid(128), target_type: 'post', target_id: uuid(129) } } as never,
    NESTED('CommunityTab', 'CommunitySafety', {}),
    'community-moderation-notices.ts:127 tgp://community/safety matches no phone link; the row lands on the Community root', landsOnCommunityRoot),
  {
    id: 'N8', title: 'message_received (student): the one coach chat', role: 'client', host: ['Tab@ClientNavigator'],
    // notifications/emitters/message-received.emitter.ts:42-48: kind message_received, payload senderName, threadId, deep_link tgp://messages/<threadId>.
    http: NOTIF_HTTP({ id: 'n-msg', kind: 'message_received', body: 'New message from Alex', deep_link: `tgp://messages/${uuid(130)}`, channel: 'inapp', read_at: null, created_at: CREATED, payload: { senderName: 'Alex', threadId: uuid(130) } }),
    before: () => attach('client'), screen: centerScreen, tap: { label: /New message from Alex/ },
    expected: opens('Home', { screen: 'Messages' }),
  },
  notifGap('N8c', 'message_received (coach: lands on the inbox, see Owner decisions)', 'coach',
    { id: 'n-msg-c', kind: 'message_received', body: 'New message from Dana', deep_link: `tgp://messages/${CLIENT}`, channel: 'inapp', read_at: null, created_at: CREATED, payload: { senderName: 'Dana', threadId: CLIENT } } as never,
    NESTED('Messages', 'ClientMessages', { clientId: CLIENT, clientName: 'Dana' }),
    'the coach row opens the Messages inbox (a hub), not that client\'s chat: pushTapRouter.ts:134-135 COACH-CHAT-BACK',
    () => { expect(mockNavigate).toHaveBeenCalledTimes(1); expect(mockNavigate).toHaveBeenCalledWith('Messages', { screen: 'MessagesInbox', pop: true }); }),
);

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
    if (key in http) {
      if (http[key] === PENDING) return new Promise(() => undefined);
      const value = http[key] as { __withHeaders?: boolean; headers?: object; data?: unknown };
      if (value?.__withHeaders) return { data: value.data, headers: value.headers };
      return { data: http[key], headers: {} };
    }
    throw Object.assign(new Error(`no fixture for ${url}`), { response: { status: 404 } });
  });
  mockPost.mockResolvedValue({ data: {}, headers: {} });
}

function renderRow(row: Row) {
  mockCurrentUser = row.role === 'coach'
    ? { id: COACH_USER, name: 'Coach Kim', firstName: 'Kim' }
    : { id: CLIENT, coach_id: COACH_USER, name: 'Dana Cruz', firstName: 'Dana' };
  respond(row.http);
  row.before?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  row.seedQueries?.(client);
  return render(<QueryClientProvider client={client}>{row.screen()}</QueryClientProvider>);
}

const findRow2 = (view: Awaited<ReturnType<typeof render>>, row: Row) => {
  if ('testID' in row.tap) {
    return row.tap.index === undefined ? view.getByTestId(row.tap.testID) : view.getAllByTestId(row.tap.testID)[row.tap.index];
  }
  return view.getByLabelText(row.tap.label);
};

/** The row on screen and tapped once. */
async function tapRow(row: Row): Promise<RowCtx> {
  const view = await renderRow(row);
  if (row.beforeTap) await waitFor(() => row.beforeTap!(view), { timeout: 8000 });
  await waitFor(() => expect(findRow2(view, row)).toBeTruthy(), { timeout: 8000 });
  await act(async () => {
    fireEvent.press(findRow2(view, row));
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

const LIVE_ROWS = ROWS.filter((r) => !(r.serverSwitchOff && SERVER_SWITCHES_FORCED_ON));

describe.each(LIVE_ROWS.filter((r) => r.expected.kind === 'opens'))('$id $title', (row) => {
  const want = row.expected as OpensExpect;
  it(`one tap opens ${want.route} with this row's own ids, exactly once`, async () => {
    await tapRow(row);
    expectOneNavigate(want);
  });
  it(`${want.route} is registered and reachable from the row's stack`, () => {
    expect(registrationOf(row.role, row.host, want.route, want.params)).toBeNull();
  });
});

describe.each(LIVE_ROWS.filter((r) => r.expected.kind === 'gap'))('$id $title (gap)', (row) => {
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

describe.each(LIVE_ROWS.filter((r) => r.expected.kind === 'inPlace'))('$id $title (complete in place)', (row) => {
  const { drawn, reason } = row.expected as InPlaceExpect;
  it(`complete in place: ${reason}`, async () => {
    const ctx = await tapRow(row);
    drawn(ctx);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe.each(LIVE_ROWS.filter((r) => r.expected.kind === 'sheet'))('$id $title', (row) => {
  const { testID, shows } = row.expected as SheetExpect;
  it('one tap opens that row\'s own sheet or notice and navigates nowhere', async () => {
    const { view } = await tapRow(row);
    await waitFor(() => expect(view.getByTestId(testID).props.visible).not.toBe(false));
    if (shows) expect(view.queryAllByText(shows, { exact: false }).length).toBeGreaterThan(0);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe.each(LIVE_ROWS.filter((r) => r.expected.kind === 'noRow'))('$id $title', (row) => {
  const want = row.expected as NoRowExpect;
  it(`no row, so no dead tap: ${want.reason}`, async () => {
    const { view } = await tapRow(row);
    for (const id of want.absent) expect(view.queryByTestId(id)).toBeNull();
    if (want.present) expect(view.getByTestId(want.present)).toBeTruthy();
    if (want.neighbour) expectOneNavigate(want.neighbour);
    else expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe.each(LIVE_ROWS.filter((r) => r.expected.kind === 'calls'))('$id $title', (row) => {
  const { fn, reason } = row.expected as CallsExpect;
  it(`one tap runs its own action: ${reason}`, async () => {
    await tapRow(row);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe.each(LIVE_ROWS.filter((r) => r.expected.kind === 'disabled'))('$id $title', (row) => {
  const want = row.expected as DisabledExpect;
  it(`disabled until it is real: ${want.reason}`, async () => {
    const { view } = await tapRow(row);
    expect(view.getByTestId(want.testID).props.accessibilityState?.disabled ?? view.getByTestId(want.testID).props.disabled).toBe(true);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// ─── Negatives ───────────────────────────────────────────────────────────────────────────────────────────────────────

describe('rows that must not exist or must not move', () => {
  it('a row kind the mapper skips draws no row; a row with no kind is a text row (coachCommunityApi.ts:673-675)', async () => {
    const unknown = inboxMessage(uuid(140), 'text', 'x', { kind: 'carrier_pigeon' });
    const noVoiceObject = inboxMessage(uuid(141), 'voice', 'Voice note');
    const older = inboxMessage(uuid(142), 'text', 'from an older server');
    delete (older as { kind?: string }).kind;
    const row: Row = {
      id: 'A-neg', title: '', role: 'coach', host: COACH_COMMUNITY_HOST,
      http: { ...EMPTY_STATES, '/community/me/coach-inbox': inboxPage(unknown, noVoiceObject, older) },
      screen: inboxScreen, tap: { testID: `coach-community-inbox-row-${uuid(142)}` }, expected: opens('x'),
    };
    const { view } = await tapRow(row);
    expect(view.queryByTestId(`coach-community-inbox-row-${uuid(140)}`)).toBeNull();
    expect(view.queryByTestId(`coach-community-inbox-row-${uuid(141)}`)).toBeNull();
    if (SPACE_CHAT_SHIPPED) expect(mockNavigate).toHaveBeenCalledWith('CommunitySpaceChat', { cohortId: COHORT, messageId: uuid(142) });
    else expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('a closed coach chat draws no SpaceTree coach row, so no tap exists (SpaceTree.tsx:67-69)', async () => {
    const row: Row = {
      id: 'F-neg', title: '', role: 'client', host: CLIENT_COMMUNITY_HOST,
      http: { ...HOME_HTTP, '/messages': { __withHeaders: true, headers: { 'x-conversation-closed': '1' }, data: {} } },
      screen: () => <CommunityHomeScreen />, tap: { testID: `space-row-${COHORT}` }, expected: opens('x'),
    };
    const view = await renderRow(row);
    await waitFor(() => expect(view.getByTestId(`space-row-${COHORT}`)).toBeTruthy());
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/messages?limit=1'));
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(view.queryByTestId('space-row-coach')).toBeNull();
  });
});

// ─── Completeness guards ─────────────────────────────────────────────────────────────────────────────────────────────

const notInTable = (missing: string[]) => {
  if (missing.length > 0) throw new Error(`not in the row table: ${missing.join(', ')}`);
};
const rowIds = new Set(ROWS.map((r) => r.id));

describe('completeness guards', () => {
  it('every COACH_INBOX_ROW_KINDS value has a row under each row type the mapper lets through', () => {
    const seen = new Set<string>();
    for (const row of ROWS) {
      const page = row.http['/community/me/coach-inbox'] as { items?: { type: string; kind: string }[] } | undefined;
      for (const item of page?.items ?? []) seen.add(`${item.type}:${item.kind}`);
    }
    // The server writes a post row with kind 'text' only (community-coach-inbox.service.ts:142-160); the mapper would pass others.
    const POST_NOT_SENT = new Set(['post:voice', 'post:photo']);
    // The row types come from the mapper's runtime gate, InboxRowWireSchema's type enum (coachCommunityApi.ts:644-658;
    // safeParse at :669 skips a row that fails). CoachInboxItemSchema (:131) holds the same enum text but is parsed
    // nowhere, so the slice starts at the wire schema, not at the first match.
    const api = fs.readFileSync(path.join(SRC, 'api/coachCommunityApi.ts'), 'utf8');
    const wireStart = api.indexOf('const InboxRowWireSchema');
    expect(wireStart).toBeGreaterThanOrEqual(0);
    const wire = api.slice(wireStart, api.indexOf('.passthrough()', wireStart));
    const typeEnum = wire.match(/type: z\.enum\(\[([^\]]*)\]\)/);
    expect(typeEnum).not.toBeNull();
    const rowTypes = [...(typeEnum?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(rowTypes.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const kind of COACH_INBOX_ROW_KINDS) {
      for (const type of rowTypes) {
        const combo = `${type}:${kind}`;
        if (!seen.has(combo) && !POST_NOT_SENT.has(combo)) missing.push(combo);
      }
    }
    notInTable(missing);
  });

  it('every COACH_MOD_TARGET_TYPES value has a row', () => {
    const seen = new Set<string>();
    for (const row of ROWS) {
      const list = row.http['/community/moderation/flagged'] as { items?: { target_type: string }[] } | undefined;
      for (const item of list?.items ?? []) seen.add(item.target_type);
    }
    notInTable(COACH_MOD_TARGET_TYPES.filter((t) => !seen.has(t)));
  });

  it('every search kind and SpaceTarget kind has a row', () => {
    const seenSearch = new Set<string>();
    for (const row of ROWS) {
      const search = row.http[`/community/workspaces/${WS}/search`] as { results?: { kind: string }[] } | undefined;
      for (const result of search?.results ?? []) seenSearch.add(result.kind);
    }
    notInTable(SEARCH_KINDS.filter((k) => !seenSearch.has(k)));

    const tree = fs.readFileSync(path.join(SRC, 'components/community/SpaceTree.tsx'), 'utf8');
    const union = tree.slice(tree.indexOf('export type SpaceTarget'), tree.indexOf('type IconName'));
    const kinds = [...union.matchAll(/kind: '(\w+)'/g)].map((m) => m[1]);
    // Every quoted name in each name: union, wherever it sits (a repeated capture group keeps only its last match).
    const routeNames = [...union.matchAll(/name: ([^;}]+)/g)].flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((q) => q[1]));
    const targetRow: Record<string, string> = { space: 'F1', coach: 'F2', Leaderboard: 'F3', CommunityClassroom: 'F4' };
    notInTable([...kinds.filter((k) => k !== 'route'), ...routeNames].filter((k) => !(k in targetRow) || !rowIds.has(targetRow[k])));
  });

  it('every file the universe search finds is a row surface or named outside with its reason', () => {
    const OUTSIDE: Record<string, string> = {
      'screens/community/CommunityThreadScreen.tsx': 'the comments under one post (rows inside one conversation)',
      'screens/community/CommunityDmThreadScreen.tsx': 'the bubbles of one DM thread (rows inside one conversation)',
      'screens/community/CommunityChallengeDetailScreen.tsx': 'one challenge\'s comments and leaderboard (rows inside one conversation)',
      // m#945: present once the space chat lands.
      'screens/community/CommunitySpaceChatScreen.tsx': 'the messages of one space chat (rows inside one conversation)',
      'screens/community/coach-dm/CoachDmThreadScreen.tsx': 'the bubbles of one coach DM thread (rows inside one conversation)',
    };
    const SURFACES: Record<string, string[]> = {
      'screens/community/CoachCommunityInboxScreen.tsx': ['A1', 'A2', 'A3', 'A4', 'A5'],
      'screens/community/CoachCommunityModerationScreen.tsx': ['B1', 'B2', 'B2p', 'B3', 'B4'],
      'screens/community/CoachCommunityCohortsScreen.tsx': ['C5'],
      'screens/community/CoachCommunityCohortDetailScreen.tsx': ['C6'],
      'screens/community/CoachCommunityEventsScreen.tsx': ['C7'],
      'screens/community/CommunitySpaceScreen.tsx': ['F5', 'F6', 'F7', 'W4'],
      'screens/community/CommunityDmListScreen.tsx': ['F8'],
      'screens/community/coach-dm/CoachDmListScreen.tsx': ['F8c'],
      'screens/community/CommunityFindScreen.tsx': ['F9', 'F10', 'F11', 'F12', 'F13a', 'F13b'],
      'screens/community/CommunityChallengesScreen.tsx': ['F14'],
      'screens/community/CommunityClassroomScreen.tsx': ['F15'],
      'screens/community/CommunityWearablePromptsScreen.tsx': ['W3'],
      'screens/notifications/NotificationCenterScreen.tsx': ['N1', 'N2', 'N2c', 'N2d', 'N3', 'N3c', 'N4', 'N5', 'N6', 'N7', 'N8', 'N8c'],
      'screens/coach/CoachInboxV2.tsx': ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'],
      'screens/coach/MessagesScreen.tsx': ['D8'],
      'screens/coach/command-center/InboxScreen.tsx': ['D9'],
      'screens/client/CommunityScreen.tsx': ['W1'],
      'screens/client/NotificationsScreen.tsx': ['W2'],
    };
    const listFiles = (dir: string): string[] =>
      fs.readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((e) => {
        if (e.name === '__tests__') return [];
        const rel = path.join(dir, e.name);
        return e.isDirectory() ? listFiles(rel) : /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
      });
    const universe = [
      ...listFiles('screens/community'),
      ...listFiles('components/community'),
      ...listFiles('screens/notifications'),
      ...['screens/coach/CoachInboxV2.tsx', 'screens/coach/MessagesScreen.tsx', 'screens/coach/command-center/InboxScreen.tsx', 'screens/client/MessagesInboxScreen.tsx', 'screens/client/CommunityScreen.tsx', 'screens/client/NotificationsScreen.tsx'],
    ].filter((f) => /FlatList|SectionList|FlashList/.test(fs.readFileSync(path.join(SRC, f), 'utf8')));
    expect(universe.length).toBeGreaterThanOrEqual(20);
    notInTable(universe.filter((f) => !(f in SURFACES) && !(f in OUTSIDE)));
    notInTable(Object.entries(SURFACES).filter(([f, ids]) => !universe.includes(f) || ids.some((id) => !rowIds.has(id))).map(([f]) => `${f} (stale surface or missing row)`));
    // MessagesInboxScreen is drawn without a list (universe line 2 of the brief): its rows are E1 to E5.
    expect(['E1', 'E2', 'E3', 'E4', 'E5'].every((id) => rowIds.has(id))).toBe(true);
  });
});
