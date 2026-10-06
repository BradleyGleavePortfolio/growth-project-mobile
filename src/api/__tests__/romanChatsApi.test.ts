/**
 * romanChatsApi: the client for backend #635 (GET /roman/sessions,
 * DELETE /roman/sessions[/:id]) and the transcript read.
 *
 * Proves: the wire shape is validated (cuid ids accepted, drift rejected as
 * a coded unexpected failure, never thrown), the page size is clamped to the
 * backend bounds, ids are path-encoded, and every backend status + machine
 * code maps to its own failure reason (status AND code, never message text).
 * Also pins the romanApi id fix: the backend ids are cuid, not uuid.
 */
import { failureOf, romanChatsApi, ROMAN_CHATS_MAX_LIMIT } from '../romanChatsApi';
import { RomanSessionSchema, RomanStreamChunkSchema, RomanWireMessageSchema } from '../romanApi';
import { authEpoch, type AccountBinding } from '../../services/accountBinding';
import { authEvents } from '../../utils/authEvents';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../services/secureStorage', () => ({
  secureStorage: { getItem: jest.fn(async () => 'test-token') },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as { get: jest.Mock; delete: jest.Mock };

beforeEach(() => {
  api.get.mockReset();
  api.delete.mockReset();
});

function httpError(status: number, data?: unknown, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status, data, headers },
    config: { headers: { 'x-request-id': 'sent-req-1234' } },
  });
}
function networkError() {
  return Object.assign(new Error('Network Error'), { isAxiosError: true, config: { headers: {} } });
}

const CUID = 'cmg9x2k3l0000abcd1234efgh';
/** The current sign-in of a synthetic account (every request is bound, Sol A-331-4). */
const B = (): AccountBinding => ({ subject: 'sub:user-a', epoch: authEpoch() });
/** The request options every bound call sends: the binding, plus `extra`. */
const sentWith = (extra: Record<string, unknown> = {}) =>
  expect.objectContaining({ accountBinding: expect.objectContaining({ subject: 'sub:user-a' }), ...extra });
const chat = (over: Record<string, unknown> = {}) => ({
  id: CUID,
  surface: 'client',
  dayKey: '2026-10-02',
  messageCount: 6,
  startedAt: '2026-10-02T08:01:00.000Z',
  lastActivityAt: '2026-10-02T08:09:00.000Z',
  ...over,
});

describe('list', () => {
  it('reads a page with cuid ids and the cursor, sending limit and cursor', async () => {
    api.get.mockResolvedValue({ status: 200, data: { sessions: [chat()], nextCursor: CUID } });
    const out = await romanChatsApi.list(B(), { cursor: 'cprev', limit: 30 });
    expect(api.get).toHaveBeenCalledWith('/roman/sessions', sentWith({ params: { limit: 30, cursor: 'cprev' } }));
    expect(out).toEqual({ ok: true, value: { sessions: [chat()], nextCursor: CUID } });
  });

  it('clamps the page size to the backend bounds (1..100) and omits an empty cursor', async () => {
    api.get.mockResolvedValue({ status: 200, data: { sessions: [], nextCursor: null } });
    await romanChatsApi.list(B(), { limit: 1000, cursor: null });
    expect(api.get).toHaveBeenLastCalledWith('/roman/sessions', sentWith({ params: { limit: ROMAN_CHATS_MAX_LIMIT } }));
    await romanChatsApi.list(B(), { limit: 0 });
    expect(api.get).toHaveBeenLastCalledWith('/roman/sessions', sentWith({ params: { limit: 1 } }));
    await romanChatsApi.list(B());
    expect(api.get).toHaveBeenLastCalledWith('/roman/sessions', sentWith({ params: { limit: 30 } }));
  });

  it('a body that drifts from the contract is a coded unexpected failure (never thrown, never shown)', async () => {
    api.get.mockResolvedValue({
      status: 200,
      data: { sessions: [{ ...chat(), content: 'secret text' }], nextCursor: null },
      headers: { 'x-request-id': 'srv-ref-9' },
    });
    const out = await romanChatsApi.list(B());
    expect(out).toEqual({
      ok: false,
      failure: { reason: 'unexpected', status: 200, code: 'WIRE_DRIFT', requestId: 'srv-ref-9' },
    });
    api.get.mockResolvedValue({ status: 200, data: { sessions: [chat({ surface: 'admin' })], nextCursor: null } });
    expect((await romanChatsApi.list(B())).ok).toBe(false);
    api.get.mockResolvedValue({ status: 200, data: { sessions: [chat({ id: '' })], nextCursor: null } });
    expect((await romanChatsApi.list(B())).ok).toBe(false);
  });
});

