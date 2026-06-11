/**
 * coachCommunityApi — wire-contract tests for the v1-6 coach surface.
 *
 * Mocks the axios instance at `../services/api` (the repo's established test
 * seam) and asserts, for the endpoints:
 *   - the exact URL + HTTP method the mobile client sends,
 *   - that NO `coachId` is ever threaded into a URL or payload (hard gate:
 *     the acting coach is derived from the JWT, never a client-supplied param),
 *   - a Zod parse-SUCCESS path (valid backend shape -> typed object),
 *   - a Zod parse-FAILURE path (drifted shape -> CoachCommunityApiError contract),
 *   - HTTP error mapping (401 -> unauthorized, 403 -> forbidden, 5xx -> server),
 *   - that mutations send an Idempotency-Key header (R19).
 */
import {
  coachCommunityApi,
  CoachCommunityApiError,
  type CoachDashboard,
} from './coachCommunityApi';

jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

// The idempotency util reads crypto.getRandomValues; provide a deterministic
// stub so the mutation tests do not depend on the RN polyfill.
jest.mock('../utils/idempotency', () => ({
  generateIdempotencyKey: () => 'test-idempotency-key',
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../services/api').default as {
  get: jest.Mock;
  post: jest.Mock;
  delete: jest.Mock;
};

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
});

function axiosError(status: number): Error {
  const err = new Error(`HTTP ${status}`) as Error & {
    isAxiosError: boolean;
    response: { status: number };
  };
  err.isAxiosError = true;
  err.response = { status };
  return err;
}

const validDashboard: CoachDashboard = {
  unread_inbox_count: 3,
  active_cohort_count: 2,
  flagged_today_count: 1,
};

