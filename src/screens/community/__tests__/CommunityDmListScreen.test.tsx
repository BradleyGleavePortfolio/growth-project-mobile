/**
 * CommunityDmListScreen — embedded prerequisite-state regression tests (v3-1 R8).
 *
 * The Community tab embeds this surface and threads the `/community/me` truth
 * (loading / error / retry) through props. These tests mirror the Challenges
 * prerequisite tests and pin:
 *
 *   1. A `/community/me` error renders a calm, retryable prerequisite error
 *      (NOT the "no conversations yet" empty inbox, NOT an indefinite loading
 *      state) and never fetches threads.
 *   2. Pressing retry invokes the parent's `onRetryPrerequisite` (me.refetch),
 *      and a subsequent resolved workspace renders the thread list (recovery).
 *   3. A still-loading prerequisite renders the loading state, not the empty
 *      inbox, and never fetches threads.
 *   4. A genuine workspace_id=null SUCCESS (no membership) renders the calm
 *      empty/onboarding inbox, NOT the error state.
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

// ── useDmThreads — the workspace-scoped inbox query (mutable holder) ─────────
type ThreadsState = {
  data: Array<{ thread_id: string; other_user_id: string }> | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: jest.Mock;
};
const mockThreads: ThreadsState = {
  data: [],
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
};
const mockUseDmThreadsSpy = jest.fn();
jest.mock('../../../hooks/useCommunity', () => ({
  useDmThreads: (workspaceId: string | null | undefined) => {
    mockUseDmThreadsSpy(workspaceId);
    return mockThreads;
  },
}));

import CommunityDmListScreen from '../CommunityDmListScreen';

beforeEach(() => {
  mockNavigate.mockReset();
  mockUseDmThreadsSpy.mockReset();
  mockThreads.data = [];
  mockThreads.isLoading = false;
  mockThreads.isError = false;
  mockThreads.refetch.mockReset();
});

describe('CommunityDmListScreen embedded prerequisite', () => {
  it('a /community/me error renders the retryable error (NOT empty, NOT loading), retry refetches, success renders the inbox', () => {
    const onRetryPrerequisite = jest.fn();
    const { rerender } = render(
      <CommunityDmListScreen
        embedded
        workspaceId={null}
        prerequisiteLoading={false}
        prerequisiteError
        onRetryPrerequisite={onRetryPrerequisite}
      />,
    );

    expect(screen.getByTestId('community-dmlist-prereq-error')).toBeTruthy();
    expect(screen.queryByTestId('community-dmlist-prereq-loading')).toBeNull();
    expect(screen.queryByTestId('community-dmlist-empty')).toBeNull();
    expect(mockUseDmThreadsSpy).toHaveBeenCalledWith(null);

    fireEvent.press(screen.getByTestId('community-dmlist-prereq-retry'));
    expect(onRetryPrerequisite).toHaveBeenCalledTimes(1);

    mockThreads.data = [{ thread_id: 't-1', other_user_id: 'coach-1' }];
    rerender(
      <CommunityDmListScreen
        embedded
        workspaceId="ws-resolved"
        prerequisiteLoading={false}
        prerequisiteError={false}
        onRetryPrerequisite={onRetryPrerequisite}
      />,
    );
    expect(screen.getByTestId('dm-row-t-1')).toBeTruthy();
    expect(screen.queryByTestId('community-dmlist-prereq-error')).toBeNull();
  });

  it('a still-loading prerequisite renders the loading state, not the empty inbox, and does not fetch threads', () => {
    render(
      <CommunityDmListScreen
        embedded
        workspaceId={null}
        prerequisiteLoading
        prerequisiteError={false}
      />,
    );
    expect(screen.getByTestId('community-dmlist-prereq-loading')).toBeTruthy();
    expect(screen.queryByTestId('community-dmlist-empty')).toBeNull();
    expect(mockUseDmThreadsSpy).toHaveBeenCalledWith(null);
  });

  it('a DM thread-list query FAILURE renders the retryable threads error (NOT the empty inbox), and retry refetches the inbox', () => {
    // A resolved workspace whose thread query REJECTS must show a calm retryable
    // threads error, never the "no conversations yet" empty inbox — collapsing a
    // load failure into empty silently hides it (R65 #36/#44).
    mockThreads.data = undefined;
    mockThreads.isLoading = false;
    mockThreads.isError = true;
    render(
      <CommunityDmListScreen
        embedded
        workspaceId="ws-resolved"
        prerequisiteLoading={false}
        prerequisiteError={false}
      />,
    );
    expect(screen.getByTestId('community-dmlist-threads-error')).toBeTruthy();
    expect(screen.queryByTestId('community-dmlist-empty')).toBeNull();
    expect(screen.queryByTestId('community-dmlist-prereq-error')).toBeNull();

    // Retry refetches the thread list directly (threads.refetch), not the prereq.
    fireEvent.press(screen.getByTestId('community-dmlist-threads-retry'));
    expect(mockThreads.refetch).toHaveBeenCalledTimes(1);
  });

  it('a genuine workspace_id=null SUCCESS renders the empty/onboarding inbox, NOT the error state', () => {
    render(
      <CommunityDmListScreen
        embedded
        workspaceId={null}
        prerequisiteLoading={false}
        prerequisiteError={false}
      />,
    );
    expect(screen.getByTestId('community-dmlist-empty')).toBeTruthy();
    expect(screen.queryByTestId('community-dmlist-prereq-error')).toBeNull();
    expect(screen.queryByTestId('community-dmlist-prereq-loading')).toBeNull();
  });
});
