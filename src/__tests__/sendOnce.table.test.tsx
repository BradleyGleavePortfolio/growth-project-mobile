/**
 * SEND-ONCE-PHONE (182-S10): the phone's mirror of the server's send-once table (backend test/send-once.table.spec.ts,
 * b#1228). One row per write the member can send again with the same words. Each row names the server row it mirrors,
 * the phone lines where its key lives and travels, and a proof at the wire: the real screen, hook and API call send
 * once and get no answer, then Send again / Publish again / Retry sends the same words. Both requests must carry the
 * same v4 Idempotency-Key header (never a body field), and new words must carry a new one. A resend that makes a new
 * key, or sends none, turns its row red by name. The shape check pins the table to the server's five phone writes;
 * other phone paths that resend one of them (Copilot's Try again, an earlier Copilot turn's Try again after another
 * question, a Roman quick-start chip tapped again beside another draft) get a row of their own.
 * Only the wire is stubbed: `services/api` posts (community) and `fetch` (Roman); reads answer through spies.
 */
import React from 'react';
import { AccessibilityInfo, Alert } from 'react-native';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
jest.mock('../services/accountBinding', () => ({
  ...jest.requireActual('../services/accountBinding'),
  captureAccountBinding: async () => null,
}));
jest.mock('../api/romanApi', () => ({
  ...jest.requireActual('../api/romanApi'),
  openOrResumeSession: async () => ({ id: 'sess-1', surface: 'client', messageCount: 0 }),
  listMessages: async () => ({ messages: [], nextCursor: null }),
  deleteSession: jest.fn(),
}));
jest.mock('../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'me-1', firstName: 'Dana', name: 'Dana', coach_id: 'coach-7' }),
}));
jest.mock('../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('../config/featureFlags', () => ({
  ...jest.requireActual('../config/featureFlags'),
  featureFlags: { ...jest.requireActual('../config/featureFlags').featureFlags, communityChallenges: true },
}));
const mockParams: { current: Record<string, unknown> } = { current: {} };
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({ goBack: jest.fn(), navigate: jest.fn() }),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams.current }),
  useFocusEffect: () => undefined,
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../components/community/SafetyMenu', () => () => null);
jest.mock('../components/roman/RomanAvatar', () => () => null);
jest.mock('../components/ai/useOpenSupport', () => ({ useOpenSupport: () => jest.fn() }));
jest.mock('../components/roman/RomanConsentGate', () => ({ children }: { children: React.ReactNode }) => children);

const { communityApi } = require('../api/communityApi');
const { removedRowsApi } = require('../api/communityRemovedRows');
const { communityChallengesApi } = require('../api/communityChallengesApi');
const { authEvents } = require('../utils/authEvents');
const CommunityDmThreadScreen = require('../screens/community/CommunityDmThreadScreen').default;
const CommunityComposerScreen = require('../screens/community/CommunityComposerScreen').default;
const CommunityThreadScreen = require('../screens/community/CommunityThreadScreen').default;
const CommunityChallengeDetailScreen = require('../screens/community/CommunityChallengeDetailScreen').default;
const RomanChatScreen = require('../screens/roman/RomanChatScreen').default;
const { useCopilotAsk } = require('../screens/client/copilot/useCopilotAsk');
const { ROMAN_QUICK_STARTS } = require('../components/roman/romanVoice');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WS = '11111111-1111-1111-1111-111111111111';
const POST = '33333333-3333-3333-3333-333333333333';
const NOW = '2026-03-01T00:00:00Z';
const NO_ANSWER = { isAxiosError: true, message: 'Network Error' }; // no response: offline or the answer was lost

type View = Awaited<ReturnType<typeof render>>;
/** One request at the wire: the key header it carried and the body it sent. */
type Sent = { key: unknown; body: Record<string, unknown> };

/** Community writes at the wire: every `services/api` post to `path`. */
const postsTo = (path: RegExp): Sent[] =>
  mockPost.mock.calls
    .filter(([url]) => path.test(String(url)))
    .map(([, body, config]) => ({
      key: (config as { headers?: Record<string, unknown> } | undefined)?.headers?.['Idempotency-Key'],
      body: body as Record<string, unknown>,
    }));
