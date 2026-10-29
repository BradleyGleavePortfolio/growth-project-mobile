/**
 * CoachCommunityInboxScreen — v2-2 kill-switch FLAG-OFF invariance (Code F4).
 *
 * The v2-2 ack surface is gated on `featureFlags.communityAcks`, which the
 * screen reads ONCE at module scope (`ACKS_ENABLED`). This isolated test pins
 * the flag OFF *before* the screen module is imported and proves the inbox is
 * byte-for-byte the v1-6 surface when the flag is off:
 *
 *   - NO ack badge is rendered for any row (`coach-community-inbox-ack-badge-*`
 *     is absent);
 *   - NO v2-2 "Acknowledge" quick-action is rendered
 *     (`coach-community-inbox-mark-acked-*` is absent);
 *   - there is no dismissal button either (`coach-community-inbox-ack-*`):
 *     the server has no route for one;
 *   - the ack data/action hooks (`useCoachAckState`, `useCoachAckActions`) are
 *     NEVER called — the flag-off path must not touch the ack subsystem at all.
 *
 * This file is intentionally separate from `coachCommunityScreens.test.tsx`
 * (which pins the flag ON) because the flag is captured at import time: a single
 * module registry cannot hold both the on and off variants of the screen.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

// ── Pin the kill-switch OFF before the screen is imported ────────────────────
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return {
    ...actual,
    featureFlags: { ...actual.featureFlags, communityAcks: false },
  };
});

// ── Spy hooks for the ack subsystem so we can assert they are never called ───
const mockUseCoachAckState = jest.fn();
const mockUseCoachAckActions = jest.fn();

jest.mock('../../../hooks/useCoachCommunity', () => {
  const actual = jest.requireActual('../../../hooks/useCoachCommunity');
  return {
    coachCommunityKeys: actual.coachCommunityKeys,
    useCoachInbox: () => mockInbox,
    useCoachEmptyStatePayload: () => ({
      status: 'ready',
      payload: {
        text: 'You are all caught up.',
        avatar_crop: 'neutral',
        surface_key: 'coach_community_inbox_empty',
        voice_variant: 'roman_v2',
      },
    }),
    // The screen still imports these symbols; route them through the spies so
    // any accidental call under the flag-off path is caught.
    useCoachAckState: (...args: unknown[]) => mockUseCoachAckState(...args),
  };
});

jest.mock('../../../hooks/useCoachAckActions', () => ({
  useCoachAckActions: (...args: unknown[]) => {
    mockUseCoachAckActions(...args);
    return {
      markSeen: { mutate: jest.fn(), isPending: false, error: null },
      markAcked: { mutate: jest.fn(), isPending: false, error: null },
      markReplied: { mutate: jest.fn(), isPending: false, error: null },
    };
  },
  isIllegalAckTransition: () => false,
}));

// react-query: the seeding effect is flag-gated, so this inert client should
// never be touched under the flag-off path.
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    getQueryData: () => undefined,
    setQueryData: () => undefined,
  }),
}));

// useTheme → real light tokens (no ThemeProvider), mirroring the repo pattern.
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import CoachCommunityInboxScreen from '../CoachCommunityInboxScreen';

const MID = '11111111-1111-1111-1111-111111111111';

const inboxItem = () => ({
  id: MID,
  cohort_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  cohort_name: 'Spring block',
  client_user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  client_name: 'Dana Cruz',
  avatar_url: null,
  snippet: 'Quick question about my plan',
  created_at: new Date(Date.now() - 3_600_000).toISOString(),
  acknowledged: false,
});

let mockInbox: unknown;

beforeEach(() => {
  mockUseCoachAckState.mockClear();
  mockUseCoachAckActions.mockClear();
  mockInbox = {
    data: { items: [inboxItem()], next_cursor: null },
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
  };
});

describe('CoachCommunityInboxScreen — flag OFF invariance (Code F4)', () => {
  it('renders the v1-6 inbox with NO v2-2 ack surface', async () => {
    const { queryByTestId } = await render(<CoachCommunityInboxScreen />);

    // No v2-2 ack badge and no v2-2 Acknowledge quick-action.
    expect(queryByTestId(`coach-community-inbox-ack-badge-${MID}`)).toBeNull();
    expect(queryByTestId(`coach-community-inbox-mark-acked-${MID}`)).toBeNull();

    // No dismissal button: the server has no route for one.
    expect(queryByTestId(`coach-community-inbox-ack-${MID}`)).toBeNull();
  });

  it('never calls the ack data/action hooks under the flag-off path', async () => {
    await render(<CoachCommunityInboxScreen />);
    expect(mockUseCoachAckState).not.toHaveBeenCalled();
    expect(mockUseCoachAckActions).not.toHaveBeenCalled();
  });

  it('the row accessibility label is the plain v1-6 base (no ack/SLA routine)', async () => {
    const { getByTestId } = await render(<CoachCommunityInboxScreen />);
    const row = getByTestId(`coach-community-inbox-row-${MID}`);
    // FIN-868R5 C3: the base also says when the message came.
    expect(row.props.accessibilityLabel).toMatch(
      /^Dana Cruz in Spring block, .+: Quick question about my plan$/,
    );
  });
});
