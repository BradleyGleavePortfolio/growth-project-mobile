/**
 * CRISIS-TEXT-M (owner #200-S1 op 1, #203-E21; operator rulings 04:0x 11-10): when the server's crisis check matched
 * a member's own community text, that member's write answer (or its 422 refusal) carries `crisis_flag: true`
 * (backend b#1232, CONTRACT 6755386095), and the poster sees the approved 911 / 988 line at once. One row per phone
 * place that sends one of b#1232's routes. Only the wire is stubbed (`services/api` posts); every answer is copied key
 * for key from the server line cited beside it, and every body is ordinary words ([R22]): the phone never reads the
 * text, the flag comes only from the answer.
 * The line is guideline 7's 911 and 988 sentences (operator ruling 3: COMMUNITY_REPORT_CRISIS_LINE's bytes differ).
 */
import React from 'react';
import { AccessibilityInfo, Alert, Platform } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockDisk = new Map<string, string>();
jest.mock('../storage/mmkv', () => ({
  ...jest.requireActual('../storage/mmkv'),
  cacheStorage: {
    getString: () => undefined,
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
}));
const mockPost = jest.fn();
const mockGet = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => mockPost(...a), get: (...a: unknown[]) => mockGet(...a) },
}));
jest.mock('../services/secureStorage', () => ({ secureStorage: { getItem: jest.fn(async () => 'test-token') } }));
jest.mock('../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));
jest.mock('../lib/analytics', () => ({ ...jest.requireActual('../lib/analytics'), track: jest.fn(), capture: jest.fn() }));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: '22222222-2222-4222-8222-222222222222', firstName: 'Dana', name: 'Dana', coach_id: 'coach-7' }),
}));
jest.mock('../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('../config/featureFlags', () => ({
  ...jest.requireActual('../config/featureFlags'),
  featureFlags: { ...jest.requireActual('../config/featureFlags').featureFlags, communityChallenges: true },
}));
const mockParams: { current: Record<string, unknown> } = { current: {} };
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({ goBack: jest.fn(), navigate: jest.fn() }),
  useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack }),
  useRoute: () => ({ params: mockParams.current }),
  useFocusEffect: () => undefined,
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../components/community/SafetyMenu', () => () => null);
jest.mock('../components/SkeletonLoader', () => ({ SkeletonCard: () => null }));

const { communityApi } = require('../api/communityApi');
const { removedRowsApi } = require('../api/communityRemovedRows');
const { communityChallengesApi } = require('../api/communityChallengesApi');
const { communityWinsApi } = require('../api/communityWinsApi');
const { communitySafetyApi, COMMUNITY_GUIDELINES } = require('../api/communitySafetyApi');
const { authEvents } = require('../utils/authEvents');
const { setUserCache, clearUserCache } = require('../lib/userCache');
const { persistableError } = require('../services/queryClient');
const { logger } = require('../utils/logger');
const sentry = require('../services/sentry');
const analytics = require('../lib/analytics');
const CommunityDmThreadScreen = require('../screens/community/CommunityDmThreadScreen').default;
const CommunityComposerScreen = require('../screens/community/CommunityComposerScreen').default;
const CommunityThreadScreen = require('../screens/community/CommunityThreadScreen').default;
const CommunityChallengeDetailScreen = require('../screens/community/CommunityChallengeDetailScreen').default;
const CommunityScreen = require('../screens/client/CommunityScreen').default;

/** The approved line (guideline 7's 911 and 988 sentences, owner 10-01 09:07): app text, pinned here on purpose. */
const LINE = 'If you are in danger, call 911. If you are struggling emotionally, call or text 988.';
/** CONTENT_REJECTED.message (backend community-safety.service.ts:33-38): the server's own refusal words. */
const REFUSED = 'This message was not posted because it appears to contain abusive or explicit language. Please rephrase it.';

const ME = '22222222-2222-4222-8222-222222222222';
const WS = '11111111-1111-4111-8111-111111111111';
const POST = '33333333-3333-4333-8333-333333333333';
const COACH = 'coach-7';
const CHALLENGE_UUID = '55555555-5555-4555-8555-555555555555';
const NOW = '2026-11-10T12:00:00.000Z';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NO_ANSWER = { isAxiosError: true, message: 'Network Error' }; // no response: offline or the answer was lost
const WORDS = 'Leg day went well, thanks all'; // ordinary words ([R22])

type View = Awaited<ReturnType<typeof render>>;
type Flag = Record<string, unknown>; // {} (no field) or { crisis_flag: <value> }
const FLAGGED: Flag = { crisis_flag: true };

