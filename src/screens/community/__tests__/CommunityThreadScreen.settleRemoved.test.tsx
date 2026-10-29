import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// All HTTP responses below are supplied by transport mocks. Do not initialize
// the unused authenticated transport and its global persistence lifecycle.
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true }),
  useRoute: () => ({ params: { postId: '33333333-3333-3333-3333-333333333333' } }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    id: '22222222-2222-2222-2222-222222222222',
    coach_id: '99999999-9999-9999-9999-999999999999',
  }),
}));
jest.mock('../../../components/community/SafetyMenu', () => {
  const { Text } = require('react-native');
  return ({ testID }: { testID?: string }) => <Text testID={testID}>Menu</Text>;
});
const mockGetPost = jest.fn();
const mockListComments = jest.fn();
jest.mock('../../../api/communityRemovedRows', () => ({
  ...jest.requireActual('../../../api/communityRemovedRows'),
  removedRowsApi: {
    getPost: (...args: unknown[]) => mockGetPost(...args),
    listComments: (...args: unknown[]) => mockListComments(...args),
  },
}));
jest.mock('../../../api/communityApi', () => {
  const actual = jest.requireActual('../../../api/communityApi');
  return {
    ...actual,
    communityApi: {
      ...actual.communityApi,
      getMe: jest.fn().mockResolvedValue({
        workspace_id: '11111111-1111-1111-1111-111111111111',
        unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
      }),
    },
  };
});

import CommunityThreadScreen from '../CommunityThreadScreen';
import { communityKeys, settleRemovedPost } from '../../../hooks/useCommunity';
import { communitySearchKeys } from '../../../hooks/useCommunitySearch';
import type { RemovablePost } from '../../../api/communityRemovedRows';

// FR-RBM3 (class-first for LS-RBM3 B1): one read that shows a post as removed by a coach settles
// every other copy of it on the phone, even when that copy's own re-read failed.
const WS = '11111111-1111-1111-1111-111111111111';
const POST = '33333333-3333-3333-3333-333333333333';
const KEPT = '66666666-6666-6666-6666-666666666666';
const OTHER = '44444444-4444-4444-4444-444444444444';
const ISO = '2026-10-28T15:00:00.000Z';
const livePost = {
  id: POST, workspace_id: WS, cohort_id: null, author_user_id: OTHER, author_name: 'Sam',
  title: 'Training', body: 'Live post', scope: 'hall', type: 'text',
  pinned: false, created_at: ISO, updated_at: ISO, deleted: false,
} as unknown as RemovablePost;
const keptPost = { ...livePost, id: KEPT, title: 'Kept', body: 'Kept words' } as RemovablePost;
const removedPost = {
  ...livePost, title: null, body: null, deleted: true, reactions: [], removed_at: ISO,
  removed_by: { role: 'coach', user_id: '99999999-9999-9999-9999-999999999999', name: 'Maya' },
} as unknown as RemovablePost;
const hit = (id: string, targetId: string, kind = 'post') => ({
  id, kind, targetId, cohortId: null, authorId: OTHER, excerpt: `words of ${targetId}`, createdAt: ISO,
});
const searchPage = (results: ReturnType<typeof hit>[]) => ({
  version: 1, query: 'train', results, nextCursor: null, tookMs: 3,
});
const allKey = communitySearchKeys.query(WS, 'train');
const eventKey = communitySearchKeys.query(WS, 'train', 'event');

function seeded(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  qc.setQueryData(communityKeys.posts(WS), [keptPost, livePost]);
  qc.setQueryData(communityKeys.post(POST), livePost);
  qc.setQueryData(communityKeys.today(), { pinned_post: { id: POST, title: 'Training', author_user_id: OTHER } });
  qc.setQueryData(allKey, {
    pages: [searchPage([hit('r1', POST), hit('r2', KEPT)]), searchPage([hit('r3', POST, 'event')])],
    pageParams: [undefined, 'c1'],
  });
  qc.setQueryData(eventKey, { pages: [searchPage([hit('r4', POST, 'event')])], pageParams: [undefined] });
  return qc;
}

describe('settleRemovedPost', () => {
  it('turns every cached copy of the removed post into its placeholder and drops it from Today and Find', () => {
    const qc = seeded();
    settleRemovedPost(qc, removedPost);
    expect(qc.getQueryData(communityKeys.posts(WS))).toEqual([keptPost, removedPost]);
    expect(qc.getQueryData(communityKeys.post(POST))).toEqual(removedPost);
    expect(qc.getQueryData<{ pinned_post: unknown }>(communityKeys.today())?.pinned_post).toBeNull();
    const found = qc.getQueryData<{ pages: { results: { id: string }[] }[] }>(allKey);
    expect(found?.pages.map((p) => p.results.map((r) => r.id))).toEqual([['r2'], ['r3']]);
    // An event-only search cannot hold the post; an event hit with the same target id stays.
    expect(qc.getQueryData<{ pages: { results: { id: string }[] }[] }>(eventKey)?.pages[0].results.map((r) => r.id)).toEqual(['r4']);
    qc.clear();
  });

  it('leaves the caches untouched for a live post or a different pinned post', () => {
    const qc = seeded();
    const before = {
      list: qc.getQueryData(communityKeys.posts(WS)),
      today: qc.getQueryData(communityKeys.today()),
      search: qc.getQueryData(allKey),
    };
    settleRemovedPost(qc, livePost);
    settleRemovedPost(qc, { ...removedPost, id: '77777777-7777-7777-7777-777777777777' });
    expect(qc.getQueryData(communityKeys.posts(WS))).toBe(before.list);
    expect(qc.getQueryData(communityKeys.today())).toBe(before.today);
    expect(qc.getQueryData(allKey)).toBe(before.search);
    expect(qc.getQueryData(communityKeys.post(POST))).toEqual(livePost);
    qc.clear();
  });

  it('does not create caches that were never read', () => {
    const qc = new QueryClient();
    settleRemovedPost(qc, removedPost);
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    qc.clear();
  });
});

it('the post page read settles the list, Today and Find even when their own re-reads fail', async () => {
  const qc = seeded();
  mockGetPost.mockReset().mockResolvedValue(removedPost);
  mockListComments.mockReset().mockRejectedValue(new Error('Network request failed'));
  const view = await render(
    <QueryClientProvider client={qc}><CommunityThreadScreen /></QueryClientProvider>,
  );
  try {
    await waitFor(() => expect(view.getByTestId('community-thread-post-removed')).toBeTruthy());
    await act(async () => {});
    expect(qc.getQueryData(communityKeys.posts(WS))).toEqual([keptPost, removedPost]);
    expect(qc.getQueryData<{ pinned_post: unknown }>(communityKeys.today())?.pinned_post).toBeNull();
    expect(view.queryByText('Replies did not load. Check your connection, then try again.')).toBeNull();
  } finally {
    await view.unmount();
    qc.clear();
  }
});
