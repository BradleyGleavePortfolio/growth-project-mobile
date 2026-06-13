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

// ── Feature flags — Hall on so the empty-state primary action resolves ───────
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: {
    communityHall: true,
    communityDm: true,
    communityEvents: true,
    communityChallenges: true,
  },
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
});

describe('CommunityTodayScreen error state', () => {
  it('a today query FAILURE renders the retryable today error (NOT the empty state), and retry refetches today', () => {
    mockToday.data = undefined;
    mockToday.isLoading = false;
    mockToday.isError = true;
    render(<CommunityTodayScreen />);

    expect(screen.getByTestId('community-today-error')).toBeTruthy();
    expect(screen.queryByTestId('community-today-empty')).toBeNull();

    fireEvent.press(screen.getByTestId('community-today-retry'));
    expect(mockToday.refetch).toHaveBeenCalledTimes(1);
  });

  it('a genuine empty SUCCESS still renders the empty/onboarding state, NOT the error state', () => {
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
    render(<CommunityTodayScreen />);

    expect(screen.getByTestId('community-today-empty')).toBeTruthy();
    expect(screen.queryByTestId('community-today-error')).toBeNull();
  });
});
