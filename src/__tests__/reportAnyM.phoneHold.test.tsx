/**
 * FIX-RAM-1 (fix round 1 on m#1025 REPORT-ANY-M; owner #200-S4: "when you press and hold ANY message, you should be able
 * to report that message"). Every hold pressed as a phone presses it: userEvent gives the touch to the nearest touchable
 * under the finger, so a hold bound on a wrapper around an inner pressable does not count (the build's trap 1, LS-RAM-1
 * B1). The real voice feed, the real note page, the real player on a fake playback port and the real SafetyMenu; the
 * wire, the device store, the theme, navigation and the signed-in person are stood in as reportAnyM.hold.test.tsx does.
 *   PH1 to PH3: a voice note's card holds to its Report menu wherever the finger lands, and a tap keeps its job.
 *   PH4: every other hold site, pressed as a phone.  SP2: her own space post opens on a slow press.
 *   VN-LINE2: the owner's voice note line for a client viewer only.  EXC: the transcript inside the note's hold.
 *   RE2: her own reply carries no hold.  Names and ids are made up.
 */
import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, userEvent, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockOnline = { feed: true, page: true };

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
  useNetworkStatus: () => ({ isOnline: mockOnline.page, isInternetReachable: mockOnline.page }),
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
jest.mock('../hooks/useVoiceOutbox', () => ({ useVoiceOutbox: () => ({ items: [], online: mockOnline.feed, send: jest.fn(), retry: jest.fn(), discard: jest.fn() }) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const { HapticService } = require('../ui/haptics/haptics.service');
const { registerVoicePlayback } = require('../components/community/voicePlaybackPort');
const { resetReportedVoiceNotes, markVoiceNoteReported } = require('../components/community/VoiceReportedFold');
const { VOICE_NOTE_HEARD_LINE } = require('../components/community/SafetyMenu');
const { useBlockedUsersStore } = require('../store/blockedUsersStore');
const VoiceNotePlayer = require('../components/community/VoiceNotePlayer').default;
const VoiceNotesSection = require('../components/community/VoiceNotesSection').default;
const CommunityVoiceNoteDetail = require('../screens/community/CommunityVoiceNoteDetail').default;
const CommunityDmThreadScreen = require('../screens/community/CommunityDmThreadScreen').default;
const CoachDmThreadScreen = require('../screens/community/coach-dm/CoachDmThreadScreen').default;
const CommunityThreadScreen = require('../screens/community/CommunityThreadScreen').default;
const CommunityChallengeDetailScreen = require('../screens/community/CommunityChallengeDetailScreen').default;
const CommunitySpaceScreen = require('../screens/community/CommunitySpaceScreen').default;
const CommunityScreen = require('../screens/client/CommunityScreen').default;
const { NavigationContext } = require('@react-navigation/native');
/* eslint-enable @typescript-eslint/no-var-requires */

// ─── People, places, the wire and the playback port ───────────────────────────────────────────────────────────────
const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(1);
const CLIENT = uuid(10);
const COACH = uuid(20);
const MEMBER = uuid(30);
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
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
const play = jest.fn(async () => undefined);
const pause = jest.fn(async () => undefined);
const seek = jest.fn(async () => undefined);
const port = () => ({ isAvailable: true, load: jest.fn(async () => ({ play, pause, seek, unload: jest.fn(async () => undefined) })) });

let qc: QueryClient;
const nav = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => () => undefined), setOptions: jest.fn() };
const mount = (el: React.ReactElement) => render(
  <NavigationContext.Provider value={nav}><QueryClientProvider client={qc}>{el}</QueryClientProvider></NavigationContext.Provider>,
);
type View = Awaited<ReturnType<typeof render>>;
type Finger = () => ReturnType<View['getByText']>;
const ROWS = ['report', 'reported', 'block', 'remove', 'delete'] as const;
const rowsOf = (v: View, tid: string) => ROWS.filter((r) => v.queryByTestId(`${tid}-${r}`) !== null);
const sheetUp = (v: View, tid: string) => v.queryByTestId(`${tid}-sheet`) !== null;
const close = async (v: View, tid: string) => {
  await fireEvent.press(v.getByTestId(`${tid}-close`));
  expect(sheetUp(v, tid)).toBe(false);
};
/** Lets a tap's play or seek (each async) land before a case says it did not happen. */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
/** The •••'s rows; then a hold made as a phone makes it, on the element a finger lands on. */
async function dotsThenHold(v: View, tid: string, finger: Finger) {
  await fireEvent.press(v.getByTestId(tid));
  const dots = rowsOf(v, tid);
  await close(v, tid);
  await userEvent.setup().longPress(finger(), { duration: 600 });
  expect(sheetUp(v, tid)).toBe(true);
  const hold = rowsOf(v, tid);
  await close(v, tid);
  return { dots, hold };
}
/** The reasons step for this item, by the ••• or by a hold; whether it reads the owner's voice note line. */
async function readsLine(v: View, tid: string, door: 'dots' | 'hold', finger: Finger) {
  if (door === 'dots') await fireEvent.press(v.getByTestId(tid));
  else await userEvent.setup().longPress(finger(), { duration: 600 });
  await fireEvent.press(v.getByTestId(`${tid}-report`));
  const line = within(v.getByTestId(`${tid}-sheet`)).queryByText(VOICE_NOTE_HEARD_LINE) !== null;
  await close(v, tid);
  return line;
}

const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
let tap: jest.SpyInstance;
let soft: jest.SpyInstance;
beforeEach(() => {
  setOS('android');
  mockGet.mockReset();
  mockPost.mockReset().mockResolvedValue({ data: {}, headers: {} });
  mockGetClients.mockReset().mockResolvedValue({ data: [] });
  mockNavigate.mockReset();
  mockGoBack.mockReset();
  mockDisk.clear();
  Object.values(mockReads).forEach((f) => f.mockReset());
  mockOnline.feed = true;
  mockOnline.page = true;
  play.mockClear();
  pause.mockClear();
  seek.mockClear();
  registerVoicePlayback(port());
  resetReportedVoiceNotes();
  useBlockedUsersStore.setState({ blocked: [] });
  mockUser = { id: CLIENT, role: 'student', name: 'Dana Cruz', firstName: 'Dana', coach_id: COACH };
  mockParams = {};
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  tap = jest.spyOn(HapticService, 'mediumImpact');
  soft = jest.spyOn(HapticService, 'softImpact');
});
afterEach(() => {
  setOS(realOS);
  tap.mockRestore();
  soft.mockRestore();
  qc.clear();
});
afterAll(() => registerVoicePlayback(null));

// ─── Voice notes: the feed and the page ───────────────────────────────────────────────────────────────────────────
const NOTE = { id: 'vn-1', author_id: MEMBER, author_name: 'Jo Park', author_is_coach: false, url: 'https://signed.example/vn-1.m4a', duration_ms: 42_000, waveform_peaks: [0.2, 0.7], created_at: ago(3_600_000) };
const MINE = { ...NOTE, id: 'vn-2', author_id: CLIENT, author_name: 'Dana Cruz' };
const FEED = 'voice-notes-section';
const section = async (notes: unknown[] = [NOTE], role = 'client') => {
  serve({ '/community/me': meAnswer(role) });
  mockReads.listFeed.mockResolvedValue({ voice_notes: notes, next_cursor: null });
  const v = await mount(<VoiceNotesSection workspaceId={WS} viewerUserId={CLIENT} viewerCoachId={COACH} />);
  await v.findByTestId(`${FEED}-player-${(notes[0] as { id: string }).id}`);
  return v;
};
const PAGE = 'community-voice-detail-safety';
const notePage = async (params: Record<string, unknown> = {}, note: unknown = NOTE, role = 'client') => {
  serve({ '/community/me': meAnswer(role) });
  mockReads.getOne.mockResolvedValue(note);
  mockParams = { voiceNoteId: 'vn-1', ...params };
  const v = await mount(<CommunityVoiceNoteDetail />);
  await v.findByText('Jo Park');
  return v;
};
const inPlayer = (v: View, playerId: string, part: 'voice-player-toggle' | 'voice-player-seek' | 'voice-player-duration') =>
  () => within(v.getByTestId(playerId)).getByTestId(part, { includeHiddenElements: true }); // the time line is hidden from a screen reader, not from a finger
/** The strip learns its width from layout, which jest never runs; a tap at its left edge then seeks to 0:00. */
const layOut = (v: View, playerId: string) =>
  fireEvent(within(v.getByTestId(playerId)).getByTestId('voice-player-seek'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 200, height: 44 } } });

