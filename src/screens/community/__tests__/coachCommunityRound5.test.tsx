/**
 * FIN-868R5 (fix round 5): what an ordinary coach hits on the coach community
 * Inbox, Cohorts and Cohort detail screens. One describe per finding; each was
 * committed failing before its fix.
 *
 * Every data and mutation hook is mocked so each render path is deterministic
 * (the same pattern as coachCommunityScreens.test.tsx).
 */
import React from 'react';
import * as Native from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { CoachEmptyStateSurfaceKey } from '../../../api/coachCommunityApi';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

jest.mock('react-native-safe-area-context', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }: { children: React.ReactNode; style?: object }) =>
      ReactLocal.createElement(View, { style }, children),
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

const mockNavigate = jest.fn();
const mockRouteParams: { current: Record<string, unknown> } = { current: {} };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: mockRouteParams.current }),
}));

type QueryStub = {
  data?: unknown;
  isLoading?: boolean;
  isError?: boolean;
  isRefetching?: boolean;
  refetch?: () => void;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
};
const idle = (data: unknown): QueryStub => ({
  data,
  isLoading: false,
  isError: false,
  isRefetching: false,
  refetch: jest.fn(),
});
const mockState: { inbox: QueryStub; cohorts: QueryStub; cohortDetail: QueryStub } = {
  inbox: idle({ items: [], next_cursor: null }),
  cohorts: idle([]),
  cohortDetail: idle(undefined),
};
/** The ids of the spaces this coach owns; null = not known yet. */
const mockOwnedIds: { current: ReadonlySet<string> | null } = { current: null };
const mockAckStateByMessage: { current: Record<string, unknown> } = { current: {} };
const mockCreateMutate = jest.fn();
const mockInviteMutate = jest.fn();
const mockMarkAckedMutate = jest.fn();

jest.mock('../../../hooks/useCoachCommunity', () => {
  const actual = jest.requireActual('../../../hooks/useCoachCommunity');
  return {
    coachCommunityKeys: actual.coachCommunityKeys,
    useCoachInbox: () => mockState.inbox,
    useCoachCohorts: () => mockState.cohorts,
    useCoachOwnedCohortIds: () => mockOwnedIds.current,
    useCoachCohortDetail: () => mockState.cohortDetail,
    useCoachAckState: (messageId: string) => mockAckStateByMessage.current[messageId],
    useCoachEmptyStatePayload: (surfaceKey: CoachEmptyStateSurfaceKey) => ({
      status: 'ready',
      payload: {
        text: 'TEST_EMPTY_COPY',
        avatar_crop: 'neutral',
        surface_key: surfaceKey,
        voice_variant: 'roman_v2',
      },
    }),
    useCreateCohort: () => ({ mutate: mockCreateMutate, isPending: false }),
    useInviteMember: () => ({ mutate: mockInviteMutate, isPending: false }),
    useRemoveMember: () => ({ mutate: jest.fn(), isPending: false }),
  };
});

jest.mock('../../../hooks/useCoachAckActions', () => ({
  useCoachAckActions: () => ({
    markSeen: { mutate: jest.fn(), isPending: false, error: null },
    markAcked: { mutate: mockMarkAckedMutate, isPending: false, error: null },
    markReplied: { mutate: jest.fn(), isPending: false, error: null },
  }),
  isIllegalAckTransition: () => false,
}));

jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return {
    ...actual,
    featureFlags: { ...actual.featureFlags, communityAcks: true },
  };
});

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    getQueryData: () => undefined,
    setQueryData: () => undefined,
  }),
}));

import CoachCommunityInboxScreen from '../CoachCommunityInboxScreen';
import CoachCommunityCohortsScreen from '../CoachCommunityCohortsScreen';
import CoachCommunityCohortDetailScreen from '../CoachCommunityCohortDetailScreen';

const OWN_SPACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEAM_SPACE = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const inboxItem = (over: Partial<Record<string, unknown>> = {}) => ({
  id: '11111111-1111-1111-1111-111111111111',
  cohort_id: OWN_SPACE,
  cohort_name: 'Spring block',
  client_user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  client_name: 'Dana Cruz',
  avatar_url: null,
  snippet: 'Quick question about my plan...',
  created_at: new Date(Date.now() - 3_600_000).toISOString(),
  acknowledged: false,
  type: 'message',
  kind: 'text',
  ...over,
});

const cohort = (over: Partial<Record<string, unknown>> = {}) => ({
  id: OWN_SPACE,
  name: 'Spring block',
  member_count: 3,
  unread_count: 1,
  created_at: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockState.inbox = idle({ items: [], next_cursor: null });
  mockState.cohorts = idle([]);
  mockState.cohortDetail = idle(undefined);
  mockOwnedIds.current = null;
  mockAckStateByMessage.current = {};
  mockRouteParams.current = {};
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('LS-6: Acknowledge shows only where this coach can acknowledge', () => {
  // The server lets only the space's owner acknowledge (ack.service.ts:
  // isWorkspaceCoach); a co-coach's tap was refused with "no longer available".
  const own = inboxItem();
  const team = inboxItem({
    id: '22222222-2222-2222-2222-222222222222',
    cohort_id: TEAM_SPACE,
    cohort_name: 'Team space',
    client_name: 'Eli Park',
  });

  beforeEach(() => {
    mockState.inbox = idle({ items: [own, team], next_cursor: null });
  });

  it('offers Acknowledge on a row from a space the coach owns, not on a co-coach row', async () => {
    mockOwnedIds.current = new Set([OWN_SPACE]);
    const { getByTestId, queryByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(getByTestId(`coach-community-inbox-mark-acked-${own.id}`)).toBeTruthy();
    expect(queryByTestId(`coach-community-inbox-mark-acked-${team.id}`)).toBeNull();
    // The co-coach row still shows the message and its ack badge.
    expect(getByTestId(`coach-community-inbox-row-${team.id}`)).toBeTruthy();
    expect(
      getByTestId(`coach-community-inbox-ack-badge-${team.id}`, { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it('keeps Acknowledge on every row while the coach\u2019s spaces are not known yet', async () => {
    mockOwnedIds.current = null;
    const { getByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(getByTestId(`coach-community-inbox-mark-acked-${own.id}`)).toBeTruthy();
    expect(getByTestId(`coach-community-inbox-mark-acked-${team.id}`)).toBeTruthy();
  });

  it('a coach who owns no spaces sees no Acknowledge at all', async () => {
    mockOwnedIds.current = new Set();
    const { queryByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(queryByTestId(`coach-community-inbox-mark-acked-${own.id}`)).toBeNull();
    expect(queryByTestId(`coach-community-inbox-mark-acked-${team.id}`)).toBeNull();
  });
});
