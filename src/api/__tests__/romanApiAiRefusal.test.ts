/**
 * romanApi — R2b refusals on the Roman send route (backend #626).
 *
 *   - 403 ai_consent_required (pre-check, before the turn is stored) and 503
 *     ai_egress_blocked over HTTP map to kind `aiRefused` with the refusal,
 *     read from the status AND the machine code;
 *   - the same codes in the in-stream `event: error` frame (HTTP 200) map the
 *     same way, with the reference from the X-Request-ID response header;
 *   - the strict SSE error parser still rejects any key beyond
 *     { code, message } (backend B-626-2 keeps the frame exactly that shape).
 */
import { parseSseChunks, RomanApiError, RomanWireError, sendMessage } from '../romanApi';
import { captureError } from '../../services/sentry';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

jest.mock('../../services/sentry', () => ({ captureError: jest.fn() }));

jest.mock('../../services/secureStorage', () => ({
  secureStorage: { getItem: jest.fn(async () => 'test-token') },
}));

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const CONSENT = { code: 'ai_consent_required', message: "You haven't allowed AI help yet. You can turn it on in Settings > Privacy." };
const EGRESS = {
  code: 'ai_egress_blocked',
  message: 'AI help is turned off for this request because of a problem on our side.',
};

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

function mockFetchOnce(init: { ok?: boolean; status?: number; text?: string; headers?: Record<string, string> }) {
  const headers = init.headers ?? {};
  const response: Pick<Response, 'ok' | 'status' | 'headers' | 'text'> = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } as Headers,
    text: async () => init.text ?? '',
  };
  global.fetch = jest.fn(async () => response as Response);
}

async function failureOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
}

describe('romanApi.sendMessage — R2b refusals over HTTP', () => {
  it('403 ai_consent_required -> aiRefused / consent_required', async () => {
    mockFetchOnce({ ok: false, status: 403, text: JSON.stringify({ statusCode: 403, ...CONSENT, error: 'Forbidden' }) });
    const err = await failureOf(sendMessage(SESSION_ID, 'hi'));
    expect(err).toBeInstanceOf(RomanApiError);
    expect(err).toMatchObject({ kind: 'aiRefused', refusal: { kind: 'consent_required' } });
  });

  it('503 ai_egress_blocked -> aiRefused / egress_blocked with the requestId reference', async () => {
    mockFetchOnce({
      ok: false,
      status: 503,
      text: JSON.stringify({ statusCode: 503, ...EGRESS, requestId: 'req-7f3a9c21' }),
      headers: { 'x-request-id': 'req-7f3a9c21' },
    });
    const err = await failureOf(sendMessage(SESSION_ID, 'hi'));
    expect(err).toMatchObject({
      kind: 'aiRefused',
      refusal: { kind: 'egress_blocked', reference: 'req-7f3a9c21', serverMessage: EGRESS.message },
    });
  });

  it('a 403 without the machine code stays generic (never decided from message text)', async () => {
    mockFetchOnce({ ok: false, status: 403, text: JSON.stringify({ message: CONSENT.message }) });
    const err = await failureOf(sendMessage(SESSION_ID, 'hi'));
    expect(err).toMatchObject({ kind: 'generic' });
    expect((err as RomanApiError).refusal).toBeUndefined();
  });

  it('a non-JSON 503 body stays generic', async () => {
    mockFetchOnce({ ok: false, status: 503, text: '<html>bad gateway</html>' });
    await expect(sendMessage(SESSION_ID, 'hi')).rejects.toMatchObject({ kind: 'generic' });
  });
});

describe('romanApi.sendMessage — R2b refusals in the stream error frame', () => {
  it('in-stream ai_consent_required -> aiRefused / consent_required', async () => {
    mockFetchOnce({ text: `event: error\ndata: ${JSON.stringify(CONSENT)}\n\n` });
    await expect(sendMessage(SESSION_ID, 'hi')).rejects.toMatchObject({
      kind: 'aiRefused',
      refusal: { kind: 'consent_required' },
    });
  });

  it('in-stream ai_egress_blocked -> aiRefused / egress_blocked, reference from X-Request-ID', async () => {
    mockFetchOnce({
      text: `event: error\ndata: ${JSON.stringify(EGRESS)}\n\n`,
      headers: { 'x-request-id': 'sse-ref-0042' },
    });
    await expect(sendMessage(SESSION_ID, 'hi')).rejects.toMatchObject({
      kind: 'aiRefused',
      refusal: { kind: 'egress_blocked', reference: 'sse-ref-0042' },
    });
  });

  it('in-stream ROMAN_UNAVAILABLE still maps to the calm unavailable state', async () => {
    mockFetchOnce({
      text: 'event: error\ndata: {"code":"ROMAN_UNAVAILABLE","message":"Roman is not available right now."}\n\n',
    });
    await expect(sendMessage(SESSION_ID, 'hi')).rejects.toMatchObject({ kind: 'unavailable' });
  });
});

