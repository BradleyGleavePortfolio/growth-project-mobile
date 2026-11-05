/**
 * @jest-environment ./src/__tests__/helpers/lsWorkoutPacific187.cjs
 */
// FR-917R2 (LS-917R2 B3): a week with three done assignments of one plan.
// Monday's was done offline and sent Tuesday (its workout is dated Monday, the
// assignment completed Tuesday). GET /workouts lists Wednesday, Tuesday,
// Monday. Each workout shows once: Monday's row must not take
// Tuesday's workout on its completed day before Tuesday's row pairs.
// Harness copied from fr917CalendarPairing.screen.test.tsx.
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

type Row = Record<string, unknown>;
const done = (over: Row = {}) => ({
  id: 'assignment-1',
  scheduled_for: '2026-10-26T00:00:00.000Z',
  workout_plan: { name: 'Offline push' },
  ...over,
});
const log = (id: string, date: string, name = 'Offline push') => ({
  id, date, created_at: '2026-10-27T12:00:00.000Z', workout_name: name, exercises: [],
});
async function show(workouts: Row[], logs: Row[], day: string) {
  const data = {
    coaches: [], sessions: [], checkIns: [], workouts, logs,
    loading: false, failed: false, refreshing: false, offline: false, hasData: true,
  } as unknown as CalendarWeekData;
  await render(<CalendarWeekPage data={data} onRefresh={jest.fn()} onSession={jest.fn()} onBook={jest.fn()} />);
  await fireEvent.press(screen.getByTestId(`week-day-${day}`));
  await act(async () => { jest.advanceTimersByTime(250); });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-27T12:00:00.000Z'));
});
afterEach(() => jest.useRealTimers());

const week = [
  done({ id: 'a1', scheduled_for: '2026-10-26T00:00:00.000Z', completed_at: '2026-10-27T15:00:00.000Z' }),
  done({ id: 'a2', scheduled_for: '2026-10-27T00:00:00.000Z', completed_at: '2026-10-27T20:00:00.000Z' }),
  done({ id: 'a3', scheduled_for: '2026-10-28T00:00:00.000Z', completed_at: '2026-10-28T20:00:00.000Z' }),
];
const saved = [log('wed', '2026-10-28'), log('tue', '2026-10-27'), log('mon', '2026-10-26')];

// Monday selected shows Monday to Sunday: three assignment rows, no saved
// workout shown again.
it('three same-named workouts: each shows once, as its assignment', async () => {
  await show(week, saved, '2026-10-26');
  expect(screen.queryAllByText('Offline push')).toHaveLength(3);
  ['a1', 'a2', 'a3'].forEach((id) => expect(screen.getByTestId(`week-workout-${id}`)).toBeTruthy());
  expect(screen.queryAllByTestId(/^week-log-/)).toHaveLength(0);
});

it('control: a fourth saved workout with no assignment still shows', async () => {
  await show(week, [...saved, log('extra', '2026-10-27')], '2026-10-26');
  expect(screen.queryAllByText('Offline push')).toHaveLength(4);
  expect(screen.queryAllByTestId(/^week-log-/).map((n) => n.props.testID)).toEqual(['week-log-extra']);
});
