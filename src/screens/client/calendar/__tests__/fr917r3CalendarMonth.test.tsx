/** FR-917R3 own tests (F6, LS-917R3 B3): the C4 Style C month view. Mocks
 * copied from calendarWeek.test.tsx. */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CalendarStackParamList } from '../../../../navigation/calendarRoutes';
import type { CoachingSession } from '../../../../api/schedulingApi';
import type { ClientWorkoutAssignmentWithPlan } from '../../../../api/workoutBuilderApi';
import { addDays, getLocalWeekStart, getTodayString } from '../../../../utils/date';

const mockNavigate = jest.fn();
let mockCoachless = false;
let mockEntitled = true;
const mockMessageCoach = jest.fn();
const mockOpenPlans = jest.fn();
jest.mock('../../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({
    entitlementActive: mockEntitled, status: mockEntitled ? 'active' : 'inactive',
    confirmedActive: mockEntitled, messageCoach: mockMessageCoach, openPlans: mockOpenPlans,
  }),
}));
jest.mock('../../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => mockCoachless }));
jest.mock('../../../../components/coachless/JoinCoachState', () => ({ useClientNeedsCoach: () => mockCoachless }));
jest.mock('../../../../config/purchaseSurfaces', () => ({ nonP2PPurchasesHidden: () => true }));
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
  workoutApi: { getAll: jest.fn() },
}));
jest.mock('../../../../ui/haptics/haptics.service', () => ({
  HapticService: { softImpact: jest.fn(), selection: jest.fn(), error: jest.fn() },
}));
import { schedulingApi } from '../../../../api/schedulingApi';
import { workoutBuilderApi } from '../../../../api/workoutBuilderApi';
import { checkInsApi, workoutApi } from '../../../../services/api';
import type { ApiWorkoutSession } from '../../../../hooks/useApi';
import { entitlementEvents } from '../../../../entitlements/entitlementEvents';
import { COACHLESS_TITLE, COACH_MANAGED_TITLE } from '../../../../entitlements/PaywallSheet';
import { ProtectedScreen } from '../../../../entitlements/ProtectedScreen';
import CalendarWeekScreen, { CalendarWeekPage, monthEnd, monthGrid, monthStart, type CalendarWeekData } from '../CalendarWeekScreen';
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
const screen = async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(qc);
  // @ts-expect-error Test navigator supplies only the one method this screen calls.
  const navigation: NativeStackNavigationProp<CalendarStackParamList, 'CalendarHome'> = { navigate: mockNavigate };
  return render(<QueryClientProvider client={qc}><CalendarWeekScreen navigation={navigation}
    route={{ key: 'home', name: 'CalendarHome' }} /></QueryClientProvider>);
};
const page = (data: Partial<CalendarWeekData> = {}) => render(
  <CalendarWeekPage data={{ ...base, ...data }} onRefresh={refresh} onSession={openSession} onBook={book} />,
);
const logged = (id: string, day: string, name: string) =>
  ({ id, user_id: 'me', date: `${day}T00:00:00.000Z`, workout_name: name, exercises: [], created_at: `${day}T18:00:00.000Z` }) as ApiWorkoutSession;
beforeEach(() => {
  jest.mocked(workoutApi.getAll).mockResolvedValue({ data: [] } as Awaited<ReturnType<typeof workoutApi.getAll>>);
});
afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((q) => q.clear());
  jest.clearAllMocks();
  mockEntitled = true;
  mockCoachless = false;
});

const planned = (id: string, day: string) => ({ ...workout, id, scheduled_for: `${day}T12:00:00` }) as ClientWorkoutAssignmentWithPlan;

it('a month with workouts on its first and last day marks both, in whole Monday-first weeks', async () => {
  expect(monthGrid('2026-10-01')).toHaveLength(35);
  expect(monthGrid('2026-10-01')[0]).toBe('2026-09-28');
  expect(monthGrid('2026-10-01')[34]).toBe('2026-11-01');
  expect(monthEnd('2026-02-01')).toBe('2026-02-28');
  expect(monthStart('2026-12-31', 1)).toBe('2027-01-01');
  const r = await render(<CalendarWeekPage initialMonth="2026-10-01" onRefresh={refresh} onSession={openSession} onBook={book}
    data={{ ...base, sessions: [], checkIns: [{ id: 'c-31', date: '2026-10-31' }],
      workouts: [planned('first', '2026-10-01'), planned('last', '2026-10-31')] }} />);
  expect(r.getByText('October 2026')).toBeTruthy();
  for (const day of ['2026-10-01', '2026-10-31']) expect(r.getByTestId(`month-workout-${day}`, { includeHiddenElements: true })).toBeTruthy();
  expect(r.queryByTestId('month-workout-2026-10-02', { includeHiddenElements: true })).toBeNull();
  expect(r.getByTestId('month-checkin-2026-10-31', { includeHiddenElements: true })).toBeTruthy();
  expect(r.getByTestId('month-day-2026-10-31').props.accessibilityLabel).toMatch(/Workout, Check-in$/);
  await fireEvent.press(r.getByTestId('month-day-2026-10-31'));
  expect(r.getByTestId('week-agenda-2026-10-31')).toBeTruthy();
  expect(r.getByTestId('week-workout-last')).toBeTruthy();
  // Only the chosen day's agenda shows under the month.
  expect(r.queryByTestId('week-agenda-2026-10-01')).toBeNull();
  await fireEvent.press(r.getByLabelText('Previous month'));
  expect(r.getByText('September 2026')).toBeTruthy();
});