describe('strict SSE error parser (unchanged contract)', () => {
  it('accepts exactly { code, message }', () => {
    expect(parseSseChunks(`event: error\ndata: ${JSON.stringify(EGRESS)}\n\n`).streamError).toEqual(EGRESS);
  });

  it('still rejects an extra requestId key as wire drift', () => {
    expect(() =>
      parseSseChunks(`event: error\ndata: ${JSON.stringify({ ...EGRESS, requestId: 'r1' })}\n\n`),
    ).toThrow(RomanWireError);
  });

  it('still rejects any unknown key', () => {
    expect(() =>
      parseSseChunks(`event: error\ndata: ${JSON.stringify({ ...CONSENT, retryAfterSeconds: 3 })}\n\n`),
    ).toThrow(RomanWireError);
  });

  it('a drifted frame through sendMessage is a RomanWireError, not a refusal', async () => {
    mockFetchOnce({ text: `event: error\ndata: ${JSON.stringify({ ...CONSENT, requestId: 'r1' })}\n\n` });
    await expect(sendMessage(SESSION_ID, 'hi')).rejects.toBeInstanceOf(RomanWireError);
  });
});

// Sol B-326-3 / Opus C-326-1: the backend stores the user turn BEFORE it opens
// the stream, so every failure after HTTP 200 carries turnStored; a refusal
// answered over HTTP (the pre-check) does not. C-326-3: an in-stream egress
// block is reported to Sentry once, with the reference the person sees.
describe('romanApi.sendMessage — was the user turn stored?', () => {
  beforeEach(() => jest.clearAllMocks());

  it('HTTP 403 pre-check refusal: turnStored false (nothing was stored)', async () => {
    mockFetchOnce({ ok: false, status: 403, text: JSON.stringify(CONSENT) });
    const err = await failureOf(sendMessage(SESSION_ID, 'hi'));
    expect(err).toBeInstanceOf(RomanApiError);
    expect((err as RomanApiError).turnStored).toBe(false);
  });

  it('in-stream consent refusal: turnStored true', async () => {
    mockFetchOnce({ text: `event: error\ndata: ${JSON.stringify(CONSENT)}\n\n` });
    const err = await failureOf(sendMessage(SESSION_ID, 'hi'));
    expect((err as RomanApiError).turnStored).toBe(true);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('in-stream ROMAN_UNAVAILABLE: turnStored true', async () => {
    mockFetchOnce({
      text: 'event: error\ndata: {"code":"ROMAN_UNAVAILABLE","message":"Roman is not available right now."}\n\n',
    });
    const err = await failureOf(sendMessage(SESSION_ID, 'hi'));
    expect((err as RomanApiError).turnStored).toBe(true);
  });

  it('a 200 whose body cannot be read: turnStored true', async () => {
    const response: Pick<Response, 'ok' | 'status' | 'headers' | 'text'> = {
      ok: true,
      status: 200,
      headers: { get: (_k: string) => null } as Headers,
      text: async () => {
        throw new TypeError('Network request failed');
      },
    };
    global.fetch = jest.fn(async () => response as Response);
    const err = await failureOf(sendMessage(SESSION_ID, 'hi'));
    expect(err).toBeInstanceOf(RomanApiError);
    expect((err as RomanApiError).turnStored).toBe(true);
  });

  it('in-stream egress block: reported once with the X-Request-ID reference', async () => {
    mockFetchOnce({ text: `event: error\ndata: ${JSON.stringify(EGRESS)}\n\n`, headers: { 'x-request-id': 'sse-ref-0042' } });
    await failureOf(sendMessage(SESSION_ID, 'hi'));
    expect(captureError).toHaveBeenCalledTimes(1);
    expect((captureError as jest.Mock).mock.calls[0][1]).toMatchObject({ surface: 'roman', reference: 'sse-ref-0042' });
  });
});
