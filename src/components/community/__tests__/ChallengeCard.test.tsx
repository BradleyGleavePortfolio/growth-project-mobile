/**
 * ChallengeCard — render + behavioral-design regression tests (v3-1).
 *
 * Pins the card's design contract (DESIGN_INTELLIGENCE Part III):
 *   - Foregrounds the caller's OWN progress ("X of Y"), never a ranking.
 *   - ONE affordance that adapts to state: Join -> Continue -> Goal reached
 *     (UX finding 13 — a single chip, no separate status label).
 *   - Completed renders a calm closure ("Goal reached") with a LINE check icon,
 *     not a trophy/badge (no badge theater §3.7) and no comparison.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});

// Ionicons -> a Text node that forwards name/testID so the completed-state line
// icon is observable without loading font assets (repo pattern).
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name, testID }: { name: string; testID?: string }) =>
      React.createElement(Text, { testID: testID ?? `icon-${name}` }, `icon:${name}`),
  };
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
  it('shows a single Join affordance and description when not joined', async () => {
    await render(
      <ChallengeCard
        challenge={challenge()}
        participation={null}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    // F13: exactly one footer affordance, labelled by state.
    expect(screen.getByTestId('card-action')).toBeTruthy();
    expect(screen.getByText('Join')).toBeTruthy();
    expect(screen.getByText('Hit your protein target daily.')).toBeTruthy();
    // No separate status label competing with the action chip.
    expect(screen.queryByText('Open to join')).toBeNull();
  });

  it('shows own progress and a single Continue affordance when joined', async () => {
    await render(
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
    // F13: no separate "In progress" status text.
    expect(screen.queryByText('In progress')).toBeNull();
  });

  it('renders a calm completed closure as the single affordance with a line check icon', async () => {
    await render(
      <ChallengeCard
        challenge={challenge()}
        participation={participation({ completed: true, progress_value: 30 })}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    // The chip itself IS the closure label (F13) — no separate "View" action.
    expect(screen.getByTestId('card-action')).toBeTruthy();
    expect(screen.getByText('Goal reached')).toBeTruthy();
    expect(screen.queryByText('View')).toBeNull();
    expect(screen.getByTestId('card-complete-icon')).toBeTruthy();
  });

  it('fires onPress with the challenge', async () => {
    const onPress = jest.fn();
    await render(
      <ChallengeCard
        challenge={challenge()}
        participation={null}
        onPress={onPress}
        testID="card"
      />,
    );
    await fireEvent.press(screen.getByTestId('card'));
    expect(onPress).toHaveBeenCalledWith(expect.objectContaining({ id: 'ch-1' }));
  });
});
