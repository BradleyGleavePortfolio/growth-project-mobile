/**
 * REPORT-ANY-M (agent 203; owner #200-S4, his answer #201-E6 item 7: "when you press and hold ANY message, you should be
 * able to report that message"). A press and hold on every message a member sees opens the approved Report menu for that
 * place: on every SafetyMenu host the hold opens that item's own menu (the same sheet, the same rows and the same report
 * body as its •••); a client's past Roman chats hold to the room's menu (R4); the coaching chats and Roman's client room
 * hold to Report as before; the coach's own Roman room offers none (201-D1, v1.1). The space chat's hold sheet is
 * reportAnyM.space.test.tsx's.
 * The real screens with every switch on ([R27]); only the wire (services/api and the read calls each host's own suite
 * stands in), the device store, the theme, navigation and the signed-in person are stubbed. Names are made up.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { Alert, Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockGetClients = jest.fn();
jest.mock('../services/api', () => ({
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
jest.mock('../config/featureFlags', () => {
  const actual = jest.requireActual('../config/featureFlags');
  const on: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(actual.featureFlags)) on[k] = typeof v === 'boolean' ? true : v;
  return { ...actual, featureFlags: on };
});
jest.mock('../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ flags: new Proxy({}, { get: () => true }), isLoading: false, isError: false }),
}));
const mockTheme = () => {
  const tokens = jest.requireActual('../theme/tokens');
  return { colors: jest.requireActual('../constants/colors').default, tokens: tokens.default, semanticColors: tokens.lightTokens, colorScheme: 'light', isDark: false };
};
jest.mock('../theme/useTheme', () => ({ useTheme: () => mockTheme() }));
jest.mock('../theme/ThemeProvider', () => ({ useTheme: () => mockTheme(), LightTheme: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => {
  const Icon = () => null;
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon, MaterialCommunityIcons: Icon };
});
const mockDisk = new Map<string, string>();
jest.mock('../storage/mmkv', () => ({
  cacheStorage: {
    getString: (k: string) => mockDisk.get(k),
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
  prefsStorage: { getString: () => undefined, set: () => undefined, delete: () => undefined },
}));
jest.mock('../api/communityRealtime', () => new Proxy({ __esModule: true }, {
  get: (target, key) => (key in target ? target[key as keyof typeof target] : () => () => undefined),
}));
let mockUser: Record<string, unknown> | null = null;
jest.mock('../hooks/useCurrentUser', () => ({ ...jest.requireActual('../hooks/useCurrentUser'), useCurrentUser: () => mockUser }));
jest.mock('../hooks/useNetworkStatus', () => ({
  ...jest.requireActual('../hooks/useNetworkStatus'),
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
}));
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    ...jest.requireActual('@react-navigation/native'),
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, replace: jest.fn(), canGoBack: () => true, addListener: () => () => undefined, setOptions: () => undefined, getState: () => ({ routeNames: [] }) }),
    useRoute: () => ({ params: mockParams }),
    useFocusEffect: (cb: () => void | (() => void)) => R.useEffect(() => cb(), [cb]),
    useIsFocused: () => true,
  };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
// The read calls each host's own suite stands in (CommunityThreadScreen.test, CommunitySpaceScreen.test,
// CommunityChallengeDetailScreen.test, CommunityVoiceNoteDetail.test, CommunityWinsScreen.test); every send is real.
const mockReads = {
  getPost: jest.fn(), listComments: jest.fn(), listPosts: jest.fn(), listFeed: jest.fn(), getOne: jest.fn(),
  getChallenge: jest.fn(), listNotes: jest.fn(), getLeaderboard: jest.fn(), getFeed: jest.fn(),
};
jest.mock('../api/communityRemovedRows', () => {
  const actual = jest.requireActual('../api/communityRemovedRows');
  return {
    ...actual,
    removedRowsApi: {
      ...actual.removedRowsApi,
      getPost: (...a: unknown[]) => mockReads.getPost(...a),
      listComments: (...a: unknown[]) => mockReads.listComments(...a),
      listPosts: (...a: unknown[]) => mockReads.listPosts(...a),
    },
  };
});
jest.mock('../api/communityVoiceApi', () => {
  const actual = jest.requireActual('../api/communityVoiceApi');
  return {
    ...actual,
    communityVoiceApi: {
      ...actual.communityVoiceApi,
      listFeed: (...a: unknown[]) => mockReads.listFeed(...a),
      getOne: (...a: unknown[]) => mockReads.getOne(...a),
      remove: jest.fn(async () => ({ deleted: true })),
    },
  };
});
jest.mock('../api/communityChallengesApi', () => ({
  ...jest.requireActual('../api/communityChallengesApi'),
  communityChallengesApi: {
    getChallenge: (...a: unknown[]) => mockReads.getChallenge(...a),
    listComments: (...a: unknown[]) => mockReads.listNotes(...a),
    getLeaderboard: (...a: unknown[]) => mockReads.getLeaderboard(...a),
    join: jest.fn(), updateProgress: jest.fn(), setLeaderboardOptIn: jest.fn(), addComment: jest.fn(), reportComment: jest.fn(),
  },
}));
jest.mock('../api/communityWinsApi', () => ({
  ...jest.requireActual('../api/communityWinsApi'),
  communityWinsApi: { getFeed: (...a: unknown[]) => mockReads.getFeed(...a), postWin: jest.fn(), deleteWin: jest.fn(async () => undefined) },
}));
jest.mock('../hooks/useVoiceOutbox', () => ({ useVoiceOutbox: () => ({ items: [], online: true, send: jest.fn(), retry: jest.fn(), discard: jest.fn() }) }));
// The player stands in with its own play button (a tap on play still plays: its own pressable keeps the touch).
const mockPlay = jest.fn();
jest.mock('../components/community/VoiceNotePlayer', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { testID: string; durationMs: number }) => (
    <Pressable onPress={mockPlay} accessibilityRole="button" accessibilityLabel="Play voice note" testID={p.testID}>
      <Text>{`voice note ${p.durationMs}`}</Text>
    </Pressable>
  ) };
});
// Roman's rooms (RomanHold197.test's stand-ins: the chat hook, the coachless gate, the face, support, consent).
const mockUseRomanChat = jest.fn();
jest.mock('../screens/roman/useRomanChat', () => ({ useRomanChat: (s: unknown) => mockUseRomanChat(s) }));
jest.mock('../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('../components/roman/RomanAvatar', () => () => null);
jest.mock('../components/ai/useOpenSupport', () => ({ useOpenSupport: () => jest.fn() }));
jest.mock('../components/roman/RomanConsentGate', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn(async () => undefined) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const { HapticService } = require('../ui/haptics/haptics.service');
const { authEvents } = require('../utils/authEvents');
const { authEpoch } = require('../services/accountBinding');
const { useBlockedUsersStore } = require('../store/blockedUsersStore');
const { resetReportedVoiceNotes, markVoiceNoteReported } = require('../components/community/VoiceReportedFold');
const { VOICE_NOTE_HEARD_LINE } = require('../components/community/SafetyMenu');
const CommunityDmThreadScreen = require('../screens/community/CommunityDmThreadScreen').default;
const CoachDmThreadScreen = require('../screens/community/coach-dm/CoachDmThreadScreen').default;
const CommunityThreadScreen = require('../screens/community/CommunityThreadScreen').default;
const CommunityChallengeDetailScreen = require('../screens/community/CommunityChallengeDetailScreen').default;
const CommunitySpaceScreen = require('../screens/community/CommunitySpaceScreen').default;
const VoiceNotesSection = require('../components/community/VoiceNotesSection').default;
const CommunityVoiceNoteDetail = require('../screens/community/CommunityVoiceNoteDetail').default;
const CommunityScreen = require('../screens/client/CommunityScreen').default;
const RomanConversationScreen = require('../screens/settings/RomanConversationScreen').default;
const RomanChatScreen = require('../screens/roman/RomanChatScreen').default;
const { NavigationContext } = require('@react-navigation/native');
/* eslint-enable @typescript-eslint/no-var-requires */