/** Roman turns at the wire: every `fetch` to the session's messages. */
const fetchMock = jest.fn(async (_url: string, _init: RequestInit): Promise<Response> => {
  throw new TypeError('Network request failed'); // no answer, every time
});
const romanTurns = (): Sent[] =>
  fetchMock.mock.calls
    .filter(([url]) => /\/roman\/sessions\/sess-1\/messages$/.test(String(url)))
    .map(([, init]) => ({
      key: (init.headers as Record<string, unknown>)['Idempotency-Key'],
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    }));

const press = async (v: View, testID: string) => {
  await act(async () => { fireEvent.press(v.getByTestId(testID)); });
};
const type = async (v: View, testID: string, words: string) => {
  await fireEvent.changeText(v.getByTestId(testID), words);
};
const withQuery = (node: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
};

type Row = {
  /** The server row this mirrors (backend test/send-once.table.spec.ts `write`). */
  write: string;
  /** The member's resend. */
  resend: 'Send again' | 'Publish again' | 'Retry';
  /** Where the key is kept and where it travels. */
  phone: string[];
  open: () => Promise<View>;
  /** Put `words` in the box (the post row writes a title and a body). */
  fill: (v: View, words: string) => Promise<void>;
  send: (v: View) => Promise<void>;
  again: (v: View) => Promise<void>;
  /** This row's requests at the wire, oldest first. */
  wire: () => Sent[];
  /** The body the server sees for `words` (the key is never in it). */
  body: (words: string) => Record<string, unknown>;
  /** This row's write at the wire (the path its first request is held on). */
  path: RegExp;
  /** Where its draft lasts: on the device (Back and a restart keep it) or in the screen (it ends when the screen closes). */
  lasts: 'device' | 'screen';
};

const DM_FIELD = 'community-dmthread-composer-field';
const THREAD_FIELD = 'community-thread-composer-field';
const CHALLENGE_FIELD = 'community-challenge-composer-field';
const ROMAN_INPUT = 'roman-composer-input';