/**
 * The 422 the server sends for a refused text (community-safety.service.ts:278 throws CONTENT_REJECTED, plus
 * crisis_flag: true on a match; http-exception.filter.ts:125-134 builds the envelope with buildErrorEnvelope,
 * not-found-envelope.ts:26-34, and spreads the allowlisted detail beside it, error-details.ts:52, :91-93).
 */
const refusal = (flag: Flag, path: string) => ({
  isAxiosError: true,
  message: 'Request failed with status code 422',
  response: {
    status: 422,
    headers: {},
    data: {
      statusCode: 422, code: 'community.content.rejected', message: REFUSED, error: 'content_rejected',
      timestamp: NOW, path, ...flag,
    },
  },
});

const press = async (v: View, testID: string) => {
  await act(async () => { fireEvent.press(v.getByTestId(testID)); });
};
const type = async (v: View, testID: string, words: string) => {
  await fireEvent.changeText(v.getByTestId(testID), words);
};
let client: QueryClient;
const withQuery = (node: React.ReactElement) => <QueryClientProvider client={client}>{node}</QueryClientProvider>;
const alertSpy = () => Alert.alert as unknown as jest.Mock;
/** Every native alert that carries the line, as [title, message]. */
const lineAlerts = () => alertSpy().mock.calls.filter((c) => String(c[1] ?? '').includes(LINE) || String(c[0] ?? '').includes(LINE));
const writesTo = (path: RegExp) => mockPost.mock.calls.filter(([url]) => path.test(String(url)));
const keyOf = (call: unknown[]) => (call[2] as { headers?: Record<string, unknown> } | undefined)?.headers?.['Idempotency-Key'];

type Row = {
  place: string;
  /** b#1232's route and the server lines its answer is copied from. */
  route: string;
  path: RegExp;
  wirePath: string;
  open: () => Promise<View>;
  fill: (v: View, words: string) => Promise<void>;
  send: (v: View) => Promise<void>;
  /** The success answer, key for key, with `flag` spread top-level as crisisField does (community-safety.service.ts:73-76). */
  answer: (flag: Flag, words: string) => Record<string, unknown>;
  /** The body the server sees: today's, never the flag. */
  body: (words: string) => Record<string, unknown>;
  /** Where today's refusal shows. */
  refusalShows: 'alert' | 'inline';
  /** The inline refusal's text (inline rows). */
  inlineText?: (v: View) => string | null;
  /** The send ended as at base (the row posts and the screen moves on as today). */
  ended: (v: View) => Promise<void>;
  /** The box still holds the words after a refusal (the draft is kept). */
  kept: (v: View, words: string) => void;
};

const fieldValue = (v: View, testID: string) => v.getByTestId(testID).props.value as string;
/** The wins sheet's Modal onDismiss, read while the sheet is up (the jest Modal renders nothing once closed). */
const sheetDismiss = (v: View): (() => void) => {
  let node = v.getByTestId('wins-title') as unknown as { props: Record<string, unknown>; parent: unknown } | null;
  while (node && typeof node.props.onDismiss !== 'function') node = node.parent as typeof node;
  if (!node) throw new Error('the wins sheet has no onDismiss');
  return node.props.onDismiss as () => void;
};

