/**
 * REMOVED-BY-M3 B-TEST (live): a coach's removal of a Hall post, or of a reply under it, reaches readers with no tap.
 * The ping (community.post.updated, backend #1176, ids only) re-reads the post lists, post pages, replies, Today and
 * open Find searches that can hold a post over REST, so the row turns into its placeholder; a closed post search is
 * dropped. Other known events re-read none of them. Only the event name is read.
 */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

jest.mock('../../config/featureFlags', () => ({
  featureFlags: { communityVoiceNotes: true, communitySearch: true },
}));
jest.mock('../useFeatureFlags', () => ({
  useFeatureFlags: () => ({ flags: { community_search: true }, isLoading: false, isError: false }),
}));

const mockPing: { current: ((ping?: unknown) => void) | null } = { current: null };
jest.mock('../../api/communityRealtime', () => ({
  ...jest.requireActual('../../api/communityRealtime'),
  subscribeToCommunityUser: (_userId: string, onPing: (ping?: unknown) => void) => {
    mockPing.current = onPing;
    return () => {
      mockPing.current = null;
    };
  },
}));
const mockGetMe = jest.fn();
jest.mock('../../api/communityApi', () => {
  const actual = jest.requireActual('../../api/communityApi');
  return { ...actual, communityApi: { ...actual.communityApi, getMe: (...a: unknown[]) => mockGetMe(...a) } };
});
const mockListPosts = jest.fn();
const mockGetPost = jest.fn();
const mockListComments = jest.fn();
jest.mock('../../api/communityRemovedRows', () => ({
  ...jest.requireActual('../../api/communityRemovedRows'),
  removedRowsApi: {
    listPosts: (...a: unknown[]) => mockListPosts(...a),
    getPost: (...a: unknown[]) => mockGetPost(...a),
    listComments: (...a: unknown[]) => mockListComments(...a),
  },
}));
const mockSearch = jest.fn();
jest.mock('../../api/communitySearchApi', () => {
  const actual = jest.requireActual('../../api/communitySearchApi');
  return { ...actual, communitySearchApi: { search: (...a: unknown[]) => mockSearch(...a) } };
});
jest.mock('../../analytics/posthog.service', () => ({ track: jest.fn() }));

import { communityKeys, useCommunityBadge, usePostComments, usePosts } from '../useCommunity';
import { communitySearchKeys, useCommunitySearch } from '../useCommunitySearch';
import { removedRowsApi } from '../../api/communityRemovedRows';

const ISO = '2026-10-28T15:00:00.000Z';
const live = {
  id: 'p-1', workspace_id: 'ws-1', cohort_id: null, author_user_id: 'u-alice', title: 'Leg day', body: 'Felt strong',
  scope: 'hall', type: 'text', pinned: false, created_at: ISO, updated_at: ISO, deleted: false,
};
const removed = {
  ...live, title: null, body: null, deleted: true, reactions: [], removed_at: ISO,
  removed_by: { role: 'coach', user_id: 'u-coach', name: 'Maya' },
};
// The ping as backend #1176 sends it (the phone reads only `event`).
const postPing = { event: 'community.post.updated', payload: { id: 'p-1', workspaceId: 'ws-1', updatedAt: ISO } };
const results = { version: 1, query: 'leg', results: [], nextCursor: null, tookMs: 3 };
const kinds = () => mockSearch.mock.calls.map((c) => (c[1] as { kind?: string }).kind ?? 'all');

async function ping(p?: unknown) {
  await act(async () => {
    mockPing.current?.(p);
  });
}

beforeEach(() => {
  mockPing.current = null;
  mockGetMe.mockReset().mockResolvedValue({
    workspace_id: 'ws-1',
    membership: { role: 'client' },
    unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  });
  mockListPosts.mockReset().mockResolvedValue({ posts: [live], next_before: null });
  mockGetPost.mockReset().mockResolvedValue(live);
  mockListComments.mockReset().mockResolvedValue([]);
  mockSearch.mockReset().mockResolvedValue(results);
});

async function renderHall() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const view = await renderHook(
    () => {
      useCommunityBadge('u-me');
      return {
        posts: usePosts('ws-1'),
        post: useQuery({ queryKey: communityKeys.post('p-1'), queryFn: () => removedRowsApi.getPost('p-1') }),
        comments: usePostComments('p-1'),
        searches: [
          useCommunitySearch({ workspaceId: 'ws-1', term: 'leg' }),
          useCommunitySearch({ workspaceId: 'ws-1', term: 'leg', kind: 'post' }),
          useCommunitySearch({ workspaceId: 'ws-1', term: 'leg', kind: 'voice_note_transcript' }),
        ],
      };
    },
    { wrapper },
  );
  const closed = await renderHook(() => useCommunitySearch({ workspaceId: 'ws-1', term: 'squat', kind: 'post' }), {
    wrapper,
  });
  await waitFor(() => expect(view.result.current.posts.isSuccess).toBe(true));
  await waitFor(() => expect(view.result.current.post.isSuccess && view.result.current.comments.isSuccess).toBe(true));
  await waitFor(() => expect(view.result.current.searches.every((q) => q.isSuccess)).toBe(true));
  await waitFor(() => expect(closed.result.current.isSuccess).toBe(true));
  await waitFor(() => expect(mockPing.current).not.toBeNull());
  await closed.unmount();
  return { qc, view };
}

describe('REMOVED-BY-M3: the post.updated ping', () => {
  it('turns the post into its placeholder in the list and its page with no tap, and re-reads the replies', async () => {
    const { view } = await renderHall();
    expect(view.result.current.posts.data?.[0]).toEqual(live);
    mockListPosts.mockResolvedValue({ posts: [removed], next_before: null });
    mockGetPost.mockResolvedValue(removed);
    const repliesBefore = mockListComments.mock.calls.length;
    await ping(postPing);
    await waitFor(() => expect(view.result.current.posts.data?.[0]).toEqual(removed));
    await waitFor(() => expect(view.result.current.post.data).toEqual(removed));
    await waitFor(() => expect(mockListComments.mock.calls.length).toBe(repliesBefore + 1));
  });

  it('re-reads only open searches that can hold a post (all kinds, posts), and drops a closed post search', async () => {
    const { qc } = await renderHall();
    expect(kinds().sort()).toEqual(['all', 'post', 'post', 'voice_note_transcript']);
    const closedKey = communitySearchKeys.query('ws-1', 'squat', 'post');
    expect(qc.getQueryData(closedKey)).toBeDefined();
    await ping(postPing);
    await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(6));
    expect(kinds().slice(4).sort()).toEqual(['all', 'post']);
    expect(qc.getQueryData(closedKey)).toBeUndefined();
  });

  it.each([
    ['a new message', { event: 'community.message.created' }],
    ['a voice removal', { event: 'community.message.updated' }],
    ['a reaction', { event: 'community.reaction.changed' }],
  ])('%s re-reads the badge only, not the posts', async (_label, other) => {
    await renderHall();
    const before = [mockListPosts, mockGetPost, mockListComments].map((m) => m.mock.calls.length);
    const meBefore = mockGetMe.mock.calls.length;
    await ping(other);
    await waitFor(() => expect(mockGetMe.mock.calls.length).toBeGreaterThan(meBefore));
    expect([mockListPosts, mockGetPost, mockListComments].map((m) => m.mock.calls.length)).toEqual(before);
  });
});
