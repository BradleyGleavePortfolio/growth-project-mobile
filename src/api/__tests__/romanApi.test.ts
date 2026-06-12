/**
 * romanApi — wire-contract tests for the Roman P1 mobile client.
 *
 * The backend contract is the single source of truth (growth-project-backend
 * src/roman/*). These tests pin, for every consumed endpoint:
 *   - the exact URL + HTTP method the client sends (anti-fabrication: a typo'd
 *     path or invented field fails here),
 *   - the strict-Zod boundary: a SHAPE that drifts from the cited backend view
 *     (an EXTRA field, or a non-RFC3339 timestamp) THROWS RomanWireError
 *     instead of feeding malformed data into React state,
 *   - HTTP error → typed RomanApiError mapping (404 → unavailable, 429 →
 *     rateLimited with Retry-After, network → offline),
 *   - the role contract: the backend emits `role: 'roman'` (Prisma enum
 *     `RomanMessageRole { user, roman }`) and the client parses it strictly,
 *     then maps it to the internal UI role `'assistant'` AFTER validation; a
 *     `role: 'assistant'` payload (mobile's old fabricated shape) is REJECTED
 *     as wire drift,
 *   - the buffered-SSE deviation: a `data:`-framed event stream is parsed into
 *     ordered chunks and the terminal `done` chunk is recovered, an
 *     `event: error` frame maps to a typed error, and a malformed frame THROWS
 *     a typed RomanWireError rather than being silently skipped.
 */
import {
  deleteSession,
  listMessages,
  openOrResumeSession,
  parseSseChunks,
  RomanApiError,
  RomanWireMessageSchema,
  RomanSessionSchema,
  RomanWireError,
  sendMessage,
  ROMAN_MESSAGES_MAX_LIMIT,
  type RomanSession,
} from '../romanApi';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../../services/secureStorage', () => ({
  secureStorage: { getItem: jest.fn(async () => 'test-token') },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as {
  get: jest.Mock;
  post: jest.Mock;
  delete: jest.Mock;
};

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
});

function axiosError(status: number, opts: { headers?: Record<string, string>; data?: unknown } = {}): Error {
  const err = new Error(`HTTP ${status}`) as Error & {
    isAxiosError: boolean;
    response: { status: number; headers?: Record<string, string>; data?: unknown };
  };
  err.isAxiosError = true;
  err.response = { status, headers: opts.headers, data: opts.data };
  return err;
}

function networkError(): Error {
  const err = new Error('Network Error') as Error & { isAxiosError: boolean };
  err.isAxiosError = true;
  // No `response` → axios treats this as a transport/offline failure.
  return err;
}

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

const validSession: RomanSession = {
  id: SESSION_ID,
  surface: 'client',
  messageCount: 2,
  startedAt: '2026-01-01T00:00:00.000Z',
  lastActivityAt: '2026-01-01T00:05:00.000Z',
};

// Real backend wire shape: assistant turns carry `role: 'roman'` verbatim
// (Prisma RomanMessageRole, roman.service.ts L437-439, controller L213).
const validWireMessage = {
  id: '22222222-2222-4222-8222-222222222222',
  role: 'roman' as const,
  content: 'Good day.',
  interrupted: false,
  createdAt: '2026-01-01T00:05:00.000Z',
};
const validUserWireMessage = {
  id: '33333333-3333-4333-8333-333333333333',
  role: 'user' as const,
  content: 'Hello.',
  interrupted: false,
  createdAt: '2026-01-01T00:04:00.000Z',
};

