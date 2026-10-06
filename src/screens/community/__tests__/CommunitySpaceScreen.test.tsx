/**
 * CommunitySpaceScreen — embedded prerequisite-state regression tests (v3-1 R8).
 *
 * The Community tab embeds this surface (Hall AND Cohorts) and threads the
 * `/community/me` truth (loading / error / retry) through props. These tests
 * mirror the Challenges prerequisite tests and pin, for BOTH space types:
 *
 *   1. A `/community/me` error renders a calm, retryable prerequisite error
 *      (NOT the empty "the Hall is quiet" / "no cohort posts" state, NOT an
 *      indefinite loading state) and never fetches posts.
 *   2. Pressing retry invokes the parent's `onRetryPrerequisite` (me.refetch),
 *      and a subsequent resolved workspace renders the post feed (recovery).
 *   3. A still-loading prerequisite renders the loading state, not the empty
 *      state, and never fetches posts.
 *   4. A genuine workspace_id=null SUCCESS (no membership) renders the
 *      Today-style "No cohort yet / Send your coach a message" state, NOT the
 *      error state and NOT "Be the first to post" (B-E2E-1: there is no
 *      workspace to post to).
 *   5. Opened as a route (no props) the screen resolves the workspace from
 *      `/community/me` itself (B-E2E-1).
 *
 * The data layer is mocked so each render path is deterministic.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

// ── Theme: real light tokens, no ThemeProvider ───────────────────────────────
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});

// ── Navigation ───────────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// ── Current user ─────────────────────────────────────────────────────────────
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'me-1', firstName: 'Dana', name: 'Dana' }),
}));

// ── Safe-area stub ───────────────────────────────────────────────────────────
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

// ── PostCard → an inert node forwarding testID, so the feed render path is
// observable without standing up the full card (this suite tests the screen's
// prerequisite branching, not PostCard internals). ──────────────────────────
jest.mock('../../../components/community', () => {
  const actual = jest.requireActual('../../../components/community');
  const React = require('react');
  const { Text } = require('react-native');
  return {
    ...actual,
    PostCard: ({ testID }: { testID?: string }) => <Text testID={testID} />,
  };
});

// ── usePosts — the workspace-scoped feed query (mutable holder) ──────────────
type PostsState = {
  data: Array<{ id: string }> | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: jest.Mock;
};
const mockPosts: PostsState = {
  data: [],
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
};
const mockUsePostsSpy = jest.fn();
// `/community/me` for the route (no-props) path (mutable holder).
const mockMe: {
  data: { workspace_id: string | null } | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: jest.Mock;
} = { data: undefined, isLoading: false, isError: false, refetch: jest.fn() };
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => mockMe,
  usePosts: (workspaceId: string | null | undefined) => {
    mockUsePostsSpy(workspaceId);
    return mockPosts;
  },
}));

import CommunitySpaceScreen from '../CommunitySpaceScreen';

beforeEach(() => {
  mockNavigate.mockReset();
  mockUsePostsSpy.mockReset();
  mockPosts.data = [];
  mockPosts.isLoading = false;
  mockPosts.isError = false;
  mockPosts.refetch.mockReset();
  mockMe.data = undefined;
  mockMe.isLoading = false;
  mockMe.isError = false;
  mockMe.refetch.mockReset();
});

describe.each(['hall', 'cohort'] as const)(
  'CommunitySpaceScreen embedded prerequisite (space=%s)',
  (space) => {
    it('a /community/me error renders the retryable error (NOT empty, NOT loading), retry refetches, success renders the feed', async () => {
      // The embedded tab threads the real `me` truth. A rejected `/community/me`
      // arrives as workspaceId=null + prerequisiteError=true; the screen must
      // render the SAME calm retryable error the route renders — never an inert
      // empty feed (50-failures #36, swallowed error).
      const onRetryPrerequisite = jest.fn();
      const { rerender } = await render(
        <CommunitySpaceScreen
          embedded
          space={space}
          workspaceId={null}
          prerequisiteLoading={false}
          prerequisiteError
          onRetryPrerequisite={onRetryPrerequisite}
        />,
      );

      expect(screen.getByTestId('community-space-prereq-error')).toBeTruthy();
      expect(screen.queryByTestId('community-space-prereq-loading')).toBeNull();
      expect(screen.queryByTestId('community-space-empty')).toBeNull();
      // The posts query was disabled (null id) — no feed fetch on a failed prereq.
      expect(mockUsePostsSpy).toHaveBeenCalledWith(null);

      // Retry invokes the parent's me.refetch through onRetryPrerequisite.
      await fireEvent.press(screen.getByTestId('community-space-prereq-retry'));
      expect(onRetryPrerequisite).toHaveBeenCalledTimes(1);

      // After a successful refetch the parent rethreads a resolved id + cleared
      // flags, and the feed renders.
      mockPosts.data = [{ id: 'p-1' }];
      await rerender(
        <CommunitySpaceScreen
          embedded
          space={space}
          workspaceId="ws-resolved"
          prerequisiteLoading={false}
          prerequisiteError={false}
          onRetryPrerequisite={onRetryPrerequisite}
        />,
      );
      expect(screen.getByTestId('post-card-p-1')).toBeTruthy();
      expect(screen.queryByTestId('community-space-prereq-error')).toBeNull();
    });

    it('a still-loading prerequisite renders the loading state, not the empty state, and does not fetch posts', async () => {
      await render(
        <CommunitySpaceScreen
          embedded
          space={space}
          workspaceId={null}
          prerequisiteLoading
          prerequisiteError={false}
        />,
      );
      expect(screen.getByTestId('community-space-prereq-loading')).toBeTruthy();
      expect(screen.queryByTestId('community-space-empty')).toBeNull();
      expect(mockUsePostsSpy).toHaveBeenCalledWith(null);
    });

    it('a post-feed query FAILURE renders the retryable posts error (NOT the empty state), and retry refetches the feed', async () => {
      // A resolved workspace whose post query REJECTS must show a calm retryable
      // posts error, never the "the Hall is quiet" / "no cohort posts" empty
      // state — collapsing a load failure into empty silently hides it
      // (R65 #36/#44).
      mockPosts.data = undefined;
      mockPosts.isLoading = false;
      mockPosts.isError = true;
      await render(
        <CommunitySpaceScreen
          embedded
          space={space}
          workspaceId="ws-resolved"
          prerequisiteLoading={false}
          prerequisiteError={false}
        />,
      );
      expect(screen.getByTestId('community-space-posts-error')).toBeTruthy();
      expect(screen.queryByTestId('community-space-empty')).toBeNull();
      expect(screen.queryByTestId('community-space-prereq-error')).toBeNull();

      // Retry refetches the post feed directly (posts.refetch), not the prereq.
      await fireEvent.press(screen.getByTestId('community-space-posts-retry'));
      expect(mockPosts.refetch).toHaveBeenCalledTimes(1);
    });

    it('a genuine workspace_id=null SUCCESS renders "No cohort yet / Send your coach a message", never the composer CTA (B-E2E-1)', async () => {
      // The prerequisite SUCCEEDED with no community space: not loading, not
      // errored. This is the calm Today-style state, never the retryable error,
      // and never "Be the first to post" (that composer had no workspace and
      // posted to workspaces//posts).
      await render(
        <CommunitySpaceScreen
          embedded
          space={space}
          workspaceId={null}
          prerequisiteLoading={false}
          prerequisiteError={false}
        />,
      );
      expect(screen.getByTestId('community-space-no-workspace')).toBeTruthy();
      expect(screen.getByText('No cohort yet')).toBeTruthy();
      expect(screen.queryByText('Be the first to post')).toBeNull();
      expect(screen.queryByTestId('community-space-empty')).toBeNull();
      expect(screen.queryByTestId('community-space-prereq-error')).toBeNull();
      expect(screen.queryByTestId('community-space-prereq-loading')).toBeNull();

      await fireEvent.press(screen.getByTestId('community-space-no-workspace-action'));
      expect(mockNavigate).toHaveBeenCalledWith('Home', { screen: 'Messages' });
      expect(mockNavigate).not.toHaveBeenCalledWith('CommunityComposer', expect.anything());
    });

    it('opened as a route, it reads the workspace from /community/me (B-E2E-1)', async () => {
      mockMe.data = { workspace_id: 'ws-me' };
      mockPosts.data = [{ id: 'p-route' }];
      const { rerender } = await render(<CommunitySpaceScreen space={space} />);
      expect(mockUsePostsSpy).toHaveBeenCalledWith('ws-me');
      expect(screen.getByTestId('post-card-p-route')).toBeTruthy();

      // `/community/me` succeeded with no space: no composer CTA.
      mockMe.data = { workspace_id: null };
      mockPosts.data = [];
      await rerender(<CommunitySpaceScreen space={space} />);
      expect(screen.getByTestId('community-space-no-workspace')).toBeTruthy();
      expect(screen.queryByText('Be the first to post')).toBeNull();
    });
  },
);
