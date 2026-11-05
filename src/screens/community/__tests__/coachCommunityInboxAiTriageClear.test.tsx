/**
 * CoachCommunityInboxScreen — the AI triage card on a clear inbox (FX4-868, agent 178).
 *
 * With the triage switch ON (A1.10: every feature is on for v1), a clear inbox
 * is the dark caught-up page (K2 B_caught_up). The triage card shows there only
 * when the triage has items: its empty, loading and error cards stay off that
 * page. An inbox with rows keeps the card in every state.
 *
 * A file of its own: the screen reads the switch once at import, so the
 * flag-off file (coachCommunityInboxAiTriageFlagOff.test.tsx) cannot hold it.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return {
    ...actual,
    featureFlags: {
      ...actual.featureFlags,
      communityAiTriage: true,
      communityAcks: true,
    },
  };
});

let mockTriage: Record<string, unknown>;
jest.mock('../../../hooks/useInboxTriage', () => ({
  useInboxTriage: () => mockTriage,
}));

let mockInbox: unknown;
jest.mock('../../../hooks/useCoachCommunity', () => {
  const actual = jest.requireActual('../../../hooks/useCoachCommunity');
  return {
    coachCommunityKeys: actual.coachCommunityKeys,
    useCoachInbox: () => mockInbox,
    useCoachOwnedCohortIds: () => null,
    useCoachEmptyStatePayload: () => ({
      status: 'ready',
      payload: {
        text: 'TEST_CLEAR_INBOX_COPY',
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

const TID = 'coach-community-inbox-ai-triage';
const MID = '11111111-1111-4111-8111-111111111111';

const bucket = (category: string, ids: string[]) => ({
  category,
  items: ids.map((id) => ({
    source_item_id: id,
    source_kind: 'message',
    category,
    summary: 'Asks to move a check-in.',
  })),
});

const triageWith = (ids: string[]) => ({
  generated_at: new Date().toISOString(),
  is_empty: ids.length === 0,
  buckets: [
    bucket('urgent', []),
    bucket('win_to_celebrate', []),
    bucket('form_check', []),
    bucket('general', ids),
    bucket('no_action_needed', []),
  ],
  source_item_ids: ids,
});

const triageState = (over: Record<string, unknown>) => ({
  data: undefined,
  isLoading: false,
  isError: false,
  isRefetching: false,
  error: null,
  refetch: jest.fn(),
  ...over,
});

const inboxState = (items: unknown[]) => ({
  data: { items, next_cursor: null },
  isLoading: false,
  isError: false,
  isRefetching: false,
  fetchStatus: 'idle',
  refetch: jest.fn(),
});

const row = () => ({
  id: MID,
  type: 'message',
  kind: 'text',
  cohort_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cohort_name: 'Spring block',
  client_user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  client_name: 'Dana Cruz',
  avatar_url: null,
  snippet: 'Can we move my check-in?',
  created_at: new Date(Date.now() - 3_600_000).toISOString(),
});

const caughtUpNav = () => ({
  navigate: jest.fn(),
  goBack: jest.fn(),
  canGoBack: () => true,
  setOptions: jest.fn(),
});

describe('FX4-868 — the AI triage card on a clear inbox (switch on)', () => {
  beforeEach(() => {
    mockInbox = inboxState([]);
    mockTriage = triageState({ data: triageWith([]) });
  });

  it('the caught-up page has no "Nothing to triage" card', async () => {
    const { getByTestId, getByText, queryByTestId } = await render(
      <CoachCommunityInboxScreen navigation={caughtUpNav() as never} />,
    );
    expect(getByTestId('coach-community-inbox-empty-back')).toBeTruthy();
    expect(getByText('TEST_CLEAR_INBOX_COPY')).toBeTruthy();
    expect(queryByTestId(`${TID}-empty`)).toBeNull();
    expect(queryByTestId(TID)).toBeNull();
  });

  it.each([
    ['loading', { isLoading: true }],
    ['error', { isError: true, error: new Error('triage down') }],
  ])('the caught-up page has no %s triage card', async (state, over) => {
    mockTriage = triageState(over);
    const { getByTestId, queryByTestId } = await render(
      <CoachCommunityInboxScreen navigation={caughtUpNav() as never} />,
    );
    expect(getByTestId('coach-community-inbox-empty-back')).toBeTruthy();
    expect(queryByTestId(`${TID}-${state}`)).toBeNull();
    expect(queryByTestId(`${TID}-refused`)).toBeNull();
  });

  it('a triage with items still shows on the caught-up page', async () => {
    mockTriage = triageState({ data: triageWith([MID]) });
    const { getByTestId } = await render(
      <CoachCommunityInboxScreen navigation={caughtUpNav() as never} />,
    );
    expect(getByTestId('coach-community-inbox-empty-back')).toBeTruthy();
    expect(getByTestId(TID)).toBeTruthy();
  });

  it('an inbox with rows keeps the empty triage card above them', async () => {
    mockInbox = inboxState([row()]);
    const { getByTestId } = await render(
      <CoachCommunityInboxScreen navigation={caughtUpNav() as never} />,
    );
    expect(getByTestId(`coach-community-inbox-row-${MID}`)).toBeTruthy();
    expect(getByTestId(`${TID}-empty`)).toBeTruthy();
  });
});
