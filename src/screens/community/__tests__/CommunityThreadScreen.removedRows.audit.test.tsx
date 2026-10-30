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
import { communityKeys, refreshPostQueries } from '../../../hooks/useCommunity';

const POST = '33333333-3333-3333-3333-333333333333';
const OTHER = '44444444-4444-4444-4444-444444444444';
const ISO = '2026-10-28T15:00:00.000Z';
const livePost = {
  id: POST, workspace_id: '11111111-1111-1111-1111-111111111111',
  cohort_id: null, author_user_id: OTHER, author_name: 'Sam',
  title: 'Training', body: 'Live post', scope: 'hall', type: 'text',
  pinned: false, created_at: ISO, updated_at: ISO, deleted: false,
};
const removedPost = {
  ...livePost, title: null, body: null, deleted: true, reactions: [],
  removed_at: ISO,
  removed_by: { role: 'coach', user_id: '99999999-9999-9999-9999-999999999999', name: 'Maya' },
};
const reply = {
  id: '55555555-5555-5555-5555-555555555555', post_id: POST,
  author_user_id: OTHER, author_name: 'Sam', body: 'Cached reply text', created_at: ISO,
};

beforeEach(() => {
  mockGetPost.mockReset().mockResolvedValue(livePost);
  mockListComments.mockReset().mockResolvedValue([reply]);
});

async function renderThread() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  const view = await render(
    <QueryClientProvider client={qc}><CommunityThreadScreen /></QueryClientProvider>,
  );
  return { qc, view };
}

it('B1: a confirmed removed post hides cached replies even when the reply refresh is offline', async () => {
  const { qc, view } = await renderThread();
  try {
    await waitFor(() => expect(view.getByText('Cached reply text')).toBeTruthy());
    expect(qc.getQueryData(communityKeys.comments(POST))).toEqual([reply]);

    mockGetPost.mockResolvedValue(removedPost);
    mockListComments.mockRejectedValue(new Error('Network request failed'));
    await act(async () => { await refreshPostQueries(qc); });
    await waitFor(() => expect(view.getByTestId('community-thread-post-removed')).toBeTruthy());
    expect(qc.getQueryState(communityKeys.comments(POST))?.status).toBe('error');

    expect(view.queryByText('Cached reply text')).toBeNull();
    expect(view.queryByTestId(`comment-safety-${reply.id}`)).toBeNull();
    expect(view.queryByTestId('community-thread-composer-field')).toBeNull();
  } finally {
    await view.unmount();
    qc.clear();
  }
});
