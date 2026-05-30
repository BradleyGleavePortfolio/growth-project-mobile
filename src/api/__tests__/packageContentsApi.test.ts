// Behavioral tests for the coach package CONTENTS + push API client (PR-17 M1).
//
// Mirrors the paymentsApi.test.ts convention: mock the shared axios default
// instance, assert each method hits the correct path + verb + body, and that
// the mutations (attach/patch/push) carry an Idempotency-Key header
// (decision #8). pushPreview's query string is asserted via the axios config
// `params`.

jest.mock('../../services/api', () => {
  const instance = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  };
  return { __esModule: true, default: instance };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const apiMock = jest.requireMock('../../services/api').default as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  patch: jest.Mock;
  delete: jest.Mock;
};

import {
  coachPackageContentsApi,
  type AttachContentBody,
  type PatchContentBody,
  type PushRequest,
} from '../packageContentsApi';

const PKG = 'pkg-123';
const CONTENT = 'content-456';

beforeEach(() => {
  apiMock.get.mockReset().mockResolvedValue({ data: {} });
  apiMock.post.mockReset().mockResolvedValue({ data: {} });
  apiMock.put.mockReset().mockResolvedValue({ data: {} });
  apiMock.patch.mockReset().mockResolvedValue({ data: {} });
  apiMock.delete.mockReset().mockResolvedValue({ data: {} });
});

describe('coachPackageContentsApi paths + verbs', () => {
  it('list → GET /v1/coach/packages/:id/contents', async () => {
    await coachPackageContentsApi.list(PKG);
    expect(apiMock.get).toHaveBeenCalledTimes(1);
    const [url] = apiMock.get.mock.calls[0];
    expect(url).toBe(`/v1/coach/packages/${PKG}/contents`);
  });

  it('attach → POST /v1/coach/packages/:id/contents + body + idem header', async () => {
    const body: AttachContentBody = {
      asset_type: 'auto_message',
      asset_id: 'tmpl-1',
      cadence_kind: 'immediate',
      cadence_payload: {},
      display_caption: 'hello',
    };
    await coachPackageContentsApi.attach(PKG, body);
    expect(apiMock.post).toHaveBeenCalledTimes(1);
    const [url, sentBody, config] = apiMock.post.mock.calls[0];
    expect(url).toBe(`/v1/coach/packages/${PKG}/contents`);
    expect(sentBody).toEqual(body);
    expect(config?.headers?.['Idempotency-Key']).toBeTruthy();
  });

  it('attach → honors a caller-supplied idempotency key', async () => {
    const body: AttachContentBody = {
      asset_type: 'pdf',
      asset_id: 'media-9',
      cadence_kind: 'immediate',
      cadence_payload: {},
    };
    await coachPackageContentsApi.attach(PKG, body, 'fixed-key-1');
    const [, , config] = apiMock.post.mock.calls[0];
    expect(config?.headers?.['Idempotency-Key']).toBe('fixed-key-1');
  });

  it('patch → PATCH /v1/coach/packages/:id/contents/:contentId + body + idem header', async () => {
    const body: PatchContentBody = {
      display_title: 'New title',
      cadence_kind: 'relative_to_purchase',
      cadence_payload: { offset_days: 7 },
    };
    await coachPackageContentsApi.patch(PKG, CONTENT, body);
    expect(apiMock.patch).toHaveBeenCalledTimes(1);
    const [url, sentBody, config] = apiMock.patch.mock.calls[0];
    expect(url).toBe(`/v1/coach/packages/${PKG}/contents/${CONTENT}`);
    expect(sentBody).toEqual(body);
    expect(config?.headers?.['Idempotency-Key']).toBeTruthy();
  });

  it('reorder → PUT /v1/coach/packages/:id/contents/reorder + content_ids body', async () => {
    await coachPackageContentsApi.reorder(PKG, ['a', 'b', 'c']);
    expect(apiMock.put).toHaveBeenCalledTimes(1);
    const [url, sentBody] = apiMock.put.mock.calls[0];
    expect(url).toBe(`/v1/coach/packages/${PKG}/contents/reorder`);
    expect(sentBody).toEqual({ content_ids: ['a', 'b', 'c'] });
  });

  it('remove → DELETE /v1/coach/packages/:id/contents/:contentId + idem header', async () => {
    await coachPackageContentsApi.remove(PKG, CONTENT);
    expect(apiMock.delete).toHaveBeenCalledTimes(1);
    const [url, config] = apiMock.delete.mock.calls[0];
    expect(url).toBe(`/v1/coach/packages/${PKG}/contents/${CONTENT}`);
    expect(config?.headers?.['Idempotency-Key']).toBeTruthy();
  });

  it('pushPreview → GET …/push/preview with audience+mode query params', async () => {
    await coachPackageContentsApi.pushPreview(PKG, CONTENT, {
      audience: 'active',
      mode: 'push_existing',
    });
    expect(apiMock.get).toHaveBeenCalledTimes(1);
    const [url, config] = apiMock.get.mock.calls[0];
    expect(url).toBe(`/v1/coach/packages/${PKG}/contents/${CONTENT}/push/preview`);
    expect(config?.params).toEqual({ audience: 'active', mode: 'push_existing' });
  });

  it('push → POST …/push + full body + idem header', async () => {
    const body: PushRequest = {
      audience: 'cohort',
      cohort_purchase_ids: ['p1', 'p2'],
      fire_at: '2026-06-01T12:00:00.000Z',
      mode: 'resend',
      notify: true,
    };
    await coachPackageContentsApi.push(PKG, CONTENT, body);
    expect(apiMock.post).toHaveBeenCalledTimes(1);
    const [url, sentBody, config] = apiMock.post.mock.calls[0];
    expect(url).toBe(`/v1/coach/packages/${PKG}/contents/${CONTENT}/push`);
    expect(sentBody).toEqual(body);
    expect(config?.headers?.['Idempotency-Key']).toBeTruthy();
  });

  it('push → honors a caller-supplied idempotency key', async () => {
    const body: PushRequest = {
      audience: 'all',
      fire_at: '2026-06-01T12:00:00.000Z',
      mode: 'push_existing',
      notify: false,
    };
    await coachPackageContentsApi.push(PKG, CONTENT, body, 'fixed-push-key');
    const [, , config] = apiMock.post.mock.calls[0];
    expect(config?.headers?.['Idempotency-Key']).toBe('fixed-push-key');
  });

  it('encodes path segments to prevent injection', async () => {
    await coachPackageContentsApi.list('a/b');
    const [url] = apiMock.get.mock.calls[0];
    expect(url).toBe('/v1/coach/packages/a%2Fb/contents');
  });
});
