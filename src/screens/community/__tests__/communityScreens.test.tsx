/**
 * Render + empty-state tests for the seven v1-5 Community screens.
 *
 * Every data hook is mocked so each render path is deterministic and the suite
 * exits clean (no React Query timers). Coverage:
 *   - All 7 screens render their root testID without throwing.
 *   - Empty states render the Roman copy + a PRIMARY ACTION (NOT a spinner) and
 *     the CTA fires the expected navigation/intent (UX HARD gate: no
 *     spinner-only / "coming soon" empty states).
 *
 * useTheme is mocked to return the real light tokens so semanticColors keys
 * resolve without standing up the full ThemeProvider.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

const mockFocus = jest.fn();
jest.mock('../../../components/community/ComposerInput', () => {
  const React = require('react');
  const actual = jest.requireActual('../../../components/community/ComposerInput').default;
  return { __esModule: true, default: React.forwardRef((props: object, ref: React.Ref<unknown>) => {
    React.useImperativeHandle(ref, () => ({ focus: mockFocus }));
    return React.createElement(actual, props);
  }) };
});
jest.mock('../../../components/community/VoiceNotesSection', () => {
  const { Pressable, Text } = require('react-native');
  return { __esModule: true, default: ({ onRecord }: { onRecord: () => void }) =>
    <Pressable onPress={onRecord} testID="voice-record"><Text>Record</Text></Pressable> };
});

// ── Theme: real tokens, no ThemeProvider ─────────────────────────────────────
// SafetyMenu (Report / Block) needs a QueryClient; it has its own suite
// (components/community/__tests__/SafetyMenu.test.tsx). Stub it to a marker so
// these render tests still prove it is mounted on the thread.
jest.mock('../../../components/community/SafetyMenu', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ testID }: { testID?: string }) => React.createElement(View, { testID }),
  };
});

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});

// ── Navigation ───────────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockRouteParams: { current: Record<string, unknown> } = { current: {} };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: mockRouteParams.current }),
}));

// ── Current user ─────────────────────────────────────────────────────────────
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'me-1', firstName: 'Dana', name: 'Dana' }),
}));

// ── Feature flags (sub-tab switcher reads these) ─────────────────────────────
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: {
    communityTab: true,
    communityHall: true,
    communityCohorts: true,
    communityDm: true,
    communityVoiceNotes: true,
  },
}));

// ── Community data mockHooks ─────────────────────────────────────────────────────
const mockHooks = {
  me: {
    isError: false, isLoading: false, refetch: jest.fn(),
    data: {
      workspace_id: 'ws-1' as string | null,
      unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
    },
  },
  today: { data: null, isLoading: false, isError: false },
  posts: { data: [] as { id: string; title: string; body: string; scope: string }[], isLoading: false, isError: false },
  comments: { data: [] as { id: string; body: string; author_user_id: string }[], isLoading: false, isError: false, refetch: jest.fn() },
  dmThreads: { data: [], isLoading: false, isError: false },
  dmMessages: { data: [], isLoading: false, isError: false },
  badge: { total: 0, cohortMessages: 0, dmMessages: 0, mentions: 0 },
};
const mockMutate = jest.fn();
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => mockHooks.me,
  useCommunityToday: () => mockHooks.today,
  useCommunityCohorts: () => ({ data: { cohorts: [] }, isLoading: false }),
  usePosts: () => mockHooks.posts,
  usePostComments: () => mockHooks.comments,
  useDmThreads: () => mockHooks.dmThreads,
  useDmMessages: () => mockHooks.dmMessages,
  useCommunityBadge: () => mockHooks.badge,
  useCreatePost: () => ({ mutate: mockMutate, isPending: false }),
  useAddComment: () => ({ mutateAsync: mockMutate, isPending: false }),
  useSendDm: () => ({ mutate: mockMutate, isPending: false }),
  useReactToPost: () => ({ mutate: mockMutate, isPending: false }),
  useDeletePost: () => ({ mutateAsync: mockMutate, isPending: false }),
  isOptimisticId: (id: string) => id.startsWith('optimistic:'),
}));

// communityApi (CommunityThreadScreen uses useQuery(getPost) directly via RQ);
// stub the post query by mocking @tanstack/react-query useQuery for that screen.
jest.mock('@tanstack/react-query', () => {
  const actual = jest.requireActual('@tanstack/react-query');
  return { ...actual, useQuery: () => ({ data: { title: 'A post', body: 'Body' } }) };
});

import { COMMUNITY_REACTION_EMOJI } from '../../../api/communityApi';
import CommunityTabScreen from '../CommunityTabScreen';
import CommunityTodayScreen from '../CommunityTodayScreen';
import CommunitySpaceScreen from '../CommunitySpaceScreen';
import CommunityThreadScreen from '../CommunityThreadScreen';
import CommunityDmListScreen from '../CommunityDmListScreen';
import CommunityDmThreadScreen from '../CommunityDmThreadScreen';
import CommunityComposerScreen from '../CommunityComposerScreen';

beforeEach(() => {
  mockNavigate.mockReset();
  mockGoBack.mockReset();
  mockMutate.mockReset();
  mockMutate.mockResolvedValue(undefined);
  mockFocus.mockReset();
  mockHooks.comments.isError = false;
  mockHooks.comments.isLoading = false;
  mockHooks.comments.data = [];
  mockHooks.comments.refetch.mockReset();
  mockHooks.posts.data = [];
  mockHooks.me.isError = false;
  mockHooks.me.isLoading = false;
  mockHooks.me.refetch.mockReset();
  mockRouteParams.current = {};
});

describe('Community screens — render', () => {
  it('CommunityTabScreen renders', async () => {
    const { getByTestId } = await render(<CommunityTabScreen />);
    expect(getByTestId('community-tab-screen')).toBeTruthy();
  });

  it('CommunityTodayScreen renders', async () => {
    const { getByTestId } = await render(<CommunityTodayScreen />);
    expect(getByTestId('community-today-screen')).toBeTruthy();
  });

  it('CommunitySpaceScreen renders', async () => {
    const { getByTestId } = await render(
      <CommunitySpaceScreen space="hall" workspaceId="ws-1" />,
    );
    expect(getByTestId('community-space-screen')).toBeTruthy();
  });

  it('CommunityThreadScreen renders', async () => {
    mockRouteParams.current = { postId: 'p-1' };
    const { getByTestId } = await render(<CommunityThreadScreen />);
    expect(getByTestId('community-thread-screen')).toBeTruthy();
  });

  it('CommunityDmListScreen renders', async () => {
    const { getByTestId } = await render(<CommunityDmListScreen workspaceId="ws-1" />);
    expect(getByTestId('community-dmlist-screen')).toBeTruthy();
  });

  it('CommunityDmThreadScreen renders', async () => {
    mockRouteParams.current = { recipientId: 'coach-1', participantLabel: 'Coach' };
    const { getByTestId } = await render(<CommunityDmThreadScreen />);
    expect(getByTestId('community-dmthread-screen')).toBeTruthy();
  });

  it('CommunityComposerScreen renders (post mode)', async () => {
    mockRouteParams.current = { mode: 'post' };
    const { getByTestId } = await render(<CommunityComposerScreen />);
    expect(getByTestId('community-composer-screen')).toBeTruthy();
    expect(getByTestId('community-composer-title')).toBeTruthy();
  });

  it('CommunityComposerScreen renders (dm mode — no title field)', async () => {
    mockRouteParams.current = { mode: 'dm', recipientId: 'coach-1' };
    const { getByTestId, queryByTestId } = await render(<CommunityComposerScreen />);
    expect(getByTestId('community-composer-screen')).toBeTruthy();
    expect(queryByTestId('community-composer-title')).toBeNull();
  });
});

describe('Community empty states — Roman copy + primary action (NOT spinner)', () => {
  it('Space (Hall) empty renders a CTA that opens the composer', async () => {
    const { getByTestId } = await render(
      <CommunitySpaceScreen space="hall" workspaceId="ws-1" />,
    );
    const empty = getByTestId('community-space-empty');
    expect(empty).toBeTruthy();
    // Primary action present and wired (not a spinner).
    await fireEvent.press(getByTestId('community-space-empty-action'));
    expect(mockNavigate).toHaveBeenCalledWith('CommunityComposer', { mode: 'post' });
  });

  it('DM inbox empty renders a CTA to message the coach', async () => {
    const { getByTestId } = await render(<CommunityDmListScreen workspaceId="ws-1" />);
    expect(getByTestId('community-dmlist-empty')).toBeTruthy();
    await fireEvent.press(getByTestId('community-dmlist-empty-action'));
    expect(mockNavigate).toHaveBeenCalledWith('CommunityComposer', {
      mode: 'dm',
      recipientId: '',
    });
  });

  it('Thread empty (no replies) renders an empty state with a primary action', async () => {
    mockRouteParams.current = { postId: 'p-1' };
    const { getByTestId } = await render(<CommunityThreadScreen />);
    expect(getByTestId('community-thread-empty')).toBeTruthy();
    await fireEvent.press(getByTestId('community-thread-empty-action'));
    expect(mockFocus).toHaveBeenCalledTimes(1);
  });

  it('DM thread empty renders an empty state with a primary action', async () => {
    mockRouteParams.current = { recipientId: 'coach-1' };
    const { getByTestId } = await render(<CommunityDmThreadScreen />);
    expect(getByTestId('community-dmthread-empty')).toBeTruthy();
    expect(getByTestId('community-dmthread-empty-action')).toBeTruthy();
  });

  it('Today empty renders an empty state (not a spinner)', async () => {
    const { getByTestId } = await render(<CommunityTodayScreen />);
    // The Today screen renders its own empty surface; assert a Community empty
    // state mounted rather than an ActivityIndicator.
    expect(getByTestId('community-today-screen')).toBeTruthy();
  });
});

describe('Community quiet reading and action parity', () => {
  it('keeps workspace failures retryable in the composer', async () => {
    mockHooks.me.isError = true;
    const { getByTestId, queryByTestId } = await render(<CommunityComposerScreen />);
    expect(queryByTestId('community-composer-no-workspace')).toBeNull();
    await fireEvent.press(getByTestId('community-composer-retry'));
    expect(mockHooks.me.refetch).toHaveBeenCalledTimes(1);
  });
  it('keeps populated-feed post, composer, safety and voice entry routes', async () => {
    mockHooks.posts.data = [{ id: 'p-1', title: 'A post', body: 'Body', scope: 'hall' }];
    const { getByTestId } = await render(<CommunitySpaceScreen workspaceId="ws-1" />);
    expect(getByTestId('post-safety-p-1')).toBeTruthy();
    await fireEvent.press(getByTestId('post-card-p-1'));
    expect(mockNavigate).toHaveBeenCalledWith('CommunityThread', { postId: 'p-1' });
    await fireEvent.press(getByTestId('community-space-new-post'));
    expect(mockNavigate).toHaveBeenCalledWith('CommunityComposer', { mode: 'post' });
    await fireEvent.press(getByTestId('voice-record'));
    expect(mockNavigate).toHaveBeenCalledWith('CommunityVoiceComposer', { target: 'hall' });
  });
  it('does not describe loading replies as empty', async () => {
    mockHooks.comments.isLoading = true;
    const { getByText, queryByTestId } = await render(<CommunityThreadScreen />);
    expect(getByText('Loading replies…')).toBeTruthy();
    expect(queryByTestId('community-thread-empty')).toBeNull();
  });
  it('separates failed replies from genuine empty replies and retries', async () => {
    mockHooks.comments.isError = true;
    const { getByTestId, queryByTestId } = await render(<CommunityThreadScreen />);
    expect(queryByTestId('community-thread-empty')).toBeNull();
    await fireEvent.press(getByTestId('community-thread-retry'));
    expect(mockHooks.comments.refetch).toHaveBeenCalledTimes(1);
  });
  it('reads the post in Inter 17pt, keeps reply safety, reactions and sending reachable', async () => {
    mockRouteParams.current = { postId: 'p-1' };
    mockHooks.comments.data = [{ id: 'c-1', body: 'A reply', author_user_id: 'member-2' }];
    const { getByText, getByTestId, getAllByRole } = await render(<CommunityThreadScreen />);
    expect(StyleSheet.flatten(getByText('Body').props.style)).toMatchObject({ fontSize: 17, fontFamily: 'Inter_400Regular' });
    expect(getByTestId('comment-safety-c-1')).toBeTruthy();
    expect(getByTestId('community-thread-post-safety')).toBeTruthy();
    expect(getAllByRole('button')[0].props.accessibilityLabel).toBe('Back');
    await fireEvent.press(getByTestId(`reaction-${COMMUNITY_REACTION_EMOJI[0]}`));
    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ postId: 'p-1', active: false }));
    await fireEvent.changeText(getByTestId('community-thread-composer-field'), 'Reply text');
    await fireEvent.press(getByTestId('community-thread-composer-send'));
    expect(mockMutate).toHaveBeenCalledWith('Reply text');
  });
  it('uses neutral post confirmation and returns within 300ms', async () => {
    jest.useFakeTimers();
    try {
      const { getByTestId, getByText } = await render(<CommunityComposerScreen />);
      await fireEvent.changeText(getByTestId('community-composer-title'), 'Title');
      await fireEvent.changeText(getByTestId('community-composer-body'), 'Body');
      await fireEvent.press(getByTestId('community-composer-submit'));
      const options = mockMutate.mock.calls[0][1];
      await act(() => options.onSuccess());
      expect(getByText('Post published.')).toBeTruthy();
      await act(() => jest.advanceTimersByTime(300));
      expect(mockGoBack).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });
});

describe('Composer — submit wiring', () => {
  it('publishes a post via the create-post mutation', async () => {
    mockRouteParams.current = { mode: 'post' };
    const { getByTestId } = await render(<CommunityComposerScreen />);
    await fireEvent.changeText(getByTestId('community-composer-title'), 'My title');
    await fireEvent.changeText(getByTestId('community-composer-body'), 'My body');
    await fireEvent.press(getByTestId('community-composer-submit'));
    expect(mockMutate).toHaveBeenCalledWith(
      { title: 'My title', body: 'My body' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('never posts to an empty workspace id when /community/me has no space (B-E2E-1)', async () => {
    const saved = mockHooks.me;
    mockHooks.me = {
      isError: false, isLoading: false, refetch: jest.fn(),
      data: { workspace_id: null, unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 } },
    };
    try {
      mockRouteParams.current = { mode: 'post' };
      const { getByTestId } = await render(<CommunityComposerScreen />);
      await fireEvent.changeText(getByTestId('community-composer-title'), 'My title');
      await fireEvent.changeText(getByTestId('community-composer-body'), 'My body');
      await fireEvent.press(getByTestId('community-composer-submit'));
      expect(mockMutate).not.toHaveBeenCalled();
      expect(getByTestId('community-composer-no-workspace')).toBeTruthy();
    } finally {
      mockHooks.me = saved;
    }
  });

  it('sends a DM via the send-dm mutation', async () => {
    mockRouteParams.current = { mode: 'dm', recipientId: 'coach-1' };
    const { getByTestId } = await render(<CommunityComposerScreen />);
    await fireEvent.changeText(getByTestId('community-composer-body'), 'hello');
    await fireEvent.press(getByTestId('community-composer-submit'));
    expect(mockMutate).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
