import React from 'react';
import { StyleSheet } from 'react-native';
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
}));
jest.mock('../../../../ui/haptics/haptics.service', () => ({
  HapticService: { softImpact: jest.fn(), selection: jest.fn(), error: jest.fn() },
}));
import { schedulingApi } from '../../../../api/schedulingApi';
import { workoutBuilderApi } from '../../../../api/workoutBuilderApi';
import { checkInsApi } from '../../../../services/api';
import { entitlementEvents } from '../../../../entitlements/entitlementEvents';
import { COACHLESS_TITLE, COACH_MANAGED_TITLE } from '../../../../entitlements/PaywallSheet';
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
afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((q) => q.clear());
  jest.clearAllMocks();
  mockEntitled = true;
  mockCoachless = false;
});

it('every week day selects a real agenda; notification, booking and own workout routes are real', async () => {
  const r = await page();
  const start = getLocalWeekStart();
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(start, i);
    await fireEvent.press(r.getByTestId(`week-day-${day}`));
    expect(r.getByTestId(`week-agenda-${day}`)).toBeTruthy();
    expect(r.getByTestId(`week-day-${day}`).props.accessibilityState.selected).toBe(true);
  }
  await fireEvent.press(r.getByTestId(`week-day-${today}`));
  await fireEvent.press(r.getByTestId('week-workout-assignment-own'));
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'WorkoutAssignmentDetail', params: { assignmentId: 'assignment-own' }, initial: false });
  expect(r.getByText('Frozen plan')).toBeTruthy();
  expect(r.queryByText('Live plan')).toBeNull();
  await fireEvent.press(r.getByTestId('week-session-session-own'));
  expect(openSession).toHaveBeenCalledWith('session-own');
  await fireEvent.press(r.getByTestId('week-book'));
  expect(book).toHaveBeenCalledWith('coach-own');
  await fireEvent.press(r.getByTestId('week-notifications'));
  expect(mockNavigate).toHaveBeenCalledWith('Home', { screen: 'NotificationCenter', initial: false });
  await fireEvent.press(r.getByTestId('week-checkin-open'));
  expect(mockNavigate).toHaveBeenCalledWith('Home', { screen: 'Habits', params: { initialTab: 'checkin' }, initial: false });
});

it('next session opens real detail even if outside this week, without duplicating pages', async () => {
  const next = { ...session, session_type_id: 'type-own', start_at: `${addDays(today, 10)}T12:00:00`, end_at: `${addDays(today, 10)}T12:30:00` };
  const r = await page({ sessions: [next, next], descriptions: { 'type-own': 'The coach’s actual session description.' } });
  await fireEvent.press(r.getByTestId('week-next-session-own'));
  expect(openSession).toHaveBeenCalledWith('session-own');
  expect(r.getAllByTestId('week-next-session-own')).toHaveLength(1);
  expect(r.getByText('The coach’s actual session description.')).toBeTruthy();
});

it('the diary view supports workouts, saved check-ins, today entry and notifications without session rows', async () => {
  const r = await page({ coaches: [], sessions: [] });
  expect(r.getByTestId('week-workout-assignment-own')).toBeTruthy();
  expect(r.getByTestId(`week-checkin-${today}`)).toBeTruthy();
  expect(r.queryByTestId('week-book')).toBeNull();
  await fireEvent.press(r.getByTestId('week-checkin-open'));
  expect(mockNavigate).toHaveBeenCalled();
});

it.each(['loading', 'failed', 'offline'] as const)('%s never invents empty or rest states', async (key) => {
  const r = await page({ sessions: [], workouts: [], checkIns: [], [key]: true });
  expect(r.queryByTestId('week-empty')).toBeNull();
  expect(r.queryByText(c['C4-S-89'])).toBeNull();
  if (key === 'failed') {
    await fireEvent.press(r.getByTestId('week-retry'));
    expect(refresh).toHaveBeenCalledTimes(1);
  }
});

it('offline keeps loaded rows, disables booking and distinguishes a cold offline view', async () => {
  const r = await page({ offline: true });
  expect(r.getByText(c['C4S1-S-01'])).toBeTruthy();
  expect(r.getByTestId('week-workout-assignment-own')).toBeTruthy();
  await fireEvent.press(r.getByTestId('week-book'));
  expect(book).not.toHaveBeenCalled();
  await r.unmount();
  const cold = await page({ offline: true, hasData: false, sessions: [], workouts: [], checkIns: [] });
  expect(cold.getByText(c['C4S1-S-03'])).toBeTruthy();
});

