/**
 * extensionPairApi — wire-contract tests (v0.3 import, PR-M2).
 *
 * Mocks the axios instance at `../../services/api` (the repo's established test
 * seam) and asserts the EXACT method, path, and body mobile sends for the
 * coach-callable pairing endpoints, that responses pass through untouched,
 * that the pairing code and setup nonce travel body-only (never a query string
 * or path), that transport errors PROPAGATE to the caller (never coerced into
 * a fake success), and that mobile has NO redeem method.
 *
 * Backend contract source of truth (consumer-frozen at `2.0.0-c1-s1.1`,
 * backend a0ea1bea; see src/types/__fixtures__/c1PairSurface.a0ea1bea.json):
 *   growth-project-backend/docs/contracts/importer-openapi.json
 *   (POST /api/extension/pair/init, /pair/status, /pair/current)
 */
import { AxiosError, AxiosHeaders } from 'axios';
import api from '../../services/api';
import { extensionPairApi } from '../extensionPairApi';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const post = jest.mocked(api.post);

/** Rule 19 key the caller mints once per intent and replays on every retry. */
const IDEM_KEY = 'b0a1c2d3-e4f5-4607-8899-aabbccddeeff';
/** C1 setup_nonce the caller persists before the first attempt and replays. */
const NONCE = '7f1e2d3c-4b5a-4968-8776-655443322110';

beforeEach(() => {
  post.mockReset();
});

