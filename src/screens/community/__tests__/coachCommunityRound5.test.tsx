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
import {
  CoachCommunityApiError,
  type CoachEmptyStateSurfaceKey,
} from '../../../api/coachCommunityApi';
import { describeCommunityFailure } from '../../../api/communityErrors';

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

describe('Member counts read naturally and the spoken row says what it shows', () => {
  const member = {
    user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    name: 'Dana Cruz',
    email: 'dana@example.com',
    avatar_url: null,
    role: 'client',
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    joined_at: new Date().toISOString(),
  };

  it('a cohort with one member says "1 member", and its label speaks the unread count', async () => {
    mockState.cohorts = idle([cohort({ member_count: 1, unread_count: 2 })]);
    const { getByText, getByTestId } = await render(<CoachCommunityCohortsScreen />);
    expect(getByText('1 member · 2 unread')).toBeTruthy();
    expect(getByTestId(`coach-community-cohort-row-${OWN_SPACE}`).props.accessibilityLabel).toBe(
      'Spring block, 1 member, 2 unread',
    );
  });

  it('a cohort with nothing unread says only how many members', async () => {
    mockState.cohorts = idle([cohort({ member_count: 3, unread_count: 0 })]);
    const { getByText, getByTestId } = await render(<CoachCommunityCohortsScreen />);
    expect(getByText('3 members')).toBeTruthy();
    expect(getByTestId(`coach-community-cohort-row-${OWN_SPACE}`).props.accessibilityLabel).toBe(
      'Spring block, 3 members',
    );
  });

  it('the cohort page header says "1 member"', async () => {
    mockRouteParams.current = { cohortId: OWN_SPACE, cohortName: 'Spring block' };
    mockState.cohortDetail = idle({ cohort: cohort({ member_count: 1 }), members: [member] });
    const { getByText, queryByText } = await render(<CoachCommunityCohortDetailScreen />);
    expect(getByText('1 member')).toBeTruthy();
    expect(queryByText('1 members')).toBeNull();
  });
});

describe('Create takes only a name the server accepts', () => {
  // CreateCohortDto trims, then needs 2 to 120 characters; anything else was
  // refused with a 400 the app explained as "a server problem".
  async function openCreate() {
    mockState.cohorts = idle([cohort()]);
    const screen = await render(<CoachCommunityCohortsScreen />);
    await fireEvent.press(screen.getByTestId('coach-community-cohorts-fab'));
    return screen;
  }

  it('keeps Create off for a one-letter name and sends a two-letter one', async () => {
    const screen = await openCreate();
    const input = screen.getByTestId('coach-community-cohorts-name-input');
    const submit = () => screen.getByTestId('coach-community-cohorts-modal-submit');
    await fireEvent.changeText(input, ' A ');
    expect(submit().props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    await fireEvent.press(submit());
    await fireEvent(input, 'submitEditing');
    expect(mockCreateMutate).not.toHaveBeenCalled();

    await fireEvent.changeText(input, 'AB');
    expect(submit().props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    );
    await fireEvent.press(submit());
    expect(mockCreateMutate).toHaveBeenCalledWith({ name: 'AB' }, expect.any(Object));
  });

  it('stops the name at 120 characters, the server limit', async () => {
    const screen = await openCreate();
    expect(screen.getByTestId('coach-community-cohorts-name-input').props.maxLength).toBe(120);
  });
});

describe('A cohort name already used says so', () => {
  // community-cohort-write.service.ts: a name already used in the coach's
  // workspace (archived cohorts too) is a 409 'community.cohort.name_taken';
  // the app said "This changed while you were looking at it."
  const NAME_TAKEN = 'You already used this name for a cohort. Choose a different name.';
  const refusal = {
    isAxiosError: true,
    response: { status: 409, data: { error: 'conflict', code: 'community.cohort.name_taken' } },
  };

  it('maps community.cohort.name_taken to its own words', () => {
    expect(describeCommunityFailure(refusal, 'moderate').message).toBe(NAME_TAKEN);
  });

  it('the Cohorts screen shows those words when Create is refused', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockCreateMutate.mockImplementation(
      (_vars: unknown, opts?: { onError?: (e: unknown) => void }) =>
        opts?.onError?.(new CoachCommunityApiError('conflict', 409, 'refused', refusal)),
    );
    mockState.cohorts = idle([cohort()]);
    const screen = await render(<CoachCommunityCohortsScreen />);
    await fireEvent.press(screen.getByTestId('coach-community-cohorts-fab'));
    await fireEvent.changeText(screen.getByTestId('coach-community-cohorts-name-input'), 'Spring block');
    await fireEvent.press(screen.getByTestId('coach-community-cohorts-modal-submit'));
    expect(alert).toHaveBeenCalledWith('Action not applied', NAME_TAKEN);
  });
});