const SEND_ONCE_PHONE_TABLE: Row[] = [
  {
    write: 'POST /community/workspaces/:workspaceId/dms/:recipientId/messages',
    resend: 'Send again',
    phone: [
      'src/screens/community/CommunityDmThreadScreen.tsx (the thread draft keeps its words and key on the device: lib/chatDrafts)',
      'src/components/community/ComposerInput.tsx (Send again sends the kept key; a refusal the key cannot fix drops it)',
      'src/api/communityApi.ts sendDm (the key as the Idempotency-Key header; body { body })',
    ],
    open: async () => {
      mockParams.current = { recipientId: 'coach-7', participantLabel: 'Sam Rivera' };
      const v = await render(withQuery(<CommunityDmThreadScreen />));
      await waitFor(() => expect(v.getByTestId(DM_FIELD)).toBeTruthy());
      return v;
    },
    fill: (v, words) => type(v, DM_FIELD, words),
    send: (v) => press(v, 'community-dmthread-composer-send'),
    again: (v) => press(v, 'community-dmthread-composer-send'),
    wire: () => postsTo(/\/community\/workspaces\/[^/]+\/dms\/coach-7\/messages$/),
    body: (words) => ({ body: words }),
    path: /\/community\/workspaces\/[^/]+\/dms\/coach-7\/messages$/,
    lasts: 'device',
  },
  {
    write: 'POST /community/workspaces/:workspaceId/posts',
    resend: 'Publish again',
    phone: [
      'src/screens/community/CommunityComposerScreen.tsx (lib/sendOnce useDraftSendKey: one key per title and body)',
      'src/hooks/useCommunity.ts useCreatePost',
      'src/api/communityApi.ts createPost (the key as the Idempotency-Key header; body { title, body })',
    ],
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
    again: (v) => press(v, 'community-composer-submit'),
    wire: () => postsTo(/\/community\/workspaces\/[^/]+\/posts$/),
    body: (words) => ({ title: 'Week one', body: words }),
    path: /\/community\/workspaces\/[^/]+\/posts$/,
    lasts: 'screen',
  },
  {
    write: 'POST /community/posts/:postId/comments',
    resend: 'Send again',
    phone: [
      'src/screens/community/CommunityThreadScreen.tsx (lib/sendOnce useDraftSendKey via ComposerInput)',
      'src/hooks/useCommunity.ts useAddComment',
      'src/api/communityApi.ts addComment (the key as the Idempotency-Key header; body { body })',
    ],
    open: async () => {
      mockParams.current = { postId: POST };
      const v = await render(withQuery(<CommunityThreadScreen />));
      await waitFor(() => expect(v.getByText('World')).toBeTruthy());
      return v;
    },
    fill: (v, words) => type(v, THREAD_FIELD, words),
    send: (v) => press(v, 'community-thread-composer-send'),
    again: (v) => press(v, 'community-thread-composer-send'),
    wire: () => postsTo(new RegExp(`/community/posts/${POST}/comments$`)),
    body: (words) => ({ body: words }),
    path: new RegExp(`/community/posts/${POST}/comments$`),
    lasts: 'screen',
  },
  {
    write: 'POST /community/challenges/:challengeId/comments',
    resend: 'Send again',
    phone: [
      'src/screens/community/CommunityChallengeDetailScreen.tsx (lib/sendOnce useDraftSendKey via ComposerInput)',
      'src/api/communityChallengesApi.ts addComment (the key as the Idempotency-Key header; body { body })',
    ],
    open: async () => {
      mockParams.current = { challengeId: 'ch-1' };
      const v = await render(withQuery(<CommunityChallengeDetailScreen />));
      await waitFor(() => expect(v.getByTestId(CHALLENGE_FIELD)).toBeTruthy());
      return v;
    },
    fill: (v, words) => type(v, CHALLENGE_FIELD, words),
    send: (v) => press(v, 'community-challenge-composer-send'),
    again: (v) => press(v, 'community-challenge-composer-send'),
    wire: () => postsTo(/\/community\/challenges\/ch-1\/comments$/),
    body: (words) => ({ body: words }),
    path: /\/community\/challenges\/ch-1\/comments$/,
    lasts: 'screen',
  },
  {
    write: 'POST /roman/sessions/:id/messages',
    resend: 'Retry',
    phone: [
      'src/screens/roman/RomanChatScreen.tsx (the composer draft keeps its words and key on the device: lib/chatDrafts)',
      'src/screens/roman/useRomanChat.ts send (keeps the key when the failure left it open)',
      'src/api/romanApi.ts sendMessage (the key as the Idempotency-Key header; body { content }; strict schemas stay)',
    ],
    open: async () => {
      const v = await render(<RomanChatScreen surface="client" />);
      await waitFor(() => expect(v.getByTestId(ROMAN_INPUT)).toBeTruthy());
      return v;
    },
    fill: (v, words) => type(v, ROMAN_INPUT, words),
    send: (v) => press(v, 'roman-composer-send'),
    again: async (v) => {
      await waitFor(() => expect(v.getByTestId('roman-send-retry')).toBeTruthy());
      await press(v, 'roman-send-retry');
    },
    wire: romanTurns,
    body: (words) => ({ content: words }),
    path: /\/roman\/sessions\/sess-1\/messages$/,
    lasts: 'device',
  },
];

/**
 * Other phone paths that resend one of the five writes (class-first): each must keep the same key too. Copilot asks
 * through Roman's own send (the same server row), from its own hook; its Try again passes the turn's id. Each proof
 * gives the wire's first send, its resend and a send of other words, in that order; `same` is the resent words.
 * A path where two sends wait at once (two failed Copilot turns, a chip beside a typed draft) is its own row
 * (LS-953 B1, B2): one key slot shared by both loses the first send's key.
 */