// ─── People, places and the wire ──────────────────────────────────────────────────────────────────────────────────
const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1);
const CLIENT = uuid(10);
const COACH = uuid(20);
const FORMER = uuid(21); // a coach she had before, not her coach now
const MEMBER = uuid(30);
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const REPORTS = '/community/moderation/reports';
const SPAM = 'Spam or scams'; // a reason, tapped by its app label
const meAnswer = (role = 'client') => ({
  feature_flag_state: 'enabled', workspace_id: WS,
  membership: role === 'none' ? null : { id: uuid(40), role, notify_level: 'live', dm_enabled_effective: true, last_read_message_at: null, joined_at: ago(86_400_000) },
  unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  flags: { community_api: true, community_dm: true, community_realtime: false, community_push: true, community_telemetry: false },
});
const dmUrl = (other: string) => `/community/workspaces/${WS}/dms/${other}/messages`;
const dm = (n: number, from: string, to: string, body: string, at = ago(60_000)) => ({
  id: uuid(n), thread_id: `${WS}:${[from, to].sort().join(':')}`, sender_user_id: from, recipient_user_id: to, body, created_at: at, deleted: false,
});
const axiosErr = (status: number) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data: { error: 'not_found' } } });
function serve(http: Record<string, unknown>) {
  mockGet.mockImplementation(async (url: string) => {
    const key = url.split('?')[0];
    if (!(key in http)) throw axiosErr(404);
    return { data: http[key], headers: {} };
  });
}
const reportsSent = () => mockPost.mock.calls.filter(([u]) => u === REPORTS).map(([, body]) => body);

let qc: QueryClient;
const nav = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => () => undefined), setOptions: jest.fn() };
const mount = (el: React.ReactElement) => render(
  <NavigationContext.Provider value={nav}><QueryClientProvider client={qc}>{el}</QueryClientProvider></NavigationContext.Provider>,
);
type View = Awaited<ReturnType<typeof render>>;