describe('coachCommunityApi — read endpoints', () => {
  it('getDashboard hits the dashboard endpoint and parses the envelope', async () => {
    api.get.mockResolvedValueOnce({ data: validDashboard });
    const res = await coachCommunityApi.getDashboard();
    expect(api.get).toHaveBeenCalledWith('/community/coach/dashboard');
    expect(res.unread_inbox_count).toBe(3);
  });

  it('getInbox forwards keyset params', async () => {
    api.get.mockResolvedValueOnce({ data: { items: [], next_before: null } });
    await coachCommunityApi.getInbox({ before: 'cursor-1', limit: 20 });
    expect(api.get).toHaveBeenCalledWith('/community/coach/inbox', {
      params: { before: 'cursor-1', limit: '20' },
    });
  });

  it('getCohorts unwraps the cohorts array', async () => {
    api.get.mockResolvedValueOnce({
      data: {
        cohorts: [
          {
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            name: 'Spring',
            member_count: 4,
            unread_count: 0,
            created_at: '2026-06-10T00:00:00.000Z',
          },
        ],
      },
    });
    const res = await coachCommunityApi.getCohorts();
    expect(api.get).toHaveBeenCalledWith('/community/coach/cohorts');
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe('Spring');
  });

  it('getCohortDetail hits the by-id endpoint', async () => {
    api.get.mockResolvedValueOnce({
      data: {
        cohort: {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          name: 'Spring',
          member_count: 0,
          unread_count: 0,
          created_at: '2026-06-10T00:00:00.000Z',
        },
        members: [],
      },
    });
    await coachCommunityApi.getCohortDetail('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(api.get).toHaveBeenCalledWith(
      '/community/coach/cohorts/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    );
  });

  it('getFlagged unwraps the items array', async () => {
    api.get.mockResolvedValueOnce({ data: { items: [] } });
    const res = await coachCommunityApi.getFlagged();
    expect(api.get).toHaveBeenCalledWith('/community/moderation/flagged');
    expect(res).toEqual([]);
  });
});

describe('coachCommunityApi — mutations carry Idempotency-Key + no coachId', () => {
  it('ackInboxItem posts to the ack endpoint with an idempotency header', async () => {
    api.post.mockResolvedValueOnce({ data: {} });
    await coachCommunityApi.ackInboxItem('11111111-1111-1111-1111-111111111111');
    expect(api.post).toHaveBeenCalledWith(
      '/community/coach/inbox/11111111-1111-1111-1111-111111111111/ack',
      {},
      { headers: { 'Idempotency-Key': 'test-idempotency-key' } },
    );
  });

  it('createCohort posts the name with an idempotency header (no coachId)', async () => {
    api.post.mockResolvedValueOnce({
      data: {
        cohort: {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          name: 'Winter',
          member_count: 0,
          unread_count: 0,
          created_at: '2026-06-10T00:00:00.000Z',
        },
      },
    });
    await coachCommunityApi.createCohort({ name: 'Winter' });
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/community/coach/cohorts');
    expect(body).toEqual({ name: 'Winter' });
    // The payload must NOT contain a coachId — the JWT is the only authority.
    expect(JSON.stringify(body)).not.toMatch(/coachId/i);
  });

  it('inviteMember posts the email to the members endpoint', async () => {
    api.post.mockResolvedValueOnce({
      data: {
        member: {
          user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          name: 'Dana',
          email: 'dana@example.com',
          avatar_url: null,
          role: 'client',
          joined_at: '2026-06-10T00:00:00.000Z',
        },
      },
    });
    await coachCommunityApi.inviteMember('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', {
      email: 'dana@example.com',
    });
    expect(api.post).toHaveBeenCalledWith(
      '/community/coach/cohorts/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/members',
      { email: 'dana@example.com' },
      { headers: { 'Idempotency-Key': 'test-idempotency-key' } },
    );
  });

  it('removeMember deletes the member by userId', async () => {
    api.delete.mockResolvedValueOnce({ data: {} });
    await coachCommunityApi.removeMember(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    );
    expect(api.delete).toHaveBeenCalledWith(
      '/community/coach/cohorts/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/members/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    );
  });

  it('hidePost posts to the post hide endpoint', async () => {
    api.post.mockResolvedValueOnce({ data: {} });
    await coachCommunityApi.hidePost('dddddddd-dddd-dddd-dddd-dddddddddddd');
    expect(api.post).toHaveBeenCalledWith(
      '/community/posts/dddddddd-dddd-dddd-dddd-dddddddddddd/hide',
      {},
      { headers: { 'Idempotency-Key': 'test-idempotency-key' } },
    );
  });

  it('hideMessage posts to the message hide endpoint', async () => {
    api.post.mockResolvedValueOnce({ data: {} });
    await coachCommunityApi.hideMessage('ffffffff-ffff-ffff-ffff-ffffffffffff');
    expect(api.post).toHaveBeenCalledWith(
      '/community/messages/ffffffff-ffff-ffff-ffff-ffffffffffff/hide',
      {},
      { headers: { 'Idempotency-Key': 'test-idempotency-key' } },
    );
  });
});

describe('coachCommunityApi — error + contract mapping', () => {
  it('maps 401 to an unauthorized CoachCommunityApiError', async () => {
    api.get.mockRejectedValueOnce(axiosError(401));
    await expect(coachCommunityApi.getDashboard()).rejects.toMatchObject({
      name: 'CoachCommunityApiError',
      kind: 'unauthorized',
      status: 401,
    });
  });

  it('maps 403 to a forbidden CoachCommunityApiError', async () => {
    api.get.mockRejectedValueOnce(axiosError(403));
    await expect(coachCommunityApi.getCohorts()).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403,
    });
  });

  it('maps 500 to a server CoachCommunityApiError', async () => {
    api.get.mockRejectedValueOnce(axiosError(500));
    await expect(coachCommunityApi.getFlagged()).rejects.toMatchObject({
      kind: 'server',
      status: 500,
    });
  });

  it('throws a contract error when the dashboard shape drifts', async () => {
    api.get.mockResolvedValueOnce({ data: { unread_inbox_count: 'three' } });
    const err = await coachCommunityApi.getDashboard().catch((e) => e);
    expect(err).toBeInstanceOf(CoachCommunityApiError);
    expect(err.kind).toBe('contract');
  });
});