describe('delete', () => {
  it('deleteOne sends DELETE /roman/sessions/:id with the id path-encoded', async () => {
    api.delete.mockResolvedValue({ status: 204 });
    expect(await romanChatsApi.deleteOne(B(), 'a/b c')).toEqual({ ok: true, value: null });
    expect(api.delete).toHaveBeenCalledWith('/roman/sessions/a%2Fb%20c', sentWith());
  });

  it('deleteAll sends DELETE /roman/sessions', async () => {
    api.delete.mockResolvedValue({ status: 204 });
    expect(await romanChatsApi.deleteAll(B())).toEqual({ ok: true, value: null });
    expect(api.delete).toHaveBeenCalledWith('/roman/sessions', sentWith());
  });

  it('a 503 ROMAN_ERASE_INCOMPLETE is its own reason', async () => {
    api.delete.mockRejectedValue(httpError(503, { statusCode: 503, code: 'ROMAN_ERASE_INCOMPLETE', message: 'x' }));
    expect(await romanChatsApi.deleteAll(B())).toEqual({ ok: false, failure: { reason: 'erase_incomplete' } });
  });
});

describe('readMessages', () => {
  it('maps the wire role roman to the UI role assistant and keeps server order', async () => {
    api.get.mockResolvedValue({
      status: 200,
      data: {
        messages: [
          { id: 'cm2', role: 'roman', content: 'Hello', interrupted: false, createdAt: '2026-10-02T08:02:00.000Z' },
          { id: 'cm1', role: 'user', content: 'Hi', interrupted: false, createdAt: '2026-10-02T08:01:00.000Z' },
        ],
        nextCursor: null,
      },
    });
    const out = await romanChatsApi.readMessages(B(), CUID);
    expect(api.get).toHaveBeenCalledWith(`/roman/sessions/${CUID}/messages`, sentWith({ params: { limit: 30 } }));
    expect(out.ok && out.value.messages.map((m) => [m.id, m.role])).toEqual([
      ['cm2', 'assistant'],
      ['cm1', 'user'],
    ]);
  });
});

