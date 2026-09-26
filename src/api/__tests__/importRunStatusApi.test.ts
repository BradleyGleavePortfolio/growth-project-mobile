/**
 * S12-B3 importRunStatusApi transport seam: exact paths + query params, the
 * uniform 404 mapped to `notFound` (rendered "not known yet"), every other
 * failure propagated untouched so the hook can mark an earlier reading stale.
 */
import { AxiosError, AxiosHeaders } from 'axios';
import { importRunStatusApi } from '../importRunStatusApi';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as { get: jest.Mock };

const INTENT = 'intent-1';

function httpError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(`http ${status}`, 'ERR_BAD_RESPONSE', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: {},
  });
}

beforeEach(() => api.get.mockReset());

describe('importRunStatusApi.status', () => {
  it('GETs scout/import/status with intent_id as the only query param and returns the raw body', async () => {
    api.get.mockResolvedValueOnce({ data: { intent_id: INTENT } });
    await expect(importRunStatusApi.status(INTENT)).resolves.toEqual({ kind: 'body', body: { intent_id: INTENT } });
    const [path, cfg] = api.get.mock.calls[0];
    expect(path).toBe('/scout/import/status');
    expect(cfg.params).toEqual({ intent_id: INTENT });
    expect(cfg.signal).toBeDefined();
  });

  it('maps the uniform 404 to notFound', async () => {
    api.get.mockRejectedValueOnce(httpError(404));
    await expect(importRunStatusApi.status(INTENT)).resolves.toEqual({ kind: 'notFound' });
  });

  it.each([400, 401, 403, 429, 500])('propagates HTTP %i untouched', async (status) => {
    const err = httpError(status);
    api.get.mockRejectedValueOnce(err);
    await expect(importRunStatusApi.status(INTENT)).rejects.toBe(err);
  });

  it('propagates a non-HTTP failure untouched', async () => {
    const err = new Error('offline');
    api.get.mockRejectedValueOnce(err);
    await expect(importRunStatusApi.status(INTENT)).rejects.toBe(err);
  });
});

describe('importRunStatusApi.roster', () => {
  it('GETs scout/reconstruct/roster with intent_id + bounded limit, cursor only when given', async () => {
    api.get.mockResolvedValue({ data: {} });
    await importRunStatusApi.roster(INTENT);
    await importRunStatusApi.roster(INTENT, 'CUR');
    expect(api.get.mock.calls[0][0]).toBe('/scout/reconstruct/roster');
    expect(api.get.mock.calls[0][1].params).toEqual({ intent_id: INTENT, limit: '50' });
    expect(api.get.mock.calls[1][1].params).toEqual({ intent_id: INTENT, limit: '50', cursor: 'CUR' });
  });

  it('maps 404 to notFound', async () => {
    api.get.mockRejectedValueOnce(httpError(404));
    await expect(importRunStatusApi.roster(INTENT)).resolves.toEqual({ kind: 'notFound' });
  });
});