// ─── One rule, two doors: the rows a sheet shows, by the •••, then by the hold ─────────────────────────────────────
const ROWS = ['report', 'reported', 'block', 'remove', 'delete'] as const;
const rowsOf = (v: View, tid: string) => ROWS.filter((r) => v.queryByTestId(`${tid}-${r}`) !== null);
const sheetUp = (v: View, tid: string) => v.queryByTestId(`${tid}-sheet`) !== null;
const close = async (v: View, tid: string) => {
  await fireEvent.press(v.getByTestId(`${tid}-close`));
  expect(sheetUp(v, tid)).toBe(false);
};
/** The •••'s rows, then the hold's rows on the element a finger lands on (the words, the bubble, the card). */
async function bothDoors(v: View, tid: string, finger: () => ReturnType<View['getByText']>) {
  await fireEvent.press(v.getByTestId(tid));
  expect(sheetUp(v, tid)).toBe(true);
  const dots = rowsOf(v, tid);
  await close(v, tid);
  await fireEvent(finger(), 'longPress');
  expect(sheetUp(v, tid)).toBe(true);
  const hold = rowsOf(v, tid);
  await close(v, tid);
  return { dots, hold };
}
/** Report, then a reason, from the door named; the report bodies sent. */
async function reportBy(v: View, tid: string, door: 'dots' | 'hold', finger: () => ReturnType<View['getByText']>) {
  mockPost.mockClear();
  if (door === 'dots') await fireEvent.press(v.getByTestId(tid));
  else await fireEvent(finger(), 'longPress');
  await fireEvent.press(v.getByTestId(`${tid}-report`));
  await fireEvent.press(within(v.getByTestId(`${tid}-sheet`)).getByLabelText(SPAM));
  await waitFor(() => expect(reportsSent()).toHaveLength(1));
  return reportsSent();
}
/** A long press on an element with no ••• beside it: no sheet anywhere, no haptic. */
async function holdsNothing(v: View, finger: () => ReturnType<View['getByText']>) {
  tap.mockClear();
  await fireEvent(finger(), 'longPress');
  expect(v.queryAllByTestId(/-sheet$/)).toHaveLength(0);
  expect(tap).not.toHaveBeenCalled();
}

const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
let alert: jest.SpyInstance;
let tap: jest.SpyInstance;
beforeEach(() => {
  setOS('android'); // the follow-up alerts come at once; SC7 and SC8 drive iOS's onDismiss order
  mockGet.mockReset();
  mockPost.mockReset().mockResolvedValue({ data: {}, headers: {} });
  mockGetClients.mockReset().mockResolvedValue({ data: [] });
  mockNavigate.mockReset();
  mockGoBack.mockReset();
  mockPlay.mockReset();
  mockDisk.clear();
  Object.values(mockReads).forEach((f) => f.mockReset());
  resetReportedVoiceNotes();
  useBlockedUsersStore.setState({ blocked: [] });
  mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: COACH };
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  tap = jest.spyOn(HapticService, 'mediumImpact');
});
afterEach(() => {
  setOS(realOS);
  alert.mockRestore();
  tap.mockRestore();
  qc.clear();
});

// ─── H6: a member's direct messages ────────────────────────────────────────────────────────────────────────────────
describe('H6 DM1-DM3: a member\'s direct message thread', () => {
  const thread = (other: string, words: string, mine: string) => [dm(901, other, CLIENT, words), dm(900, CLIENT, other, mine, ago(120_000))];
  const open = async (other: string, words: string, mine = 'On my way') => {
    serve({ '/community/me': meAnswer(), '/v1/clients/me/coach': { id: COACH, name: 'Alex Morgan' }, [dmUrl(other)]: { messages: thread(other, words, mine) } });
    mockParams = { recipientId: other, participantLabel: other === COACH ? undefined : 'Jo Park' };
    const v = await mount(<CommunityDmThreadScreen />);
    await v.findByText(words);
    return v;
  };

  it('DM1 ONE-MENU: holding her coach\'s message opens that message\'s ••• sheet: Report, no Block (never her coach); one medium tap', async () => {
    const v = await open(COACH, 'Keep Friday easy.');
    const tid = `dm-message-safety-${uuid(901)}`;
    const { dots, hold } = await bothDoors(v, tid, () => v.getByText('Keep Friday easy.'));
    expect(dots).toEqual(['report']);
    expect(hold).toEqual(dots);
    expect(tap).toHaveBeenCalledTimes(1);
  });

  it('DM1 ONE-MENU: holding another member\'s message opens its ••• sheet: Report and Block Jo Park', async () => {
    const v = await open(MEMBER, 'See you at the track');
    const tid = `dm-message-safety-${uuid(901)}`;
    const { dots, hold } = await bothDoors(v, tid, () => v.getByText('See you at the track'));
    expect(dots).toEqual(['report', 'block']);
    expect(hold).toEqual(dots);
    await fireEvent(v.getByText('See you at the track'), 'longPress');
    expect(within(v.getByTestId(`${tid}-sheet`)).getByLabelText('Block Jo Park')).toBeTruthy();
  });

  it('DM1 ONE-MENU: a former coach (not her coach now) is any member here: Report and Block, by either door', async () => {
    const v = await open(FORMER, 'Good luck with the new plan');
    const tid = `dm-message-safety-${uuid(901)}`;
    const { dots, hold } = await bothDoors(v, tid, () => v.getByText('Good luck with the new plan'));
    expect(dots).toEqual(['report', 'block']);
    expect(hold).toEqual(dots);
  });

  it('DM1: Report from the hold sends exactly the body the ••• sends: that message, the reason, nothing else', async () => {
    const v = await open(MEMBER, 'See you at the track');
    const tid = `dm-message-safety-${uuid(901)}`;
    const finger = () => v.getByText('See you at the track');
    const byDots = await reportBy(v, tid, 'dots', finger);
    const byHold = await reportBy(v, tid, 'hold', finger);
    expect(byHold).toEqual([{ target_type: 'message', target_id: uuid(901), reason: 'spam' }]);
    expect(byHold).toEqual(byDots);
    expect(alert).toHaveBeenLastCalledWith('Report sent', expect.any(String));
  });

  it('DM2: her own message has no ••• and holds nothing', async () => {
    const v = await open(MEMBER, 'See you at the track', 'Running late today');
    await holdsNothing(v, () => v.getByText('Running late today'));
  });

  it('DM3: the header ••• is unchanged: it opens its own sheet for the newest message from the other person', async () => {
    const v = await open(MEMBER, 'See you at the track');
    await fireEvent.press(v.getByTestId('community-dmthread-safety'));
    expect(rowsOf(v, 'community-dmthread-safety')).toEqual(['report', 'block']);
    await fireEvent.press(v.getByTestId('community-dmthread-safety-report'));
    await fireEvent.press(within(v.getByTestId('community-dmthread-safety-sheet')).getByLabelText(SPAM));
    await waitFor(() => expect(reportsSent()).toEqual([{ target_type: 'message', target_id: uuid(901), reason: 'spam' }]));
  });

  it('A11Y: with the hold bound, the message\'s words and its ••• are each still reached, the ••• with its own label', async () => {
    const v = await open(MEMBER, 'See you at the track');
    expect(v.getByText('See you at the track')).toBeTruthy(); // not hidden from a screen reader
    expect(within(v.getByTestId(`dm-cell-${uuid(901)}`)).getByLabelText('Report or block Jo Park')).toBeTruthy();
    // Where a hold is bound, its element is not one accessible element (it would fold the words into one stop).
    let n = v.getByText('See you at the track').parent;
    while (n && typeof n.props.onLongPress !== 'function') n = n.parent;
    if (n) expect(n.props.accessible).toBe(false);
  });
});

