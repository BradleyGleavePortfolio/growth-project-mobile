/**
 * CommunityTodayScreen — error-state regression tests (v3-1 R9).
 *
 * The Today surface is the Community tab's home. A failed `useCommunityToday()`
 * must NOT collapse into the Roman onboarding empty state ("Nothing waiting
 * today" / "Visit the Hall"): that silently hides the failure and can send a
 * member to another surface while the root today object is unavailable
 * (R65 #36/#44). These tests pin:
 *
 *   1. A `useCommunityToday` FAILURE renders a calm, retryable today error
 *      (NOT the empty state), and pressing retry invokes `today.refetch()`.
 *   2. A genuine empty SUCCESS still renders the calm empty/onboarding state,
 *      NOT the error state (the error split did not break true-empty).
 *
 * The data layer is mocked so each render path is deterministic.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, fireEvent, within } from '@testing-library/react-native';
import { lightTokens, radius } from '../../../theme/tokens';

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
const mockUser: { coach_id?: string } = {};
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));

// ── Feature flags — Hall on so the empty-state primary action resolves ───────
const mockFlags = { communityHall: true, communityDm: true, communityEvents: true, communityChallenges: true };
jest.mock('../../../config/featureFlags', () => ({ get featureFlags() { return mockFlags; } }));
jest.mock('../../../ui/skeletons/Skeleton', () => ({
  SkeletonRow: () => null,
}));

// ── useCommunityToday — the today query (mutable holder) ─────────────────────
type TodayState = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: jest.Mock;
};
const mockToday: TodayState = {
  data: undefined,
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
};
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityToday: () => mockToday,
}));

import CommunityTodayScreen from '../CommunityTodayScreen';

beforeEach(() => {
  mockNavigate.mockReset();
  mockToday.data = undefined;
  mockToday.isLoading = false;
  mockToday.isError = false;
  mockToday.refetch.mockReset();
  Object.keys(mockFlags).forEach((key) => { mockFlags[key as keyof typeof mockFlags] = true; });
  mockUser.coach_id = undefined;
});

describe('Today truthful rows and action parity', () => {
  const populated = {
    feature_flag_state: 'enabled',
    cohort: { id: 'c-1', name: 'Morning group', member_count: 0 },
    pinned_post: { id: 'p-1', title: 'A shared note', author_user_id: 'other-author' },
    event: { id: 'e-1', title: 'Group session', starts_at: '2026-10-08T16:00:00Z' },
    challenge: { id: 'ch-1', title: 'Walk together', ends_at: '2026-10-10T16:00:00Z' },
    empty_reason: null,
  };
  it('keeps all populated destinations and offers the real composer without inventing post facts', async () => {
    mockToday.data = populated;
    await render(<CommunityTodayScreen />);
    expect(screen.queryByText('From your coach')).toBeNull();
    expect(screen.getByText('Pinned post')).toBeTruthy();
    expect(screen.getByText('0 members')).toBeTruthy();
    const actions = [
      ['cohort', 'CommunitySpace', { space: 'cohort', cohortId: 'c-1' }],
      ['pinned', 'CommunityThread', { postId: 'p-1' }],
      ['event', 'CommunityEventDetail', { eventId: 'e-1' }],
      ['challenge', 'CommunityChallengeDetail', { challengeId: 'ch-1' }],
      ['compose', 'CommunityComposer', { mode: 'post' }],
    ] as const;
    for (const [id, route, params] of actions) {
      await fireEvent.press(screen.getByTestId(`community-today-${id}`));
      expect(mockNavigate).toHaveBeenLastCalledWith(route, params);
    }
  });
  it('keeps event and challenge flag-off fallbacks to the Hall', async () => {
    mockToday.data = populated;
    mockFlags.communityEvents = mockFlags.communityChallenges = false;
    await render(<CommunityTodayScreen />);
    for (const id of ['event', 'challenge']) {
      await fireEvent.press(screen.getByTestId(`community-today-${id}`));
      expect(mockNavigate).toHaveBeenLastCalledWith('CommunitySpace', { space: 'hall' });
    }
  });
  it.each([['hall', true, true, undefined], ['dm', false, true, undefined], ['coach', false, false, 'coach-1']])(
    'labels a true-empty %s action with its actual destination',
    async (_kind, hall, dm, coach) => {
      mockFlags.communityHall = Boolean(hall); mockFlags.communityDm = Boolean(dm);
      mockUser.coach_id = typeof coach === 'string' ? coach : undefined;
      mockToday.data = { ...populated, cohort: null, pinned_post: null, event: null, challenge: null, empty_reason: 'no_today_content' };
      await render(<CommunityTodayScreen />);
      expect(screen.getByText('No updates in Today')).toBeTruthy();
      expect(screen.getByText(hall ? 'Visit the Hall' : dm ? 'Messages' : 'Send your coach a message')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('community-today-empty-action'));
      expect(mockNavigate).toHaveBeenCalledWith(...(hall ? ['CommunitySpace', { space: 'hall' }] : dm ? ['CommunityDmList'] : ['Home', { screen: 'Messages' }]));
    },
  );
  it('omits an unavailable empty fallback for a coachless client', async () => {
    mockFlags.communityHall = mockFlags.communityDm = false;
    mockToday.data = { ...populated, cohort: null, pinned_post: null, event: null, challenge: null, empty_reason: 'no_today_content' };
    await render(<CommunityTodayScreen />);
    expect(screen.queryByTestId('community-today-empty-action')).toBeNull();
  });
  it('does not promise a coach or a composer to a client without membership', async () => {
    mockToday.data = { ...populated, cohort: null, pinned_post: null, event: null, challenge: null, empty_reason: 'no_membership' };
    await render(<CommunityTodayScreen />);
    expect(screen.getByText('A community space is not available for this account.')).toBeTruthy();
    expect(screen.queryByTestId('community-today-empty-action')).toBeNull();
    expect(screen.queryByTestId('community-today-compose')).toBeNull();
  });
  it('distinguishes initial loading from true empty', async () => {
    mockToday.isLoading = true;
    await render(<CommunityTodayScreen />);
    expect(screen.getByLabelText('Loading community Today')).toBeTruthy();
    expect(screen.queryByTestId('community-today-empty')).toBeNull();
  });
});

describe('CommunityTodayScreen error state', () => {
  it('a today query FAILURE renders the retryable today error (NOT the empty state), and retry refetches today', async () => {
    mockToday.data = undefined;
    mockToday.isLoading = false;
    mockToday.isError = true;
    await render(<CommunityTodayScreen />);

    expect(screen.getByTestId('community-today-error')).toBeTruthy();
    expect(screen.queryByTestId('community-today-empty')).toBeNull();

    await fireEvent.press(screen.getByTestId('community-today-error-retry'));
    expect(mockToday.refetch).toHaveBeenCalledTimes(1);
  });

  it('a genuine empty SUCCESS still renders the empty/onboarding state, NOT the error state', async () => {
    // Successful today with no cohort/event/post/challenge: the calm empty
    // state, never the retryable error.
    mockToday.data = {
      feature_flag_state: {},
      cohort: null,
      event: null,
      pinned_post: null,
      challenge: null,
      empty_reason: 'no_today_content',
    };
    mockToday.isLoading = false;
    mockToday.isError = false;
    await render(<CommunityTodayScreen />);

    expect(screen.getByTestId('community-today-empty')).toBeTruthy();
    expect(screen.queryByTestId('community-today-error')).toBeNull();
  });
});

// ─── REDO-HABITS-CAL-COMM-133: Today on the shared primitives ────────────────

describe('REDO-HABITS-CAL-COMM-133 Today look', () => {
  const flat = (n: { props: { style?: unknown } }) => (StyleSheet.flatten(n.props.style as never) ?? {}) as Record<string, unknown>;
  const forest = () =>
    (screen.queryAllByRole('button') as { props: { style?: unknown } }[]).filter((b) => flat(b).backgroundColor === lightTokens.accent);
  const populated = {
    feature_flag_state: 'enabled',
    cohort: { id: 'c-1', name: 'Morning group', member_count: 1 },
    pinned_post: null, event: null, challenge: null, empty_reason: null,
  };

  it('one rounded forest New post in the footer, a serif date that never clips, a singular member count', async () => {
    mockToday.data = populated;
    await render(<CommunityTodayScreen />);
    expect(forest()).toHaveLength(1);
    expect(within(screen.getByTestId('community-today-screen-footer')).getByTestId('community-today-compose')).toBeTruthy();
    expect(flat(forest()[0]).borderRadius).toBe(radius.button);
    expect(screen.getByText('1 member')).toBeTruthy();
    const date = flat(screen.getByRole('header'));
    expect(date.fontFamily).toBe('CormorantGaramond_400Regular');
    expect(Number(date.lineHeight)).toBeGreaterThanOrEqual(1.2 * Number(date.fontSize));
  });

  it('a failed load offers a text retry, never a filled 4 pt button', async () => {
    mockToday.isError = true;
    await render(<CommunityTodayScreen />);
    expect(screen.getByTestId('community-today-error-retry')).toBeTruthy();
    expect(forest()).toHaveLength(0);
  });
});