type OtherPath = { write: string; resend: string; phone: string[]; same?: string; proof: () => Promise<Sent[]> };
const OTHER_RESEND_PATHS: OtherPath[] = [
  {
    write: 'POST /roman/sessions/:id/messages',
    resend: 'Try again (Copilot)',
    phone: [
      'src/screens/client/copilot/useCopilotAsk.ts ask (one key per question while a failure leaves it open)',
      'src/api/romanApi.ts sendMessage (the key as the Idempotency-Key header; body { content })',
    ],
    proof: async () => {
      const { result } = await renderHook(() => useCopilotAsk());
      await act(async () => { await result.current.ask('Same words'); });
      const turn = result.current.turns[0];
      await act(async () => { await result.current.ask(turn.question, turn.id); });
      await act(async () => { await result.current.ask('Other words'); });
      return romanTurns();
    },
  },
  {
    write: 'POST /roman/sessions/:id/messages',
    resend: 'Try again on an earlier Copilot turn after another question',
    phone: ['src/screens/client/copilot/useCopilotAsk.ts ask (each failed turn keeps its own key, by turn id)'],
    proof: async () => {
      const { result } = await renderHook(() => useCopilotAsk());
      await act(async () => { await result.current.ask('Same words'); });
      const turn = result.current.turns[0];
      await act(async () => { await result.current.ask('Other words'); });
      await act(async () => { await result.current.ask(turn.question, turn.id); });
      const [first, other, again] = romanTurns();
      return [first, again, other];
    },
  },
  {
    write: 'POST /roman/sessions/:id/messages',
    resend: 'A quick-start chip tapped again while another draft is in the box',
    phone: [
      'src/screens/roman/RomanChatScreen.tsx sendText (a chip kept out of the box keeps its key aside)',
      'src/lib/chatDrafts.ts keepAside / keyFor (one kept key per text beside the box, on the device)',
    ],
    same: ROMAN_QUICK_STARTS[0],
    proof: async () => {
      const v = await render(<RomanChatScreen surface="client" />);
      await waitFor(() => expect(v.getByTestId(ROMAN_INPUT)).toBeTruthy());
      await type(v, ROMAN_INPUT, 'Other words');
      await press(v, 'roman-quick-start-0');
      await waitFor(() => expect(romanTurns()).toHaveLength(1));
      await press(v, 'roman-quick-start-0');
      await waitFor(() => expect(romanTurns()).toHaveLength(2));
      expect(v.getByTestId(ROMAN_INPUT).props.value).toBe('Other words');
      await press(v, 'roman-composer-send');
      await waitFor(() => expect(romanTurns()).toHaveLength(3));
      v.unmount();
      return romanTurns();
    },
  },
];

/**
 * Hold the first request to `path` with no answer yet (LS-953R2 B1); `answer()` then ends it with no answer. Every
 * other request gets no answer at once, as in every row.
 */
const holdFirst = (path: RegExp) => {
  let end!: () => void;
  const held = new Promise<never>((_resolve, reject) => { end = () => reject(NO_ANSWER); });
  held.catch(() => undefined);
  let first = true;
  const take = (url: unknown) => {
    if (!first || !path.test(String(url))) return false;
    first = false;
    return true;
  };
  mockPost.mockImplementation((url: unknown) => (take(url) ? held : Promise.reject(NO_ANSWER)));
  fetchMock.mockImplementation(async (url: string) => {
    if (take(url)) await held.catch(() => undefined);
    throw new TypeError('Network request failed');
  });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  // React Query lands a mutation's end on a timer tick: let it, so the screen can send again.
  return { answer: async () => { await act(async () => { end(); await tick(); await tick(); }); } };
};

