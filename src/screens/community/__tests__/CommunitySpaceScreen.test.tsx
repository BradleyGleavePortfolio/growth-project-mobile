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
 *   4. A genuine workspace_id=null SUCCESS (no membership) renders the calm
 *      empty/onboarding state, NOT the error state.
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
};
const mockPosts: PostsState = { data: [], isLoading: false, isError: false };
const mockUsePostsSpy = jest.fn();
jest.mock('../../../hooks/useCommunity', () => ({
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
});

describe.each(['hall', 'cohort'] as const)(
  'CommunitySpaceScreen embedded prerequisite (space=%s)',
  (space) => {
    it('a /community/me error renders the retryable error (NOT empty, NOT loading), retry refetches, success renders the feed', () => {
      // The embedded tab threads the real `me` truth. A rejected `/community/me`
      // arrives as workspaceId=null + prerequisiteError=true; the screen must
      // render the SAME calm retryable error the route renders — never an inert
      // empty feed (50-failures #36, swallowed error).
      const onRetryPrerequisite = jest.fn();
      const { rerender } = render(
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
      fireEvent.press(screen.getByTestId('community-space-prereq-retry'));
      expect(onRetryPrerequisite).toHaveBeenCalledTimes(1);

      // After a successful refetch the parent rethreads a resolved id + cleared
      // flags, and the feed renders.
      mockPosts.data = [{ id: 'p-1' }];
      rerender(
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

    it('a still-loading prerequisite renders the loading state, not the empty state, and does not fetch posts', () => {
      render(
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

    it('a genuine workspace_id=null SUCCESS renders the empty/onboarding state, NOT the error state', () => {
      // The prerequisite SUCCEEDED with no membership: not loading, not errored.
      // This must be the calm empty state, never the retryable error.
      render(
        <CommunitySpaceScreen
          embedded
          space={space}
          workspaceId={null}
          prerequisiteLoading={false}
          prerequisiteError={false}
        />,
      );
      expect(screen.getByTestId('community-space-empty')).toBeTruthy();
      expect(screen.queryByTestId('community-space-prereq-error')).toBeNull();
      expect(screen.queryByTestId('community-space-prereq-loading')).toBeNull();
    });
  },
);
