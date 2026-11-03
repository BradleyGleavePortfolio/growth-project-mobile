/** Independent review: real Calendar root and infinite-query past-session reader. */
import React from 'react';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { schedulingApi, type CoachingSession } from '../api/schedulingApi';
import { addDays, getTodayString } from '../utils/date';
import CalendarWeekRoot, { monthGrid } from '../screens/client/calendar/CalendarWeekScreen';

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

const uuid = (n: number) => `10000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`;
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

it('LS-917R5 B2: Month reads past sessions through the visible leading grid days', async () => {
  // A normal history: roughly one session per ten days, with a page boundary
  // on Apr 29. May's visible grid begins Apr 27, before its first calendar day.
  const month = '2026-05-01';
  expect(monthGrid(month)[0]).toBe('2026-04-27');
  const page = [...Array.from({ length: 19 }, (_, n) => session(n, addDays('2026-11-03', -10 * n))),
    session(19, '2026-04-29')];
  const older = session(20, '2026-04-27');
  const pastCalls: unknown[] = [];
  jest.mocked(schedulingApi.listMySessions).mockImplementation(async (_limit, opts) => {
    if (opts?.scope !== 'past') return [];
    pastCalls.push(opts);
    if (!opts.before) return page;
    expect(opts.before).toBe(page[19].start_at);
    expect(opts.beforeId).toBe(page[19].id);
    return [older];
  });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof CalendarWeekRoot>['navigation'];
  const view = await render(<QueryClientProvider client={qc}>
    <CalendarWeekRoot navigation={navigation} route={{ key: 'grid-review', name: 'CalendarHome' }} />
  </QueryClientProvider>);
  await waitFor(() => expect(pastCalls).toHaveLength(1));
  await fireEvent.press(view.getByTestId('calendar-tab-month'));
  const today = getTodayString();
  const delta = (2026 - Number(today.slice(0, 4))) * 12 + 4 - (Number(today.slice(5, 7)) - 1);
  for (let n = 0; n < Math.abs(delta); n++) {
    await fireEvent.press(view.getByTestId(delta < 0 ? 'month-previous' : 'month-next'));
  }
  await fireEvent.press(view.getByTestId('month-day-2026-04-29'));
  expect(view.getByTestId(`week-session-${page[19].id}`)).toBeTruthy();
  await fireEvent.press(view.getByTestId('month-day-2026-04-27'));
  await waitFor(() => expect({
    pastRequests: pastCalls.length,
    sessionVisible: !!view.queryByTestId(`week-session-${older.id}`),
    falseRest: !!within(view.getByTestId('week-agenda-2026-04-27')).queryByText('Rest day'),
  }).toEqual({ pastRequests: 2, sessionVisible: true, falseRest: false }));
  expect(view.getByTestId(`week-session-${older.id}`)).toBeTruthy();
  expect(within(view.getByTestId('week-agenda-2026-04-27')).queryByText('Rest day')).toBeNull();
});