// ─── H7: the coach's direct message with a client ──────────────────────────────────────────────────────────────────
describe('H7 CD1: the coach\'s direct message with a client', () => {
  const JORDAN = uuid(31);
  const open = async () => {
    mockUser = { id: COACH, role: 'coach', name: 'Sam Rivera', firstName: 'Sam', coach_id: null };
    serve({ '/community/me': meAnswer('none'), [`/community/workspaces/${WS}/dms`]: { threads: [] },
      [dmUrl(JORDAN)]: { messages: [dm(911, JORDAN, COACH, 'Can we move Monday?'), dm(910, COACH, JORDAN, 'Sure thing', ago(120_000))] } });
    mockParams = { recipientId: JORDAN, name: 'Jordan Lee' };
    const v = await mount(<CoachDmThreadScreen />);
    await v.findByText('Can we move Monday?');
    return v;
  };

  it('CD1 ONE-MENU: holding the client\'s message opens its ••• sheet (Report, Block Jordan) and reports the same body', async () => {
    const v = await open();
    const tid = `coach-dm-message-safety-${uuid(911)}`;
    const finger = () => v.getByText('Can we move Monday?');
    const { dots, hold } = await bothDoors(v, tid, finger);
    expect(dots).toEqual(['report', 'block']);
    expect(hold).toEqual(dots);
    expect(await reportBy(v, tid, 'hold', finger)).toEqual(await reportBy(v, tid, 'dots', finger));
  });

  it('CD1: his own message holds nothing', async () => {
    const v = await open();
    await holdsNothing(v, () => v.getByText('Sure thing'));
  });
});