function axiosError(status: number, data: Record<string, unknown> = {}): AxiosError {
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', undefined, undefined, {
    status,
    statusText: String(status),
    data,
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

describe('extensionPairApi.init', () => {
  it('POSTs /extension/pair/init with chosen_platform + setup_nonce in the body and returns the response', async () => {
    post.mockResolvedValue({ data: { pairing_code: '123456', expires_at: '2026-07-14T12:05:00Z' } });

    const res = await extensionPairApi.init('truecoach', IDEM_KEY, NONCE);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('/extension/pair/init');
    expect(post.mock.calls[0][1]).toEqual({ chosen_platform: 'truecoach', setup_nonce: NONCE });
    // R19: the key travels as a header, never in the body or the path.
    expect(post.mock.calls[0][2]).toEqual({ headers: { 'Idempotency-Key': IDEM_KEY } });
    expect(res.data).toEqual({ pairing_code: '123456', expires_at: '2026-07-14T12:05:00Z' });
  });

  it('omits the /api prefix (baseURL already carries it) and sends no query string', async () => {
    post.mockResolvedValue({ data: { pairing_code: '000000', expires_at: 'x' } });
    await extensionPairApi.init('custom', IDEM_KEY, NONCE);
    const path = post.mock.calls[0][0] as string;
    expect(path.startsWith('/api/')).toBe(false);
    expect(path).not.toContain('?');
  });

  it('propagates a 401 (auth) to the caller — never a fake mint', async () => {
    post.mockRejectedValue(axiosError(401));
    await expect(extensionPairApi.init('everfit', IDEM_KEY, NONCE)).rejects.toBeInstanceOf(AxiosError);
  });

  it('propagates a 404 (server kill-switch off) to the caller', async () => {
    post.mockRejectedValue(axiosError(404));
    await expect(extensionPairApi.init('everfit', IDEM_KEY, NONCE)).rejects.toBeInstanceOf(AxiosError);
  });

  it('propagates a 500 (transient server fault) to the caller', async () => {
    post.mockRejectedValue(axiosError(500));
    await expect(extensionPairApi.init('truecoach', IDEM_KEY, NONCE)).rejects.toBeInstanceOf(AxiosError);
  });

  it('returns the server-authoritative expires_at untouched (no local clock math)', async () => {
    const expiresAt = '2026-07-14T12:05:00.000Z';
    post.mockResolvedValue({ data: { pairing_code: '246810', expires_at: expiresAt } });
    const res = await extensionPairApi.init('everfit', IDEM_KEY, NONCE);
    expect(res.data.expires_at).toBe(expiresAt);
    expect(res.data.pairing_code).toBe('246810');
  });

  it('sends the exact chosen_platform slug for each distinct platform', async () => {
    post.mockResolvedValue({ data: { pairing_code: '000000', expires_at: 'x' } });
    await extensionPairApi.init('everfit', IDEM_KEY, NONCE);
    await extensionPairApi.init('trainerize', IDEM_KEY, NONCE);
    expect(post.mock.calls[0][1]).toEqual({ chosen_platform: 'everfit', setup_nonce: NONCE });
    expect(post.mock.calls[1][1]).toEqual({ chosen_platform: 'trainerize', setup_nonce: NONCE });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('replays the caller\'s key verbatim so a retry cannot mint a second session', async () => {
    post.mockRejectedValueOnce(axiosError(500));
    post.mockResolvedValueOnce({ data: { pairing_code: '135791', expires_at: 'x' } });
    await expect(extensionPairApi.init('everfit', IDEM_KEY, NONCE)).rejects.toBeInstanceOf(AxiosError);
    await extensionPairApi.init('everfit', IDEM_KEY, NONCE);
    expect(post.mock.calls[0][2]).toEqual(post.mock.calls[1][2]);
    const path = post.mock.calls[0][0] as string;
    expect(path).not.toContain(IDEM_KEY);
  });

  it('sends the setup_nonce in the BODY only — never the path, query, or headers', async () => {
    post.mockResolvedValue({ data: { pairing_code: '000000', expires_at: 'x' } });
    await extensionPairApi.init('truecoach', IDEM_KEY, NONCE);
    const [path, body, config] = post.mock.calls[0];
    expect(path).not.toContain(NONCE);
    expect((body as { setup_nonce: string }).setup_nonce).toBe(NONCE);
    expect(JSON.stringify(config)).not.toContain(NONCE);
  });

  it('replays the same setup_nonce verbatim on a same-intent retry', async () => {
    post.mockRejectedValueOnce(axiosError(500));
    post.mockResolvedValueOnce({ data: { pairing_code: '135791', expires_at: 'x' } });
    await expect(extensionPairApi.init('everfit', IDEM_KEY, NONCE)).rejects.toBeInstanceOf(AxiosError);
    await extensionPairApi.init('everfit', IDEM_KEY, NONCE);
    expect(post.mock.calls[0][1]).toEqual(post.mock.calls[1][1]);
  });

  it('propagates 409 setup_nonce_conflict untouched (classification is the hook\'s job)', async () => {
    post.mockRejectedValue(axiosError(409, { code: 'setup_nonce_conflict', message: 'x' }));
    await expect(extensionPairApi.init('truecoach', IDEM_KEY, NONCE)).rejects.toMatchObject({
      response: { status: 409, data: { code: 'setup_nonce_conflict' } },
    });
  });

  it('propagates 410 setup_challenge_unavailable untouched', async () => {
    post.mockRejectedValue(axiosError(410, { code: 'setup_challenge_unavailable', message: 'x' }));
    await expect(extensionPairApi.init('truecoach', IDEM_KEY, NONCE)).rejects.toMatchObject({
      response: { status: 410, data: { code: 'setup_challenge_unavailable' } },
    });
  });

  it('passes an import_intent_id through untouched when the server issues one', async () => {
    post.mockResolvedValue({ data: { pairing_code: '000000', expires_at: 'x', import_intent_id: 'ii-1' } });
    const res = await extensionPairApi.init('truecoach', IDEM_KEY, NONCE);
    expect(res.data.import_intent_id).toBe('ii-1');
  });

  it('does not swallow a rejection into a resolved value', async () => {
    post.mockRejectedValue(axiosError(401));
    const onResolve = jest.fn();
    const onReject = jest.fn();
    await extensionPairApi.init('truecoach', IDEM_KEY, NONCE).then(onResolve, onReject);
    expect(onResolve).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledTimes(1);
  });
});

describe('extensionPairApi.status', () => {
  it('POSTs /extension/pair/status with the code in the BODY (never a query)', async () => {
    post.mockResolvedValue({ data: { status: 'pending' } });

    const res = await extensionPairApi.status('654321');

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('/extension/pair/status');
    expect(post.mock.calls[0][1]).toEqual({ code: '654321' });
    // The code must not leak into the URL where it could be logged by proxies.
    expect(post.mock.calls[0][0]).not.toContain('654321');
    expect(res.data).toEqual({ status: 'pending' });
  });

  it('returns the raw wire status untouched (decoding is the hook\'s job)', async () => {
    post.mockResolvedValue({ data: { status: 'something-unexpected' } });
    const res = await extensionPairApi.status('111111');
    expect(res.data.status).toBe('something-unexpected');
  });

  it('propagates a 500 to the caller', async () => {
    post.mockRejectedValue(axiosError(500));
    await expect(extensionPairApi.status('222222')).rejects.toBeInstanceOf(AxiosError);
  });

  it('propagates a 401 (auth loss mid-poll) to the caller', async () => {
    post.mockRejectedValue(axiosError(401));
    await expect(extensionPairApi.status('333333')).rejects.toBeInstanceOf(AxiosError);
  });

  it('propagates a 404 (code unknown / kill-switch) to the caller', async () => {
    post.mockRejectedValue(axiosError(404));
    await expect(extensionPairApi.status('444444')).rejects.toBeInstanceOf(AxiosError);
  });

  it('passes through the paired terminal status verbatim', async () => {
    post.mockResolvedValue({ data: { status: 'paired' } });
    const res = await extensionPairApi.status('555555');
    expect(res.data.status).toBe('paired');
  });

  it('passes through the expired status verbatim', async () => {
    post.mockResolvedValue({ data: { status: 'expired' } });
    const res = await extensionPairApi.status('666666');
    expect(res.data.status).toBe('expired');
  });

  it('re-POSTs on every poll (no client-side caching of a code lookup)', async () => {
    post.mockResolvedValue({ data: { status: 'pending' } });
    await extensionPairApi.status('777777');
    await extensionPairApi.status('777777');
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls.every((c) => c[0] === '/extension/pair/status')).toBe(true);
  });
});

describe('extensionPairApi.current', () => {
  it('POSTs /extension/pair/current with an empty body when no nonce is saved', async () => {
    post.mockResolvedValue({ data: { result: 'no_setup' } });
    const res = await extensionPairApi.current();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('/extension/pair/current');
    expect(post.mock.calls[0][1]).toEqual({});
    expect(res.data).toEqual({ result: 'no_setup' });
  });

  it('sends a saved setup_nonce in the BODY only (never the path or a query)', async () => {
    post.mockResolvedValue({ data: { result: 'nonce_unknown' } });
    await extensionPairApi.current(NONCE);
    expect(post.mock.calls[0][1]).toEqual({ setup_nonce: NONCE });
    const path = post.mock.calls[0][0] as string;
    expect(path).toBe('/extension/pair/current');
    expect(path).not.toContain(NONCE);
    expect(path).not.toContain('?');
  });

  it('returns the raw wire result untouched (decoding fails closed in types/extensionImport)', async () => {
    post.mockResolvedValue({ data: { result: 'something-unexpected', import_intent_id: 'ii-1' } });
    const res = await extensionPairApi.current(NONCE);
    expect(res.data).toEqual({ result: 'something-unexpected', import_intent_id: 'ii-1' });
  });

  it.each([401, 404, 500])('propagates a %s to the caller', async (status) => {
    post.mockRejectedValue(axiosError(status));
    await expect(extensionPairApi.current(NONCE)).rejects.toBeInstanceOf(AxiosError);
  });
});

describe('extensionPairApi surface', () => {
  it('exposes exactly the bearer-authenticated setup routes and NO redeem (extension-only)', () => {
    expect(Object.keys(extensionPairApi).sort()).toEqual(['current', 'init', 'status']);
    expect((extensionPairApi as Record<string, unknown>).redeem).toBeUndefined();
  });

  it('only ever POSTs (no GET/DELETE: nothing secret-adjacent can enter a URL)', async () => {
    post.mockResolvedValue({ data: {} });
    await extensionPairApi.init('truecoach', IDEM_KEY, NONCE);
    await extensionPairApi.status('123456');
    await extensionPairApi.current(NONCE);
    expect(jest.mocked(api.get)).not.toHaveBeenCalled();
    expect(jest.mocked(api.delete)).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(3);
    for (const [path] of post.mock.calls) expect(path).not.toContain('?');
  });
});
