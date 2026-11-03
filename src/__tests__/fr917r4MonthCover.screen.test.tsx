/**
 * FR-917R4 own tests (B3, B4 edges), real root, real hooks and real queries:
 * - Week: a day older than the rows read waits for the larger read, never Rest day.
 * - A failed covering read shows the error with Try again, never Rest day; Try again finishes it.
 * - A failed Month page stops; Try again pages on and the older session shows.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CoachingSession } from '../api/schedulingApi';
import { schedulingApi } from '../api/schedulingApi';
import type { ApiWorkoutSession } from '../hooks/useApi';
import { workoutApi } from '../services/api';
import { addDays, bucketDateLocal, getLocalWeekStart, getTodayString } from '../utils/date';
import CalendarWeekRoot, { monthStart } from '../screens/client/calendar/CalendarWeekScreen';

jest.mock('../api/schedulingApi', () => ({
  ...jest.requireActual('../api/schedulingApi'),
  schedulingApi: {
    listMySessions: jest.fn(async () => []), listMyCoaches: jest.fn(async () => []),
    listSessionTypes: jest.fn(async () => []),
  },
}));
jest.mock('../api/workoutBuilderApi', () => ({
  workoutBuilderApi: { listMyAssignments: jest.fn(async () => []) },
}));
jest.mock('../services/api', () => ({
  workoutApi: { getAll: jest.fn() },
  checkInsApi: { list: jest.fn(async () => ({ data: [] })) },
}));
jest.mock('../entitlements/withProtectedScreen', () => ({ withProtectedScreen: (component: unknown) => component }));
jest.mock('../components/coachless/JoinCoachState', () => ({ useClientNeedsCoach: () => false }));
jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
}));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), error: jest.fn(), softImpact: jest.fn() },
}));
// The loading state and Try again are real elements here, so the tests can see and press them.
jest.mock('../ui/states/QuietStates', () => {
  const { Text } = jest.requireActual('react-native');
  return { QuietLoading: ({ label, testID }: { label: string; testID?: string }) => <Text testID={testID}>{label}</Text> };
});
jest.mock('../ui', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    Screen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    PrimaryButton: () => null,
    TextLink: ({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) =>
      <Text accessibilityRole="button" onPress={onPress} testID={testID}>{label}</Text>,
  };
});
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

const today = getTodayString();
const weekStart = getLocalWeekStart();
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
const log = (id: string, day: string, name: string): ApiWorkoutSession => ({
  id, user_id: 'member-fixture', date: day, workout_name: name,
  exercises: [], created_at: `${day}T12:00:00.000Z`,
});
const ERROR = 'Calendar could not load. Check the connection, then try again.';
const clients: QueryClient[] = [];
async function root() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof CalendarWeekRoot>['navigation'];
  return render(<QueryClientProvider client={client}>
    <CalendarWeekRoot navigation={navigation} route={{ key: 'fixture', name: 'CalendarHome' }} />
  </QueryClientProvider>);
}
const limits = () => jest.mocked(workoutApi.getAll).mock.calls.map(([limit]) => limit);
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
beforeEach(() => { jest.clearAllMocks(); });
afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('FR-917R4 B3 edges: saved workouts cover every day shown', () => {
  it('Week: 50 rows from today leave this week\'s first day unread; it loads, never Rest day, then shows its workout', async () => {
    // 50 workouts today (the server's newest 50), one more on the week's first day.
    const history = [
      ...Array.from({ length: 50 }, (_, i) => log(uuid(i), today, `Today workout ${i}`)),
      log(uuid(50), weekStart, 'First day workout'),
    ];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    jest.mocked(workoutApi.getAll).mockImplementation(async (limit = 10) => {
      if (limit > 50) await gate;
      return { data: history.slice(0, limit) } as never;
    });
    const view = await root();
    await waitFor(() => expect(view.getByTestId(`week-log-${uuid(0)}`)).toBeTruthy());
    await waitFor(() => expect(limits()).toEqual([50, 100]));
    // The larger read is in flight: every day on or before the oldest row read is loading, not a rest day.
    if (weekStart < today) {
      await fireEvent.press(view.getByTestId(`week-day-${weekStart}`));
      expect(view.queryByText('Rest day')).toBeNull();
    }
    expect(view.getByTestId('week-loading')).toBeTruthy();
    await act(async () => { release(); });
    await waitFor(() => expect(view.getByTestId(`week-log-${uuid(50)}`)).toBeTruthy());
    expect(view.queryByTestId('week-loading')).toBeNull();
    // 51 rows < 100 asked: every saved workout is read; no further request.
    await settle();
    expect(limits()).toEqual([50, 100]);
  });

  it('a failed covering read shows the error with Try again, never Rest day; Try again finishes the cover', async () => {
    const oldMonth = monthStart(today, -6);
    const oldDay = addDays(oldMonth, 4);
    const history = [
      ...Array.from({ length: 100 }, (_, i) => log(uuid(i), addDays(today, -i), `Recent workout ${i}`)),
      log(uuid(100), oldDay, 'Earlier saved workout'),
    ];
    let failing = true;
    jest.mocked(workoutApi.getAll).mockImplementation(async (limit = 10) => {
      if (limit > 50 && failing) throw new Error('fixture: gateway unavailable');
      return { data: history.slice(0, limit) } as never;
    });
    const view = await root();
    await waitFor(() => expect(view.getByTestId(`week-log-${uuid(0)}`)).toBeTruthy());
    await fireEvent.press(view.getByTestId('calendar-tab-month'));
    for (let i = 0; i < 6; i++) await fireEvent.press(view.getByTestId('month-previous'));
    await view.findByText(ERROR);
    await fireEvent.press(view.getByTestId(`month-day-${oldDay}`));
    expect(view.getByTestId('week-retry')).toBeTruthy();
    expect(view.queryByText('Rest day')).toBeNull();
    // A failed read is not retried by the effect: one failed larger request only.
    await settle();
    expect(limits().filter((limit) => limit > 50)).toEqual([100]);
    failing = false;
    await fireEvent.press(view.getByTestId('week-retry'));
    await waitFor(() => expect(view.getByTestId(`week-log-${uuid(100)}`)).toBeTruthy());
    expect(view.queryByText(ERROR)).toBeNull();
    expect(view.queryByText('Rest day')).toBeNull();
    // The same GET /workouts with a larger limit: no new endpoint, cursor or date filter.
    expect(jest.mocked(workoutApi.getAll).mock.calls.every((args) => args.length === 1)).toBe(true);
  });
});

describe('FR-917R4 B4 edge: a failed Month page resumes on Try again', () => {
  const session = (id: string, day: string): CoachingSession => ({
    id, coach_id: 'coach-fixture', client_id: 'member-fixture', session_type_id: null,
    status: 'completed', start_at: `${day}T17:00:00.000Z`, end_at: `${day}T17:30:00.000Z`,
    title: 'Weekly call', coach_notes_md: null, client_recap_md: null,
    video_provider: 'stub', video_url: null, video_meeting_id: null,
    calendar_provider: 'stub', calendar_event_id: null, approved_at: null,
    ended_at: null, end_reason: null, created_at: `${day}T09:00:00.000Z`,
    updated_at: `${day}T09:00:00.000Z`,
  });
  it('the next page fails once, waits, then pages on after Try again and stops at the real end', async () => {
    const firstPage = Array.from({ length: 20 }, (_, i) => session(uuid(i), addDays(today, -7 * i)));
    const older = session(uuid(20), addDays(today, -7 * 20));
    let nextCalls = 0;
    jest.mocked(workoutApi.getAll).mockImplementation(async () => ({ data: [] }) as never);
    jest.mocked(schedulingApi.listMySessions).mockImplementation(async (_limit, options) => {
      if (options?.scope !== 'past') return [];
      if (!options.before) return firstPage;
      nextCalls += 1;
      if (nextCalls === 1) throw new Error('fixture: gateway unavailable');
      return [older];
    });
    const view = await root();
    await waitFor(() => expect(jest.mocked(schedulingApi.listMySessions).mock.calls
      .some(([, options]) => options?.scope === 'past')).toBe(true));
    await fireEvent.press(view.getByTestId('calendar-tab-month'));
    for (let i = 0; i < 5; i++) await fireEvent.press(view.getByTestId('month-previous'));
    await view.findByText(ERROR);
    await settle();
    expect(nextCalls).toBe(1);
    await fireEvent.press(view.getByTestId('week-retry'));
    await waitFor(() => expect(nextCalls).toBe(2));
    await waitFor(() => expect(view.queryByText(ERROR)).toBeNull());
    // The paged-in session is on the screen's data: its day (in or next to the month shown) lists it.
    const olderCell = view.queryByTestId(`month-day-${bucketDateLocal(new Date(older.start_at))}`);
    if (olderCell) {
      await fireEvent.press(olderCell);
      expect(view.getByTestId(`week-session-${older.id}`)).toBeTruthy();
    }
    await settle();
    // One page of one row is the server's end: no request cap is needed to stop.
    expect(nextCalls).toBe(2);
  });
});
