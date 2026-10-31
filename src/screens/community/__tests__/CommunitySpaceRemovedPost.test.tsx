/**
 * REMOVED-BY-M3 B-TEST: the Hall / cohort post list keeps a coach-removed post in its place as one quiet line
 * (backend #1176 CONTRACT 6450153770 sections 3 and 6): no title, words, menu or tap. Live posts and older servers
 * (no removed keys) draw as today. Same stubs as CommunitySpaceScreen.test.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'me-1', firstName: 'Dana', name: 'Dana', coach_id: 'coach-1' }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../../components/community/SafetyMenu', () => {
  const { Text } = require('react-native');
  return ({ testID }: { testID?: string }) => <Text testID={testID} />;
});

const mockPosts: { data: Array<Record<string, unknown>>; isLoading: boolean; isError: boolean; refetch: jest.Mock } = {
  data: [],
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
};
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => ({ data: { workspace_id: 'ws-1' }, isLoading: false, isError: false, refetch: jest.fn() }),
  isOptimisticId: (id: string) => id.startsWith('optimistic:'),
  usePosts: () => ({ ...mockPosts, isSuccess: true, isFetchedAfterMount: true, isStale: false }),
}));

import CommunitySpaceScreen from '../CommunitySpaceScreen';

const ISO = '2026-10-28T15:00:00.000Z';
const live = (id: string, over: Record<string, unknown> = {}) => ({
  id, workspace_id: 'ws-1', cohort_id: null, author_user_id: 'member-1', title: 'Leg day', body: 'Felt strong',
  scope: 'hall', type: 'text', pinned: false, created_at: ISO, updated_at: ISO, deleted: false, ...over,
});
const removed = (id: string, by: string, over: Record<string, unknown> = {}) => live(id, {
  title: null, body: null, deleted: true, reactions: [], removed_at: ISO,
  removed_by: { role: 'coach', user_id: by, name: 'Maya' }, ...over,
});

function renderHall() {
  return render(
    <CommunitySpaceScreen embedded space="hall" workspaceId="ws-1" prerequisiteLoading={false} prerequisiteError={false} />,
  );
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockPosts.data = [];
});

describe('REMOVED-BY-M3: a coach-removed post in the Hall list', () => {
  it('reads Removed by Coach {name} to everyone else, with no title, words, menu or tap; live posts unchanged', async () => {
    mockPosts.data = [live('p-1'), removed('p-2', 'coach-1')];
    await renderHall();
    expect(screen.getByTestId('post-removed-p-2')).toBeTruthy();
    expect(screen.getByText('Removed by Coach Maya')).toBeTruthy();
    expect(screen.queryByTestId('post-card-p-2')).toBeNull();
    expect(screen.queryByTestId('post-safety-p-2')).toBeNull();
    expect(screen.queryByText('Untitled post')).toBeNull();
    expect(screen.getAllByText('Leg day')).toHaveLength(1);
    expect(screen.getByTestId('post-card-p-1')).toBeTruthy();
    expect(screen.getByTestId('post-safety-p-1')).toBeTruthy();
  });

  it('tells the coach who removed it "You removed this post"', async () => {
    mockPosts.data = [removed('p-2', 'me-1')];
    await renderHall();
    expect(screen.getByText('You removed this post')).toBeTruthy();
  });

  it('tells the author "Your coach removed your post", and Community safety opens', async () => {
    mockPosts.data = [removed('p-2', 'coach-1', { author_user_id: 'me-1' })];
    await renderHall();
    expect(screen.getByText('Your coach removed your post')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('post-removed-line-p-2-safety'));
    expect(mockNavigate).toHaveBeenCalledWith('CommunitySafety');
  });

  it('an older server (no removed keys, even a deleted flag) draws the post as today', async () => {
    mockPosts.data = [live('p-3', { deleted: true })];
    await renderHall();
    expect(screen.getByTestId('post-card-p-3')).toBeTruthy();
    expect(screen.queryByTestId('post-removed-p-3')).toBeNull();
  });
});
