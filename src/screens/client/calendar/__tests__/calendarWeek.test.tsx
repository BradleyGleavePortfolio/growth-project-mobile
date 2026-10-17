import React from 'react';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CalendarStackParamList } from '../../../../navigation/calendarRoutes';
import type { CoachingSession } from '../../../../api/schedulingApi';
import type { ClientWorkoutAssignmentWithPlan } from '../../../../api/workoutBuilderApi';
import { addDays, getLocalWeekStart, getTodayString } from '../../../../utils/date';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
}));
jest.mock('../../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../../../api/schedulingApi', () => ({
  ...jest.requireActual('../../../../api/schedulingApi'),
  schedulingApi: { listMyCoaches: jest.fn(), listMySessions: jest.fn(), listSessionTypes: jest.fn() },
}));
jest.mock('../../../../api/workoutBuilderApi', () => ({
  workoutBuilderApi: { listMyAssignments: jest.fn() },
}));
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: {},
  checkInsApi: { list: jest.fn() },
}));
jest.mock('../../../../ui/haptics/haptics.service', () => ({
  HapticService: { softImpact: jest.fn(), selection: jest.fn(), error: jest.fn() },
}));
import { schedulingApi } from '../../../../api/schedulingApi';
import { workoutBuilderApi } from '../../../../api/workoutBuilderApi';
import { checkInsApi } from '../../../../services/api';
import CalendarWeekScreen, { CalendarWeekPage, type CalendarWeekData } from '../CalendarWeekScreen';
import { WEEK_COPY as c } from '../calendarWeekCopy';

const today = getTodayString();
const stamp = `${today}T12:00:00`;
const session = {
  id: 'session-own', coach_id: 'coach-own', title: 'Weekly call',
  start_at: stamp, end_at: `${today}T12:30:00`, status: 'scheduled',
} as CoachingSession;
const workout = {
  id: 'assignment-own', scheduled_for: stamp, completed_at: null,
  workout_plan: { name: 'Live plan' }, snapshot: { plan_name: 'Frozen plan' },
} as ClientWorkoutAssignmentWithPlan;
const base: CalendarWeekData = {
  coaches: [{ coach_id: 'coach-own', name: 'Sam', timezone: null }],
  sessions: [session], workouts: [workout], checkIns: [{ id: 'checkin-own', date: today }],
  loading: false, failed: false, refreshing: false, offline: false, hasData: true,
};
const refresh = jest.fn();
const openSession = jest.fn();
const book = jest.fn();
const clients: QueryClient[] = [];
const page = (data: Partial<CalendarWeekData> = {}) => render(
  <CalendarWeekPage data={{ ...base, ...data }} onRefresh={refresh} onSession={openSession} onBook={book} />,
);
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((q) => q.clear());
  jest.clearAllMocks();
});

it('every week day selects a real agenda; notification, booking and own workout routes are real', () => {
  const r = page();
  const start = getLocalWeekStart();
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(start, i);
    fireEvent.press(r.getByTestId(`week-day-${day}`));
    expect(r.getByTestId(`week-agenda-${day}`)).toBeTruthy();
    expect(r.getByTestId(`week-day-${day}`).props.accessibilityState.selected).toBe(true);
  }
  fireEvent.press(r.getByTestId(`week-day-${today}`));
  fireEvent.press(r.getByTestId('week-workout-assignment-own'));
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'WorkoutAssignmentDetail', params: { assignmentId: 'assignment-own' } });
  expect(r.getByText('Frozen plan')).toBeTruthy();
  expect(r.queryByText('Live plan')).toBeNull();
  fireEvent.press(r.getByTestId('week-session-session-own'));
  expect(openSession).toHaveBeenCalledWith('session-own');
  fireEvent.press(r.getByTestId('week-book'));
  expect(book).toHaveBeenCalledWith('coach-own');
  fireEvent.press(r.getByTestId('week-notifications'));
  expect(mockNavigate).toHaveBeenCalledWith('Home', { screen: 'NotificationCenter' });
  fireEvent.press(r.getByTestId('week-checkin-open'));
  expect(mockNavigate).toHaveBeenCalledWith('Home', { screen: 'Habits', params: { initialTab: 'checkin' } });
});