describe('Invite takes only an email the server accepts', () => {
  // AssignMemberDto checks IsEmail; a near-miss such as "gmail.c" passed the
  // phone's check and came back as "a server problem".
  async function openInvite() {
    mockRouteParams.current = { cohortId: OWN_SPACE, cohortName: 'Spring block' };
    mockState.cohortDetail = idle({ cohort: cohort(), members: [] });
    const screen = await render(<CoachCommunityCohortDetailScreen />);
    await fireEvent.press(screen.getByTestId('coach-community-cohort-detail-invite'));
    return screen;
  }

  it.each(['dana@gmail.c', 'dana@gmail..com', 'dana.@gmail.com', '.dana@gmail.com', 'dana@gmail.com.'])(
    'keeps Send invite off for %s',
    async (typed) => {
      const screen = await openInvite();
      await fireEvent.changeText(screen.getByTestId('coach-community-cohort-detail-email-input'), typed);
      expect(
        screen.getByTestId('coach-community-cohort-detail-invite-submit').props.accessibilityState,
      ).toEqual(expect.objectContaining({ disabled: true }));
    },
  );

  it('sends a well-formed address', async () => {
    const screen = await openInvite();
    await fireEvent.changeText(
      screen.getByTestId('coach-community-cohort-detail-email-input'),
      ' dana.cruz+spring@mail.example.co.uk ',
    );
    await fireEvent.press(screen.getByTestId('coach-community-cohort-detail-invite-submit'));
    expect(mockInviteMutate).toHaveBeenCalledWith(
      { email: 'dana.cruz+spring@mail.example.co.uk' },
      expect.any(Object),
    );
  });
});

describe('The spoken row says when the message came', () => {
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  it('reads the clock time today, the weekday this week and the date before, in full', async () => {
    const now = Date.now();
    const today = inboxItem({ created_at: new Date(now - 1_000).toISOString() });
    const recent = inboxItem({
      id: '44444444-4444-4444-4444-444444444444',
      created_at: new Date(now - 3 * 86_400_000).toISOString(),
    });
    const older = inboxItem({
      id: '55555555-5555-5555-5555-555555555555',
      created_at: new Date(now - 40 * 86_400_000).toISOString(),
    });
    mockState.inbox = idle({ items: [today, recent, older], next_cursor: null });
    const screen = await render(<CoachCommunityInboxScreen />);
    const label = (id: string): string =>
      screen.getByTestId(`coach-community-inbox-row-${id}`).props.accessibilityLabel;

    expect(label(today.id)).toMatch(
      /^Dana Cruz in Spring block, \d{1,2}:\d{2} (am|pm): Quick question about my plan\.\.\.$/,
    );
    const r = new Date(recent.created_at);
    expect(label(recent.id)).toBe(
      `Dana Cruz in Spring block, ${DAYS[r.getDay()]}: Quick question about my plan...`,
    );
    const o = new Date(older.created_at);
    expect(label(older.id)).toBe(
      `Dana Cruz in Spring block, ${o.getDate()} ${MONTHS[o.getMonth()]}: Quick question about my plan...`,
    );
  });
});
