/**
 * REMOVED-BY-M3 B-TEST: the Hall reads opt in to coach-removed placeholders (backend #1176 CONTRACT 6450153770),
 * read a placeholder post or comment, and still read today's header-less answers unchanged.
 */
import { isCoachRemoved, removedRowsApi } from '../communityRemovedRows';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as { get: jest.Mock };

const WS = '11111111-1111-1111-1111-111111111111';
const PID = '33333333-3333-3333-3333-333333333333';
const UID = '22222222-2222-2222-2222-222222222222';
const ISO = '2026-10-28T15:00:00.000Z';
const HEADERS = { 'X-Client-Removed-Rows': '1' };
const BY = { role: 'coach', user_id: 'coach-1', name: 'Maya' };

const livePost = {
  id: PID, workspace_id: WS, cohort_id: null, author_user_id: UID, author_name: 'Sam', title: 'Leg day',
  body: 'Felt strong', scope: 'hall', type: 'text', pinned: false, created_at: ISO, updated_at: ISO, deleted: false,
  reactions: [],
};
// Contract section 3: normal keys, title/body null, deleted true, pinned false, reactions [], plus the two keys.
const removedPost = { ...livePost, title: null, body: null, deleted: true, removed_at: ISO, removed_by: BY };
const liveComment = { id: UID, post_id: PID, author_user_id: UID, author_name: 'Sam', body: 'Nice', created_at: ISO };
// Contract section 4.
const removedComment = { ...liveComment, body: null, reactions: [], removed_at: ISO, removed_by: BY };

beforeEach(() => api.get.mockReset());

describe('removedRowsApi', () => {
  it('lists the Hall with the opt-in header and keeps a removed post as its placeholder', async () => {
    api.get.mockResolvedValueOnce({ data: { posts: [livePost, removedPost], next_before: null } });
    const page = await removedRowsApi.listPosts(WS);
    expect(api.get).toHaveBeenCalledWith(`/community/workspaces/${WS}/posts`, { headers: HEADERS });
    expect(page.posts).toEqual([livePost, removedPost]);
    expect(page.posts.map(isCoachRemoved)).toEqual([false, true]);
  });

  it('reads a removed post page (200 placeholder) with the header', async () => {
    api.get.mockResolvedValueOnce({ data: { post: removedPost } });
    await expect(removedRowsApi.getPost(PID)).resolves.toEqual(removedPost);
    expect(api.get).toHaveBeenCalledWith(`/community/posts/${PID}`, { headers: HEADERS });
  });

  it('reads replies with the header: a removed reply has body null', async () => {
    api.get.mockResolvedValueOnce({ data: { comments: [liveComment, removedComment] } });
    const comments = await removedRowsApi.listComments(PID);
    expect(api.get).toHaveBeenCalledWith(`/community/posts/${PID}/comments`, { headers: HEADERS });
    expect(comments).toEqual([liveComment, removedComment]);
    expect(comments.map(isCoachRemoved)).toEqual([false, true]);
  });

  it('reads an older server (header ignored, no removed keys) exactly as today', async () => {
    api.get.mockResolvedValueOnce({ data: { posts: [livePost], next_before: null } });
    api.get.mockResolvedValueOnce({ data: { comments: [liveComment] } });
    expect((await removedRowsApi.listPosts(WS)).posts).toEqual([livePost]);
    expect(await removedRowsApi.listComments(PID)).toEqual([liveComment]);
    expect(isCoachRemoved(livePost)).toBe(false);
  });

  it('refuses a removed_by that is not exactly role, user_id and name, as a contract error', async () => {
    const bad = { ...removedComment, removed_by: { ...BY, extra: 'x' } };
    api.get.mockResolvedValueOnce({ data: { comments: [bad] } });
    await expect(removedRowsApi.listComments(PID)).rejects.toMatchObject({ kind: 'contract' });
  });
});
