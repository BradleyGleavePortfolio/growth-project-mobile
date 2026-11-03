/** LS-917R4 B4: a failed Month cursor waits for Retry, rather than re-entering the fetch effect. */
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CoachingSession } from '../api/schedulingApi';
import { schedulingApi } from '../api/schedulingApi';
import { addDays, getTodayString } from '../utils/date';
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
// The real usePastSessions/useInfiniteQuery and the real root effect are not mocked.
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
const session = (id: string, day: string): CoachingSession => ({
  id, coach_id: 'coach-fixture', client_id: 'member-fixture', session_type_id: null,
  status: 'completed', start_at: `${day}T17:00:00.000Z`, end_at: `${day}T17:30:00.000Z`,
  title: 'Weekly call', coach_notes_md: null, client_recap_md: null,
  video_provider: 'stub', video_url: null, video_meeting_id: null,
  calendar_provider: 'stub', calendar_event_id: null, approved_at: null,
  ended_at: null, end_reason: null, created_at: `${day}T09:00:00.000Z`,
  updated_at: `${day}T09:00:00.000Z`,
});
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
const firstPage = Array.from({ length: 20 }, (_, i) => session(uuid(i), addDays(today, -7 * i)));
const older = session(uuid(20), addDays(today, -7 * 20));
const clients: QueryClient[] = [];
let mockFail = false;
let mockNextCalls = 0;

function expectRealStableCursor() {
  const requests = jest.mocked(schedulingApi.listMySessions).mock.calls
    .filter(([, options]) => !!options?.before).map(([, options]) => options);
  expect(requests).toEqual(Array.from({ length: mockNextCalls }, () => ({
    scope: 'past', before: firstPage[19].start_at, beforeId: firstPage[19].id,
  })));
}

beforeEach(() => {
  jest.clearAllMocks(); mockFail = false; mockNextCalls = 0;
  jest.mocked(schedulingApi.listMySessions).mockImplementation(async (_limit, options) => {
    if (options?.scope !== 'past') return [];
    if (!options.before) return firstPage;
    mockNextCalls += 1;
    if (!mockFail) return [older];
    // A test-only fuse bounds a broken effect; it is not a successful or exhausted server page.
    if (mockNextCalls >= 4) return new Promise<CoachingSession[]>(() => undefined);
    throw new Error('fixture: gateway unavailable');
  });
});
afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((client) => client.clear());
});
async function openEarlierMonth() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof CalendarWeekRoot>['navigation'];
  const view = await render(<QueryClientProvider client={client}>
    <CalendarWeekRoot navigation={navigation} route={{ key: 'fixture', name: 'CalendarHome' }} />
  </QueryClientProvider>);
  await waitFor(() => expect(jest.mocked(schedulingApi.listMySessions).mock.calls
    .some(([, options]) => options?.scope === 'past')).toBe(true));
  await fireEvent.press(view.getByTestId('calendar-tab-month'));
  // Twenty weekly calls cover about five months; the earlier month's first day needs another page.
  for (let i = 0; i < 5; i++) await fireEvent.press(view.getByTestId('month-previous'));
  return view;
}

it('control: a successful next page is consumed once and its real exhaustion stops paging', async () => {
  await openEarlierMonth();
  await waitFor(() => expect(mockNextCalls).toBe(1));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  expectRealStableCursor();
  expect(mockNextCalls).toBe(1);
});

it('LS-917R4 B4: a failed Month cursor stops automatic sends and waits for an explicit retry', async () => {
  mockFail = true;
  const view = await openEarlierMonth();
  await view.findByText('Calendar could not load. Check the connection, then try again.');
  // Allow notification/effect turns, not a query retry: retry is explicitly disabled above.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  expectRealStableCursor();
  expect(mockNextCalls).toBe(1);
});
