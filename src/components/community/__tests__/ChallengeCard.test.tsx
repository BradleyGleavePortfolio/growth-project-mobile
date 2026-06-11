/**
 * ChallengeCard — render + behavioral-design regression tests (v3-1).
 *
 * Pins the card's design contract (DESIGN_INTELLIGENCE Part III):
 *   - Foregrounds the caller's OWN progress ("X of Y"), never a ranking.
 *   - One clear action that adapts to state: Join → Continue → View.
 *   - Completed renders a calm closure ("Goal reached") with a LINE check icon,
 *     not a trophy/badge (no badge theater §3.7) and no comparison.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});

import ChallengeCard from '../ChallengeCard';

function challenge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ch-1',
    workspace_id: 'ws-1',
    cohort_id: null,
    created_by_user_id: 'coach-1',
    title: 'Protein streak',
    description: 'Hit your protein target daily.',
    status: 'active',
    starts_at: null,
    ends_at: null,
    metric_key: 'days',
    target_value: 30,
    unit: 'days',
    leaderboard_enabled: false,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    archived: false,
    ...overrides,
  } as never;
}

function participation(overrides: Record<string, unknown> = {}) {
  return {
    challenge_id: 'ch-1',
    user_id: 'me-1',
    progress_value: 12,
    target_value: 30,
    progress_fraction: 0.4,
    completed: false,
    completed_at: null,
    last_logged_at: null,
    leaderboard_opted_in: false,
    ...overrides,
  } as never;
}

describe('ChallengeCard', () => {
  it('shows a Join action and description when not joined', () => {
    render(
      <ChallengeCard
        challenge={challenge()}
        participation={null}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(screen.getByText('Join')).toBeTruthy();
    expect(screen.getByText('Open to join')).toBeTruthy();
    expect(screen.getByText('Hit your protein target daily.')).toBeTruthy();
  });

  it('shows own progress and a Continue action when joined', () => {
    render(
      <ChallengeCard
        challenge={challenge()}
        participation={participation()}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(screen.getByText('12 of 30 days')).toBeTruthy();
    expect(screen.getByText('Continue')).toBeTruthy();
    expect(screen.getByTestId('card-fill')).toBeTruthy();
  });

  it('renders a calm completed closure with a line check icon', () => {
    render(
      <ChallengeCard
        challenge={challenge()}
        participation={participation({ completed: true, progress_value: 30 })}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(screen.getByText('Goal reached')).toBeTruthy();
    expect(screen.getByText('View')).toBeTruthy();
    expect(screen.getByTestId('card-complete-icon')).toBeTruthy();
  });

  it('fires onPress with the challenge', () => {
    const onPress = jest.fn();
    render(
      <ChallengeCard
        challenge={challenge()}
        participation={null}
        onPress={onPress}
        testID="card"
      />,
    );
    fireEvent.press(screen.getByTestId('card'));
    expect(onPress).toHaveBeenCalledWith(expect.objectContaining({ id: 'ch-1' }));
  });
});