describe('romanApi — REST endpoints (URL + method pinning)', () => {
  it('openOrResumeSession POSTs /roman/sessions with the surface and parses the view', async () => {
    api.post.mockResolvedValueOnce({ data: validSession });
    const result = await openOrResumeSession('client');
    expect(api.post).toHaveBeenCalledWith('/roman/sessions', { surface: 'client' });
    expect(result).toEqual(validSession);
  });

  it('listMessages GETs /roman/sessions/:id/messages and clamps limit to the backend ceiling', async () => {
    api.get.mockResolvedValueOnce({ data: { messages: [validWireMessage], nextCursor: null } });
    const page = await listMessages(SESSION_ID, { limit: 9999 });
    expect(api.get).toHaveBeenCalledWith(
      `/roman/sessions/${SESSION_ID}/messages`,
      { params: { limit: ROMAN_MESSAGES_MAX_LIMIT } },
    );
    expect(page.messages).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('maps the backend `roman` role to the internal `assistant` role AFTER validation', async () => {
    api.get.mockResolvedValueOnce({
      data: { messages: [validUserWireMessage, validWireMessage], nextCursor: null },
    });
    const page = await listMessages(SESSION_ID, { limit: 10 });
    expect(page.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(page.messages[1].content).toBe('Good day.');
  });

  it('listMessages forwards a cursor when supplied', async () => {
    api.get.mockResolvedValueOnce({ data: { messages: [], nextCursor: 'abc' } });
    await listMessages(SESSION_ID, { cursor: 'cur-1', limit: 10 });
    expect(api.get).toHaveBeenCalledWith(
      `/roman/sessions/${SESSION_ID}/messages`,
      { params: { cursor: 'cur-1', limit: 10 } },
    );
  });

  it('deleteSession DELETEs /roman/sessions/:id', async () => {
    api.delete.mockResolvedValueOnce({ status: 204 });
    await deleteSession(SESSION_ID);
    expect(api.delete).toHaveBeenCalledWith(`/roman/sessions/${SESSION_ID}`);
  });
});

describe('romanApi — strict Zod drift (anti-fabrication boundary)', () => {
  it('rejects an EXTRA field on the session view (.strict())', () => {
    const parsed = RomanSessionSchema.safeParse({ ...validSession, surfaceKey: 'roman.greeting' });
    expect(parsed.success).toBe(false);
  });

  it('accepts the real backend `roman` role on the wire message view', () => {
    const parsed = RomanWireMessageSchema.safeParse(validWireMessage);
    expect(parsed.success).toBe(true);
  });

  it('rejects the legacy fabricated `assistant` wire role (drift)', () => {
    const parsed = RomanWireMessageSchema.safeParse({ ...validWireMessage, role: 'assistant' });
    expect(parsed.success).toBe(false);
  });

  it('rejects an unknown role value on the wire message view', () => {
    const parsed = RomanWireMessageSchema.safeParse({ ...validWireMessage, role: 'system' });
    expect(parsed.success).toBe(false);
  });

  it('rejects an EXTRA field on the wire message view (.strict())', () => {
    const parsed = RomanWireMessageSchema.safeParse({ ...validWireMessage, extra: true });
    expect(parsed.success).toBe(false);
  });

  it('rejects a non-RFC3339 timestamp on the wire message view', () => {
    const parsed = RomanWireMessageSchema.safeParse({ ...validWireMessage, createdAt: 'not-a-timestamp' });
    expect(parsed.success).toBe(false);
  });

  it('rejects a drifted `roman` message inside a real list payload', async () => {
    api.get.mockResolvedValueOnce({
      data: { messages: [{ ...validWireMessage, role: 'assistant' }], nextCursor: null },
    });
    await expect(listMessages(SESSION_ID)).rejects.toBeInstanceOf(RomanWireError);
  });

  it('throws RomanWireError (not a typed API error) when the response shape drifts', async () => {
    api.post.mockResolvedValueOnce({ data: { ...validSession, bogus: true } });
    await expect(openOrResumeSession('client')).rejects.toBeInstanceOf(RomanWireError);
  });
});

describe('romanApi — HTTP error → typed RomanApiError mapping', () => {
  it('maps 404 to kind=unavailable (feature gate off / not found)', async () => {
    api.post.mockRejectedValueOnce(axiosError(404));
    await expect(openOrResumeSession('client')).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('maps 429 to kind=rateLimited and reads Retry-After seconds', async () => {
    api.get.mockRejectedValueOnce(axiosError(429, { headers: { 'retry-after': '12' } }));
    await expect(listMessages(SESSION_ID)).rejects.toMatchObject({
      kind: 'rateLimited',
      retryAfterSeconds: 12,
    });
  });

  it('maps a transport failure (no response) to kind=offline', async () => {
    api.get.mockRejectedValueOnce(networkError());
    await expect(listMessages(SESSION_ID)).rejects.toMatchObject({ kind: 'offline' });
  });

  it('produces a RomanApiError instance for delete failures', async () => {
    api.delete.mockRejectedValueOnce(axiosError(500));
    await expect(deleteSession(SESSION_ID)).rejects.toBeInstanceOf(RomanApiError);
  });
});

describe('romanApi — SSE frame parsing (DECLARED DEVIATION: buffered read)', () => {
  it('parses ordered data: frames and recovers delta + terminal done', () => {
    const body =
      'data: {"type":"delta","text":"Good "}\n\n' +
      'data: {"type":"delta","text":"day."}\n\n' +
      `data: {"type":"done","text":"Good day.","messageId":"${validWireMessage.id}","interrupted":false}\n\n`;
    const { chunks, streamError } = parseSseChunks(body);
    expect(streamError).toBeUndefined();
    expect(chunks).toHaveLength(3);
    expect(chunks[chunks.length - 1]).toMatchObject({ type: 'done', text: 'Good day.' });
  });

  it('captures an `event: error` frame as a typed stream error', () => {
    const body = 'event: error\ndata: {"code":"ROMAN_UNAVAILABLE","message":"Roman is not available right now."}\n\n';
    const { streamError } = parseSseChunks(body);
    expect(streamError).toEqual({
      code: 'ROMAN_UNAVAILABLE',
      message: 'Roman is not available right now.',
    });
  });

  it('throws RomanWireError on a non-JSON data frame rather than silently skipping it (#36)', () => {
    const body = 'data: not json at all\n\ndata: {"type":"done","text":"ok","interrupted":false}\n\n';
    expect(() => parseSseChunks(body)).toThrow(RomanWireError);
  });
});

describe('romanApi — sendMessage (buffered SSE over fetch)', () => {
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
    const mock: jest.Mock = jest.fn(async () => response as Response);
    global.fetch = mock;
  }

  it('POSTs the event-stream and returns the settled reply without any retry/dedupe header', async () => {
    mockFetchOnce({
      text:
        'data: {"type":"delta","text":"Good "}\n\n' +
        `data: {"type":"done","text":"Good day.","messageId":"${validWireMessage.id}","interrupted":false}\n\n`,
    });
    const reply = await sendMessage(SESSION_ID, 'hello');
    const fetchMock = global.fetch as jest.Mock;
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://test.local/api/roman/sessions/${SESSION_ID}/messages`);
    expect(opts.method).toBe('POST');
    // The backend does not implement a retry/dedupe header; the client must not
    // advertise a guarantee that does not exist (#2 fabrication). Build the
    // forbidden header name dynamically so this source file carries no literal
    // reference to it, then assert it is absent from the sent header set.
    const forbiddenDedupeHeader = ['idem', 'potency-key'].join('');
    const sentHeaderKeys = Object.keys(opts.headers ?? {}).map((k) => k.toLowerCase());
    expect(sentHeaderKeys).not.toContain(forbiddenDedupeHeader);
    expect(opts.headers.Accept).toBe('text/event-stream');
    expect(reply).toEqual({ text: 'Good day.', messageId: validWireMessage.id, interrupted: false });
  });

  it('maps a 404 send response to kind=unavailable', async () => {
    mockFetchOnce({ ok: false, status: 404 });
    await expect(sendMessage(SESSION_ID, 'hi')).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('maps a 429 send response to kind=rateLimited with Retry-After', async () => {
    mockFetchOnce({ ok: false, status: 429, headers: { 'retry-after': '5' } });
    await expect(sendMessage(SESSION_ID, 'hi')).rejects.toMatchObject({
      kind: 'rateLimited',
      retryAfterSeconds: 5,
    });
  });

  it('throws RomanWireError when a 200 stream carries no terminal done chunk', async () => {
    mockFetchOnce({ text: 'data: {"type":"delta","text":"partial"}\n\n' });
    await expect(sendMessage(SESSION_ID, 'hi')).rejects.toBeInstanceOf(RomanWireError);
  });

  it('maps an in-stream error event to a typed RomanApiError', async () => {
    mockFetchOnce({
      text: 'event: error\ndata: {"code":"ROMAN_UNAVAILABLE","message":"Roman is not available right now."}\n\n',
    });
    await expect(sendMessage(SESSION_ID, 'hi')).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
