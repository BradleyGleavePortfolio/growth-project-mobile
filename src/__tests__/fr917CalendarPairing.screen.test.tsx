/**
 * @jest-environment ./src/__tests__/helpers/lsWorkoutPacific187.cjs
 */
// FR-917 F1 (LS-917 B1), the other paths: the real CalendarWeekPage pairs a
// done assignment with the one saved workout of that session (same start day,
// same plan), not with every same-name workout and not by upload time.
// Harness copied from ls917CalendarReplay.screen.test.tsx.
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

// [case, assignments, saved workouts, day shown, rows named 'Offline push', other names]
it.each<[string, Row[], Row[], string, number, string[]]>([
  ['started 23:30 Monday, finished and sent after midnight: once on Monday',
    [done({ started_at: '2026-10-27T06:30:00.000Z', completed_at: '2026-10-27T07:40:00.000Z' })],
    [log('w1', '2026-10-26')], '2026-10-26', 1, []],
  ['a second workout of the same plan that day still shows',
    [done({ started_at: '2026-10-26T16:00:00.000Z', completed_at: '2026-10-26T17:00:00.000Z' })],
    [log('w1', '2026-10-26'), log('w2', '2026-10-26')], '2026-10-26', 2, []],
  ['two done assignments of one plan that day pair with their two workouts',
    [done({ id: 'a1', started_at: '2026-10-26T16:00:00.000Z', completed_at: '2026-10-26T17:00:00.000Z' }),
      done({ id: 'a2', started_at: '2026-10-26T20:00:00.000Z', completed_at: '2026-10-26T21:00:00.000Z' })],
    [log('w1', '2026-10-26'), log('w2', '2026-10-26')], '2026-10-26', 2, []],
  ['control: done a day late, the workout is not shown again on its own day',
    [done({ started_at: '2026-10-28T01:00:00.000Z', completed_at: '2026-10-28T02:00:00.000Z' })],
    [log('w1', '2026-10-27')], '2026-10-27', 0, []],
  ['control: an unrelated workout the same day still shows',
    [done({ started_at: '2026-10-26T16:00:00.000Z', completed_at: '2026-10-26T17:00:00.000Z' })],
    [log('w1', '2026-10-26'), log('w2', '2026-10-26', 'Easy run')], '2026-10-26', 1, ['Easy run']],
  ['control: an open assignment hides nothing',
    [done({ completed_at: null })], [log('w1', '2026-10-26')], '2026-10-26', 2, []],
])('%s', async (_case, workouts, logs, day, named, others) => {
  await show(workouts, logs, day);
  expect(screen.queryAllByText('Offline push')).toHaveLength(named);
  others.forEach((name) => expect(screen.getAllByText(name)).toHaveLength(1));
});
