/**
 * CoachCommunityInboxScreen — v2-4 AI-triage kill-switch FLAG-OFF invariance.
 *
 * The v2-4 triage banner is gated on `featureFlags.communityAiTriage`, which the
 * screen reads ONCE at module scope (`TRIAGE_ENABLED`). This isolated test pins
 * the flag OFF *before* the screen module is imported and proves that with the
 * kill switch off the inbox is the v2-2 / v1-6 surface untouched:
 *
 *   - NO triage card is rendered (`coach-community-inbox-ai-triage` is absent
 *     in both the empty and the populated branches);
 *   - the triage read (`useInboxTriage` → `fetchInboxTriage`) is NEVER called —
 *     the flag-off path must not touch the AI subsystem or the network at all;
 *   - the existing v2-2 inbox row is still rendered (the ack flag is left ON so
 *     the only thing this test removes is the triage card, proving it is the
 *     sole v2-4 addition and the human inbox below is unaffected).
 *
 * This file is intentionally separate from the flag-ON screen tests because the
 * flag is captured at import time: a single module registry cannot hold both
 * the on and off variants of the screen.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

// ── Pin the v2-4 kill-switch OFF (ack flag ON) before the screen is imported ─
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return {
    ...actual,
    featureFlags: {
      ...actual.featureFlags,
      communityAiTriage: false,
      communityAcks: true,
    },
  };
});

// ── Spy the triage read so we can assert it is never reached under flag-off ──
const mockFetchInboxTriage = jest.fn();
const mockUseInboxTriage = jest.fn();

jest.mock('../../../api/communityAiTriageApi', () => {
  const actual = jest.requireActual('../../../api/communityAiTriageApi');
  return {
    ...actual,
    fetchInboxTriage: (...args: unknown[]) => mockFetchInboxTriage(...args),
  };
});

jest.mock('../../../hooks/useInboxTriage', () => ({
  useInboxTriage: (...args: unknown[]) => {
    mockUseInboxTriage(...args);
    return {
      data: undefined,
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
  },
}));

// ── Ack subsystem: flag is ON, so provide working hooks for the v2-2 row ─────
jest.mock('../../../hooks/useCoachCommunity', () => {
  const actual = jest.requireActual('../../../hooks/useCoachCommunity');
  return {
    coachCommunityKeys: actual.coachCommunityKeys,
    useCoachInbox: () => mockInbox,
    useAckInboxItem: () => ({ mutate: jest.fn(), isPending: false }),
    useCoachEmptyStatePayload: () => ({
      status: 'ready',
      payload: {
        text: 'You are all caught up.',
        avatar_crop: 'neutral',
        surface_key: 'coach_community_inbox_empty',
        voice_variant: 'roman_v2',
      },
    }),
    useCoachAckState: () => ({ data: undefined }),
  };
});

jest.mock('../../../hooks/useCoachAckActions', () => ({
  useCoachAckActions: () => ({
    markSeen: { mutate: jest.fn(), isPending: false, error: null },
    markAcked: { mutate: jest.fn(), isPending: false, error: null },
    markReplied: { mutate: jest.fn(), isPending: false, error: null },
  }),
  isIllegalAckTransition: () => false,
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    getQueryData: () => undefined,
    setQueryData: () => undefined,
  }),
}));

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
  mockFetchInboxTriage.mockClear();
  mockUseInboxTriage.mockClear();
  mockInbox = {
    data: { items: [inboxItem()], next_before: null },
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
  };
});

describe('CoachCommunityInboxScreen — AI-triage flag OFF invariance', () => {
  it('renders the inbox with NO triage card (populated branch)', async () => {
    const { queryByTestId } = await render(<CoachCommunityInboxScreen />);

    // The v2-4 triage card and all of its state variants are absent.
    expect(queryByTestId('coach-community-inbox-ai-triage')).toBeNull();
    expect(queryByTestId('coach-community-inbox-ai-triage-loading')).toBeNull();
    expect(queryByTestId('coach-community-inbox-ai-triage-error')).toBeNull();
    expect(queryByTestId('coach-community-inbox-ai-triage-empty')).toBeNull();

    // The existing v2-2 inbox row is still present (human inbox unaffected).
    expect(queryByTestId(`coach-community-inbox-row-${MID}`)).toBeTruthy();
  });

  it('renders NO triage card in the empty branch either', async () => {
    mockInbox = {
      data: { items: [], next_before: null },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { queryByTestId } = await render(<CoachCommunityInboxScreen />);

    expect(queryByTestId('coach-community-inbox-ai-triage')).toBeNull();
    // The v1-6 empty state still renders.
    expect(queryByTestId('coach-community-inbox-empty')).toBeTruthy();
  });

  it('never reads triage (no hook, no network) under the flag-off path', async () => {
    await render(<CoachCommunityInboxScreen />);
    expect(mockUseInboxTriage).not.toHaveBeenCalled();
    expect(mockFetchInboxTriage).not.toHaveBeenCalled();
  });
});
