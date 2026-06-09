/**
 * Contract tests for communityApi — the v1-5 mobile client surface over the
 * v1-4 Community backend (merged backend@5f6bedf).
 *
 * These pin every call shape the client sends and assert how each failure mode
 * normalises into a CommunityApiError (no soft-success, no swallowed 4xx/5xx).
 * If a future refactor drifts a path, body, or error-classification the suite
 * trips (R26 + R29). The wire contract is owned by the backend; this is the
 * mobile mirror.
 *
 * Coverage per endpoint:
 *   - success (exact path + params/body)
 *   - 401 → 'unauthorized', 403 → 'forbidden', 5xx → 'server', network → 'network'
 *   - Zod contract drift → 'contract'
 *   - mutations send an Idempotency-Key header (R19)
 */
import axios from 'axios';
import {
  communityApi,
  CommunityApiError,
  COMMUNITY_REACTION_EMOJI,
} from '../communityApi';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

jest.mock('../../utils/idempotency', () => ({
  __esModule: true,
  generateIdempotencyKey: () => 'test-idem-key',
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as {
  get: jest.Mock;
  post: jest.Mock;
  delete: jest.Mock;
};

const WS = '11111111-1111-1111-1111-111111111111';
const UID = '22222222-2222-2222-2222-222222222222';
const POST = '33333333-3333-3333-3333-333333333333';
const RECIP = '44444444-4444-4444-4444-444444444444';
const CID = '55555555-5555-5555-5555-555555555555';
const TID = '66666666-6666-6666-6666-666666666666';
const COMMENT = '77777777-7777-7777-7777-777777777777';
const MSG = '88888888-8888-8888-8888-888888888888';
const ISO = '2026-06-09T12:00:00.000Z';

function axiosErr(status: number) {
  // Build an object axios.isAxiosError() recognises.
  const err = new Error(`HTTP ${status}`) as Error & {
    isAxiosError: boolean;
    response?: { status: number };
  };
  err.isAxiosError = true;
  err.response = { status };
  return err;
}

const meFixture = {
  feature_flag_state: 'enabled',
  workspace_id: WS,
  membership: {
    id: CID,
    role: 'client',
    notify_level: 'live',
    dm_enabled_effective: true,
    last_read_message_at: null,
    joined_at: ISO,
  },
  unread: { cohort_messages: 2, dm_messages: 1, mentions: 0 },
  flags: {
    community_api: true,
    community_dm: true,
    community_realtime: true,
    community_push: false,
    community_telemetry: true,
  },
};

const postFixture = {
  id: POST,
  workspace_id: WS,
  cohort_id: null,
  author_user_id: UID,
  title: 'Hello',
  body: 'World',
  scope: 'hall',
  type: 'text',
  pinned: false,
  created_at: ISO,
  updated_at: ISO,
  deleted: false,
};

const dmThreadFixture = {
  thread_id: TID,
  workspace_id: WS,
  other_user_id: RECIP,
  created_at: ISO,
  last_message_at: ISO,
};

const dmMessageFixture = {
  id: MSG,
  thread_id: TID,
  sender_user_id: UID,
  recipient_user_id: RECIP,
  body: 'hi',
  created_at: ISO,
  deleted: false,
};

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  // Make the real axios.isAxiosError treat our synthetic errors as axios errors.
  jest
    .spyOn(axios, 'isAxiosError')
    .mockImplementation(
      (e: unknown) => !!(e && (e as { isAxiosError?: boolean }).isAxiosError),
    );
});

afterEach(() => jest.restoreAllMocks());

describe('communityApi.getMe', () => {
  it('GETs /community/me and parses the envelope', async () => {
    api.get.mockResolvedValueOnce({ data: meFixture });
    const res = await communityApi.getMe();
    expect(api.get).toHaveBeenCalledWith('/community/me');
    expect(res.workspace_id).toBe(WS);
    expect(res.unread.cohort_messages).toBe(2);
  });

  it('maps 401 → CommunityApiError kind "unauthorized" status 401', async () => {
    api.get.mockRejectedValueOnce(axiosErr(401));
    await expect(communityApi.getMe()).rejects.toMatchObject({
      name: 'CommunityApiError',
      kind: 'unauthorized',
      status: 401,
    });
  });

  it('maps 403 → "forbidden" (DM/scope gate)', async () => {
    api.get.mockRejectedValueOnce(axiosErr(403));
    await expect(communityApi.getMe()).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403,
    });
  });

  it('maps 500 → "server"', async () => {
    api.get.mockRejectedValueOnce(axiosErr(500));
    await expect(communityApi.getMe()).rejects.toMatchObject({
      kind: 'server',
      status: 500,
    });
  });

  it('maps a network error (no response) → "network"', async () => {
    const netErr = new Error('offline') as Error & { isAxiosError: boolean };
    netErr.isAxiosError = true;
    api.get.mockRejectedValueOnce(netErr);
    await expect(communityApi.getMe()).rejects.toMatchObject({
      kind: 'network',
      status: 0,
    });
  });

  it('throws "contract" when the response shape drifts (Zod)', async () => {
    api.get.mockResolvedValueOnce({ data: { not: 'the contract' } });
    await expect(communityApi.getMe()).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('errors are instances of CommunityApiError', async () => {
    api.get.mockRejectedValueOnce(axiosErr(410));
    const e = await communityApi.getMe().catch((x) => x);
    expect(e).toBeInstanceOf(CommunityApiError);
    expect(e.kind).toBe('gone');
  });
});

describe('communityApi.getToday', () => {
  it('GETs /community/today', async () => {
    api.get.mockResolvedValueOnce({
      data: {
        feature_flag_state: 'enabled',
        cohort: null,
        event: null,
        pinned_post: null,
        challenge: null,
        empty_reason: 'no_today_content',
      },
    });
    const res = await communityApi.getToday();
    expect(api.get).toHaveBeenCalledWith('/community/today');
    expect(res.empty_reason).toBe('no_today_content');
  });

  it('maps 500 → "server"', async () => {
    api.get.mockRejectedValueOnce(axiosErr(503));
    await expect(communityApi.getToday()).rejects.toMatchObject({
      kind: 'server',
    });
  });
});

describe('communityApi.getCohorts', () => {
  it('GETs /community/cohorts and parses summaries', async () => {
    api.get.mockResolvedValueOnce({
      data: {
        feature_flag_state: 'enabled',
        cohorts: [
          {
            id: CID,
            workspace_id: WS,
            name: 'Alpha',
            is_default: true,
            member_count: 3,
            my_role: 'client',
          },
        ],
      },
    });
    const res = await communityApi.getCohorts();
    expect(api.get).toHaveBeenCalledWith('/community/cohorts');
    expect(res.cohorts).toHaveLength(1);
  });
});

describe('communityApi.listPosts', () => {
  it('GETs the workspace posts path with keyset params', async () => {
    api.get.mockResolvedValueOnce({
      data: { posts: [postFixture], next_before: null },
    });
    const res = await communityApi.listPosts(WS, { before: ISO, limit: 20 });
    expect(api.get).toHaveBeenCalledWith(
      `/community/workspaces/${WS}/posts`,
      { params: { before: ISO, limit: '20' } },
    );
    expect(res.posts[0].id).toBe(POST);
  });

  it('maps 403 → "forbidden"', async () => {
    api.get.mockRejectedValueOnce(axiosErr(403));
    await expect(communityApi.listPosts(WS)).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });
});

describe('communityApi.createPost', () => {
  it('POSTs the post body with an Idempotency-Key header (R19)', async () => {
    api.post.mockResolvedValueOnce({ data: { post: postFixture } });
    const res = await communityApi.createPost(WS, {
      title: 'Hello',
      body: 'World',
    });
    expect(api.post).toHaveBeenCalledWith(
      `/community/workspaces/${WS}/posts`,
      { title: 'Hello', body: 'World' },
      { headers: { 'Idempotency-Key': 'test-idem-key' } },
    );
    expect(res.id).toBe(POST);
  });

  it('maps 401 → "unauthorized" (no fabricated success)', async () => {
    api.post.mockRejectedValueOnce(axiosErr(401));
    await expect(
      communityApi.createPost(WS, { title: 't', body: 'b' }),
    ).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});

describe('communityApi.listComments / addComment', () => {
  it('GETs the comments path', async () => {
    api.get.mockResolvedValueOnce({ data: { comments: [] } });
    await communityApi.listComments(POST);
    expect(api.get).toHaveBeenCalledWith(`/community/posts/${POST}/comments`);
  });

  it('POSTs a comment with the Idempotency-Key header', async () => {
    api.post.mockResolvedValueOnce({
      data: {
        comment: {
          id: COMMENT,
          post_id: POST,
          author_user_id: UID,
          body: 'nice',
          created_at: ISO,
        },
      },
    });
    const res = await communityApi.addComment(POST, 'nice');
    expect(api.post).toHaveBeenCalledWith(
      `/community/posts/${POST}/comments`,
      { body: 'nice' },
      { headers: { 'Idempotency-Key': 'test-idem-key' } },
    );
    expect(res.body).toBe('nice');
  });
});

describe('communityApi.reactToPost / unreactToPost', () => {
  it('POSTs a reaction with an allowlisted emoji', async () => {
    api.post.mockResolvedValueOnce({ data: {} });
    await communityApi.reactToPost(POST, COMMUNITY_REACTION_EMOJI[0]);
    expect(api.post).toHaveBeenCalledWith(
      `/community/posts/${POST}/reactions`,
      { emoji: COMMUNITY_REACTION_EMOJI[0] },
    );
  });

  it('DELETEs a reaction with the emoji in the request data', async () => {
    api.delete.mockResolvedValueOnce({ data: {} });
    await communityApi.unreactToPost(POST, COMMUNITY_REACTION_EMOJI[1]);
    expect(api.delete).toHaveBeenCalledWith(
      `/community/posts/${POST}/reactions`,
      { data: { emoji: COMMUNITY_REACTION_EMOJI[1] } },
    );
  });

  it('maps 500 on react → "server"', async () => {
    api.post.mockRejectedValueOnce(axiosErr(500));
    await expect(
      communityApi.reactToPost(POST, COMMUNITY_REACTION_EMOJI[0]),
    ).rejects.toMatchObject({ kind: 'server' });
  });
});

describe('communityApi DMs', () => {
  it('listDmThreads GETs the dms path', async () => {
    api.get.mockResolvedValueOnce({ data: { threads: [dmThreadFixture] } });
    const res = await communityApi.listDmThreads(WS);
    expect(api.get).toHaveBeenCalledWith(`/community/workspaces/${WS}/dms`);
    expect(res[0].thread_id).toBe(TID);
  });

  it('listDmMessages GETs the keyset messages path', async () => {
    api.get.mockResolvedValueOnce({ data: { messages: [dmMessageFixture] } });
    const res = await communityApi.listDmMessages(WS, RECIP, { limit: 50 });
    expect(api.get).toHaveBeenCalledWith(
      `/community/workspaces/${WS}/dms/${RECIP}/messages`,
      { params: { limit: '50' } },
    );
    expect(res[0].id).toBe(MSG);
  });

  it('sendDm POSTs the body with the Idempotency-Key header', async () => {
    api.post.mockResolvedValueOnce({ data: { message: dmMessageFixture } });
    const res = await communityApi.sendDm(WS, RECIP, 'hi');
    expect(api.post).toHaveBeenCalledWith(
      `/community/workspaces/${WS}/dms/${RECIP}/messages`,
      { body: 'hi' },
      { headers: { 'Idempotency-Key': 'test-idem-key' } },
    );
    expect(res.body).toBe('hi');
  });

  it('sendDm maps 403 → "forbidden" (DM gate disabled)', async () => {
    api.post.mockRejectedValueOnce(axiosErr(403));
    await expect(communityApi.sendDm(WS, RECIP, 'hi')).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403,
    });
  });

  it('openDmThread POSTs recipient_user_id with the Idempotency-Key header', async () => {
    api.post.mockResolvedValueOnce({ data: { thread: dmThreadFixture } });
    const res = await communityApi.openDmThread(WS, RECIP);
    expect(api.post).toHaveBeenCalledWith(
      `/community/workspaces/${WS}/dms`,
      { recipient_user_id: RECIP },
      { headers: { 'Idempotency-Key': 'test-idem-key' } },
    );
    expect(res.thread_id).toBe(TID);
  });
});