const ROWS: Row[] = [
  {
    place: 'composer post (S3)',
    route: 'POST /community/workspaces/:workspaceId/posts — community-posts.service.ts:241-286 `{ ...postResponse, ...crisisField }`',
    path: /\/community\/workspaces\/[^/]+\/posts$/,
    wirePath: `/community/workspaces/${WS}/posts`,
    open: async () => {
      mockParams.current = { mode: 'post' };
      const v = await render(withQuery(<CommunityComposerScreen />));
      await waitFor(() => expect(v.getByTestId('community-composer-title')).toBeTruthy());
      return v;
    },
    fill: async (v, words) => {
      await type(v, 'community-composer-title', 'Week one');
      await type(v, 'community-composer-body', words);
    },
    send: (v) => press(v, 'community-composer-submit'),
    answer: (flag, words) => ({
      post: {
        id: '66666666-6666-4666-8666-666666666666', workspace_id: WS, cohort_id: null, author_user_id: ME,
        title: 'Week one', body: words, scope: 'hall', type: 'text', pinned: false, created_at: NOW, updated_at: NOW,
        deleted: false, author_name: 'Dana', reactions: [],
      },
      ...flag,
    }),
    body: (words) => ({ title: 'Week one', body: words }),
    refusalShows: 'alert',
    ended: async (v) => {
      await waitFor(() => expect(v.getByText('Post published.')).toBeTruthy());
      await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1), { timeout: 2000 });
    },
    kept: (v, words) => expect(fieldValue(v, 'community-composer-body')).toBe(words),
  },
  {
    place: 'composer DM (S6)',
    route: 'POST /community/workspaces/:workspaceId/dms/:recipientId/messages — community-dms.service.ts:186-232 `{ ...answer, ...crisisField }`',
    path: /\/community\/workspaces\/[^/]+\/dms\/coach-7\/messages$/,
    wirePath: `/community/workspaces/${WS}/dms/${COACH}/messages`,
    open: async () => {
      mockParams.current = { mode: 'dm', recipientId: COACH };
      const v = await render(withQuery(<CommunityComposerScreen />));
      await waitFor(() => expect(v.getByTestId('community-composer-body')).toBeTruthy());
      return v;
    },
    fill: (v, words) => type(v, 'community-composer-body', words),
    send: (v) => press(v, 'community-composer-submit'),
    answer: (flag, words) => ({
      message: {
        id: '77777777-7777-4777-8777-777777777777', thread_id: `${WS}:dm`, sender_user_id: ME,
        recipient_user_id: '88888888-8888-4888-8888-888888888888', body: words, created_at: NOW, deleted: false,
      },
      ...flag,
    }),
    body: (words) => ({ body: words }),
    refusalShows: 'alert',
    ended: async () => { await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1)); },
    kept: (v, words) => expect(fieldValue(v, 'community-composer-body')).toBe(words),
  },
  {
    place: 'DM thread (S6)',
    route: 'POST /community/workspaces/:workspaceId/dms/:recipientId/messages — community-dms.service.ts:186-232',
    path: /\/community\/workspaces\/[^/]+\/dms\/coach-7\/messages$/,
    wirePath: `/community/workspaces/${WS}/dms/${COACH}/messages`,
    open: async () => {
      mockParams.current = { recipientId: COACH, participantLabel: 'Sam Rivera' };
      const v = await render(withQuery(<CommunityDmThreadScreen />));
      await waitFor(() => expect(v.getByTestId('community-dmthread-composer-field')).toBeTruthy());
      return v;
    },
    fill: (v, words) => type(v, 'community-dmthread-composer-field', words),
    send: (v) => press(v, 'community-dmthread-composer-send'),
    answer: (flag, words) => ({
      message: {
        id: '77777777-7777-4777-8777-777777777777', thread_id: `${WS}:dm`, sender_user_id: ME,
        recipient_user_id: '88888888-8888-4888-8888-888888888888', body: words, created_at: NOW, deleted: false,
      },
      ...flag,
    }),
    body: (words) => ({ body: words }),
    refusalShows: 'alert',
    ended: async (v) => { await waitFor(() => expect(fieldValue(v, 'community-dmthread-composer-field')).toBe('')); },
    kept: (v, words) => expect(fieldValue(v, 'community-dmthread-composer-field')).toBe(words),
  },
  {
    place: 'post thread reply (S5)',
    route: 'POST /community/posts/:postId/comments — community-posts.service.ts:433-460 `{ ...replayComment|commentResponse, ...crisisField }`',
    path: new RegExp(`/community/posts/${POST}/comments$`),
    wirePath: `/community/posts/${POST}/comments`,
    open: async () => {
      mockParams.current = { postId: POST };
      const v = await render(withQuery(<CommunityThreadScreen />));
      await waitFor(() => expect(v.getByTestId('community-thread-composer-field')).toBeTruthy());
      return v;
    },
    fill: (v, words) => type(v, 'community-thread-composer-field', words),
    send: (v) => press(v, 'community-thread-composer-send'),
    answer: (flag, words) => ({
      comment: {
        id: '99999999-9999-4999-8999-999999999999', post_id: POST, author_user_id: ME, body: words, created_at: NOW,
        author_name: 'Dana',
      },
      ...flag,
    }),
    body: (words) => ({ body: words }),
    refusalShows: 'alert',
    ended: async (v) => { await waitFor(() => expect(fieldValue(v, 'community-thread-composer-field')).toBe('')); },
    kept: (v, words) => expect(fieldValue(v, 'community-thread-composer-field')).toBe(words),
  },
  {
    place: 'challenge note (S7)',
    route: 'POST /community/challenges/:challengeId/comments — community-challenges.service.ts:613-634 `{ ...answer, ...crisisField }`',
    path: /\/community\/challenges\/ch-1\/comments$/,
    wirePath: '/community/challenges/ch-1/comments',
    open: async () => {
      mockParams.current = { challengeId: 'ch-1' };
      const v = await render(withQuery(<CommunityChallengeDetailScreen />));
      await waitFor(() => expect(v.getByTestId('community-challenge-composer-field')).toBeTruthy());
      return v;
    },
    fill: (v, words) => type(v, 'community-challenge-composer-field', words),
    send: (v) => press(v, 'community-challenge-composer-send'),
    answer: (flag, words) => ({
      comment: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', challenge_id: CHALLENGE_UUID, author_user_id: ME, body: words,
        created_at: NOW,
      },
      ...flag,
    }),
    body: (words) => ({ body: words }),
    refusalShows: 'inline',
    inlineText: (v) => {
      const banner = v.queryByTestId('community-challenge-action-error');
      return banner ? (within(banner).getByText(/./).props.children as string) : null;
    },
    ended: async (v) => {
      await waitFor(() => expect(fieldValue(v, 'community-challenge-composer-field')).toBe(''));
      expect(v.queryByTestId('community-challenge-action-error')).toBeNull();
    },
    kept: (v, words) => expect(fieldValue(v, 'community-challenge-composer-field')).toBe(words),
  },
  {
    place: 'wins form (S8)',
    route: 'POST /community/wins — community.service.ts:535-560 `{ ...winView, ...crisisField }` (winView :615-631)',
    path: /\/community\/wins$/,
    wirePath: '/community/wins',
    open: async () => {
      const v = await render(withQuery(<CommunityScreen />));
      await waitFor(() => expect(v.getByTestId('wins-share')).toBeTruthy());
      await press(v, 'wins-share');
      await waitFor(() => expect(v.getByTestId('wins-title')).toBeTruthy());
      return v;
    },
    fill: async (v, words) => {
      await type(v, 'wins-title', 'Week one');
      await type(v, 'wins-description', words);
    },
    send: (v) => press(v, 'wins-submit'),
    answer: (flag, words) => ({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_id: ME, display_name: 'Dana', title: 'Week one',
      description: words, created_at: NOW, is_mine: true, displayName: 'Dana', action: 'Week one', createdAt: NOW, ...flag,
    }),
    body: (words) => ({ title: 'Week one', description: words }),
    refusalShows: 'inline',
    inlineText: (v) => {
      const err = v.queryByTestId('wins-post-error');
      return err ? (err.props.children as string) : null;
    },
    ended: async (v) => { await waitFor(() => expect(v.queryByTestId('wins-title')).toBeNull()); }, // the sheet closed
    kept: (v, words) => expect(fieldValue(v, 'wins-description')).toBe(words),
  },
];