// ─── H9: a post and its replies ──────────────────────────────────────────────────────────────────────────────────
describe('H9 TH1-TH2: a post and its replies', () => {
  const POST = uuid(50);
  const post = (author: string) => ({
    id: POST, workspace_id: WS, cohort_id: null, author_user_id: author, author_name: author === CLIENT ? 'Dana Cruz' : 'Jo Park',
    title: 'Hill sprints', body: 'Six by thirty seconds', scope: 'hall', type: 'text', pinned: false, created_at: ago(7_200_000), updated_at: ago(7_200_000), deleted: false,
  });
  const reply = (n: number, author: string, body: string | null, extra: Record<string, unknown> = {}) => ({
    id: uuid(n), post_id: POST, author_user_id: author, author_name: 'Jo Park', body, created_at: ago(3_600_000), updated_at: ago(3_600_000), deleted: false, ...extra,
  });
  const open = async (author: string, replies: unknown[] = []) => {
    serve({ '/community/me': meAnswer() });
    mockReads.getPost.mockResolvedValue(post(author));
    mockReads.listComments.mockResolvedValue(replies);
    mockParams = { postId: POST };
    const v = await mount(<CommunityThreadScreen />);
    await v.findByText('Hill sprints');
    return v;
  };

  it('TH1 ONE-MENU: holding another member\'s post (its title or its words) opens the post\'s ••• sheet', async () => {
    const v = await open(MEMBER);
    const tid = 'community-thread-post-safety';
    const byTitle = await bothDoors(v, tid, () => v.getByText('Hill sprints'));
    expect(byTitle.dots).toEqual(['report', 'block']);
    expect(byTitle.hold).toEqual(byTitle.dots);
    const byWords = await bothDoors(v, tid, () => v.getByText('Six by thirty seconds'));
    expect(byWords.hold).toEqual(byWords.dots);
    expect(await reportBy(v, tid, 'hold', () => v.getByText('Hill sprints'))).toEqual([{ target_type: 'post', target_id: POST, reason: 'spam' }]);
  });

  it('TH1 ONE-MENU: her own post holds to its ••• sheet too: Delete post only', async () => {
    const v = await open(CLIENT);
    const { dots, hold } = await bothDoors(v, 'community-thread-post-safety', () => v.getByText('Hill sprints'));
    expect(dots).toEqual(['delete']);
    expect(hold).toEqual(dots);
  });

  it('TH2 ONE-MENU: holding a reply opens its ••• sheet; a reply the coach removed holds nothing', async () => {
    const v = await open(MEMBER, [
      reply(61, MEMBER, 'Count me in'),
      reply(62, MEMBER, null, { deleted: true, removed_at: ago(1_000), removed_by: { role: 'coach', user_id: COACH, name: 'Alex Morgan' } }),
    ]);
    await v.findByText('Count me in');
    const tid = `comment-safety-${uuid(61)}`;
    const { dots, hold } = await bothDoors(v, tid, () => v.getByText('Count me in'));
    expect(dots).toEqual(['report', 'block']);
    expect(hold).toEqual(dots);
    expect(await reportBy(v, tid, 'hold', () => v.getByText('Count me in'))).toEqual([{ target_type: 'comment', target_id: uuid(61), reason: 'spam' }]);
    expect(v.queryByTestId(`comment-safety-${uuid(62)}`)).toBeNull();
    await holdsNothing(v, () => v.getByTestId(`comment-removed-${uuid(62)}`));
  });

  it('A11Y: a held reply\'s words and its ••• are each still reached', async () => {
    const v = await open(MEMBER, [reply(61, MEMBER, 'Count me in')]);
    expect(await v.findByText('Count me in')).toBeTruthy();
    expect(v.getAllByLabelText('Report or block Jo Park').length).toBeGreaterThan(0);
  });
});

// ─── H10: challenge notes ────────────────────────────────────────────────────────────────────────────────────────
describe('H10 CH1: challenge notes', () => {
  const challenge = {
    id: 'ch-1', workspace_id: WS, cohort_id: 'co-1', created_by_user_id: COACH, title: 'March steps', description: 'Walk 100k steps.',
    status: 'active', starts_at: null, ends_at: null, metric_key: 'steps', target_value: 100000, unit: 'steps', leaderboard_enabled: false,
    created_at: ago(864_000_000), updated_at: ago(864_000_000), archived: false,
  };
  const note = (n: number, author: string, body: string) => ({ id: uuid(n), challenge_id: 'ch-1', author_user_id: author, body, created_at: ago(3_600_000), deleted: false });
  const open = async () => {
    mockUser = { id: CLIENT, firstName: 'Dana', name: 'Dana', coach_id: COACH };
    mockReads.getChallenge.mockResolvedValue({ challenge, participation: null });
    mockReads.listNotes.mockResolvedValue({ comments: [note(71, MEMBER, 'Nice pace everyone'), note(72, CLIENT, 'Day three done')], next_cursor: null });
    mockReads.getLeaderboard.mockResolvedValue({ available: true, opted_in: false, rows: [], next_cursor: null });
    mockParams = { challengeId: 'ch-1' };
    const v = await mount(<CommunityChallengeDetailScreen />);
    await v.findByText('Nice pace everyone');
    return v;
  };

  it('CH1 ONE-MENU: holding another member\'s note opens its ••• sheet and reports the same body', async () => {
    const v = await open();
    const tid = `community-challenge-comment-${uuid(71)}-safety`;
    const finger = () => v.getByText('Nice pace everyone');
    const { dots, hold } = await bothDoors(v, tid, finger);
    expect(dots).toEqual(['report', 'block']);
    expect(hold).toEqual(dots);
    expect(await reportBy(v, tid, 'hold', finger)).toEqual([{ target_type: 'comment', target_id: uuid(71), reason: 'spam' }]);
  });

  it('CH1: her own note (no Delete there) holds nothing', async () => {
    const v = await open();
    await holdsNothing(v, () => v.getByText('Day three done'));
  });
});

