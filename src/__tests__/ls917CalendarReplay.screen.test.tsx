/**
 * @jest-environment ./src/__tests__/helpers/lsWorkoutPacific187.cjs
 */
// LS-917: exercise the real CalendarWeekPage, not a replacement dedupe helper.
// The API records assignment.completed_at when an offline completion arrives;
// the saved workout's date remains the day on which the workout began.
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { CalendarWeekPage, type CalendarWeekData } from '../screens/client/calendar/CalendarWeekScreen';

jest.mock('../hooks/useApi', () => ({}));
jest.mock('../hooks/useCalendar', () => ({}));
jest.mock('../hooks/useWorkoutBuilder', () => ({}));
jest.mock('../services/api', () => ({}));
jest.mock('../entitlements/withProtectedScreen', () => ({ withProtectedScreen: (component: unknown) => component }));
jest.mock('../components/coachless/JoinCoachState', () => ({ useClientNeedsCoach: () => false }));
jest.mock('../hooks/useNetworkStatus', () => ({}));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), error: jest.fn(), softImpact: jest.fn() },
}));
jest.mock('../ui/states/QuietStates', () => ({ QuietLoading: () => null }));
jest.mock('../ui', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PrimaryButton: () => null,
  TextLink: () => null,
}));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: jest.requireActual('../theme/tokens').lightTokens,
    semanticColors: jest.requireActual('../theme/tokens').lightTokens,
  }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: jest.fn(),
}));

const assignment = (completedAt: string) => ({
  id: 'assignment-offline',
  scheduled_for: '2026-10-26T00:00:00.000Z',
  completed_at: completedAt,
  workout_plan: { name: 'Offline push' },
});
const workout = (date = '2026-10-26') => ({
  id: 'workout-offline',
  date,
  created_at: '2026-10-27T12:00:00.000Z',
  workout_name: 'Offline push',
  exercises: [],
});
async function show(completedAt: string) {
  const data = {
    coaches: [], sessions: [], checkIns: [],
    workouts: [assignment(completedAt)], logs: [workout()],
    loading: false, failed: false, refreshing: false, offline: false, hasData: true,
  } as unknown as CalendarWeekData;
  await render(<CalendarWeekPage data={data} onRefresh={jest.fn()} onSession={jest.fn()} onBook={jest.fn()} />);
  await fireEvent.press(screen.getByTestId('week-day-2026-10-26'));
  await act(async () => { jest.advanceTimersByTime(250); });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-27T12:00:00.000Z'));
});
afterEach(() => jest.useRealTimers());

it('control: one saved workout and its same-day completion appear once', async () => {
  await show('2026-10-26T20:00:00.000Z');
  expect(screen.getAllByText('Offline push')).toHaveLength(1);
});

it('an assigned workout uploaded the next day still appears only once on its recorded day', async () => {
  await show('2026-10-27T12:00:00.000Z');
  expect(screen.getAllByText('Offline push')).toHaveLength(1);
});

it('a workout crossing local midnight still appears only once on its start day', async () => {
  await show('2026-10-27T07:10:00.000Z');
  expect(screen.getAllByText('Offline push')).toHaveLength(1);
});