const realOS = Platform.OS;
const setOS = (os: 'ios' | 'android') => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });

beforeEach(async () => {
  jest.clearAllMocks(); // the module mocks (logger, Sentry, analytics) start each row with no calls
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mockPost.mockReset().mockRejectedValue(NO_ANSWER);
  mockGet.mockReset().mockRejectedValue(NO_ANSWER);
  mockGoBack.mockReset();
  setOS('android'); // the wins sheet's iOS wait is its own case (7); Android raises at once (SafetyMenu afterClose)
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(communityApi, 'getMe').mockResolvedValue({
    workspace_id: WS, unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  });
  jest.spyOn(communityApi, 'listDmMessages').mockResolvedValue([]);
  jest.spyOn(removedRowsApi, 'listPosts').mockResolvedValue({ posts: [], next_cursor: null });
  jest.spyOn(removedRowsApi, 'getPost').mockResolvedValue({
    id: POST, workspace_id: WS, cohort_id: null, author_user_id: '44444444-4444-4444-8444-444444444444', title: 'Hello',
    body: 'World', scope: 'hall', type: 'text', pinned: false, created_at: NOW, updated_at: NOW, deleted: false,
  });
  jest.spyOn(removedRowsApi, 'listComments').mockResolvedValue([]);
  jest.spyOn(communityChallengesApi, 'listComments').mockResolvedValue({ comments: [], next_cursor: null });
  jest.spyOn(communityChallengesApi, 'getLeaderboard').mockResolvedValue({
    available: true, opted_in: false, rows: [], next_cursor: null,
  });
  jest.spyOn(communityChallengesApi, 'getChallenge').mockResolvedValue({
    challenge: {
      id: 'ch-1', workspace_id: WS, cohort_id: 'co-1', created_by_user_id: 'coach-1', title: 'March step challenge',
      description: 'Walk 100k steps this month.', status: 'active', starts_at: null, ends_at: null, metric_key: 'steps',
      target_value: 100000, unit: 'steps', leaderboard_enabled: false, created_at: NOW, updated_at: NOW, archived: false,
    },
    participation: {
      challenge_id: 'ch-1', user_id: ME, progress_value: 25000, target_value: 100000, progress_fraction: 0.25,
      completed: false, completed_at: null, last_logged_at: NOW, leaderboard_opted_in: false,
    },
  });
  jest.spyOn(communityWinsApi, 'getFeed').mockResolvedValue([]);
  jest.spyOn(communitySafetyApi, 'listNotices').mockResolvedValue({ notices: [], unread_count: 0 });
  authEvents.emit('logout'); // no draft (or key) left over from the row before
  await waitFor(() => expect([...mockDisk.keys()]).toEqual([]));
  await setUserCache({ id: ME, role: 'client', firstName: 'Dana', coach_id: COACH });
});
afterEach(async () => {
  setOS(realOS as 'ios' | 'android');
  jest.restoreAllMocks();
  await clearUserCache();
});

