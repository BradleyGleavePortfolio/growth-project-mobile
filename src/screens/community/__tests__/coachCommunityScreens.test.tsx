/**
 * Behaviour tests for the six v1-6 Coach Community screens.
 *
 * Every data + mutation hook is mocked so each render path is deterministic and
 * the suite exits clean (no React Query timers). Coverage:
 *   - All 6 screens render their root testID without throwing (flag ON, mocked
 *     API).
 *   - FACE + VOICE contract: every Roman-voiced empty state renders
 *     <RomanAvatar /> (by testID) AND the operator-locked copy string, with the
 *     avatar above the copy (layout assertion).
 *   - Coach creates a cohort -> create mutation fires with the typed name.
 *   - Coach invites a client -> invite mutation fires with the email.
 *   - Coach removes a client -> confirmation modal shown -> DELETE on confirm.
 *   - Inbox aggregates across cohorts -> mixed rows render; ack fires.
 *   - Moderator hides a post -> confirmation modal -> hide mutation fires.
 *
 * useTheme is mocked to return the real light tokens so semanticColors keys
 * resolve without standing up the full ThemeProvider.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COACH_EMPTY_COPY } from '../../../components/community/coach/coachVoice';
import { COACH_LAB_DRAFT_KEY } from '../CoachCommunityLabScreen';

// ── Theme: real tokens, no ThemeProvider ─────────────────────────────────────
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

// ── Navigation ───────────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
const mockRouteParams: { current: Record<string, unknown> } = { current: {} };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: mockRouteParams.current }),
}));

// ── Coach community hooks (data + mutations) ─────────────────────────────────
type QueryStub = {
  data?: unknown;
  isLoading?: boolean;
  isError?: boolean;
  isRefetching?: boolean;
  refetch?: () => void;
};
const mockState: {
  dashboard: QueryStub;
  inbox: QueryStub;
  cohorts: QueryStub;
  cohortDetail: QueryStub;
  flagged: QueryStub;
} = {
  dashboard: { data: undefined, isLoading: false, isError: false },
  inbox: { data: { items: [], next_before: null }, isLoading: false, isError: false },
  cohorts: { data: [], isLoading: false, isError: false },
  cohortDetail: { data: undefined, isLoading: false, isError: false },
  flagged: { data: [], isLoading: false, isError: false },
};
const mockAckMutate = jest.fn();
const mockCreateMutate = jest.fn();
const mockInviteMutate = jest.fn();
const mockRemoveMutate = jest.fn();
const mockHideMutate = jest.fn();
const mockApproveMutate = jest.fn();

jest.mock('../../../hooks/useCoachCommunity', () => ({
  useCoachDashboard: () => mockState.dashboard,
  useCoachInbox: () => mockState.inbox,
  useCoachCohorts: () => mockState.cohorts,
  useCoachCohortDetail: () => mockState.cohortDetail,
  useCoachFlagged: () => mockState.flagged,
  useAckInboxItem: () => ({ mutate: mockAckMutate, isPending: false }),
  useCreateCohort: () => ({ mutate: mockCreateMutate, isPending: false }),
  useInviteMember: () => ({ mutate: mockInviteMutate, isPending: false }),
  useRemoveMember: () => ({ mutate: mockRemoveMutate, isPending: false }),
  useHideFlagged: () => ({ mutate: mockHideMutate, isPending: false }),
  useApproveFlagged: () => ({ mutate: mockApproveMutate, isPending: false }),
}));

import CoachCommunityHomeScreen from '../CoachCommunityHomeScreen';
import CoachCommunityInboxScreen from '../CoachCommunityInboxScreen';
import CoachCommunityLabScreen from '../CoachCommunityLabScreen';
import CoachCommunityCohortsScreen from '../CoachCommunityCohortsScreen';
import CoachCommunityCohortDetailScreen from '../CoachCommunityCohortDetailScreen';
import CoachCommunityModerationScreen from '../CoachCommunityModerationScreen';

const inboxItem = (over: Partial<Record<string, unknown>> = {}) => ({
  id: '11111111-1111-1111-1111-111111111111',
  cohort_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  cohort_name: 'Spring block',
  client_user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  client_name: 'Dana Cruz',
  avatar_url: null,
  snippet: 'Quick question about my plan',
  created_at: new Date(Date.now() - 3_600_000).toISOString(),
  acknowledged: false,
  ...over,
});

const cohort = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  name: 'Spring block',
  member_count: 3,
  unread_count: 1,
  created_at: new Date().toISOString(),
  ...over,
});

const member = (over: Partial<Record<string, unknown>> = {}) => ({
  user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  name: 'Dana Cruz',
  email: 'dana@example.com',
  avatar_url: null,
  role: 'client',
  joined_at: new Date().toISOString(),
  ...over,
});

const flaggedItem = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  target_type: 'post',
  target_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  content: 'Some reported content',
  author_name: 'Sam Lee',
  cohort_name: 'Spring block',
  reason: 'spam',
  created_at: new Date(Date.now() - 7_200_000).toISOString(),
  ...over,
});

beforeEach(() => {
  mockNavigate.mockReset();
  mockRouteParams.current = {};
  mockAckMutate.mockReset();
  mockCreateMutate.mockReset();
  mockInviteMutate.mockReset();
  mockRemoveMutate.mockReset();
  mockHideMutate.mockReset();
  mockApproveMutate.mockReset();
  // Reset to default quiet/empty state per suite.
  mockState.dashboard = { data: undefined, isLoading: false, isError: false };
  mockState.inbox = { data: { items: [], next_before: null }, isLoading: false, isError: false };
  mockState.cohorts = { data: [], isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
  mockState.cohortDetail = { data: undefined, isLoading: false, isError: false };
  mockState.flagged = { data: [], isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
});

describe('Coach Community screens — render with flag ON, mocked API', () => {
  it('Home renders', () => {
    mockState.dashboard = {
      data: { unread_inbox_count: 2, active_cohort_count: 1, flagged_today_count: 0 },
      isLoading: false,
      isError: false,
    };
    const { getByTestId } = render(<CoachCommunityHomeScreen />);
    expect(getByTestId('coach-community-home-screen')).toBeTruthy();
    expect(getByTestId('coach-community-home-inbox-card')).toBeTruthy();
  });

  it('Inbox renders with aggregated rows across cohorts', () => {
    mockState.inbox = {
      data: {
        items: [
          inboxItem(),
          inboxItem({
            id: '22222222-2222-2222-2222-222222222222',
            cohort_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            cohort_name: 'Autumn block',
            client_name: 'Ravi Patel',
          }),
        ],
        next_before: null,
      },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId, getByText } = render(<CoachCommunityInboxScreen />);
    expect(getByTestId('coach-community-inbox-screen')).toBeTruthy();
    // Mixed cohorts present.
    expect(getByText('Spring block')).toBeTruthy();
    expect(getByText('Autumn block')).toBeTruthy();
  });

  it('Lab renders', async () => {
    const { getByTestId, findByTestId } = render(<CoachCommunityLabScreen />);
    // The Lab hydrates its draft from AsyncStorage on mount; await that async
    // state settle so the update lands inside act().
    expect(await findByTestId('coach-community-lab-screen')).toBeTruthy();
    expect(getByTestId('coach-community-lab-input')).toBeTruthy();
  });

  it('Cohorts renders with a row', () => {
    mockState.cohorts = {
      data: [cohort()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId } = render(<CoachCommunityCohortsScreen />);
    expect(getByTestId('coach-community-cohorts-screen')).toBeTruthy();
    expect(
      getByTestId('coach-community-cohort-row-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ).toBeTruthy();
  });

  it('Cohort detail renders with a member', () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', cohortName: 'Spring block' };
    mockState.cohortDetail = {
      data: { cohort: cohort(), members: [member()] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId } = render(<CoachCommunityCohortDetailScreen />);
    expect(getByTestId('coach-community-cohort-detail-screen')).toBeTruthy();
    expect(
      getByTestId('coach-community-member-row-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    ).toBeTruthy();
  });

  it('Moderation renders with a flagged row', () => {
    mockState.flagged = {
      data: [flaggedItem()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId } = render(<CoachCommunityModerationScreen />);
    expect(getByTestId('coach-community-moderation-screen')).toBeTruthy();
    expect(
      getByTestId('coach-community-flagged-row-cccccccc-cccc-cccc-cccc-cccccccccccc'),
    ).toBeTruthy();
  });
});

describe('FACE + VOICE contract — RomanAvatar + locked copy on every empty state', () => {
  it('Home empty: neutral avatar + locked copy, avatar above text', () => {
    mockState.dashboard = {
      data: { unread_inbox_count: 0, active_cohort_count: 0, flagged_today_count: 0 },
      isLoading: false,
      isError: false,
    };
    const { getByTestId, getByText, toJSON } = render(<CoachCommunityHomeScreen />);
    expect(getByTestId('coach-community-home-empty')).toBeTruthy();
    expect(getByTestId('coach-community-home-empty-avatar')).toBeTruthy();
    expect(getByText(COACH_EMPTY_COPY.home.copy)).toBeTruthy();
    // Layout: the avatar renders ABOVE the copy. We assert source order by
    // serialising the rendered tree and confirming the avatar's testID appears
    // before the locked copy string. (Comparing host-node fibers directly is
    // brittle — react-test-renderer's internal Maps throw on identity checks —
    // so we compare positions in the serialised tree instead.)
    const serialised = JSON.stringify(toJSON());
    const avatarIdx = serialised.indexOf('coach-community-home-empty-avatar');
    const copyIdx = serialised.indexOf(COACH_EMPTY_COPY.home.copy);
    expect(avatarIdx).toBeGreaterThan(-1);
    expect(copyIdx).toBeGreaterThan(-1);
    expect(avatarIdx).toBeLessThan(copyIdx);
  });

  it('Inbox empty: neutral avatar + locked copy', () => {
    const { getByTestId, getByText } = render(<CoachCommunityInboxScreen />);
    expect(getByTestId('coach-community-inbox-empty-avatar')).toBeTruthy();
    expect(getByText(COACH_EMPTY_COPY.inbox.copy)).toBeTruthy();
  });

  it('Lab empty: neutral avatar + locked copy', async () => {
    const { getByTestId, getByText, findByTestId } = render(<CoachCommunityLabScreen />);
    // Await AsyncStorage hydration so the post-mount state update is wrapped.
    expect(await findByTestId('coach-community-lab-empty-avatar')).toBeTruthy();
    await waitFor(() => expect(getByText(COACH_EMPTY_COPY.lab.copy)).toBeTruthy());
  });

  it('Cohorts empty: neutral avatar + locked copy', () => {
    const { getByTestId, getByText } = render(<CoachCommunityCohortsScreen />);
    expect(getByTestId('coach-community-cohorts-empty-avatar')).toBeTruthy();
    expect(getByText(COACH_EMPTY_COPY.cohorts.copy)).toBeTruthy();
  });

  it('Cohort detail empty members: neutral avatar + locked copy', () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = {
      data: { cohort: cohort({ member_count: 0 }), members: [] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId, getByText } = render(<CoachCommunityCohortDetailScreen />);
    expect(getByTestId('coach-community-cohort-detail-empty-avatar')).toBeTruthy();
    expect(getByText(COACH_EMPTY_COPY.cohortMembers.copy)).toBeTruthy();
  });

  it('Moderation empty (celebratory): smile avatar + locked copy', () => {
    const { getByTestId, getByText } = render(<CoachCommunityModerationScreen />);
    const avatar = getByTestId('coach-community-moderation-empty-avatar');
    expect(avatar).toBeTruthy();
    // The smile crop announces the celebratory variant to screen readers.
    expect(avatar.props.accessibilityLabel).toBe('Roman, pleased');
    expect(getByText(COACH_EMPTY_COPY.moderation.copy)).toBeTruthy();
  });
});

describe('Coach mutations — create / invite / remove / ack / hide', () => {
  it('creates a cohort with the typed name', () => {
    const { getByTestId } = render(<CoachCommunityCohortsScreen />);
    fireEvent.press(getByTestId('coach-community-cohorts-fab'));
    fireEvent.changeText(
      getByTestId('coach-community-cohorts-name-input'),
      'Winter cut',
    );
    fireEvent.press(getByTestId('coach-community-cohorts-modal-submit'));
    expect(mockCreateMutate).toHaveBeenCalledWith(
      { name: 'Winter cut' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('does not create a cohort with an empty name', () => {
    const { getByTestId } = render(<CoachCommunityCohortsScreen />);
    fireEvent.press(getByTestId('coach-community-cohorts-fab'));
    fireEvent.press(getByTestId('coach-community-cohorts-modal-submit'));
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  it('invites a client by email', () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = {
      data: { cohort: cohort(), members: [member()] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId } = render(<CoachCommunityCohortDetailScreen />);
    fireEvent.press(getByTestId('coach-community-cohort-detail-invite'));
    fireEvent.changeText(
      getByTestId('coach-community-cohort-detail-email-input'),
      'new@example.com',
    );
    fireEvent.press(getByTestId('coach-community-cohort-detail-invite-submit'));
    expect(mockInviteMutate).toHaveBeenCalledWith(
      { email: 'new@example.com' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('does not invite with an invalid email', () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = {
      data: { cohort: cohort(), members: [member()] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId } = render(<CoachCommunityCohortDetailScreen />);
    fireEvent.press(getByTestId('coach-community-cohort-detail-invite'));
    fireEvent.changeText(
      getByTestId('coach-community-cohort-detail-email-input'),
      'not-an-email',
    );
    fireEvent.press(getByTestId('coach-community-cohort-detail-invite-submit'));
    expect(mockInviteMutate).not.toHaveBeenCalled();
  });

  it('removes a client only after confirmation', () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = {
      data: { cohort: cohort(), members: [member()] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId, queryByTestId } = render(<CoachCommunityCohortDetailScreen />);
    // No mutation before the destructive action is even tapped.
    fireEvent.press(
      getByTestId('coach-community-member-remove-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    );
    // Confirmation modal is now shown; mutation has NOT fired yet.
    expect(
      queryByTestId('coach-community-cohort-detail-remove-confirm-confirm'),
    ).toBeTruthy();
    expect(mockRemoveMutate).not.toHaveBeenCalled();
    // Confirm fires the DELETE.
    fireEvent.press(
      getByTestId('coach-community-cohort-detail-remove-confirm-confirm'),
    );
    expect(mockRemoveMutate).toHaveBeenCalledWith(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it('acknowledges an inbox item', () => {
    mockState.inbox = {
      data: { items: [inboxItem()], next_before: null },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId } = render(<CoachCommunityInboxScreen />);
    fireEvent.press(
      getByTestId('coach-community-inbox-ack-11111111-1111-1111-1111-111111111111'),
    );
    expect(mockAckMutate).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
  });

  it('hides a flagged post only after confirmation', () => {
    mockState.flagged = {
      data: [flaggedItem()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId, queryByTestId } = render(<CoachCommunityModerationScreen />);
    fireEvent.press(
      getByTestId('coach-community-flagged-hide-cccccccc-cccc-cccc-cccc-cccccccccccc'),
    );
    expect(
      queryByTestId('coach-community-moderation-hide-confirm-confirm'),
    ).toBeTruthy();
    expect(mockHideMutate).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('coach-community-moderation-hide-confirm-confirm'));
    expect(mockHideMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', target_type: 'post' }),
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it('cancelling the hide confirmation fires no mutation', () => {
    mockState.flagged = {
      data: [flaggedItem()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId } = render(<CoachCommunityModerationScreen />);
    fireEvent.press(
      getByTestId('coach-community-flagged-hide-cccccccc-cccc-cccc-cccc-cccccccccccc'),
    );
    fireEvent.press(getByTestId('coach-community-moderation-hide-confirm-cancel'));
    expect(mockHideMutate).not.toHaveBeenCalled();
  });

  it('approves a flagged post only after confirmation', () => {
    mockState.flagged = {
      data: [flaggedItem()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId, queryByTestId } = render(<CoachCommunityModerationScreen />);
    fireEvent.press(
      getByTestId('coach-community-flagged-approve-cccccccc-cccc-cccc-cccc-cccccccccccc'),
    );
    // Confirmation modal shown; no mutation yet.
    expect(
      queryByTestId('coach-community-moderation-approve-confirm-confirm'),
    ).toBeTruthy();
    expect(mockApproveMutate).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('coach-community-moderation-approve-confirm-confirm'));
    expect(mockApproveMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', target_type: 'post' }),
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it('cancelling the remove confirmation fires no DELETE', () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = {
      data: { cohort: cohort(), members: [member()] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId } = render(<CoachCommunityCohortDetailScreen />);
    fireEvent.press(
      getByTestId('coach-community-member-remove-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    );
    fireEvent.press(getByTestId('coach-community-cohort-detail-remove-confirm-cancel'));
    expect(mockRemoveMutate).not.toHaveBeenCalled();
  });
});

describe('Home stat cards route into the matching surfaces', () => {
  beforeEach(() => {
    mockState.dashboard = {
      data: { unread_inbox_count: 4, active_cohort_count: 2, flagged_today_count: 1 },
      isLoading: false,
      isError: false,
    };
  });

  it('inbox card -> Inbox', () => {
    const { getByTestId } = render(<CoachCommunityHomeScreen />);
    fireEvent.press(getByTestId('coach-community-home-inbox-card'));
    expect(mockNavigate).toHaveBeenCalledWith('CoachCommunityInbox');
  });

  it('cohorts card -> Cohorts', () => {
    const { getByTestId } = render(<CoachCommunityHomeScreen />);
    fireEvent.press(getByTestId('coach-community-home-cohorts-card'));
    expect(mockNavigate).toHaveBeenCalledWith('CoachCommunityCohorts');
  });

  it('moderation card -> Moderation', () => {
    const { getByTestId } = render(<CoachCommunityHomeScreen />);
    fireEvent.press(getByTestId('coach-community-home-moderation-card'));
    expect(mockNavigate).toHaveBeenCalledWith('CoachCommunityModeration');
  });
});

describe('List states + interactions — loading, refresh, navigation, long-press', () => {
  it('Inbox shows a loading indicator while fetching', () => {
    mockState.inbox = { data: undefined, isLoading: true, isError: false };
    const { getByTestId } = render(<CoachCommunityInboxScreen />);
    expect(getByTestId('coach-community-inbox-loading')).toBeTruthy();
  });

  it('Inbox renders its empty state on a fetch error (never a bare error)', () => {
    mockState.inbox = { data: undefined, isLoading: false, isError: true };
    const { getByTestId, getByText } = render(<CoachCommunityInboxScreen />);
    expect(getByTestId('coach-community-inbox-empty-avatar')).toBeTruthy();
    expect(getByText(COACH_EMPTY_COPY.inbox.copy)).toBeTruthy();
  });

  it('Inbox long-press marks every item in the same cohort thread as read', () => {
    mockState.inbox = {
      data: {
        items: [
          inboxItem({ id: '11111111-1111-1111-1111-111111111111' }),
          inboxItem({ id: '99999999-9999-9999-9999-999999999999' }),
          inboxItem({
            id: '22222222-2222-2222-2222-222222222222',
            cohort_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            cohort_name: 'Autumn block',
          }),
        ],
        next_before: null,
      },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId } = render(<CoachCommunityInboxScreen />);
    fireEvent(
      getByTestId('coach-community-inbox-row-11111111-1111-1111-1111-111111111111'),
      'longPress',
    );
    // Both Spring-block items acked; the Autumn-block item left untouched.
    expect(mockAckMutate).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
    expect(mockAckMutate).toHaveBeenCalledWith('99999999-9999-9999-9999-999999999999');
    expect(mockAckMutate).not.toHaveBeenCalledWith('22222222-2222-2222-2222-222222222222');
  });

  it('Cohorts shows a loading indicator while fetching', () => {
    mockState.cohorts = { data: undefined, isLoading: true, isError: false };
    const { getByTestId } = render(<CoachCommunityCohortsScreen />);
    expect(getByTestId('coach-community-cohorts-loading')).toBeTruthy();
  });

  it('Cohorts row tap navigates to the cohort detail with its id and name', () => {
    mockState.cohorts = {
      data: [cohort()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId } = render(<CoachCommunityCohortsScreen />);
    fireEvent.press(
      getByTestId('coach-community-cohort-row-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    );
    expect(mockNavigate).toHaveBeenCalledWith('CoachCommunityCohortDetail', {
      cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      cohortName: 'Spring block',
    });
  });

  it('Cohorts cancel closes the create modal without a mutation', () => {
    const { getByTestId, queryByTestId } = render(<CoachCommunityCohortsScreen />);
    fireEvent.press(getByTestId('coach-community-cohorts-fab'));
    expect(getByTestId('coach-community-cohorts-modal')).toBeTruthy();
    fireEvent.press(getByTestId('coach-community-cohorts-modal-cancel'));
    expect(mockCreateMutate).not.toHaveBeenCalled();
    expect(queryByTestId('coach-community-cohorts-name-input')).toBeNull();
  });
});

describe('Lab — local-only AsyncStorage draft persistence', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('hydrates a previously saved draft from AsyncStorage on mount', async () => {
    await AsyncStorage.setItem(COACH_LAB_DRAFT_KEY, 'Half-written thought');
    const { findByTestId, getByText } = render(<CoachCommunityLabScreen />);
    const input = await findByTestId('coach-community-lab-input');
    await waitFor(() => expect(input.props.value).toBe('Half-written thought'));
    // A non-empty draft replaces the empty state with the saved-state line.
    expect(getByText('Draft kept on this device')).toBeTruthy();
  });

  it('debounces an autosave to AsyncStorage as the coach types', async () => {
    jest.useFakeTimers();
    try {
      const { findByTestId, getByTestId } = render(<CoachCommunityLabScreen />);
      // Let the (real-promise) hydration settle before asserting on timers.
      const input = await act(async () => {
        const node = await findByTestId('coach-community-lab-input');
        return node;
      });
      fireEvent.changeText(input, 'New idea for the cohort');
      // Nothing persisted before the debounce window elapses.
      await act(async () => {
        jest.advanceTimersByTime(599);
      });
      expect(await AsyncStorage.getItem(COACH_LAB_DRAFT_KEY)).toBeNull();
      // Crossing the 600ms boundary fires the debounced persist; flushing the
      // pending microtasks lets the AsyncStorage write resolve.
      await act(async () => {
        jest.advanceTimersByTime(1);
        await Promise.resolve();
      });
      expect(await AsyncStorage.getItem(COACH_LAB_DRAFT_KEY)).toBe(
        'New idea for the cohort',
      );
      // The screen is still mounted and stable after the persist.
      expect(getByTestId('coach-community-lab-screen')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('persists immediately on blur without waiting for the debounce', async () => {
    const { findByTestId } = render(<CoachCommunityLabScreen />);
    const input = await findByTestId('coach-community-lab-input');
    fireEvent.changeText(input, 'Blur-saved draft');
    fireEvent(input, 'blur');
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(COACH_LAB_DRAFT_KEY)).toBe('Blur-saved draft'),
    );
  });

  it('clears the draft and the persisted copy on Clear', async () => {
    await AsyncStorage.setItem(COACH_LAB_DRAFT_KEY, 'Something to discard');
    const { findByTestId, getByTestId, getByText } = render(<CoachCommunityLabScreen />);
    const input = await findByTestId('coach-community-lab-input');
    await waitFor(() => expect(input.props.value).toBe('Something to discard'));
    fireEvent.press(getByTestId('coach-community-lab-clear'));
    await waitFor(() => expect(input.props.value).toBe(''));
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(COACH_LAB_DRAFT_KEY)).toBeNull(),
    );
    // Empty again -> the Roman-voiced empty state returns.
    expect(getByText(COACH_EMPTY_COPY.lab.copy)).toBeTruthy();
  });
});