describe('every call is bound to one sign-in (Sol A-331-4)', () => {
  it('a binding from an older sign-in sends nothing', async () => {
    const stale = B();
    authEvents.emit();
    expect(await romanChatsApi.deleteAll(stale)).toEqual({
      ok: false,
      failure: { reason: 'account_changed', mayHaveBeenSent: false },
    });
    expect(await romanChatsApi.deleteOne(stale, CUID)).toEqual({
      ok: false,
      failure: { reason: 'account_changed', mayHaveBeenSent: false },
    });
    expect((await romanChatsApi.list(stale)).ok).toBe(false);
    expect(api.delete).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('reads carry an abort signal; erases do not (an erase already sent is never hidden)', async () => {
    api.get.mockResolvedValue({ status: 200, data: { sessions: [], nextCursor: null } });
    api.delete.mockResolvedValue({ status: 204 });
    await romanChatsApi.list(B());
    await romanChatsApi.deleteAll(B());
    expect(api.get.mock.calls[0][1].signal).toBeDefined();
    expect(api.delete.mock.calls[0][1].signal).toBeUndefined();
  });

  it('an answer that arrives after the sign-in changed is dropped as account_changed', async () => {
    let answer!: (v: unknown) => void;
    api.delete.mockImplementation(() => new Promise((r) => (answer = r)));
    const pending = romanChatsApi.deleteOne(B(), CUID);
    authEvents.emit('logout');
    answer({ status: 204 });
    expect(await pending).toEqual({ ok: false, failure: { reason: 'account_changed', mayHaveBeenSent: true } });
  });
});

describe('failureOf: every status and machine code', () => {
  const cases: Array<[string, unknown, unknown]> = [
    ['no response (offline / timeout)', networkError(), { reason: 'offline' }],
    ['401', httpError(401, { statusCode: 401, message: 'Unauthorized' }), { reason: 'signed_out' }],
    ['403 role guard', httpError(403, { statusCode: 403, message: 'Forbidden resource' }), { reason: 'not_allowed', requestId: 'sent-req-1234' }],
    ['404 ROMAN_SESSION_NOT_FOUND', httpError(404, { code: 'ROMAN_SESSION_NOT_FOUND', message: 'x' }), { reason: 'not_found' }],
    ['404 without a code (route missing / chat switched off)', httpError(404, { statusCode: 404, message: 'Cannot GET /roman' }), { reason: 'route_missing' }],
    ['400 ROMAN_CURSOR_INVALID', httpError(400, { code: 'ROMAN_CURSOR_INVALID', message: 'x' }), { reason: 'cursor_invalid' }],
    [
      '400 ROMAN_SESSIONS_QUERY_INVALID (#635 fix round)',
      httpError(400, { code: 'ROMAN_SESSIONS_QUERY_INVALID', message: 'x' }),
      { reason: 'query_invalid', requestId: 'sent-req-1234' },
    ],
    ['503 ROMAN_ERASE_INCOMPLETE', httpError(503, { code: 'ROMAN_ERASE_INCOMPLETE', message: 'x' }), { reason: 'erase_incomplete' }],
    ['429', httpError(429, { statusCode: 429, message: 'Too Many Requests' }), { reason: 'busy' }],
    [
      '500 with the server request_id',
      httpError(500, { statusCode: 500, message: 'Internal server error', request_id: 'srv-abcdef12' }),
      { reason: 'unexpected', status: 500, code: null, requestId: 'srv-abcdef12' },
    ],
    [
      '400 validation (not the cursor code)',
      httpError(400, { statusCode: 400, message: ['limit must not be greater than 100'] }),
      { reason: 'unexpected', status: 400, code: null, requestId: 'sent-req-1234' },
    ],
    [
      '404 with some other code',
      httpError(404, { code: 'SOMETHING_ELSE', message: 'x' }),
      { reason: 'unexpected', status: 404, code: 'SOMETHING_ELSE', requestId: 'sent-req-1234' },
    ],
    [
      '503 with another code',
      httpError(503, { code: 'ROMAN_UNAVAILABLE', message: 'x' }),
      { reason: 'unexpected', status: 503, code: 'ROMAN_UNAVAILABLE', requestId: 'sent-req-1234' },
    ],
    ['a non-HTTP bug', new TypeError('boom'), { reason: 'unexpected', status: null, code: null, requestId: null }],
  ];
  it.each(cases)('%s', (_name, err, expected) => {
    expect(failureOf(err)).toEqual(expected);
  });

  it('reads the machine code, not the message text', () => {
    expect(failureOf(httpError(404, { message: 'ROMAN_SESSION_NOT_FOUND' }))).toEqual({ reason: 'route_missing' });
  });
});

describe('romanApi ids are cuid, not uuid (backend @default(cuid()))', () => {
  it('accepts cuid session, message and stream ids', () => {
    expect(
      RomanSessionSchema.safeParse({
        id: CUID,
        surface: 'client',
        messageCount: 0,
        startedAt: '2026-10-02T08:01:00.000Z',
        lastActivityAt: '2026-10-02T08:01:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      RomanWireMessageSchema.safeParse({
        id: CUID,
        role: 'roman',
        content: 'Hello',
        interrupted: false,
        createdAt: '2026-10-02T08:01:00.000Z',
      }).success,
    ).toBe(true);
    expect(RomanStreamChunkSchema.safeParse({ type: 'done', text: 'Hi', messageId: CUID }).success).toBe(true);
  });

  it('still rejects an empty or over-long id', () => {
    expect(RomanStreamChunkSchema.safeParse({ type: 'done', messageId: '' }).success).toBe(false);
    expect(RomanStreamChunkSchema.safeParse({ type: 'done', messageId: 'x'.repeat(65) }).success).toBe(false);
  });
});