it('next session opens real detail even if outside this week, without duplicating pages', () => {
  const next = { ...session, session_type_id: 'type-own', start_at: `${addDays(today, 10)}T12:00:00`, end_at: `${addDays(today, 10)}T12:30:00` };
  const r = page({ sessions: [next, next], descriptions: { 'type-own': 'The coach’s actual session description.' } });
  fireEvent.press(r.getByTestId('week-next-session-own'));
  expect(openSession).toHaveBeenCalledWith('session-own');
  expect(r.getAllByTestId('week-next-session-own')).toHaveLength(1);
  expect(r.getByText('The coach’s actual session description.')).toBeTruthy();
});

it('coachless clients keep workouts, saved check-ins, today entry and notifications without a lock', () => {
  const r = page({ coaches: [], sessions: [] });
  expect(r.getByTestId('week-workout-assignment-own')).toBeTruthy();
  expect(r.getByTestId(`week-checkin-${today}`)).toBeTruthy();
  expect(r.queryByTestId('week-book')).toBeNull();
  fireEvent.press(r.getByTestId('week-checkin-open'));
  expect(mockNavigate).toHaveBeenCalled();
});

it.each(['loading', 'failed', 'offline'] as const)('%s never invents empty or rest states', (key) => {
  const r = page({ sessions: [], workouts: [], checkIns: [], [key]: true });
  expect(r.queryByTestId('week-empty')).toBeNull();
  expect(r.queryByText(c['C4-S-89'])).toBeNull();
  if (key === 'failed') {
    fireEvent.press(r.getByTestId('week-retry'));
    expect(refresh).toHaveBeenCalledTimes(1);
  }
});

it('offline keeps loaded rows, disables booking and distinguishes a cold offline view', () => {
  const r = page({ offline: true });
  expect(r.getByText(c['C4S1-S-01'])).toBeTruthy();
  expect(r.getByTestId('week-workout-assignment-own')).toBeTruthy();
  fireEvent.press(r.getByTestId('week-book'));
  expect(book).not.toHaveBeenCalled();
  r.unmount();
  expect(page({ offline: true, hasData: false, sessions: [], workouts: [], checkIns: [] }).getByText(c['C4S1-S-03'])).toBeTruthy();
});

it('successfully empty week is honest; completed rows say Done', () => {
  const r = page({ sessions: [], workouts: [], checkIns: [] });
  expect(r.getByTestId('week-empty')).toBeTruthy();
  r.unmount();
  const done = page({ workouts: [{ ...workout, completed_at: stamp }] });
  expect(within(done.getByTestId('week-workout-assignment-own')).getByText('Done')).toBeTruthy();
});

it('reads only signed-in-client lists, including retained session history without a coach', async () => {
  jest.mocked(schedulingApi.listMyCoaches).mockResolvedValue([]);
  jest.mocked(schedulingApi.listMySessions).mockResolvedValue([]);
  jest.mocked(workoutBuilderApi.listMyAssignments).mockResolvedValue([workout]);
  jest.mocked(checkInsApi.list).mockResolvedValue({ data: [] } as Awaited<ReturnType<typeof checkInsApi.list>>);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(qc);
  const navigation = { navigate: mockNavigate } as NativeStackNavigationProp<CalendarStackParamList, 'CalendarHome'>;
  const r = render(<QueryClientProvider client={qc}><CalendarWeekScreen navigation={navigation}
    route={{ key: 'home', name: 'CalendarHome' }} /></QueryClientProvider>);
  await waitFor(() => expect(r.getByTestId('week-workout-assignment-own')).toBeTruthy());
  expect(workoutBuilderApi.listMyAssignments).toHaveBeenCalledWith();
  expect(checkInsApi.list).toHaveBeenCalledWith({ from: getLocalWeekStart(), to: addDays(getLocalWeekStart(), 6), limit: 7 });
  expect(schedulingApi.listMySessions).toHaveBeenCalledWith(50);
  expect(schedulingApi.listMySessions).toHaveBeenCalledWith(20, { scope: 'past', before: undefined, beforeId: undefined });
  expect(r.queryByTestId('week-error')).toBeNull();
});