const realFetch = global.fetch;
beforeEach(async () => {
  mockPost.mockReset().mockRejectedValue(NO_ANSWER); // every community write: no answer
  mockGet.mockReset().mockRejectedValue(NO_ANSWER); // reads the spies below do not answer
  fetchMock.mockReset().mockImplementation(async () => { throw new TypeError('Network request failed'); });
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(communityApi, 'getMe').mockResolvedValue({
    workspace_id: WS, unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  });
  jest.spyOn(communityApi, 'listDmMessages').mockResolvedValue([]);
  jest.spyOn(removedRowsApi, 'listPosts').mockResolvedValue({ posts: [], next_cursor: null });
  jest.spyOn(removedRowsApi, 'getPost').mockResolvedValue({
    id: POST, workspace_id: WS, cohort_id: null, author_user_id: '44444444-4444-4444-4444-444444444444', title: 'Hello',
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
      challenge_id: 'ch-1', user_id: 'me-1', progress_value: 25000, target_value: 100000, progress_fraction: 0.25,
      completed: false, completed_at: null, last_logged_at: NOW, leaderboard_opted_in: false,
    },
  });
  authEvents.emit('logout'); // no draft (or key) left over from the row before
  await waitFor(() => expect([...mockDisk.keys()]).toEqual([]));
});
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('SEND-ONCE-PHONE table: the five writes the member can send again', () => {
  it('lists exactly the five phone writes of the server table, each once, each with its phone lines', () => {
    expect(SEND_ONCE_PHONE_TABLE.map((row) => row.write)).toEqual([
      'POST /community/workspaces/:workspaceId/dms/:recipientId/messages',
      'POST /community/workspaces/:workspaceId/posts',
      'POST /community/posts/:postId/comments',
      'POST /community/challenges/:challengeId/comments',
      'POST /roman/sessions/:id/messages',
    ]);
    SEND_ONCE_PHONE_TABLE.forEach((row) => expect(row.phone.length).toBeGreaterThan(0));
    const writes = SEND_ONCE_PHONE_TABLE.map((row) => row.write);
    OTHER_RESEND_PATHS.forEach((path) => expect(writes).toContain(path.write));
  });

  it.each(OTHER_RESEND_PATHS.map((path) => [path.write, path.resend, path] as const))(
    '%s: %s after no answer sends the same key; new words send a new one',
    async (_write, _resend, path) => {
      const [first, again, other] = await path.proof();
      [first, again, other].forEach((req) => expect(req.key).toEqual(expect.stringMatching(UUID)));
      expect(first.body).toEqual({ content: path.same ?? 'Same words' });
      expect(again.body).toEqual({ content: path.same ?? 'Same words' });
      expect(other.body).toEqual({ content: 'Other words' });
      expect(again.key).toBe(first.key); // a resend that makes a new key fails here
      expect(other.key).not.toBe(first.key);
    },
  );

  it.each(SEND_ONCE_PHONE_TABLE.map((row) => [row.write, row.resend, row] as const))(
    '%s: %s after no answer sends the same key; new words send a new one',
    async (_write, _resend, row) => {
      const v = await row.open();
      await row.fill(v, 'Same words');
      await row.send(v);
      await waitFor(() => expect(row.wire()).toHaveLength(1));
      await row.again(v);
      await waitFor(() => expect(row.wire()).toHaveLength(2));
      await row.fill(v, 'Other words');
      await row.send(v);
      await waitFor(() => expect(row.wire()).toHaveLength(3));

      const [first, again, other] = row.wire();
      [first, again, other].forEach((req) => expect(req.key).toEqual(expect.stringMatching(UUID)));
      expect(first.body).toEqual(row.body('Same words')); // the key travels as the header only
      expect(again.body).toEqual(row.body('Same words'));
      expect(other.body).toEqual(row.body('Other words'));
      expect(again.key).toBe(first.key); // a resend that makes a new key fails here
      expect(other.key).not.toBe(first.key);
      v.unmount();
    },
  );

  // LS-953R2 B1 (class-first): each write keeps its key with its draft before its first request, so the same words
  // sent before that request has any answer send the same key. A draft kept on the device is on the device by then
  // (a restart reads it back: lib/chatDrafts) and survives Back and a reopen; a draft held in its screen is sent again
  // there once the first send ends.
  it.each(SEND_ONCE_PHONE_TABLE.map((row) => [row.write, row.lasts, row] as const))(
    '%s: the key is kept with its draft (%s) before the first request has any answer',
    async (_write, _lasts, row) => {
      const hold = holdFirst(row.path);
      let v = await row.open();
      await row.fill(v, 'Same words');
      await row.send(v);
      await waitFor(() => expect(row.wire()).toHaveLength(1));
      const [first] = row.wire();
      if (row.lasts === 'device') {
        await waitFor(() => expect([...mockDisk.values()].some((d) => d.includes(String(first.key)))).toBe(true));
        await v.unmount(); // Back, then the chat opens again while the first send has no answer yet
        v = await row.open();
      }
      await row.fill(v, 'Same words'); // typed again (a sent box clears) or still in the box
      if (row.lasts === 'screen') await hold.answer(); // one screen sends one at a time: the first ends, no answer
      await row.send(v);
      await waitFor(() => expect(row.wire()).toHaveLength(2));
      if (row.lasts === 'device') await hold.answer();

      const again = row.wire()[1];
      expect(again.body).toEqual(row.body('Same words'));
      expect(again.key).toEqual(expect.stringMatching(UUID));
      expect(again.key).toBe(first.key); // a key minted again for the same draft fails here
      await v.unmount();
    },
  );
});