it('the month asks only for its own check-ins (from, to, limit) and Week goes back to the week range', async () => {
  jest.mocked(schedulingApi.listMyCoaches).mockResolvedValue(base.coaches);
  jest.mocked(schedulingApi.listMySessions).mockResolvedValue([]);
  jest.mocked(schedulingApi.listSessionTypes).mockResolvedValue([]);
  jest.mocked(workoutBuilderApi.listMyAssignments).mockResolvedValue([]);
  jest.mocked(checkInsApi.list).mockResolvedValue({ data: [] } as Awaited<ReturnType<typeof checkInsApi.list>>);
  const r = await screen();
  await waitFor(() => expect(r.getByTestId('calendar-tab-month')).toBeTruthy());
  await fireEvent.press(r.getByTestId('calendar-tab-month'));
  const first = monthStart(today);
  await waitFor(() => expect(checkInsApi.list).toHaveBeenCalledWith({ from: first, to: monthEnd(first), limit: 31 }));
  await fireEvent.press(r.getByLabelText('Next month'));
  const next = monthStart(today, 1);
  await waitFor(() => expect(checkInsApi.list).toHaveBeenCalledWith({ from: next, to: monthEnd(next), limit: 31 }));
  await fireEvent.press(r.getByTestId('calendar-tab-week'));
  expect(r.queryByTestId('calendar-month')).toBeNull();
  expect(r.getByTestId(`week-day-${today}`)).toBeTruthy();
  expect(jest.mocked(checkInsApi.list).mock.calls.every(([q]) => (q?.limit === 7 && q.from === getLocalWeekStart())
    || (q?.limit === 31 && (q.from === first || q.from === next)))).toBe(true);
});

it('a coachless client gets the month too, with no scheduling read', async () => {
  mockCoachless = true;
  jest.mocked(workoutBuilderApi.listMyAssignments).mockResolvedValue([]);
  jest.mocked(checkInsApi.list).mockResolvedValue({ data: [] } as Awaited<ReturnType<typeof checkInsApi.list>>);
  const r = await screen();
  await waitFor(() => expect(r.getByTestId('calendar-tab-month')).toBeTruthy());
  await fireEvent.press(r.getByTestId('calendar-tab-month'));
  expect(r.getByTestId('calendar-month')).toBeTruthy();
  expect(r.getByTestId(`month-day-${today}`).props.accessibilityState).toEqual({ selected: true });
  [schedulingApi.listMyCoaches, schedulingApi.listMySessions, schedulingApi.listSessionTypes].forEach((read) => expect(read).not.toHaveBeenCalled());
});

it('an earlier month pages past sessions back to its first day (more than one page)', async () => {
  jest.mocked(schedulingApi.listMyCoaches).mockResolvedValue(base.coaches);
  jest.mocked(schedulingApi.listSessionTypes).mockResolvedValue([]);
  jest.mocked(workoutBuilderApi.listMyAssignments).mockResolvedValue([]);
  jest.mocked(checkInsApi.list).mockResolvedValue({ data: [] } as Awaited<ReturnType<typeof checkInsApi.list>>);
  const first = monthStart(today);
  // A full page of 20 past sessions, all after the 1st of this month at 09:00; then an older page.
  const page1 = Array.from({ length: 20 }, (_, i) => ({ ...session, id: `p${i}`, status: 'completed',
    start_at: `${addDays(today, -(i % 3))}T09:${String(59 - i).padStart(2, '0')}:00`, end_at: `${addDays(today, -(i % 3))}T10:00:00` }))
    .sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at)) as CoachingSession[];
  const older = [{ ...session, id: 'older', status: 'completed', start_at: `${addDays(first, -40)}T09:00:00`, end_at: `${addDays(first, -40)}T10:00:00` }] as CoachingSession[];
  jest.mocked(schedulingApi.listMySessions).mockImplementation(async (_n: number, opts?: { scope?: string; before?: string }) =>
    (opts?.scope === 'past' ? (opts.before ? older : page1) : []));
  const r = await screen();
  await waitFor(() => expect(r.getByTestId('calendar-tab-month')).toBeTruthy());
  const pastCalls = () => jest.mocked(schedulingApi.listMySessions).mock.calls.filter(([, o]) => o?.scope === 'past');
  await waitFor(() => expect(pastCalls()).toHaveLength(1));
  await fireEvent.press(r.getByTestId('calendar-tab-month'));
  await fireEvent.press(r.getByLabelText('Previous month'));
  await waitFor(() => expect(pastCalls().length).toBeGreaterThanOrEqual(2));
  expect(pastCalls()[1][1]).toMatchObject({ scope: 'past', before: page1[19].start_at, beforeId: page1[19].id });
});