// ─── H11: the posts of a space ─────────────────────────────────────────────────────────────────────────────────────
describe('H11 SP1: the posts of a space', () => {
  const row = (id: string, author: string, title: string) => ({
    id, workspace_id: WS, cohort_id: null, author_user_id: author, title, body: 'Details inside', scope: 'hall', type: 'text', pinned: false,
    created_at: ago(3_600_000), updated_at: ago(3_600_000), deleted: false,
  });
  const open = async () => {
    serve({ '/community/me': meAnswer() });
    mockReads.listFeed.mockResolvedValue({ voice_notes: [], next_cursor: null });
    mockReads.listPosts.mockResolvedValue({ posts: [row(uuid(81), MEMBER, 'Saturday long run'), row(uuid(82), CLIENT, 'My first 10k'), row('optimistic:83', MEMBER, 'Sending this one')] });
    mockParams = {};
    const v = await mount(<CommunitySpaceScreen />);
    await v.findByText('Saturday long run');
    return v;
  };

  it('SP1 ONE-MENU: holding a post row opens its ••• sheet; a tap still opens the post', async () => {
    const v = await open();
    const tid = `post-safety-${uuid(81)}`;
    const { dots, hold } = await bothDoors(v, tid, () => v.getByText('Saturday long run'));
    expect(dots).toEqual(['report', 'block']);
    expect(hold).toEqual(dots);
    expect(mockNavigate).not.toHaveBeenCalled(); // a hold is not a tap
    await fireEvent.press(v.getByText('Saturday long run'));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('SP1: her own post (no ••• there) and a post still sending hold nothing', async () => {
    const v = await open();
    await holdsNothing(v, () => v.getByText('My first 10k'));
    await holdsNothing(v, () => v.getByText('Sending this one'));
  });
});

// ─── H12: voice notes ──────────────────────────────────────────────────────────────────────────────────────────────
describe('H12 VN1-VN2: voice notes, with the owner\'s line (R6, #ALM-E29)', () => {
  const NOTE = { id: 'vn-1', author_id: MEMBER, author_name: 'Jo Park', author_is_coach: false, url: 'https://signed.example/vn-1.m4a', duration_ms: 42_000, waveform_peaks: [0.2, 0.7], created_at: ago(3_600_000) };
  const section = async (role = 'client') => {
    serve({ '/community/me': meAnswer(role) });
    mockReads.listFeed.mockResolvedValue({ voice_notes: [NOTE], next_cursor: null });
    const v = await mount(<VoiceNotesSection workspaceId={WS} viewerUserId={CLIENT} viewerCoachId={COACH} />);
    await v.findByText('Jo Park');
    return v;
  };
  const tid = 'voice-notes-section-menu-vn-1';

  it('VN1 ONE-MENU: holding a voice note opens its ••• sheet with the note\'s card; a tap on play still plays', async () => {
    const v = await section();
    const { dots, hold } = await bothDoors(v, tid, () => v.getByText('Jo Park'));
    expect(dots).toEqual(['report', 'block']);
    expect(hold).toEqual(dots);
    await fireEvent.press(v.getByLabelText('Play voice note'));
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(v.queryByTestId(`${tid}-sheet`)).toBeNull();
  });

  it('VN-LINE VN1: the reasons step for a voice note says who can hear it, word for word, by the ••• and by the hold', async () => {
    const v = await section();
    for (const door of ['dots', 'hold'] as const) {
      if (door === 'dots') await fireEvent.press(v.getByTestId(tid));
      else await fireEvent(v.getByText('Jo Park'), 'longPress');
      await fireEvent.press(v.getByTestId(`${tid}-report`));
      expect(within(v.getByTestId(`${tid}-sheet`)).getByText(VOICE_NOTE_HEARD_LINE)).toBeTruthy();
      expect(VOICE_NOTE_HEARD_LINE).toBe('A reported voice note can be heard by your coach and the TGP team.');
      await close(v, tid);
    }
    expect(await reportBy(v, tid, 'hold', () => v.getByText('Jo Park'))).toEqual([{ target_type: 'voice_note', target_id: 'vn-1', reason: 'spam' }]);
  });

  it('VN1 ONE-MENU: once reported the hold shows "Reported" and Block, as the ••• does; the coach also gets Remove', async () => {
    markVoiceNoteReported('vn-1');
    const v = await section();
    const reported = await bothDoors(v, tid, () => v.getByText('Jo Park'));
    expect(reported.dots).toEqual(['reported', 'block']);
    expect(reported.hold).toEqual(reported.dots);
    await v.unmount();
    resetReportedVoiceNotes();
    qc.clear();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
    const coach = await section('coach');
    const coachRows = await bothDoors(coach, tid, () => coach.getByText('Jo Park'));
    expect(coachRows.dots).toEqual(['report', 'block', 'remove']);
    expect(coachRows.hold).toEqual(coachRows.dots);
  });

  it('VN2 ONE-MENU and VN-LINE: the note\'s own page holds to its ••• sheet, the line in the reasons', async () => {
    serve({ '/community/me': meAnswer() });
    mockReads.getOne.mockResolvedValue(NOTE);
    mockParams = { voiceNoteId: 'vn-1' };
    const v = await mount(<CommunityVoiceNoteDetail />);
    await v.findByText('Jo Park');
    const dtid = 'community-voice-detail-safety';
    const { dots, hold } = await bothDoors(v, dtid, () => v.getByText('Jo Park'));
    expect(dots).toEqual(['report', 'block']);
    expect(hold).toEqual(dots);
    await fireEvent(v.getByText('Jo Park'), 'longPress');
    await fireEvent.press(v.getByTestId(`${dtid}-report`));
    expect(within(v.getByTestId(`${dtid}-sheet`)).getByText(VOICE_NOTE_HEARD_LINE)).toBeTruthy();
  });

  it('VN-LINE: a text report shows no voice note line', async () => {
    serve({ '/community/me': meAnswer(), '/v1/clients/me/coach': { id: COACH, name: 'Alex Morgan' }, [dmUrl(MEMBER)]: { messages: [dm(901, MEMBER, CLIENT, 'See you at the track')] } });
    mockParams = { recipientId: MEMBER, participantLabel: 'Jo Park' };
    const v = await mount(<CommunityDmThreadScreen />);
    await fireEvent(await v.findByText('See you at the track'), 'longPress');
    await fireEvent.press(v.getByTestId(`dm-message-safety-${uuid(901)}-report`));
    expect(v.queryByText(VOICE_NOTE_HEARD_LINE)).toBeNull();
  });
});

// ─── H13: wins ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe('H13 W1: wins', () => {
  const win = (id: string, userId: string, name: string, title: string, isMine = false) => ({ id, userId, displayName: name, title, description: 'Felt strong', createdAt: ago(3_600_000), isMine });
  const open = async () => {
    mockUser = { id: CLIENT, name: 'Dana Cruz', coach_id: COACH };
    serve({ '/community/safety/notices': { notices: [] } });
    mockReads.getFeed.mockResolvedValue([win('w-1', MEMBER, 'Jo Park', 'Deadlift best'), win('w-2', CLIENT, 'Dana Cruz', 'Seven day streak', true)]);
    const v = await mount(<CommunityScreen />);
    await v.findByText('Deadlift best');
    return v;
  };

  it('W1 ONE-MENU: holding another member\'s win opens its ••• sheet and reports the same body', async () => {
    const v = await open();
    const tid = 'win-menu-w-1';
    const finger = () => v.getByText('Deadlift best');
    const { dots, hold } = await bothDoors(v, tid, finger);
    expect(dots).toEqual(['report', 'block']);
    expect(hold).toEqual(dots);
    expect(await reportBy(v, tid, 'hold', finger)).toEqual([{ target_type: 'win', target_id: 'w-1', reason: 'spam' }]);
  });

  it('W1 ONE-MENU: her own win holds to Delete win only, as its •••', async () => {
    const v = await open();
    const { dots, hold } = await bothDoors(v, 'win-menu-w-2', () => v.getByText('Seven day streak'));
    expect(dots).toEqual(['delete']);
    expect(hold).toEqual(dots);
  });
});

