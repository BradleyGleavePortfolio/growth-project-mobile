/**
 * FIX-953R3 (class-first, LS-953R2 B2): every answer a keyed write can give to a same-key resend, read from backend
 * main f239683f, and what the phone does with the key after it. The promise: a send-once key is dropped only on an
 * answer after which a same-key resend can never store or return the first send's result; every answer that says the
 * first send may still finish keeps it. One row per write and answer. Each row runs the real API call over a stubbed
 * wire, then asks the shared rule (lib/sendOnce failedSendKeepsKey) what a failure does to the key; an answered row
 * resolves, and its holder ends the draft and the key with it (the per-write send-once suites).
 *
 * Community writes take a transaction lock on the keyed id and then return the first row (message-idempotency.ts
 * keyedWrite), so a same-key resend waits for the first send and is never answered "still being written": their only
 * answers are the first row, 409 (other words under the key) and 400 (a key that is not a UUID). The Roman turn
 * (Roman chat and Copilot share it) answers a resend from replayTurn: the reply, 409, or one coded frame. The
 * refusal, cap and pool frames come from a first send (or a future server), never from replayTurn; they end the key.
 */
jest.mock('../services/api', () => ({ __esModule: true, default: { post: (...a: unknown[]) => mockPost(...a) } }));
jest.mock('../services/secureStorage', () => ({ secureStorage: { getItem: jest.fn(async () => 'test-token') } }));
jest.mock('../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));

import { communityApi } from '../api/communityApi';
import { communityChallengesApi } from '../api/communityChallengesApi';
import { sendMessage } from '../api/romanApi';
import { failedSendKeepsKey } from '../lib/sendOnce';

const mockPost = jest.fn();
const KEY = '0f8b5c2e-6a1d-4c3b-9e7f-2d4a6b8c0e1f';
const WS = '11111111-1111-1111-1111-111111111111';
const UID = '22222222-2222-2222-2222-222222222222';
const POST = '33333333-3333-3333-3333-333333333333';
const RECIP = '44444444-4444-4444-4444-444444444444';
const ROW_ID = '55555555-5555-5555-5555-555555555555';
const THREAD = '66666666-6666-6666-6666-666666666666';
const CHALLENGE = '77777777-7777-7777-7777-777777777777';
const ISO = '2026-11-09T12:00:00.000Z';
const WORDS = 'Same words';

type Row = {
  write: string;
  /** What the server answers a same-key resend (or, marked, only a first send). */
  answer: string;
  /** Where backend main f239683f sends it. */
  server: string;
  /** Where the phone reads it. */
  phone: string;
  /** What the key does after this answer. */
  key: 'kept' | 'ended';
  /** The answer is the first send's result: the call resolves and the draft ends with its key. */
  answered?: true;
  resend: () => Promise<unknown>;
};

// ─── The Roman turn: Roman chat and Copilot share one route and one sendMessage ──────────────────────────────────

const frame = (code: string) =>
  `event: error\ndata: {"code":"${code}","message":"Roman is not available right now."}\n\n`;
const REPLY = 'data: {"type":"delta","text":"Swap it."}\n\ndata: {"type":"done","text":"Swap it.","messageId":"m-reply-1","interrupted":false}\n\n';

const romanWire = (status: number, body: string) => {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
  })) as unknown as typeof fetch;
};

