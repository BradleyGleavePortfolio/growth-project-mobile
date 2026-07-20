/**
 * Contract/consumer tests for importReviewApi (IMPORTER-I reconstruct read,
 * backend contract 1.4.0). These pin that the response schema mirrors the
 * backend DTO field-by-field and is STRICT: an extra/unknown field, a non-uuid
 * entity id, a non-integer/negative page_count, a wrong family, or a missing
 * envelope field all fail validation and surface as a `contract` error
 * (CommunityApiError kind 'contract'), never silently passing malformed data
 * into React state.
 *
 * They also pin the honesty-relevant contract facts: page_count is page-local
 * (not asserted against a total), next_cursor is OPAQUE (any string, not a
 * uuid) and nullable, and a 403 classifies as `forbidden` (no existence oracle).
 */
import axios from 'axios';
import { importReviewApi } from '../importReviewApi';
import { CommunityApiError } from '../communityApi';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as { get: jest.Mock };

const E1 = '11111111-1111-4111-8111-111111111111';
const E2 = '22222222-2222-4222-8222-222222222222';

function validEntity(id: string = E1, family = 'workouts') {
  return { id, family };
}

function validPage(overrides: Record<string, unknown> = {}) {
  return {
    family: 'workouts',
    entities: [validEntity()],
    reasons: [{ code: 'partial_source', message: 'Some sessions were unreadable.' }],
    page_count: 1,
    next_cursor: null,
    ...overrides,
  };
}

beforeEach(() => {
  api.get.mockReset();
});

afterEach(() => jest.restoreAllMocks());

describe('importReviewApi — happy-path parse + request shape', () => {
  it('parses a well-formed page and sends family + bounded limit, no cursor on page 1', async () => {
    api.get.mockResolvedValueOnce({ data: validPage() });
    const res = await importReviewApi.listEntities('workouts');
    expect(res.entities[0].id).toBe(E1);
    expect(res.page_count).toBe(1);
    expect(res.next_cursor).toBeNull();
    const [path, cfg] = api.get.mock.calls[0];
    expect(path).toBe('/scout/reconstruct/entities');
    expect(cfg.params).toEqual({ family: 'workouts', limit: '20' });
  });

  it('sends the OPAQUE cursor verbatim (not a uuid) when paging forward', async () => {
    api.get.mockResolvedValueOnce({
      data: validPage({ next_cursor: null }),
    });
    await importReviewApi.listEntities('client_history', {
      cursor: 'opaque||cursor::token',
      limit: 5,
    });
    const [, cfg] = api.get.mock.calls[0];
    expect(cfg.params).toEqual({
      family: 'client_history',
      limit: '5',
      cursor: 'opaque||cursor::token',
    });
  });

  it('accepts an OPAQUE (non-uuid) next_cursor signalling a further page', async () => {
    api.get.mockResolvedValueOnce({
      data: validPage({ next_cursor: 'not-a-uuid-opaque-token' }),
    });
    const res = await importReviewApi.listEntities('workouts');
    expect(res.next_cursor).toBe('not-a-uuid-opaque-token');
  });

  it('accepts an empty page (no entities, no reasons) as a normal read', async () => {
    api.get.mockResolvedValueOnce({
      data: validPage({ entities: [], reasons: [], page_count: 0 }),
    });
    const res = await importReviewApi.listEntities('workouts');
    expect(res.entities).toHaveLength(0);
    expect(res.page_count).toBe(0);
  });

  it('parses both canonical families', async () => {
    api.get.mockResolvedValueOnce({
      data: validPage({ family: 'client_history', entities: [validEntity(E2, 'client_history')] }),
    });
    const res = await importReviewApi.listEntities('client_history');
    expect(res.family).toBe('client_history');
    expect(res.entities[0].family).toBe('client_history');
  });
});

