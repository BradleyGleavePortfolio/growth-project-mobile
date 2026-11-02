/** LS-917R4 B2: C4's month must distinguish an existing missed session. */
import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import type { CoachingSession } from '../api/schedulingApi';
import { colors } from '../theme/tokens';
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
  PrimaryButton: () => null, TextLink: () => null,
}));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: jest.requireActual('../theme/tokens').lightTokens,
    semanticColors: jest.requireActual('../theme/tokens').lightTokens,
  }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }), useFocusEffect: jest.fn(),
}));

const session = (id: string, day: string, status: CoachingSession['status']): CoachingSession => ({
  id, coach_id: 'coach-fixture', client_id: 'member-fixture', session_type_id: null,
  status, start_at: `${day}T12:00:00.000Z`, end_at: `${day}T12:30:00.000Z`,
  title: 'Check-in call', coach_notes_md: null, client_recap_md: null,
  video_provider: 'stub', video_url: null, video_meeting_id: null,
  calendar_provider: 'stub', calendar_event_id: null, approved_at: null,
  ended_at: null, end_reason: null, created_at: `${day}T09:00:00.000Z`,
  updated_at: `${day}T13:00:00.000Z`,
});
const data: CalendarWeekData = {
  coaches: [], sessions: [
    session('scheduled-fixture', '2026-10-05', 'scheduled'),
    session('missed-fixture', '2026-10-08', 'no_show'),
  ],
  workouts: [], checkIns: [], logs: [], loading: false, failed: false,
  refreshing: false, offline: false, hasData: true,
};
const start = () => render(<CalendarWeekPage data={data} initialMonth="2026-10-01"
  onRefresh={jest.fn()} onSession={jest.fn()} onBook={jest.fn()} />);
afterEach(cleanup);

it('control: the existing no_show payload already renders Missed in its selected-day agenda', async () => {
  const view = await start();
  await fireEvent.press(view.getByTestId('month-day-2026-10-08'));
  expect(view.getByTestId('week-session-missed-fixture')).toBeTruthy();
  expect(view.getAllByText('Missed').length).toBeGreaterThan(0);
});

it('LS-917R4 B2: the month retains the picked C4 Missed legend even before selecting the missed day', async () => {
  const view = await start();
  expect(view.getByText(/\bSession\b/, { includeHiddenElements: true })).toBeTruthy();
  expect(view.getByText(/\bWorkout\b/, { includeHiddenElements: true })).toBeTruthy();
  expect(view.getByText(/\bCheck-in\b/, { includeHiddenElements: true })).toBeTruthy();
  expect(view.getByText(/\bMissed\b/, { includeHiddenElements: true })).toBeTruthy();
});

it('LS-917R4 B2: a missed session is not painted as the same ordinary session ring', async () => {
  const view = await start();
  const rings = (day: string) => {
    const result: ViewStyle[] = [];
    // RNTL 14's public TestInstance tree, not react-test-renderer methods.
    const collect = (node: ReturnType<typeof view.getByTestId> | string) => {
      if (typeof node === 'string') return;
      const style = StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>);
      if (style && Number(style.borderWidth) > 0) result.push(style);
      node.children.forEach(collect);
    };
    collect(view.getByTestId(`month-day-${day}`));
    return result;
  };
  expect(rings('2026-10-05')).toEqual(expect.arrayContaining([
    expect.objectContaining({ borderColor: colors.camel }),
  ]));
  expect(rings('2026-10-08')).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ borderColor: colors.camel }),
  ]));
});