describe('PH1: the voice feed, a hold made as a phone wherever the finger lands on the card', () => {
  const player = `${FEED}-player-vn-1`;
  const tid = `${FEED}-menu-vn-1`;
  it.each([
    ['the play disc', 'voice-player-toggle'],
    ['the waveform', 'voice-player-seek'],
    ['the time line', 'voice-player-duration'],
    ['the name', null],
  ] as const)('PH1 holding %s opens the note\'s own ••• sheet (Report, Block), one medium haptic, no play, no seek', async (_where, part) => {
    const v = await section();
    const finger = part ? inPlayer(v, player, part) : () => v.getByText('Jo Park');
    const { dots, hold } = await dotsThenHold(v, tid, finger);
    expect(dots).toEqual(['report', 'block']);
    expect(hold).toEqual(dots);
    tap.mockClear();
    soft.mockClear(); // the •••'s own presses above are light taps
    await userEvent.setup().longPress(finger(), { duration: 600 });
    expect(sheetUp(v, tid)).toBe(true);
    await settle();
    expect(tap).toHaveBeenCalledTimes(1); // one medium haptic, from the hold
    expect(soft).not.toHaveBeenCalled(); // branch (a): the disc's light haptic fires in onPress, which a long press drops
    expect(play).not.toHaveBeenCalled();
    expect(seek).not.toHaveBeenCalled();
  });

  it('PH1 branch (c): after a hold on the disc opened the menu and it closed, the next tap on the disc plays', async () => {
    const v = await section();
    await userEvent.setup().longPress(inPlayer(v, player, 'voice-player-toggle')(), { duration: 600 });
    expect(sheetUp(v, tid)).toBe(true);
    await close(v, tid);
    await settle();
    expect(play).not.toHaveBeenCalled();
    await userEvent.setup().press(inPlayer(v, player, 'voice-player-toggle')());
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(sheetUp(v, tid)).toBe(false);
  });

  it('PH1: on a loaded note a hold on the waveform does not move the playhead; a tap on the waveform seeks', async () => {
    const v = await section();
    await userEvent.setup().press(inPlayer(v, player, 'voice-player-toggle')());
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    await layOut(v, player);
    await userEvent.setup().longPress(inPlayer(v, player, 'voice-player-seek')(), { duration: 600 });
    expect(sheetUp(v, tid)).toBe(true);
    await settle();
    expect(seek).not.toHaveBeenCalled();
    await close(v, tid);
    await userEvent.setup().press(inPlayer(v, player, 'voice-player-seek')());
    await waitFor(() => expect(seek).toHaveBeenCalledWith(0));
    expect(sheetUp(v, tid)).toBe(false);
  });

  it('PH1: her own note\'s disc holds to its Delete-only menu, as its ••• (R3)', async () => {
    const v = await section([MINE]);
    const mine = `${FEED}-menu-vn-2`;
    const { dots, hold } = await dotsThenHold(v, mine, inPlayer(v, `${FEED}-player-vn-2`, 'voice-player-toggle'));
    expect(dots).toEqual(['delete']);
    expect(hold).toEqual(dots);
    await settle();
    expect(play).not.toHaveBeenCalled();
  });
});

