/**
 * @jest-environment ./src/__tests__/helpers/lsWorkoutPacific187.cjs
 *
 * B-LS-WORKOUT-3: a scheduled calendar day is not an instant to move west
 * across midnight. Render the real Home dial from its real production mapper.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import HomeDial from '../components/home/rings/HomeDial';
import { trainDial } from '../components/home/rings/homeRings';

jest.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({
  semanticColors: jest.requireActual('../theme/tokens').lightTokens,
}) }));

it.each([
  { scenario: 'an open Monday ISO calendar date', scheduled_for: '2026-10-26T00:00:00.000Z', completed_at: null, expected: '0 of 1' },
  { scenario: 'a completed Monday ISO calendar date', scheduled_for: '2026-10-26T00:00:00.000Z', completed_at: '2026-10-26T18:00:00.000Z', expected: '1 of 1' },
  { scenario: 'a date-only Monday control', scheduled_for: '2026-10-26', completed_at: null, expected: '0 of 1' },
  { scenario: 'a midweek ISO calendar date control', scheduled_for: '2026-10-28T00:00:00.000Z', completed_at: '2026-10-28T18:00:00.000Z', expected: '1 of 1' },
])('B-LS-WORKOUT-3 keeps $scenario in the client Home weekly total west of UTC', async ({ scheduled_for, completed_at, expected }) => {
  const now = new Date('2026-10-30T16:00:00.000Z');
  expect(now.getTimezoneOffset()).toBe(420);
  const dial = trainDial({
    now, assignments: [{ scheduled_for, completed_at }],
    history: [], daysPerWeek: 3, loading: false,
  });
  const view = await render(<HomeDial label="Train" view={dial} onPress={jest.fn()}
    accessibilityLabel={`Train, ${dial.value} workouts, This week`} testID="home-dial-train" />);
  expect(view.getByText(expected)).toBeTruthy();
});