const ROMAN_ROUTE = 'POST /roman/sessions/:id/messages';
const romanRows = (surface: 'Roman chat' | 'Copilot'): Row[] => {
  const write = `${ROMAN_ROUTE} (${surface})`;
  const send = () => sendMessage('sess-1', WORDS, { ...(surface === 'Copilot' ? { copilot: true } : {}), idempotencyKey: KEY });
  const via = (status: number, body: string) => () => { romanWire(status, body); return send(); };
  return [
    {
      write,
      answer: 'ROMAN_REPLY_PENDING frame: the first send may still store its reply',
      server: 'roman.controller.ts:307-309 (first.pending, roman.service.ts:869-872; a lost first-send race :209-213); roman-sse-error.ts:33-37',
      phone: 'romanApi.ts sendMessage stream-error branch: ROMAN_REPLY_PENDING_CODE -> plain RomanApiError, turnStored',
      key: 'kept',
      resend: via(200, frame('ROMAN_REPLY_PENDING')),
    },
    {
      write,
      answer: 'ROMAN_UNAVAILABLE frame: the first send ended with no reply, or the 660 s bound passed',
      server: 'roman.controller.ts:308 (ROMAN_SSE_FALLBACK_ERROR, roman-sse-error.ts:28-31)',
      phone: "romanApi.ts sendMessage stream-error branch: RomanKeySpentError 'unavailable'",
      key: 'ended',
      resend: via(200, frame('ROMAN_UNAVAILABLE')),
    },
    {
      write,
      answer: 'the stored reply replayed (delta + done)',
      server: 'roman.controller.ts:313-328',
      phone: 'romanApi.ts sendMessage done path',
      key: 'ended',
      answered: true,
      resend: via(200, REPLY),
    },
    {
      write,
      answer: '409: other words under the key',
      server: 'roman.controller.ts:304 (IDEMPOTENCY_KEY_REUSED)',
      phone: 'romanApi.ts sendMessage 400 / 409 -> RomanKeySpentError',
      key: 'ended',
      resend: via(409, '{"error":"conflict","code":"community.message.idempotency_key_reused"}'),
    },
    {
      write,
      answer: '400: a key that is not a UUID',
      server: 'roman.controller.ts:151 (messageKey, message-idempotency.ts:35)',
      phone: 'romanApi.ts sendMessage 400 / 409 -> RomanKeySpentError',
      key: 'ended',
      resend: via(400, '{"error":"bad_request","code":"community.message.idempotency_key_invalid"}'),
    },
    ...(surface === 'Roman chat'
      ? ([
          ['ai_consent_required', 'romanApi.ts aiRefusalFromStreamCode -> RomanKeySpentError aiRefused'],
          ['ROMAN_CAPACITY_REACHED', 'romanApi.ts aiDailyCapFromStreamCode -> RomanKeySpentError dailyCap'],
          ['COACH_AI_BUDGET_EXHAUSTED', "romanApi.ts COACH_AI_BUDGET_EXHAUSTED_CODE -> RomanKeySpentError poolEmpty"],
          ['ROMAN_SOMETHING_NEW', "romanApi.ts an unknown code -> RomanKeySpentError 'generic'"],
        ] as const).map(([code, phone]): Row => ({
          write,
          answer: `${code} frame (a first send or a future server only; replayTurn never sends it)`,
          server: 'roman.controller.ts:297-329 sends none of these; the first send streams them',
          phone,
          key: 'ended',
          resend: via(200, frame(code)),
        }))
      : []),
  ];
};

// ─── The community writes: a transaction lock on the keyed id, then the first row ────────────────────────────────

const answerWith = (data: unknown) => mockPost.mockResolvedValueOnce({ data });
const refuseWith = (status: number, data: unknown) =>
  mockPost.mockRejectedValueOnce({ isAxiosError: true, message: `HTTP ${status}`, response: { status, data } });
const REUSED = { error: 'conflict', code: 'community.message.idempotency_key_reused' };
const INVALID = { error: 'bad_request', code: 'community.message.idempotency_key_invalid' };

const communityRows = (
  write: string,
  server: { first: string; reused: string; invalid: string },
  phone: string,
  call: () => Promise<unknown>,
  firstRow: unknown,
): Row[] => [
  {
    write,
    answer: 'the first row (a resend waits on the keyed lock, then gets the first send\'s row)',
    server: `${server.first}; message-idempotency.ts:63-72 keyedWrite`,
    phone,
    key: 'ended',
    answered: true,
    resend: () => { answerWith(firstRow); return call(); },
  },
  {
    write,
    answer: '409: other words under the key',
    server: server.reused,
    phone: `${phone}; apiCall.ts call (status 409)`,
    key: 'ended',
    resend: () => { refuseWith(409, REUSED); return call(); },
  },
  {
    write,
    answer: '400: a key that is not a UUID',
    server: `${server.invalid} (messageKey, message-idempotency.ts:35)`,
    phone: `${phone}; apiCall.ts call (status 400)`,
    key: 'ended',
    resend: () => { refuseWith(400, INVALID); return call(); },
  },
];