describe('importReviewApi — strict drift rejection', () => {
  it('rejects an UNKNOWN extra field on the envelope', async () => {
    api.get.mockResolvedValueOnce({ data: validPage({ surprise: 'x' }) });
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects an UNKNOWN extra field on an entity (.strict, not .passthrough)', async () => {
    api.get.mockResolvedValueOnce({
      data: validPage({ entities: [{ ...validEntity(), leaked_pii: 'jane@x.com' }] }),
    });
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects a NON-uuid entity id', async () => {
    api.get.mockResolvedValueOnce({
      data: validPage({ entities: [{ id: 'not-a-uuid', family: 'workouts' }] }),
    });
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects an UNRECOGNISED family (site-agnostic closed enum)', async () => {
    api.get.mockResolvedValueOnce({ data: validPage({ family: 'truecoach_notes' }) });
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects a MISSING next_cursor field (strict envelope)', async () => {
    const p = validPage();
    delete (p as Record<string, unknown>).next_cursor;
    api.get.mockResolvedValueOnce({ data: p });
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects a NON-integer page_count', async () => {
    api.get.mockResolvedValueOnce({ data: validPage({ page_count: 1.5 }) });
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects a NEGATIVE page_count', async () => {
    api.get.mockResolvedValueOnce({ data: validPage({ page_count: -1 }) });
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects an extra field on a reason', async () => {
    api.get.mockResolvedValueOnce({
      data: validPage({ reasons: [{ code: 'x', message: 'y', count: 3 }] }),
    });
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('a contract drift is a CommunityApiError instance', async () => {
    api.get.mockResolvedValueOnce({ data: validPage({ extra: true }) });
    const e = await importReviewApi.listEntities('workouts').catch((x) => x);
    expect(e).toBeInstanceOf(CommunityApiError);
    expect(e.kind).toBe('contract');
  });
});

describe('importReviewApi — required-envelope completeness (strict 1.4.0)', () => {
  // Each required field is dropped in turn; a strict envelope must reject the
  // truncated page rather than default it, so a partial backend read can never
  // masquerade as a healthy empty page.
  it.each([
    ['family'],
    ['entities'],
    ['reasons'],
    ['page_count'],
    ['next_cursor'],
  ])('rejects a page missing the required "%s" field', async (field) => {
    const p = validPage() as Record<string, unknown>;
    delete p[field];
    api.get.mockResolvedValueOnce({ data: p });
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects a non-array entities field', async () => {
    api.get.mockResolvedValueOnce({ data: validPage({ entities: {} }) });
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects a null element inside entities', async () => {
    api.get.mockResolvedValueOnce({ data: validPage({ entities: [null] }) });
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects an entity missing its family field', async () => {
    api.get.mockResolvedValueOnce({ data: validPage({ entities: [{ id: E1 }] }) });
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects a reason missing its code', async () => {
    api.get.mockResolvedValueOnce({
      data: validPage({ reasons: [{ message: 'no code' }] }),
    });
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects a reason missing its message', async () => {
    api.get.mockResolvedValueOnce({
      data: validPage({ reasons: [{ code: 'partial' }] }),
    });
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects a numeric next_cursor (must be an opaque string or null)', async () => {
    api.get.mockResolvedValueOnce({ data: validPage({ next_cursor: 42 }) });
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects a non-string reason message', async () => {
    api.get.mockResolvedValueOnce({
      data: validPage({ reasons: [{ code: 'partial', message: 3 }] }),
    });
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind: 'contract',
    });
  });
});

describe('importReviewApi — request-shape edges (bounded, id-free)', () => {
  it('forwards a custom finite limit as a string', async () => {
    api.get.mockResolvedValueOnce({ data: validPage() });
    await importReviewApi.listEntities('workouts', { limit: 5 });
    expect(api.get.mock.calls[0][1].params).toEqual({ family: 'workouts', limit: '5' });
  });

  it('omits a non-positive limit (never sends limit=0)', async () => {
    api.get.mockResolvedValueOnce({ data: validPage() });
    await importReviewApi.listEntities('workouts', { limit: 0 });
    expect(api.get.mock.calls[0][1].params).toEqual({ family: 'workouts' });
  });

  it('omits a non-finite limit rather than sending NaN', async () => {
    api.get.mockResolvedValueOnce({ data: validPage() });
    await importReviewApi.listEntities('workouts', { limit: Number.NaN });
    expect(api.get.mock.calls[0][1].params).toEqual({ family: 'workouts' });
  });

  it('never puts a coach id in the path or params (coach-scoped server-side)', async () => {
    api.get.mockResolvedValueOnce({ data: validPage() });
    await importReviewApi.listEntities('workouts');
    const [path, cfg] = api.get.mock.calls[0];
    expect(path).toBe('/scout/reconstruct/entities');
    expect(Object.keys(cfg.params)).toEqual(expect.not.arrayContaining(['coach', 'coachId', 'user', 'userId']));
  });

  it('attaches an AbortSignal so a hung read cannot block forever', async () => {
    api.get.mockResolvedValueOnce({ data: validPage() });
    await importReviewApi.listEntities('workouts');
    expect(api.get.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('importReviewApi — transport classification', () => {
  function axiosStatus(status: number) {
    jest
      .spyOn(axios, 'isAxiosError')
      .mockImplementation(
        (x: unknown) => !!(x && (x as { isAxiosError?: boolean }).isAxiosError),
      );
    const err = new Error(`HTTP ${status}`) as Error & {
      isAxiosError: boolean;
      response?: { status: number };
    };
    err.isAxiosError = true;
    err.response = { status };
    return err;
  }

  // The full status→kind map. `forbidden` (not `not-found`) on 403 is the
  // load-bearing privacy case: a coach probing another's data gets no existence
  // oracle. `unknown` is the safe catch-all for unmapped statuses.
  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [409, 'conflict'],
    [410, 'gone'],
    [500, 'server'],
    [503, 'server'],
    [418, 'unknown'],
  ])('classifies HTTP %i as "%s"', async (status, kind) => {
    api.get.mockRejectedValueOnce(axiosStatus(status));
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind,
      status,
    });
  });

  it('classifies a network failure (no response) as "network"', async () => {
    jest
      .spyOn(axios, 'isAxiosError')
      .mockImplementation(
        (x: unknown) => !!(x && (x as { isAxiosError?: boolean }).isAxiosError),
      );
    const err = new Error('Network Error') as Error & { isAxiosError: boolean };
    err.isAxiosError = true;
    api.get.mockRejectedValueOnce(err);
    await expect(importReviewApi.listEntities('workouts')).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('wraps a non-axios throw as an "unknown" CommunityApiError (never leaks the raw error)', async () => {
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(false);
    api.get.mockRejectedValueOnce(new TypeError('boom'));
    const e = await importReviewApi.listEntities('workouts').catch((x) => x);
    expect(e).toBeInstanceOf(CommunityApiError);
    expect(e.kind).toBe('unknown');
  });
});