/** Answer every write to `row.path` with `answer`. */
const answerWith = (row: Row, answer: (words: string) => unknown) =>
  mockPost.mockImplementation((url: unknown, body: Record<string, unknown>) =>
    row.path.test(String(url))
      ? Promise.resolve({ data: answer(String(body.body ?? body.description ?? '')) })
      : Promise.reject(NO_ANSWER));

/** Hold the first write to `row.path` until `land(answer)`. */
const holdWith = (row: Row) => {
  let land!: (data: unknown) => void;
  const held = new Promise((resolve) => { land = (data) => resolve({ data }); });
  mockPost.mockImplementation((url: unknown) => (row.path.test(String(url)) ? held : Promise.reject(NO_ANSWER)));
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { land: async (data: unknown) => { await act(async () => { land(data); await tick(); await tick(); }); } };
};

describe('CRISIS-TEXT-M: the poster of flagged community text sees the 911 / 988 line at once', () => {
  it('names the six phone places of b#1232\'s routes, and the line is guideline 7\'s 911 and 988 sentences', () => {
    expect(ROWS.map((r) => r.place)).toEqual([
      'composer post (S3)', 'composer DM (S6)', 'DM thread (S6)', 'post thread reply (S5)', 'challenge note (S7)',
      'wins form (S8)',
    ]);
    expect(COMMUNITY_GUIDELINES[6]).toBe(`This space is not for emergencies. ${LINE}`); // ruling 3: built from guideline 7
  });

  it.each(ROWS.map((r) => [r.place, r] as const))('case 1 %s: a flagged answer shows the line once, at once; the rest as at base', async (_p, row) => {
    answerWith(row, (words) => row.answer(FLAGGED, words));
    const v = await row.open();
    await row.fill(v, WORDS);
    await row.send(v);
    await waitFor(() => expect(lineAlerts()).toHaveLength(1));
    expect(lineAlerts()[0]).toEqual(['', LINE]); // no title, the line as the message, the system OK (as Report sent)
    await row.ended(v);
    const sent = writesTo(row.path);
    expect(sent).toHaveLength(1);
    expect(sent[0][1]).toEqual(row.body(WORDS)); // what is posted is today's body
    expect(lineAlerts()).toHaveLength(1);
    await v.unmount();
  });

  it.each(ROWS.flatMap((r) => ([
    ['no field (an unmatched write, or the older server d35b77db)', {}],
    ['crisis_flag false', { crisis_flag: false }],
    ['crisis_flag null', { crisis_flag: null }],
    ['crisis_flag "true"', { crisis_flag: 'true' }],
    ['crisis_flag 1', { crisis_flag: 1 }],
  ] as const).map(([what, flag]) => [r.place, what, r, flag] as const)))(
    'case 2 %s, %s: no line, no error, the same send as at base',
    async (_p, _w, row, flag) => {
      answerWith(row, (words) => row.answer(flag as Flag, words));
      const v = await row.open();
      await row.fill(v, WORDS);
      await row.send(v);
      await row.ended(v);
      expect(lineAlerts()).toHaveLength(0);
      expect(alertSpy()).not.toHaveBeenCalled();
      const sent = writesTo(row.path);
      expect(sent).toHaveLength(1);
      expect(sent[0][1]).toEqual(row.body(WORDS));
      await v.unmount();
    },
  );

  const challenge = ROWS.find((r) => r.place === 'challenge note (S7)') as Row;
  it('case 3 S7: a flagged note that was stored lists, with the line, instead of an error', async () => {
    const note = challenge.answer(FLAGGED, WORDS);
    answerWith(challenge, () => note);
    const v = await challenge.open();
    (communityChallengesApi.listComments as jest.Mock).mockResolvedValue({ comments: [note.comment], next_cursor: null });
    await challenge.fill(v, WORDS);
    await challenge.send(v);
    await waitFor(() => expect(v.getByText(WORDS)).toBeTruthy());
    expect(v.queryByTestId('community-challenge-action-error')).toBeNull();
    expect(lineAlerts()).toHaveLength(1);
    expect(sentry.captureError).not.toHaveBeenCalled(); // at base the strict parse sends a report naming the key
    await v.unmount();
  });

  it('case 3 S7: an answer with any other unknown key still fails the strict parse, as at base', async () => {
    answerWith(challenge, (words) => ({ ...challenge.answer({}, words), crisis_level: 'high' }));
    const v = await challenge.open();
    await challenge.fill(v, WORDS);
    await challenge.send(v);
    await waitFor(() => expect(v.getByTestId('community-challenge-action-error')).toBeTruthy());
    expect(challenge.inlineText?.(v)).toMatch(/server problem/);
    expect(lineAlerts()).toHaveLength(0);
    await v.unmount();
  });

  it.each(ROWS.map((r) => [r.place, r.refusalShows, r] as const))(
    'cases 4 and 5 %s: a flagged refusal shows the line first and the refusal in one %s; the draft stays',
    async (_p, _shows, row) => {
      mockPost.mockImplementation((url: unknown) =>
        row.path.test(String(url)) ? Promise.reject(refusal(FLAGGED, row.wirePath)) : Promise.reject(NO_ANSWER));
      const v = await row.open();
      await row.fill(v, WORDS);
      await row.send(v);
      const joined = `${LINE}\n\n${REFUSED}`;
      if (row.refusalShows === 'alert') {
        await waitFor(() => expect(alertSpy()).toHaveBeenCalledTimes(1));
        expect(alertSpy().mock.calls[0]).toEqual(['Please rephrase', joined]);
      } else {
        await waitFor(() => expect(row.inlineText?.(v)).toBe(joined));
        expect(alertSpy()).not.toHaveBeenCalled();
      }
      row.kept(v, WORDS);
      expect(writesTo(row.path)).toHaveLength(1);
      await v.unmount();
    },
  );

  it.each(ROWS.map((r) => [r.place, r] as const))('case 4 %s: a refusal without the flag shows today\'s exact message', async (_p, row) => {
    mockPost.mockImplementation((url: unknown) =>
      row.path.test(String(url)) ? Promise.reject(refusal({}, row.wirePath)) : Promise.reject(NO_ANSWER));
    const v = await row.open();
    await row.fill(v, WORDS);
    await row.send(v);
    if (row.refusalShows === 'alert') {
      await waitFor(() => expect(alertSpy()).toHaveBeenCalledTimes(1));
      expect(alertSpy().mock.calls[0]).toEqual(['Please rephrase', REFUSED]);
    } else {
      await waitFor(() => expect(row.inlineText?.(v)).toBe(REFUSED));
    }
    expect(lineAlerts()).toHaveLength(0);
    row.kept(v, WORDS);
    await v.unmount();
  });

  it.each(ROWS.filter((r) => r.place !== 'wins form (S8)').map((r) => [r.place, r] as const))(
    'case 6 %s: Send again after a lost answer (same key) shows the line for that answer, once',
    async (_p, row) => {
      let n = 0;
      mockPost.mockImplementation((url: unknown) => {
        if (!row.path.test(String(url))) return Promise.reject(NO_ANSWER);
        n += 1;
        return n === 1 ? Promise.reject(NO_ANSWER) : Promise.resolve({ data: row.answer(FLAGGED, WORDS) });
      });
      const v = await row.open();
      await row.fill(v, WORDS);
      await row.send(v);
      await waitFor(() => expect(writesTo(row.path)).toHaveLength(1));
      if (row.place.startsWith('composer')) await waitFor(() => expect(alertSpy()).toHaveBeenCalledTimes(1)); // offline
      await row.fill(v, WORDS); // still in the box, or restored after the failure
      await row.send(v);
      await waitFor(() => expect(lineAlerts()).toHaveLength(1));
      const [first, again] = writesTo(row.path);
      expect(keyOf(first)).toEqual(expect.stringMatching(UUID));
      expect(keyOf(again)).toBe(keyOf(first)); // the server answers the first row, with the flag again
      await row.ended(v);
      expect(lineAlerts()).toHaveLength(1);
      await v.unmount();
    },
  );

  it('case 6 S8: the wins form still sends a new key on every call, and each flagged answer shows the line once', async () => {
    const wins = ROWS.find((r) => r.place === 'wins form (S8)') as Row;
    answerWith(wins, (words) => wins.answer(FLAGGED, words));
    let v = await wins.open();
    await wins.fill(v, WORDS);
    await wins.send(v);
    await waitFor(() => expect(lineAlerts()).toHaveLength(1));
    await v.unmount();
    v = await wins.open();
    await wins.fill(v, WORDS);
    await wins.send(v);
    await waitFor(() => expect(lineAlerts()).toHaveLength(2));
    const [first, second] = writesTo(wins.path);
    expect(keyOf(first)).toEqual(expect.stringMatching(UUID));
    expect(keyOf(second)).not.toBe(keyOf(first)); // communityWinsApi.ts:93, unchanged
    await v.unmount();
  });

  it.each(ROWS.filter((r) => r.place !== 'wins form (S8)').map((r) => [r.place, r] as const))(
    'case 7 %s: the screen is gone (Back during the send) before the answer lands: the line still shows',
    async (_p, row) => {
      const hold = holdWith(row);
      const v = await row.open();
      await row.fill(v, WORDS);
      await row.send(v);
      await waitFor(() => expect(writesTo(row.path)).toHaveLength(1));
      await v.unmount();
      await hold.land(row.answer(FLAGGED, WORDS));
      await waitFor(() => expect(lineAlerts()).toHaveLength(1));
    },
  );

  it('case 7 S8 on iOS: the wins sheet closes on success, and the line waits until it is gone, then shows once', async () => {
    setOS('ios');
    const wins = ROWS.find((r) => r.place === 'wins form (S8)') as Row;
    answerWith(wins, (words) => wins.answer(FLAGGED, words));
    const v = await wins.open();
    const dismiss = sheetDismiss(v);
    await wins.fill(v, WORDS);
    await wins.send(v);
    await wins.ended(v);
    expect(lineAlerts()).toHaveLength(0); // an alert raised while the sheet closes is lost on iOS (SafetyMenu.tsx:147-152)
    await act(async () => { dismiss(); });
    expect(lineAlerts()).toHaveLength(1);
    await v.unmount();
    expect(lineAlerts()).toHaveLength(1);
  });

  it('case 7 S8 on iOS: the sheet closed (Close) before the answer lands: the line shows at once', async () => {
    setOS('ios');
    const wins = ROWS.find((r) => r.place === 'wins form (S8)') as Row;
    const hold = holdWith(wins);
    const v = await wins.open();
    const dismiss = sheetDismiss(v);
    await wins.fill(v, WORDS);
    await wins.send(v);
    await waitFor(() => expect(writesTo(wins.path)).toHaveLength(1));
    await act(async () => { fireEvent.press(v.getByLabelText('Close')); });
    await act(async () => { dismiss(); });
    await hold.land(wins.answer(FLAGGED, WORDS));
    await waitFor(() => expect(lineAlerts()).toHaveLength(1));
    await v.unmount();
  });

  it('case 7 S8 on iOS: the screen goes while the line waits for the sheet: the line still shows', async () => {
    setOS('ios');
    const wins = ROWS.find((r) => r.place === 'wins form (S8)') as Row;
    const hold = holdWith(wins);
    const v = await wins.open();
    await wins.fill(v, WORDS);
    await wins.send(v);
    await waitFor(() => expect(writesTo(wins.path)).toHaveLength(1));
    await hold.land(wins.answer(FLAGGED, WORDS));
    await v.unmount();
    await waitFor(() => expect(lineAlerts()).toHaveLength(1));
  });

  it.each(ROWS.flatMap((r) => (['sign-out', 'an account switch'] as const).map((how) => [r.place, how, r] as const)))(
    'case 8 %s: %s before the answer lands: the next account sees no line',
    async (_p, how, row) => {
      const hold = holdWith(row);
      const v = await row.open();
      await row.fill(v, WORDS);
      await row.send(v);
      await waitFor(() => expect(writesTo(row.path)).toHaveLength(1));
      if (how === 'sign-out') await clearUserCache(); // signOut empties the identity mirror (authActions.ts, userCache.ts:217-223)
      else await setUserCache({ id: '12121212-1212-4212-8212-121212121212', role: 'client' });
      await hold.land(row.answer(FLAGGED, WORDS));
      await v.unmount();
      expect(lineAlerts()).toHaveLength(0);
    },
  );

  it.each(ROWS.map((r) => [r.place, r] as const))(
    'case 9 %s: after a flagged answer and a flagged refusal no cache, store, draft, log, report or event holds the key or the line',
    async (_p, row) => {
      let n = 0;
      mockPost.mockImplementation((url: unknown) => {
        if (!row.path.test(String(url))) return Promise.reject(NO_ANSWER);
        n += 1;
        return n === 1 ? Promise.reject(refusal(FLAGGED, row.wirePath)) : Promise.resolve({ data: row.answer(FLAGGED, WORDS) });
      });
      const v = await row.open();
      await row.fill(v, WORDS);
      await row.send(v);
      await waitFor(() => expect(writesTo(row.path)).toHaveLength(1));
      await row.fill(v, `${WORDS}.`);
      await row.send(v);
      await waitFor(() => expect(writesTo(row.path)).toHaveLength(2));
      await row.ended(v);
      const hasIt = (s: string) => s.includes('crisis_flag') || s.includes(LINE) || s.includes('crisis');
      // React Query: every query's data and every mutation's data and variables (a mutationFn's return is kept there).
      const queries = client.getQueryCache().getAll().map((q) => q.state.data);
      const mutations = client.getMutationCache().getAll().map((m) => ({ data: m.state.data, variables: m.state.variables }));
      expect(hasIt(JSON.stringify(queries))).toBe(false);
      expect(hasIt(JSON.stringify(mutations))).toBe(false);
      // A refused write's error is the server's own 422 (as at base); what may be saved of it holds neither.
      client.getMutationCache().getAll().forEach((m) => {
        expect(hasIt(JSON.stringify(persistableError(m.state.error)) ?? '')).toBe(false);
        expect(hasIt(JSON.stringify(persistableError(m.state.failureReason)) ?? '')).toBe(false);
      });
      // Drafts and kept keys on the device, AsyncStorage, logs, Sentry, analytics.
      expect(hasIt(JSON.stringify([...mockDisk.entries()]))).toBe(false);
      const keys = await AsyncStorage.getAllKeys();
      const stored = await Promise.all(keys.map(async (k) => [k, await AsyncStorage.getItem(k)]));
      expect(hasIt(JSON.stringify(stored))).toBe(false);
      const calls = [
        ...(logger.warn as jest.Mock).mock.calls, ...(logger.info as jest.Mock).mock.calls,
        ...(logger.error as jest.Mock).mock.calls, ...(logger.debug as jest.Mock).mock.calls,
        ...(sentry.captureError as jest.Mock).mock.calls, ...(analytics.track as jest.Mock).mock.calls,
      ];
      expect(hasIt(JSON.stringify(calls.map((c) => c.map((a: unknown) => (a instanceof Error ? a.message : a)))))).toBe(false);
      expect(sentry.captureError).not.toHaveBeenCalled();
      await v.unmount();
    },
  );

  it('case 10: a read the recipient, another member or the coach makes never shows the line (only the poster\'s own write answer does)', async () => {
    (communityApi.listDmMessages as jest.Mock).mockRestore();
    mockGet.mockImplementation((url: unknown) =>
      /\/dms\/coach-7\/messages$/.test(String(url))
        ? Promise.resolve({ data: { messages: [{
          id: '77777777-7777-4777-8777-777777777777', thread_id: `${WS}:dm`, sender_user_id: '88888888-8888-4888-8888-888888888888',
          recipient_user_id: ME, body: WORDS, created_at: NOW, deleted: false, crisis_flag: true,
        }], crisis_flag: true } })
        : Promise.reject(NO_ANSWER));
    mockParams.current = { recipientId: COACH, participantLabel: 'Sam Rivera' };
    const v = await render(withQuery(<CommunityDmThreadScreen />));
    await waitFor(() => expect(v.getByText(WORDS)).toBeTruthy());
    expect(lineAlerts()).toHaveLength(0);
    await v.unmount();
  });

  it('case 11: the challenge banner carries the whole line as its accessible text and announces it; the wins text announces itself', async () => {
    const joined = `${LINE}\n\n${REFUSED}`;
    mockPost.mockImplementation((url: unknown) =>
      challenge.path.test(String(url)) ? Promise.reject(refusal(FLAGGED, challenge.wirePath)) : Promise.reject(NO_ANSWER));
    let v = await challenge.open();
    await challenge.fill(v, WORDS);
    await challenge.send(v);
    await waitFor(() => expect(v.getByTestId('community-challenge-action-error')).toBeTruthy());
    const banner = v.getByTestId('community-challenge-action-error');
    expect(banner.props.accessibilityLabel).toBe(joined);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(joined);
    await v.unmount();

    setOS('ios'); // Android reads the polite live region; iOS needs the announcement
    const wins = ROWS.find((r) => r.place === 'wins form (S8)') as Row;
    mockPost.mockImplementation((url: unknown) =>
      wins.path.test(String(url)) ? Promise.reject(refusal(FLAGGED, wins.wirePath)) : Promise.reject(NO_ANSWER));
    (AccessibilityInfo.announceForAccessibility as jest.Mock).mockClear();
    v = await wins.open();
    await wins.fill(v, WORDS);
    await wins.send(v);
    await waitFor(() => expect(wins.inlineText?.(v)).toBe(joined));
    expect(v.getByTestId('wins-post-error').props.accessibilityLiveRegion).toBe('polite');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(joined);
    await v.unmount();
  });

  it('case 13: a reaction answer that carries the key shows no line (reactions are not one of b#1232\'s routes)', async () => {
    mockPost.mockImplementation((url: unknown) =>
      /\/reactions$/.test(String(url))
        ? Promise.resolve({ data: { target_type: 'post', target_id: POST, reactions: [], crisis_flag: true } })
        : Promise.reject(NO_ANSWER));
    await communityApi.reactToPost(POST, require('../api/communityApi').COMMUNITY_REACTION_EMOJI[0]);
    expect(lineAlerts()).toHaveLength(0);
  });
});
