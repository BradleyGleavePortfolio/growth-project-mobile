/**
 * extensionPairApi — wire-contract tests (v0.3 import, PR-M2).
 *
 * Mocks the axios instance at `../../services/api` (the repo's established test
 * seam) and asserts the EXACT method, path, and body mobile sends for the only
 * two coach-callable pairing endpoints, that responses pass through untouched,
 * that the pairing code travels body-only (never a query string), and that
 * transport errors PROPAGATE to the caller (never coerced into a fake success).
 *
 * Backend contract source of truth:
 *   growth-project-backend/docs/contracts/importer-openapi.json
 *   (POST /api/extension/pair/init, POST /api/extension/pair/status)
 */
import { AxiosError, AxiosHeaders } from 'axios';
import { extensionPairApi } from '../extensionPairApi';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as { post: jest.Mock };

beforeEach(() => {
  api.post.mockReset();
});

function axiosError(status: number): AxiosError {
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', undefined, undefined, {
    status,
    statusText: String(status),
    data: {},
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

describe('extensionPairApi.init', () => {
  it('POSTs /extension/pair/init with the chosen_platform body and returns the response', async () => {
    api.post.mockResolvedValue({ data: { pairing_code: '123456', expires_at: '2026-07-14T12:05:00Z' } });

    const res = await extensionPairApi.init('truecoach');

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post.mock.calls[0][0]).toBe('/extension/pair/init');
    expect(api.post.mock.calls[0][1]).toEqual({ chosen_platform: 'truecoach' });
    expect(res.data).toEqual({ pairing_code: '123456', expires_at: '2026-07-14T12:05:00Z' });
  });

  it('omits the /api prefix (baseURL already carries it) and sends no query string', async () => {
    api.post.mockResolvedValue({ data: { pairing_code: '000000', expires_at: 'x' } });
    await extensionPairApi.init('custom');
    const path = api.post.mock.calls[0][0] as string;
    expect(path.startsWith('/api/')).toBe(false);
    expect(path).not.toContain('?');
  });

  it('propagates a 401 (auth) to the caller — never a fake mint', async () => {
    api.post.mockRejectedValue(axiosError(401));
    await expect(extensionPairApi.init('everfit')).rejects.toBeInstanceOf(AxiosError);
  });

  it('propagates a 404 (server kill-switch off) to the caller', async () => {
    api.post.mockRejectedValue(axiosError(404));
    await expect(extensionPairApi.init('everfit')).rejects.toBeInstanceOf(AxiosError);
  });

  it('propagates a 500 (transient server fault) to the caller', async () => {
    api.post.mockRejectedValue(axiosError(500));
    await expect(extensionPairApi.init('truecoach')).rejects.toBeInstanceOf(AxiosError);
  });

  it('returns the server-authoritative expires_at untouched (no local clock math)', async () => {
    const expiresAt = '2026-07-14T12:05:00.000Z';
    api.post.mockResolvedValue({ data: { pairing_code: '246810', expires_at: expiresAt } });
    const res = await extensionPairApi.init('everfit');
    expect(res.data.expires_at).toBe(expiresAt);
    expect(res.data.pairing_code).toBe('246810');
  });

  it('sends the exact chosen_platform slug for each distinct platform', async () => {
    api.post.mockResolvedValue({ data: { pairing_code: '000000', expires_at: 'x' } });
    await extensionPairApi.init('everfit');
    await extensionPairApi.init('trainerize');
    expect(api.post.mock.calls[0][1]).toEqual({ chosen_platform: 'everfit' });
    expect(api.post.mock.calls[1][1]).toEqual({ chosen_platform: 'trainerize' });
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it('does not swallow a rejection into a resolved value', async () => {
    api.post.mockRejectedValue(axiosError(401));
    const spy = jest.fn();
    await extensionPairApi.init('truecoach').then(spy).catch(() => {});
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('extensionPairApi.status', () => {
  it('POSTs /extension/pair/status with the code in the BODY (never a query)', async () => {
    api.post.mockResolvedValue({ data: { status: 'pending' } });

    const res = await extensionPairApi.status('654321');

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post.mock.calls[0][0]).toBe('/extension/pair/status');
    expect(api.post.mock.calls[0][1]).toEqual({ code: '654321' });
    // The code must not leak into the URL where it could be logged by proxies.
    expect(api.post.mock.calls[0][0]).not.toContain('654321');
    expect(res.data).toEqual({ status: 'pending' });
  });

  it('returns the raw wire status untouched (decoding is the hook\'s job)', async () => {
    api.post.mockResolvedValue({ data: { status: 'something-unexpected' } });
    const res = await extensionPairApi.status('111111');
    expect(res.data.status).toBe('something-unexpected');
  });

  it('propagates a 500 to the caller', async () => {
    api.post.mockRejectedValue(axiosError(500));
    await expect(extensionPairApi.status('222222')).rejects.toBeInstanceOf(AxiosError);
  });

  it('propagates a 401 (auth loss mid-poll) to the caller', async () => {
    api.post.mockRejectedValue(axiosError(401));
    await expect(extensionPairApi.status('333333')).rejects.toBeInstanceOf(AxiosError);
  });

  it('propagates a 404 (code unknown / kill-switch) to the caller', async () => {
    api.post.mockRejectedValue(axiosError(404));
    await expect(extensionPairApi.status('444444')).rejects.toBeInstanceOf(AxiosError);
  });

  it('passes through the paired terminal status verbatim', async () => {
    api.post.mockResolvedValue({ data: { status: 'paired' } });
    const res = await extensionPairApi.status('555555');
    expect(res.data.status).toBe('paired');
  });

  it('passes through the expired status verbatim', async () => {
    api.post.mockResolvedValue({ data: { status: 'expired' } });
    const res = await extensionPairApi.status('666666');
    expect(res.data.status).toBe('expired');
  });

  it('re-POSTs on every poll (no client-side caching of a code lookup)', async () => {
    api.post.mockResolvedValue({ data: { status: 'pending' } });
    await extensionPairApi.status('777777');
    await extensionPairApi.status('777777');
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.post.mock.calls.every((c) => c[0] === '/extension/pair/status')).toBe(true);
  });
});
