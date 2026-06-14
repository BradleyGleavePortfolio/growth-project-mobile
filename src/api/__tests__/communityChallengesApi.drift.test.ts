/**
 * Contract-drift tests for communityChallengesApi.
 *
 * These pin that the response schemas mirror the backend DTO field-by-field and
 * are strict: an extra/unknown field, a non-uuid id, a non-datetime timestamp,
 * or a non-positive rank all fail validation and surface as a `contract` error
 * (CommunityApiError kind 'contract'), never silently passing malformed data
 * into React state. The list, comments, and leaderboard reads carry a cursor
 * envelope (`next_cursor: uuid | null`); a missing cursor field is itself a
 * drift on these strict schemas.
 */
import axios from 'axios';
import { communityChallengesApi } from '../communityChallengesApi';
import { CommunityApiError } from '../communityApi';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

jest.mock('../../utils/idempotency', () => ({
  __esModule: true,
  generateIdempotencyKey: () => 'test-idem-key',
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

const WS = '11111111-1111-1111-1111-111111111111';
const CID = '55555555-5555-5555-5555-555555555555';
const UID = '22222222-2222-2222-2222-222222222222';
const ISO = '2026-06-09T12:00:00.000Z';

function validChallenge() {
  return {
    id: CID,
    workspace_id: WS,
    cohort_id: null,
    created_by_user_id: UID,
    title: 'Walk it out',
    description: null,
    status: 'active',
    starts_at: null,
    ends_at: null,
    metric_key: 'steps',
    target_value: 100000,
    unit: 'steps',
    leaderboard_enabled: false,
    created_at: ISO,
    updated_at: ISO,
    archived: false,
  };
}

function validParticipation() {
  return {
    challenge_id: CID,
    user_id: UID,
    progress_value: 25000,
    target_value: 100000,
    progress_fraction: 0.25,
    completed: false,
    completed_at: null,
    last_logged_at: ISO,
    leaderboard_opted_in: false,
  };
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.delete.mockReset();
});

afterEach(() => jest.restoreAllMocks());

describe('communityChallengesApi — happy-path parse', () => {
  it('parses a well-formed challenge list page (challenges + next_cursor)', async () => {
    api.get.mockResolvedValueOnce({
      data: { challenges: [validChallenge()], next_cursor: null },
    });
    const res = await communityChallengesApi.listChallenges(WS);
    // The default call sends a bounded page limit; no cursor on the first page.
    expect(api.get).toHaveBeenCalledWith(
      `/community/workspaces/${WS}/challenges`,
      { params: { limit: '20' } },
    );
    expect(res.challenges[0].id).toBe(CID);
    expect(res.next_cursor).toBeNull();
  });

  it('accepts a uuid next_cursor signalling a further page', async () => {
    api.get.mockResolvedValueOnce({
      data: { challenges: [validChallenge()], next_cursor: WS },
    });
    const res = await communityChallengesApi.listChallenges(WS);
    expect(res.next_cursor).toBe(WS);
  });

  it('sends an explicit limit + cursor when paging forward', async () => {
    api.get.mockResolvedValueOnce({
      data: { challenges: [validChallenge()], next_cursor: null },
    });
    await communityChallengesApi.listChallenges(WS, {
      limit: 5,
      cursor: 'next-page-token',
    });
    expect(api.get).toHaveBeenCalledWith(
      `/community/workspaces/${WS}/challenges`,
      { params: { limit: '5', cursor: 'next-page-token' } },
    );
  });

  it('sends a bounded limit on leaderboard + comments fetches', async () => {
    api.get.mockResolvedValueOnce({
      data: { available: true, opted_in: true, rows: [], next_cursor: null },
    });
    await communityChallengesApi.getLeaderboard(CID);
    expect(api.get).toHaveBeenLastCalledWith(
      `/community/challenges/${CID}/leaderboard`,
      { params: { limit: '20' } },
    );
    api.get.mockResolvedValueOnce({ data: { comments: [], next_cursor: null } });
    await communityChallengesApi.listComments(CID);
    expect(api.get).toHaveBeenLastCalledWith(
      `/community/challenges/${CID}/comments`,
      { params: { limit: '20' } },
    );
  });

  it('rejects a list envelope MISSING the next_cursor field (strict)', async () => {
    api.get.mockResolvedValueOnce({
      data: { challenges: [validChallenge()] },
    });
    await expect(communityChallengesApi.listChallenges(WS)).rejects.toMatchObject(
      { kind: 'contract' },
    );
  });

  it('rejects a NON-uuid next_cursor on the list envelope', async () => {
    api.get.mockResolvedValueOnce({
      data: { challenges: [validChallenge()], next_cursor: 'not-a-uuid' },
    });
    await expect(communityChallengesApi.listChallenges(WS)).rejects.toMatchObject(
      { kind: 'contract' },
    );
  });

  it('parses a well-formed challenge detail (challenge + participation)', async () => {
    api.get.mockResolvedValueOnce({
      data: { challenge: validChallenge(), participation: validParticipation() },
    });
    const res = await communityChallengesApi.getChallenge(CID);
    expect(res.participation?.progress_value).toBe(25000);
  });
});

describe('communityChallengesApi — strict drift rejection', () => {
  it('rejects an UNKNOWN extra field on a challenge (.strict, not .passthrough)', async () => {
    const drifted = { ...validChallenge(), surprise_field: 'nope' };
    api.get.mockResolvedValueOnce({ data: { challenges: [drifted] } });
    await expect(communityChallengesApi.listChallenges(WS)).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects an UNKNOWN extra field on the list envelope', async () => {
    api.get.mockResolvedValueOnce({
      data: { challenges: [validChallenge()], next_cursor: null, next_page: 'x' },
    });
    await expect(communityChallengesApi.listChallenges(WS)).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects a NON-datetime created_at timestamp', async () => {
    const drifted = { ...validChallenge(), created_at: 'March 1st 2026' };
    api.get.mockResolvedValueOnce({ data: { challenge: drifted, participation: null } });
    await expect(communityChallengesApi.getChallenge(CID)).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects a NON-uuid id', async () => {
    const drifted = { ...validChallenge(), id: 'not-a-uuid' };
    api.get.mockResolvedValueOnce({ data: { challenge: drifted, participation: null } });
    await expect(communityChallengesApi.getChallenge(CID)).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects a non-positive / non-integer leaderboard rank', async () => {
    api.get.mockResolvedValueOnce({
      data: {
        available: true,
        opted_in: true,
        rows: [{ user_id: UID, rank: 0, progress_value: 10, is_self: true }],
        next_cursor: null,
      },
    });
    await expect(communityChallengesApi.getLeaderboard(CID)).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('rejects an extra field on a participation response', async () => {
    const drifted = { ...validParticipation(), shadow_rank: 3 };
    api.put.mockResolvedValueOnce({ data: { participation: drifted } });
    await expect(
      communityChallengesApi.updateProgress(CID, 30000),
    ).rejects.toMatchObject({ kind: 'contract' });
  });

  it('rejects a NON-datetime comment created_at', async () => {
    api.get.mockResolvedValueOnce({
      data: {
        comments: [
          {
            id: CID,
            challenge_id: CID,
            author_user_id: UID,
            body: 'nice',
            created_at: '01-03-2026',
          },
        ],
        next_cursor: null,
      },
    });
    await expect(communityChallengesApi.listComments(CID)).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('a contract drift is a CommunityApiError instance', async () => {
    const drifted = { ...validChallenge(), extra: true };
    api.get.mockResolvedValueOnce({ data: { challenges: [drifted] } });
    const e = await communityChallengesApi.listChallenges(WS).catch((x) => x);
    expect(e).toBeInstanceOf(CommunityApiError);
    expect(e.kind).toBe('contract');
  });
});

describe('communityChallengesApi — 409 classified as conflict', () => {
  it('maps an HTTP 409 on progress to kind "conflict"', async () => {
    jest
      .spyOn(axios, 'isAxiosError')
      .mockImplementation(
        (x: unknown) => !!(x && (x as { isAxiosError?: boolean }).isAxiosError),
      );
    const err = new Error('HTTP 409') as Error & {
      isAxiosError: boolean;
      response?: { status: number };
    };
    err.isAxiosError = true;
    err.response = { status: 409 };
    api.put.mockRejectedValueOnce(err);
    await expect(
      communityChallengesApi.updateProgress(CID, 40000),
    ).rejects.toMatchObject({ kind: 'conflict', status: 409 });
  });
});