// ─── H3, H4: Roman's rooms (unchanged); H5: a client's past Roman chats (R4) ───────────────────────────────────────
describe('H3, H4: Roman\'s rooms are unchanged', () => {
  const REPLY = 'Keep Thursday easy: a 30-minute ride.';
  beforeEach(() => {
    mockUser = { id: 'client-1', firstName: 'Maya' };
    mockUseRomanChat.mockImplementation(() => ({
      phase: 'ready', session: null, isFirstOpen: false, sending: false, sendError: null, nextCursor: null, loadingOlder: false,
      messages: [
        { id: 'u-1', role: 'user', content: 'Swap my run for a ride?', interrupted: false, createdAt: '2026-11-06T10:00:00Z' },
        { id: 'r-1', role: 'assistant', content: REPLY, interrupted: false, createdAt: '2026-11-06T10:00:05Z' },
      ],
      reload: jest.fn(), loadOlder: jest.fn(), clearSendError: jest.fn(), send: jest.fn(async () => 'sent'),
    }));
  });

  it('H3: in her own Roman room a hold on Roman\'s reply offers Report Message; her own turn offers none', async () => {
    const v = await mount(<RomanChatScreen surface="client" />);
    await act(async () => { fireEvent(v.getByTestId('roman-message-u-1-bubble'), 'longPress'); });
    expect(v.queryByLabelText('Report Message')).toBeNull();
    await act(async () => { fireEvent(v.getByTestId('roman-message-r-1-reply'), 'longPress'); });
    expect(v.getByLabelText('Report Message')).toBeTruthy();
  });

  it('H4: the coach\'s own Roman room offers no menu (201-D1, v1.1: including it later is a deliberate change)', async () => {
    mockUser = { id: COACH, firstName: 'Sam', role: 'coach' };
    const v = await mount(<RomanChatScreen surface="coach" />);
    await act(async () => { fireEvent(v.getByTestId('roman-message-r-1-reply'), 'longPress'); });
    expect(v.queryByLabelText('Report Message')).toBeNull();
    expect(v.queryByLabelText('Copy')).toBeNull();
  });
});

