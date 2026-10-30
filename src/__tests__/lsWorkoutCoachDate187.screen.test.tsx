/**
 * B-LS-WORKOUT-3: a normal overnight offline sync must not change the
 * training date shown to the coach.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { WorkoutsTab } from '../screens/coach/client-detail/WorkoutsTab';
import { makeStyles } from '../screens/coach/client-detail/styles';
import { mapCoachWorkoutSessions } from '../utils/workout/workoutLogging';
import { testColors } from '../screens/client/wearables/recoveryTestColors';

jest.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({
  colors: jest.requireActual('../screens/client/wearables/recoveryTestColors').testColors,
  semanticColors: jest.requireActual('../theme/tokens').lightTokens,
}) }));
jest.mock('../components/coach/ai-entry/AdjustForClient', () => ({
  AdjustForClientEntry: () => null,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-30T16:00:00Z'));
});
afterEach(() => jest.useRealTimers());

it('B-LS-WORKOUT-3 shows the recorded workout day to the coach after next-day synchronization', async () => {
  // The phone logged Sunday; the server received it Monday after reconnection.
  const rows = [{
    id: 'offline-log-fixture', workout_name: 'Sunday push',
    date: '2026-10-25T00:00:00.000Z', created_at: '2026-10-26T16:00:00.000Z',
    duration_minutes: 30, notes: '',
    exercises: [{
      exercise_name: 'Barbell Bench Press', sets_completed: 1,
      weight_per_set: [80], reps_per_set: [8],
    }],
  }];
  const view = await render(<WorkoutsTab colors={testColors} styles={makeStyles(testColors)}
    workoutSessions={mapCoachWorkoutSessions(rows)} />);
  expect(view.getByText('Sunday push')).toBeTruthy();
  const recordedDay = new Date(2026, 9, 25).toLocaleDateString();
  expect(view.getByText(`${recordedDay} · 30 min`)).toBeTruthy();
});