it('successfully empty week is honest; completed rows say Done', async () => {
  const r = await page({ sessions: [], workouts: [], checkIns: [] });
  expect(r.getByTestId('week-empty')).toBeTruthy();
  await r.unmount();
  const done = await page({ workouts: [{ ...workout, completed_at: stamp }] });
  expect(within(done.getByTestId('week-workout-assignment-own')).getByText('Done')).toBeTruthy();
});

it.each<[string, Partial<CalendarWeekData>]>([
  ['loading', { loading: true, sessions: [], workouts: [], checkIns: [], hasData: false }],
  ['empty', { sessions: [], workouts: [], checkIns: [] }],
  ['error', { failed: true, sessions: [], workouts: [], checkIns: [] }],
  ['offline', { offline: true }],
  ['full', {}],
])('%s: the tan page is solid to the footer and stays opaque while a day tap inks in', async (_state, data) => {
  const r = await page(data);
  await fireEvent.press(r.getByTestId(`week-day-${addDays(getLocalWeekStart(), 6)}`));
  const style = StyleSheet.flatten(r.getByTestId('week-page').props.style);
  expect(style).toEqual(expect.objectContaining({ flexGrow: 1 }));
  expect(style.minHeight).toBeUndefined();
  expect(style.opacity).toBeUndefined();
});

it('an entitled client reads every signed-in-client list, including past sessions and appointment types', async () => {
  jest.mocked(schedulingApi.listMyCoaches).mockResolvedValue(base.coaches);
  jest.mocked(schedulingApi.listMySessions).mockResolvedValue([]);
  jest.mocked(schedulingApi.listSessionTypes).mockResolvedValue([]);
  jest.mocked(workoutBuilderApi.listMyAssignments).mockResolvedValue([workout]);
  jest.mocked(checkInsApi.list).mockResolvedValue({ data: [] } as Awaited<ReturnType<typeof checkInsApi.list>>);
  const r = await screen();
  await waitFor(() => expect(r.getByTestId('week-workout-assignment-own')).toBeTruthy());
  await waitFor(() => expect(schedulingApi.listSessionTypes).toHaveBeenCalledWith('coach-own'));
  expect(schedulingApi.listMyCoaches).toHaveBeenCalledWith();
  expect(workoutBuilderApi.listMyAssignments).toHaveBeenCalledWith();
  expect(checkInsApi.list).toHaveBeenCalledWith({ from: getLocalWeekStart(), to: addDays(getLocalWeekStart(), 6), limit: 7 });
  expect(schedulingApi.listMySessions).toHaveBeenCalledWith(50);
  expect(schedulingApi.listMySessions).toHaveBeenCalledWith(20, { scope: 'past', before: undefined, beforeId: undefined });
  expect(r.queryByTestId('week-error')).toBeNull();
});

it.each([
  ['coachless', true, COACHLESS_TITLE],
  ['unpaid', false, COACH_MANAGED_TITLE],
] as const)('%s clients see main’s access state without any 402 scheduling read or paywall event', async (_label, coachless, title) => {
  mockEntitled = false;
  mockCoachless = coachless;
  const emit = jest.spyOn(entitlementEvents, 'emitRequired');
  const denied = async () => {
    entitlementEvents.emitRequired({ status: 402, code: 'CLIENT_ENTITLEMENT_REQUIRED', message: 'Access required' });
    throw Object.assign(new Error('Access required'), { response: { status: 402 } });
  };
  jest.mocked(schedulingApi.listMyCoaches).mockImplementation(denied);
  jest.mocked(schedulingApi.listMySessions).mockImplementation(denied);
  jest.mocked(schedulingApi.listSessionTypes).mockImplementation(denied);
  const r = await screen();
  expect(r.getByText(title)).toBeTruthy();
  // Walk every scheduling read in the audit, including the dependent types read.
  for (const read of [
    () => expect(schedulingApi.listMyCoaches).not.toHaveBeenCalled(),
    () => expect(schedulingApi.listMySessions).not.toHaveBeenCalledWith(50),
    () => expect(schedulingApi.listMySessions).not.toHaveBeenCalledWith(20, { scope: 'past', before: undefined, beforeId: undefined }),
    () => expect(schedulingApi.listSessionTypes).not.toHaveBeenCalled(),
  ]) read();
  expect(schedulingApi.listMySessions).not.toHaveBeenCalled();
  expect(r.queryByTestId('week-error')).toBeNull();
  expect(r.queryByTestId('calendar-week')).toBeNull();
  expect(emit).not.toHaveBeenCalled();
  await fireEvent.press(r.getByTestId('protected-screen-message-coach'));
  expect(mockMessageCoach).toHaveBeenCalledTimes(1);
  expect(mockOpenPlans).not.toHaveBeenCalled();
  emit.mockRestore();
});
