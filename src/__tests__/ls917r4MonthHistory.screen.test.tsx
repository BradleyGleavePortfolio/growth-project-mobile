/** LS-917R4 B3: the real Calendar root must not lose old saved workouts. */
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiWorkoutSession } from '../hooks/useApi';
import { workoutApi } from '../services/api';
import { addDays, getTodayString } from '../utils/date';
import CalendarWeekRoot, {
  CalendarWeekPage, monthStart, type CalendarWeekData,
} from '../screens/client/calendar/CalendarWeekScreen';

const mockOk = (data: unknown) => ({
  data, isPending: false, isError: false, isRefetching: false,
  fetchStatus: 'idle', refetch: jest.fn(),
});
jest.mock('../hooks/useCalendar', () => ({
  useMyCoaches: () => mockOk([]), useMySessions: () => mockOk([]),
  useBookableTypes: () => mockOk([]),
  usePastSessions: () => ({
    ...mockOk({ pages: [] }), hasNextPage: false,
    isFetchingNextPage: false, fetchNextPage: jest.fn(),
  }),
}));
jest.mock('../hooks/useWorkoutBuilder', () => ({ useMyWorkoutAssignments: () => mockOk([]) }));
// Deliberately do not mock useWorkouts or useQuery: exercise the real data path.
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

const today = getTodayString();
const oldMonth = monthStart(today, -6);
const oldDay = addDays(oldMonth, 4);
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
const latestId = uuid(0);
const olderId = uuid(100);
const log = (id: string, day: string, name: string): ApiWorkoutSession => ({
  id, user_id: 'member-fixture', date: day, workout_name: name,
  exercises: [], created_at: `${day}T12:00:00.000Z`,
});
// The server orders date/created_at descending and takes the requested limit.
// All 100 recent rows really are newer than row 101, not a fake cursor.
const history = [
  ...Array.from({ length: 100 }, (_, i) => log(uuid(i), addDays(today, -i), `Recent workout ${i}`)),
  log(olderId, oldDay, 'Earlier saved workout'),
];
const clients: QueryClient[] = [];
const root = async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(qc);
  const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof CalendarWeekRoot>['navigation'];
  const view = await render(<QueryClientProvider client={qc}>
    <CalendarWeekRoot navigation={navigation} route={{ key: 'fixture', name: 'CalendarHome' }} />
  </QueryClientProvider>);
  await waitFor(() => expect(view.getByTestId(`week-log-${latestId}`)).toBeTruthy());
  return view;
};
beforeEach(() => {
  jest.clearAllMocks();
  (workoutApi.getAll as jest.Mock).mockImplementation(async (limit = 10) => ({
    data: history.slice(0, limit),
  }));
});
afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

it('control: the real root and real useWorkouts render the newest saved workout', async () => {
  const view = await root();
  expect(view.getByText('Recent workout 0')).toBeTruthy();
  expect(workoutApi.getAll).toHaveBeenCalledWith(50);
});

it('control: the real Month presenter can show row 101 when its read supplies it', async () => {
  const data: CalendarWeekData = {
    coaches: [], sessions: [], workouts: [], checkIns: [], logs: history,
    loading: false, failed: false, refreshing: false, offline: false, hasData: true,
  };
  const view = await render(<CalendarWeekPage data={data} initialMonth={oldMonth}
    onRefresh={jest.fn()} onSession={jest.fn()} onBook={jest.fn()} />);
  await fireEvent.press(view.getByTestId(`month-day-${oldDay}`));
  expect(view.getByTestId(`week-log-${olderId}`)).toBeTruthy();
});

it('LS-917R4 B3: navigating to an earlier month keeps row 101 instead of calling its day a rest day', async () => {
  const view = await root();
  await fireEvent.press(view.getByTestId('calendar-tab-month'));
  for (let i = 0; i < 6; i++) await fireEvent.press(view.getByTestId('month-previous'));
  await fireEvent.press(view.getByTestId(`month-day-${oldDay}`));
  expect({
    savedWorkout: !!view.queryByTestId(`week-log-${olderId}`),
    restDay: !!view.queryByText('Rest day'),
  }).toEqual({ savedWorkout: true, restDay: false });
});