describe('H5: a past conversation with Roman (R4)', () => {
  const ROMAN = 'Yes, keep it easy and stay hydrated.';
  const history = async (surface: 'client' | 'coach') => {
    const api = {
      list: jest.fn(),
      readMessages: jest.fn(async () => ({ ok: true as const, value: { messages: [
        { id: 'm2', role: 'assistant', content: ROMAN, interrupted: false, createdAt: '2026-10-01T08:00:05.000Z' },
        { id: 'm1', role: 'user', content: 'Can I swap my run?', interrupted: false, createdAt: '2026-10-01T08:00:00.000Z' },
      ], nextCursor: null } })),
      deleteOne: jest.fn(), deleteAll: jest.fn(),
    };
    const params = { id: 'cx1', ownerId: 'user-a', binding: { subject: 'sub:user-a', epoch: authEpoch() }, startedAt: '2026-10-01T08:00:00.000Z', surface, messageCount: 2 };
    const v = await mount(<RomanConversationScreen navigation={nav as never} route={{ params }} api={api as never} sessionUserId={() => 'user-a'} />);
    await v.findByLabelText(`Roman said: ${ROMAN}`);
    return v;
  };
  const holdRoman = async (v: View) => { await act(async () => { fireEvent(v.getByTestId('roman-transcript-message-m2-reply'), 'longPress'); }); };

  it('H5 client: holding Roman\'s turn offers Copy and Report Message (no Reply: a past chat takes none)', async () => {
    const v = await history('client');
    expect(v.getByText('Past conversations are read only.')).toBeTruthy(); // a report is not a reply: the caption stays
    expect(v.queryByLabelText('Report Message')).toBeNull();
    await holdRoman(v);
    expect(v.getByLabelText('Copy')).toBeTruthy();
    expect(v.getByLabelText('Report Message')).toBeTruthy();
    expect(v.queryByLabelText('Reply')).toBeNull();
  });

  it('H5 client: Report Message sends one report for that turn, then the room\'s "Reported"', async () => {
    mockPost.mockResolvedValue({ data: { reportId: 'rep-1', status: 'received' }, headers: {} });
    const v = await history('client');
    await holdRoman(v);
    await act(async () => { fireEvent.press(v.getByLabelText('Report Message')); });
    await act(async () => { fireEvent.press(v.getByLabelText('Spam')); });
    await act(async () => { fireEvent.press(v.getByLabelText('Submit report')); });
    const sent = mockPost.mock.calls.filter(([u]) => String(u).startsWith('/roman/messages/'));
    expect(sent).toEqual([['/roman/messages/m2/report', { reason: 'spam', details: undefined }]]);
    expect(alert).toHaveBeenCalledWith('Reported', 'Your report has been submitted.');
  });

  it('H5 client: a sign-out between the send and its answer closes the sheets and says nothing', async () => {
    let answer: (v: unknown) => void = () => undefined;
    mockPost.mockImplementation((u: string) => (String(u).startsWith('/roman/') ? new Promise((res) => { answer = res; }) : Promise.resolve({ data: {} })));
    const v = await history('client');
    await holdRoman(v);
    await act(async () => { fireEvent.press(v.getByLabelText('Report Message')); });
    await act(async () => { fireEvent.press(v.getByLabelText('Spam')); });
    await act(async () => { fireEvent.press(v.getByLabelText('Submit report')); });
    await act(async () => { authEvents.emit('logout'); });
    await act(async () => { answer({ data: { reportId: 'rep-1', status: 'received' } }); });
    expect(alert).not.toHaveBeenCalledWith('Reported', expect.anything());
    expect(v.queryByLabelText('Submit report')).toBeNull();
    expect(v.queryByLabelText('Report Message')).toBeNull();
  });

  it('H5 client: a sign-out with the menu up closes it; the chat is gone and nothing can be reported', async () => {
    const v = await history('client');
    await holdRoman(v);
    expect(v.getByLabelText('Report Message')).toBeTruthy();
    await act(async () => { authEvents.emit('logout'); });
    expect(v.queryByLabelText('Report Message')).toBeNull();
    expect(v.queryByLabelText(`Roman said: ${ROMAN}`)).toBeNull();
    expect(mockPost.mock.calls.filter(([u]) => String(u).startsWith('/roman/'))).toEqual([]);
  });

  it('H5 coach: a coach\'s past Roman chat keeps no hold (201-D1)', async () => {
    const v = await history('coach');
    await holdRoman(v);
    expect(v.queryByLabelText('Report Message')).toBeNull();
    expect(v.queryByLabelText('Copy')).toBeNull();
  });
});

// ─── WALK: every SafetyMenu host binds the one hold helper ─────────────────────────────────────────────────────────
describe('WALK: every file that draws SafetyMenu binds the shared hold on the same item', () => {
  const SRC = path.resolve(__dirname, '..');
  // SpaceChatRow's hold is the screen's sheet (SC1); the space chat screen's own SafetyMenu is the report menu that
  // sheet opens (no •••, SC7). The DM thread's header menu (DM3) sits in a file that binds the hold on its messages.
  const NAMED = new Set(['components/community/space-chat/SpaceChatRow.tsx', 'screens/community/CommunitySpaceChatScreen.tsx']);
  const DEFINES = new Set(['components/community/SafetyMenu.tsx', 'components/community/SafetyHold.tsx']);
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' || d.name === 'node_modules' ? [] : walk(p);
    return /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [p] : [];
  });
  it('each one uses useSafetyHolds, binds the hold and hands each SafetyMenu its handle, or is one of the two named exceptions', () => {
    const hosts = walk(SRC).map((f) => [path.relative(SRC, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')] as const)
      .filter(([rel, text]) => !DEFINES.has(rel) && /<SafetyMenu\b/.test(text));
    expect(hosts.length).toBeGreaterThanOrEqual(10);
    // The helper, each menu's handle and the hold itself on the item (a SafetyHold or the item's own pressable).
    const binds = (text: string) => /useSafetyHolds\(\)/.test(text) && /\bholds\.hold\(/.test(text)
      && /<SafetyMenu[^>]*\bref=\{holds\.menu\(/.test(text.replace(/\n\s*/g, ' '));
    const missing = hosts.filter(([rel, text]) => !NAMED.has(rel) && !binds(text));
    expect(missing.map(([rel]) => rel)).toEqual([]);
  });
});