describe('PH2: the note\'s own page, a hold made as a phone on the byline, the disc and the waveform', () => {
  const player = 'community-voice-detail-player';
  it.each([
    ['the byline', null],
    ['the play disc', 'voice-player-toggle'],
    ['the waveform', 'voice-player-seek'],
  ] as const)('PH2 holding %s opens the note\'s ••• sheet; nothing plays or seeks', async (_where, part) => {
    const v = await notePage();
    const finger = part ? inPlayer(v, player, part) : () => v.getByText('Jo Park');
    const { dots, hold } = await dotsThenHold(v, PAGE, finger);
    expect(dots).toEqual(['report', 'block']);
    expect(hold).toEqual(dots);
    await settle();
    expect(play).not.toHaveBeenCalled();
    expect(seek).not.toHaveBeenCalled();
  });

  it('PH2: a tap on play still plays, with no sheet', async () => {
    const v = await notePage();
    await userEvent.setup().press(inPlayer(v, player, 'voice-player-toggle')());
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(sheetUp(v, PAGE)).toBe(false);
  });
});

describe('PH3: the class guard (a disabled player, and a player given no hold)', () => {
  it('PH3: offline, the disc and the waveform are off, and a hold on either still opens the menu', async () => {
    mockOnline.feed = false;
    const v = await section();
    const tid = `${FEED}-menu-vn-1`;
    for (const part of ['voice-player-toggle', 'voice-player-seek'] as const) {
      await userEvent.setup().longPress(inPlayer(v, `${FEED}-player-vn-1`, part)(), { duration: 600 });
      expect(sheetUp(v, tid)).toBe(true);
      await close(v, tid);
    }
    expect(play).not.toHaveBeenCalled();
  });

  it('PH3: a player given no hold (as the composer and the space chat draw it) plays on a tap, and a long press still releases as a tap', async () => {
    const v = await render(<VoiceNotePlayer url="https://signed.example/vn-9.m4a" durationMs={42_000} peaks={[0.3]} />);
    await userEvent.setup().press(v.getByTestId('voice-player-toggle'));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(await v.findByLabelText('Pause voice note')).toBeTruthy();
    await userEvent.setup().longPress(v.getByTestId('voice-player-toggle'), { duration: 600 });
    await waitFor(() => expect(pause).toHaveBeenCalledTimes(1));
    expect(tap).not.toHaveBeenCalled();
  });

  it('PH3 A11Y branch (b): with the hold passed, the disc is still a button and the waveform keeps its two actions (5 s each)', async () => {
    const v = await section();
    const box = within(v.getByTestId(`${FEED}-player-vn-1`));
    expect(box.getByRole('button', { name: 'Play voice note, 0:42' })).toBeTruthy();
    const strip = box.getByTestId('voice-player-seek');
    expect(strip.props.accessibilityRole).toBe('adjustable');
    expect(strip.props.accessibilityActions).toEqual([{ name: 'increment' }, { name: 'decrement' }]);
    expect(strip.props.accessibilityValue).toEqual({ text: '0:00 of 0:42' });
    await fireEvent(strip, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(box.getByTestId('voice-player-seek').props.accessibilityValue).toEqual({ text: '0:05 of 0:42' });
    await fireEvent(box.getByTestId('voice-player-seek'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(box.getByTestId('voice-player-seek').props.accessibilityValue).toEqual({ text: '0:00 of 0:42' });
  });
});

// ─── PH4: every other hold site, pressed as a phone ────────────────────────────────────────────────────────────────
const POST = uuid(50);
const threadPost = (author: string) => ({
  id: POST, workspace_id: WS, cohort_id: null, author_user_id: author, author_name: author === CLIENT ? 'Dana Cruz' : 'Jo Park',
  title: 'Hill sprints', body: 'Six by thirty seconds', scope: 'hall', type: 'text', pinned: false, created_at: ago(7_200_000), updated_at: ago(7_200_000), deleted: false,
});
const reply = (n: number, author: string, body: string, name = 'Jo Park') => ({
  id: uuid(n), post_id: POST, author_user_id: author, author_name: name, body, created_at: ago(3_600_000), updated_at: ago(3_600_000), deleted: false,
});
const openThread = async (replies: unknown[] = [reply(61, MEMBER, 'Count me in')]) => {
  serve({ '/community/me': meAnswer() });
  mockReads.getPost.mockResolvedValue(threadPost(MEMBER));
  mockReads.listComments.mockResolvedValue(replies);
  mockParams = { postId: POST };
  const v = await mount(<CommunityThreadScreen />);
  await v.findByText('Hill sprints');
  await v.findByText((replies[0] as { body: string }).body);
  return v;
};
const spaceRow = (id: string, author: string, title: string) => ({
  id, workspace_id: WS, cohort_id: null, author_user_id: author, title, body: 'Details inside', scope: 'hall', type: 'text', pinned: false,
  created_at: ago(3_600_000), updated_at: ago(3_600_000), deleted: false,
});
const openSpace = async () => {
  serve({ '/community/me': meAnswer() });
  mockReads.listFeed.mockResolvedValue({ voice_notes: [], next_cursor: null });
  mockReads.listPosts.mockResolvedValue({ posts: [spaceRow(uuid(81), MEMBER, 'Saturday long run'), spaceRow(uuid(82), CLIENT, 'My first 10k'), spaceRow('optimistic:83', MEMBER, 'Sending this one')] });
  mockParams = {};
  const v = await mount(<CommunitySpaceScreen />);
  await v.findByText('Saturday long run');
  return v;
};
const SITES: [string, () => Promise<View>, string, string][] = [
  ['DM1 another member\'s DM', async () => {
    serve({ '/community/me': meAnswer(), '/v1/clients/me/coach': { id: COACH, name: 'Alex Morgan' }, [dmUrl(MEMBER)]: { messages: [dm(901, MEMBER, CLIENT, 'See you at the track')] } });
    mockParams = { recipientId: MEMBER, participantLabel: 'Jo Park' };
    const v = await mount(<CommunityDmThreadScreen />);
    await v.findByText('See you at the track');
    return v;
  }, 'See you at the track', `dm-message-safety-${uuid(901)}`],
  ['CD1 the client\'s message in the coach\'s DM', async () => {
    const JORDAN = uuid(31);
    mockUser = { id: COACH, role: 'coach', name: 'Sam Rivera', firstName: 'Sam', coach_id: null };
    serve({ '/community/me': meAnswer('none'), [`/community/workspaces/${WS}/dms`]: { threads: [] }, [dmUrl(JORDAN)]: { messages: [dm(911, JORDAN, COACH, 'Can we move Monday?')] } });
    mockParams = { recipientId: JORDAN, name: 'Jordan Lee' };
    const v = await mount(<CoachDmThreadScreen />);
    await v.findByText('Can we move Monday?');
    return v;
  }, 'Can we move Monday?', `coach-dm-message-safety-${uuid(911)}`],
  ['TH1 the post\'s title', () => openThread(), 'Hill sprints', 'community-thread-post-safety'],
  ['TH1 the post\'s words', () => openThread(), 'Six by thirty seconds', 'community-thread-post-safety'],
  ['TH2 another member\'s reply', () => openThread(), 'Count me in', `comment-safety-${uuid(61)}`],
  ['CH1 another member\'s challenge note', async () => {
    const challenge = {
      id: 'ch-1', workspace_id: WS, cohort_id: 'co-1', created_by_user_id: COACH, title: 'March steps', description: 'Walk 100k steps.',
      status: 'active', starts_at: null, ends_at: null, metric_key: 'steps', target_value: 100000, unit: 'steps', leaderboard_enabled: false,
      created_at: ago(864_000_000), updated_at: ago(864_000_000), archived: false,
    };
    mockUser = { id: CLIENT, firstName: 'Dana', name: 'Dana', coach_id: COACH };
    mockReads.getChallenge.mockResolvedValue({ challenge, participation: null });
    mockReads.listNotes.mockResolvedValue({ comments: [{ id: uuid(71), challenge_id: 'ch-1', author_user_id: MEMBER, body: 'Nice pace everyone', created_at: ago(3_600_000), deleted: false }], next_cursor: null });
    mockReads.getLeaderboard.mockResolvedValue({ available: true, opted_in: false, rows: [], next_cursor: null });
    mockParams = { challengeId: 'ch-1' };
    const v = await mount(<CommunityChallengeDetailScreen />);
    await v.findByText('Nice pace everyone');
    return v;
  }, 'Nice pace everyone', `community-challenge-comment-${uuid(71)}-safety`],
  ['SP1 another member\'s space post', openSpace, 'Saturday long run', `post-safety-${uuid(81)}`],
  ['W1 another member\'s win', async () => {
    mockUser = { id: CLIENT, name: 'Dana Cruz', coach_id: COACH };
    serve({ '/community/safety/notices': { notices: [] } });
    mockReads.getFeed.mockResolvedValue([{ id: 'w-1', userId: MEMBER, displayName: 'Jo Park', title: 'Deadlift best', description: 'Felt strong', createdAt: ago(3_600_000), isMine: false }]);
    const v = await mount(<CommunityScreen />);
    await v.findByText('Deadlift best');
    return v;
  }, 'Deadlift best', 'win-menu-w-1'],
];

describe('PH4: every other hold site, pressed as a phone (the class of B1)', () => {
  it.each(SITES)('PH4 %s: a hold where the finger lands opens that item\'s own ••• sheet, the same rows', async (_site, open, words, tid) => {
    const v = await open();
    const { dots, hold } = await dotsThenHold(v, tid, () => v.getByText(words));
    expect(hold).toEqual(dots);
    expect(hold.length).toBeGreaterThan(0);
  });
});

// ─── SP2: her own space post ─────────────────────────────────────────────────────────────────────────────────────
describe('SP2: her own post in a space opens on a press of any length (fix 3, R3)', () => {
  it('SP2: a 600 ms press on her own post opens the post, and no sheet', async () => {
    const v = await openSpace();
    await userEvent.setup().longPress(v.getByText('My first 10k'), { duration: 600 });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(v.queryAllByTestId(/-sheet$/)).toHaveLength(0);
    expect(tap).not.toHaveBeenCalled();
  });

  it('SP2: a hold on another member\'s post opens its sheet and opens no post; a tap opens that post', async () => {
    const v = await openSpace();
    const tid = `post-safety-${uuid(81)}`;
    await userEvent.setup().longPress(v.getByText('Saturday long run'), { duration: 600 });
    expect(sheetUp(v, tid)).toBe(true);
    expect(mockNavigate).not.toHaveBeenCalled();
    await close(v, tid);
    await userEvent.setup().press(v.getByText('Saturday long run'));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('SP2: a post still sending does nothing on a long press', async () => {
    const v = await openSpace();
    await userEvent.setup().longPress(v.getByText('Sending this one'), { duration: 600 });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(v.queryAllByTestId(/-sheet$/)).toHaveLength(0);
  });
});

// ─── VN-LINE2: the owner's line, for a client viewer only ───────────────────────────────────────────────────────────
describe('VN-LINE2: the voice note line in the reasons step reads to a client viewer only (fix 4)', () => {
  const feedTid = `${FEED}-menu-vn-1`;
  it('VN-LINE2 feed: a client reads the line word for word, by the ••• and by the hold', async () => {
    const v = await section();
    const disc = inPlayer(v, `${FEED}-player-vn-1`, 'voice-player-toggle');
    expect(await readsLine(v, feedTid, 'dots', disc)).toBe(true);
    expect(await readsLine(v, feedTid, 'hold', () => v.getByText('Jo Park'))).toBe(true);
    expect(VOICE_NOTE_HEARD_LINE).toBe('A reported voice note can be heard by your coach and the TGP team.');
  });

  it.each(['coach', 'owner'])('VN-LINE2 feed: a viewer whose role is %s reads no line, by either door', async (role) => {
    const v = await section([NOTE], role);
    expect(await readsLine(v, feedTid, 'dots', () => v.getByText('Jo Park'))).toBe(false);
    expect(await readsLine(v, feedTid, 'hold', () => v.getByText('Jo Park'))).toBe(false);
  });

  it('VN-LINE2 page: a client reads the line by either door; the coach reads none', async () => {
    const v = await notePage();
    expect(await readsLine(v, PAGE, 'dots', () => v.getByText('Jo Park'))).toBe(true);
    expect(await readsLine(v, PAGE, 'hold', () => v.getByText('Jo Park'))).toBe(true);
    await v.unmount();
    qc.clear();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
    const coach = await notePage({}, NOTE, 'coach');
    expect(await readsLine(coach, PAGE, 'dots', () => coach.getByText('Jo Park'))).toBe(false);
    expect(await readsLine(coach, PAGE, 'hold', () => coach.getByText('Jo Park'))).toBe(false);
  });

  it('VN-LINE2: a text report shows no voice note line', async () => {
    const [, open, words, tid] = SITES[0];
    const v = await open();
    expect(await readsLine(v, tid, 'hold', () => v.getByText(words))).toBe(false);
  });
});

// ─── EXC: the transcript on the note's page ─────────────────────────────────────────────────────────────────────────
describe('EXC: the transcript excerpt sits inside the note\'s hold (fix 5)', () => {
  it('EXC: a hold on the excerpt or its label opens the note\'s sheet', async () => {
    const v = await notePage({ excerpt: 'four hill repeats' });
    for (const words of ['four hill repeats', 'Matched in transcript']) {
      await userEvent.setup().longPress(v.getByText(words), { duration: 600 });
      expect(sheetUp(v, PAGE)).toBe(true);
      await close(v, PAGE);
    }
  });

  it('EXC: a folded (reported) or removed note draws no excerpt and no hold on it', async () => {
    markVoiceNoteReported('vn-1');
    const folded = await notePage({ excerpt: 'four hill repeats' });
    expect(folded.queryByText('four hill repeats')).toBeNull();
    await folded.unmount();
    resetReportedVoiceNotes();
    qc.clear();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
    const removed = await notePage({ excerpt: 'four hill repeats' }, { ...NOTE, removed_at: ago(1_000), removed_by: { role: 'coach', user_id: COACH, name: 'Alex Morgan' } });
    expect(removed.queryByText('four hill repeats')).toBeNull();
    expect(removed.queryByTestId(`${PAGE}-sheet`)).toBeNull();
  });
});

// ─── RE2: her own reply ────────────────────────────────────────────────────────────────────────────────────────────
describe('RE2: her own reply carries no hold, as its menu draws nothing (fix 6, R3)', () => {
  /** The touchables (a hold's Pressable) from the words up to the reply's row: a plain View takes no touch. */
  const holdsOn = (v: View, words: string, rowId: string) => {
    let node = v.getByText(words) as unknown as { props: Record<string, unknown>; parent: unknown } | null;
    let touchables = 0;
    while (node && node.props.testID !== rowId) {
      if (typeof node.props.onStartShouldSetResponder === 'function') touchables += 1;
      node = node.parent as typeof node;
    }
    expect(node).not.toBeNull();
    return touchables;
  };

  it('RE2: her own reply sits in no hold (no long-press handler) and opens no sheet; another member\'s reply still holds to its sheet', async () => {
    const v = await openThread([reply(61, MEMBER, 'Count me in'), reply(63, CLIENT, 'Mine is at six', 'Dana Cruz')]);
    expect(holdsOn(v, 'Mine is at six', `comment-${uuid(63)}`)).toBe(0);
    await userEvent.setup().longPress(v.getByText('Mine is at six'), { duration: 600 });
    expect(v.queryAllByTestId(/-sheet$/)).toHaveLength(0);
    expect(holdsOn(v, 'Count me in', `comment-${uuid(61)}`)).toBe(1);
    await userEvent.setup().longPress(v.getByText('Count me in'), { duration: 600 });
    expect(sheetUp(v, `comment-safety-${uuid(61)}`)).toBe(true);
  });
});
