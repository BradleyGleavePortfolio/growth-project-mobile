/** Re-verdict controls: real root and query hooks; API transport only is mocked. */
import React from 'react';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { schedulingApi, type CoachingSession } from '../api/schedulingApi';
import { addDays, getLocalWeekStart, getTodayString } from '../utils/date';
import CalendarWeekRoot from '../screens/client/calendar/CalendarWeekScreen';

jest.mock('../api/schedulingApi', () => ({
  ...jest.requireActual('../api/schedulingApi'),
  schedulingApi: {
    listMySessions: jest.fn(), listMyCoaches: jest.fn(async () => []),
    listSessionTypes: jest.fn(async () => []),
  },
}));
jest.mock('../api/workoutBuilderApi', () => ({
  workoutBuilderApi: { listMyAssignments: jest.fn(async () => []) },
}));
jest.mock('../services/api', () => ({
  workoutApi: { getAll: jest.fn(async () => ({ data: [] })) },
  checkInsApi: { list: jest.fn(async () => ({ data: [] })) },
}));
jest.mock('../entitlements/withProtectedScreen', () => ({ withProtectedScreen: (c: unknown) => c }));
jest.mock('../components/coachless/JoinCoachState', () => ({ useClientNeedsCoach: () => false }));
jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
}));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../services/sentry', () => ({ captureError: jest.fn() }));
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

const uuid = (n: number) => `20000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`;
const session = (n: number, day: string): CoachingSession => ({
  id: uuid(n), coach_id: 'coach-fixture', client_id: 'member-fixture', session_type_id: null,
  status: 'completed', start_at: `${day}T17:00:00.000Z`, end_at: `${day}T17:30:00.000Z`,
  title: 'Review call', coach_notes_md: null, client_recap_md: null,
  video_provider: 'stub', video_url: null, video_meeting_id: null,
  calendar_provider: 'stub', calendar_event_id: null,
  approved_at: null, ended_at: null, end_reason: null,
  created_at: `${day}T09:00:00.000Z`, updated_at: `${day}T09:00:00.000Z`,
});
let qc: QueryClient;
afterEach(async () => { await cleanup(); qc?.clear(); jest.clearAllMocks(); });
async function root() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof CalendarWeekRoot>['navigation'];
  return render(<QueryClientProvider client={qc}>
    <CalendarWeekRoot navigation={navigation} route={{ key: 'scope-review', name: 'CalendarHome' }} />
  </QueryClientProvider>);
}

it.each([
  { day: '2026-05-01', offset: 2 },
  { day: '2026-05-01', offset: 0 },
  { day: '2026-05-15', offset: 2 },
  { day: '2026-05-31', offset: 2 },
])(
  'LS-917R5M control: an in-month session on $day is paged in with oldest offset $offset and never Rest day',
  async ({ day, offset }) => {
    const page = [
      ...Array.from({ length: 19 }, (_, n) => session(n, addDays('2026-11-03', -7 * n))),
      session(19, addDays(day, offset)),
    ];
    // A same-time next row must have a smaller UUID in the descending keyset.
    const older = session(offset === 0 ? -1 : 20, day);
    const requests: unknown[] = [];
    jest.mocked(schedulingApi.listMySessions).mockImplementation(async (_limit, opts) => {
      if (opts?.scope !== 'past') return [];
      requests.push(opts);
      if (!opts.before) return page;
      expect(opts.before).toBe(page[19].start_at);
      expect(opts.beforeId).toBe(page[19].id);
      return [older];
    });
    const view = await root();
    await waitFor(() => expect(requests).toHaveLength(1));
    await fireEvent.press(view.getByTestId('calendar-tab-month'));
    const today = getTodayString();
    const delta = (2026 - Number(today.slice(0, 4))) * 12 + 4 - (Number(today.slice(5, 7)) - 1);
    for (let n = 0; n < Math.abs(delta); n++) {
      await fireEvent.press(view.getByTestId(delta < 0 ? 'month-previous' : 'month-next'));
    }
    await waitFor(() => expect(requests).toHaveLength(2));
    await fireEvent.press(view.getByTestId(`month-day-${day}`));
    await waitFor(() => expect(view.getByTestId(`week-session-${older.id}`)).toBeTruthy());
    expect(within(view.getByTestId(`week-agenda-${day}`)).queryByText('Rest day')).toBeNull();
  },
);

it('LS-917R5M control: all seven Week days retain their sessions through Month and back', async () => {
  const monday = getLocalWeekStart();
  const rows = Array.from({ length: 7 }, (_, n) => session(n, addDays(monday, n)));
  jest.mocked(schedulingApi.listMySessions).mockImplementation(async (_limit, opts) =>
    opts?.scope === 'past' ? [] : rows,
  );
  const view = await root();
  await waitFor(() => expect(view.queryAllByTestId(/^week-session-/).length).toBeGreaterThan(0));
  await fireEvent.press(view.getByTestId('calendar-tab-month'));
  await fireEvent.press(view.getByTestId('calendar-tab-week'));
  for (const row of rows) {
    const day = row.start_at.slice(0, 10);
    await fireEvent.press(view.getByTestId(`week-day-${day}`));
    expect(view.getByTestId(`week-session-${row.id}`)).toBeTruthy();
    expect(within(view.getByTestId(`week-agenda-${day}`)).queryByText('Rest day')).toBeNull();
  }
});