const SEND_ONCE_RESEND_ANSWERS: Row[] = [
  ...romanRows('Roman chat'),
  ...romanRows('Copilot'),
  ...communityRows(
    'POST /community/workspaces/:workspaceId/dms/:recipientId/messages',
    {
      first: 'community-dms.service.ts:193, :198 replay; community-dms.repository.ts:34-36',
      reused: 'community-dms.service.ts:235',
      invalid: 'community-dms.controller.ts:116',
    },
    'communityApi.ts sendDm',
    () => communityApi.sendDm(WS, RECIP, WORDS, KEY),
    { message: { id: ROW_ID, thread_id: THREAD, sender_user_id: UID, recipient_user_id: RECIP, body: WORDS, created_at: ISO, deleted: false } },
  ),
  ...communityRows(
    'POST /community/workspaces/:workspaceId/posts',
    {
      first: 'community-posts.service.ts:260, :265 replayPost; community-posts.repository.ts:25-28',
      reused: 'community-posts.service.ts:291',
      invalid: 'community-posts.controller.ts:68',
    },
    'communityApi.ts createPost',
    () => communityApi.createPost(WS, { title: 'Week one', body: WORDS }, KEY),
    {
      post: {
        id: POST, workspace_id: WS, cohort_id: null, author_user_id: UID, title: 'Week one', body: WORDS, scope: 'hall',
        type: 'text', pinned: false, created_at: ISO, updated_at: ISO, deleted: false,
      },
    },
  ),
  ...communityRows(
    'POST /community/posts/:postId/comments',
    {
      first: 'community-posts.service.ts:436, :441 replayComment; community-messages.repository.ts:358',
      reused: 'community-posts.service.ts:482',
      invalid: 'community-posts.controller.ts:151',
    },
    'communityApi.ts addComment',
    () => communityApi.addComment(POST, WORDS, KEY),
    { comment: { id: ROW_ID, post_id: POST, author_user_id: UID, body: WORDS, created_at: ISO } },
  ),
  ...communityRows(
    'POST /community/challenges/:challengeId/comments',
    {
      first: 'community-challenges.service.ts:621-625; community-challenges.repository.ts:512-514',
      reused: 'community-challenges.service.ts:628',
      invalid: 'community-challenges.controller.ts:253',
    },
    'communityChallengesApi.ts addComment',
    () => communityChallengesApi.addComment(CHALLENGE, WORDS, KEY),
    { comment: { id: ROW_ID, challenge_id: CHALLENGE, author_user_id: UID, body: WORDS, created_at: ISO } },
  ),
];

const realFetch = global.fetch;
beforeEach(() => { mockPost.mockReset(); });
afterEach(() => { global.fetch = realFetch; });

describe('FIX-953R3: every answer to a same-key resend, and the key after it', () => {
  it('covers the five keyed writes and Copilot; only "still being written" keeps the key', () => {
    expect([...new Set(SEND_ONCE_RESEND_ANSWERS.map((row) => row.write))]).toEqual([
      'POST /roman/sessions/:id/messages (Roman chat)',
      'POST /roman/sessions/:id/messages (Copilot)',
      'POST /community/workspaces/:workspaceId/dms/:recipientId/messages',
      'POST /community/workspaces/:workspaceId/posts',
      'POST /community/posts/:postId/comments',
      'POST /community/challenges/:challengeId/comments',
    ]);
    // Keeping the key on any other answer brings the dead end back (Send again could never ask once more).
    expect(SEND_ONCE_RESEND_ANSWERS.filter((row) => row.key === 'kept').map((row) => row.write)).toEqual([
      'POST /roman/sessions/:id/messages (Roman chat)',
      'POST /roman/sessions/:id/messages (Copilot)',
    ]);
    SEND_ONCE_RESEND_ANSWERS.forEach((row) => {
      expect(row.server).not.toBe('');
      expect(row.phone).not.toBe('');
    });
  });

  it.each(SEND_ONCE_RESEND_ANSWERS.map((row) => [row.write, row.answer, row.key, row] as const))(
    '%s, a same-key resend answered %s: the key is %s',
    async (_write, _answer, _key, row) => {
      const outcome = await row.resend().then(
        (value) => ({ answered: true as const, value }),
        (err: unknown) => ({ answered: false as const, err }),
      );
      if (row.answered) {
        expect(outcome.answered).toBe(true); // the first send's result: the draft ends, and its key with it
        return;
      }
      expect(outcome.answered).toBe(false);
      if (outcome.answered) return;
      expect(failedSendKeepsKey(outcome.err)).toBe(row.key === 'kept');
    },
  );
});
