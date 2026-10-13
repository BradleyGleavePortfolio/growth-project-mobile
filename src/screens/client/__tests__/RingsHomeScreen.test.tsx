import React from 'react';
import { act, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getTodayString } from '../../../utils/date';
import { shiftDay } from '../../../components/home/rings/homeTiles';

const mockNavigate = jest.fn();
const mockHistory = jest.fn();
const mockAssignments = jest.fn();
let mockRomanChat = true;
let mockRecovery: number | null = null;
let mockAsleep: number | null = null;
let mockCheckIn: unknown = null;
let mockFitness: unknown;
const mockInsights = jest.fn((): { data?: unknown } => ({ data: undefined }));
const WATER_NOT_SAVED = '8 oz of water was not saved. Check the connection, then add it again.';
const mockFasts = jest.fn(async (): Promise<{ data: unknown }> => ({ data: [] }));
const mockWeekly = jest.fn<Promise<{ data: unknown }>, [string]>(async () => ({ data: [] }));
const mockSessions = jest.fn(async (): Promise<unknown[]> => []);
let mockCalendar = true;
const mockFocusCallbacks = new Set<() => void>();
let mockSleepRead: 'ok' | 'failed' | 'pending' = 'ok';
let mockCheckInRead: 'ok' | 'failed' | 'pending' = 'ok';
const mockUser: { id: string; coach_id: string; profile: Record<string, unknown> } = { id: 'u1', coach_id: 'c1', profile: {} };
const mockDay = {
  foodLogs: [], dailyTotals: { calories: 1030, protein: 73, carbs: 100, fat: 38 }, waterOz: 48, selectedDate: getTodayString(),
  hasLoadedDay: true, loadDayData: jest.fn(), loadProfile: jest.fn(), isLoading: false, loadError: null as string | null,
  logWater: jest.fn(async () => undefined),
};
jest.mock('../../../config/featureFlags', () => {
  // A getter in the object literal would be read once by the spread helper; define it after.
  const flags = { ...jest.requireActual('../../../config/featureFlags').featureFlags, clientHomeRings: true };
  Object.defineProperty(flags, 'romanChat', { get: () => mockRomanChat });
  Object.defineProperty(flags, 'clientCalendar', { get: () => mockCalendar });
  return { featureFlags: flags };
});
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => ({ calories: 1850, protein: 150, carbs: 200, fat: 60 }) }));
jest.mock('../../../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 0 }));
jest.mock('../../../store/clientStore', () => ({ useClientStore: Object.assign(() => mockDay, { getState: () => mockDay }) }));
jest.mock('../../../hooks/useWearableSamples', () => ({
  useWearableSamples: (args: { bucket: string }) => (args.bucket === 'HEALTH_FITNESS'
    ? (mockFitness ? { data: mockFitness, isSuccess: true, refetch: jest.fn() } : { data: undefined, refetch: jest.fn() })
    : { data: undefined, isSuccess: mockSleepRead === 'ok', isError: mockSleepRead === 'failed', refetch: jest.fn() }),
}));
jest.mock('../../../hooks/useHolisticInsights', () => ({ useHolisticInsights: () => mockInsights() }));
const mockRead = (data: unknown) => ({ data, isSuccess: true, refetch: jest.fn() });
jest.mock('../../../hooks/useApi', () => ({
  ...jest.requireActual('../../../hooks/useApi'),
  useTodayCheckIn: () => ({ data: mockCheckIn, isSuccess: mockCheckInRead === 'ok', isError: mockCheckInRead === 'failed', refetch: jest.fn() }),
  useWeightHistory: () => mockRead({ logs: [
    { id: 'w1', weight_lbs: 169.6, date: '2026-09-14T00:00:00.000Z' },
    { id: 'w2', weight_lbs: 168.4, date: '2026-10-12T00:00:00.000Z' },
  ] }),
  useHabits: () => mockRead([{ id: 'h1', name: 'Water' }, { id: 'h2', name: 'Steps' }, { id: 'h3', name: 'Stretch' }]),
  useHabitLogs: () => mockRead([{ habit_id: 'h1', completed: true }, { habit_id: 'h2', completed: true }]),
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ entitlementActive: true, confirmedActive: true, status: 'active' }),
}));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../wearables/recoveryData', () => ({
  DEFAULT_SLEEP_NEED_MIN: 480,
  recoveryScore: () => mockRecovery,
  sleepDeficit: () => (mockAsleep === null ? null : { asleepMinutes: mockAsleep }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => {
    mockFocusCallbacks.add(cb);
    return jest.requireActual('react').useEffect(cb, [cb]);
  },
}));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: async (url: string) => ({ data: url.includes('unread') ? { total: 1 } : { name: 'Jordan Lee' } }) },
  workoutApi: { getAll: () => mockHistory() },
  fastingApi: { getHistory: () => mockFasts() },
  logApi: { getWeekly: (start: string) => mockWeekly(start) },
}));
jest.mock('../../../api/schedulingApi', () => ({
  ...jest.requireActual('../../../api/schedulingApi'),
  schedulingApi: { listMySessions: () => mockSessions() },
}));
jest.mock('../../../api/workoutBuilderApi', () => ({ workoutBuilderApi: { listMyAssignments: () => mockAssignments() } }));
jest.mock('../../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: async () => null }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
jest.mock('../../../components/coachless/CoachlessHomeSlot', () => ({
  __esModule: true,
  default: ({ part }: { part: string }) => require('react').createElement(require('react-native').Text, null, `coachless-slot-${part}`),
}));
// Today's Home sections (not rendered while the flag is on).
jest.mock('../../../entitlements/dunning/DunningBanner', () => ({ DunningBanner: () => null }));
jest.mock('../../../components/home/HolisticInsightsTile', () => () => null);
jest.mock('../../../components/home/PushPermissionCard', () => () => null);
jest.mock('../../../components/home/CoachIntroductionBanner', () => () => null);
jest.mock('../../../components/home/FullMacrosIntroCard', () => () => null);
jest.mock('../../../components/tutorial/TutorialHomeSlot', () => () => null);
jest.mock('../../../components/PendingInviteBanner', () => () => null);
jest.mock('../../../components/join/FinishJoining', () => () => null);
import HomeScreen from '../HomeScreen';
import { HapticService } from '../../../ui/haptics/haptics.service';

const { start: weekStart } = require('../../../components/home/rings/homeRings').weekBounds(new Date());

/** Each render gets its own query cache (the tiles' fasting, session and logging reads). */
function render(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(ui, {
    wrapper: function Queries({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.coach_id = 'c1'; mockUser.profile = { workout_days_per_week: 3 };
  mockRomanChat = true; mockRecovery = null; mockAsleep = null; mockCheckIn = null; mockFitness = undefined;
  mockSleepRead = 'ok'; mockCheckInRead = 'ok'; mockCalendar = true;
  mockFocusCallbacks.clear();
  mockFasts.mockResolvedValue({ data: [] });
  mockWeekly.mockResolvedValue({ data: [] });
  mockSessions.mockResolvedValue([]);
  mockDay.loadError = null;
  mockInsights.mockReturnValue({ data: undefined });
  mockHistory.mockResolvedValue({ data: [] });
  mockAssignments.mockResolvedValue([
    { id: 'a1', scheduled_for: weekStart, completed_at: 'done', workout_plan: { name: 'Lower A' } },
    { id: 'a2', scheduled_for: weekStart, completed_at: null, workout_plan: { name: 'Full Body A' } },
  ]);
});

it('the flag is off in every eas.json profile, so merging changes nothing for users', () => {
  const eas = require('../../../../eas.json') as { build: Record<string, { env?: Record<string, string> }> };
  for (const [name, profile] of Object.entries(eas.build)) {
    expect([name, profile.env?.EXPO_PUBLIC_FF_CLIENT_HOME_RINGS]).toEqual([name, 'false']);
  }
  expect(jest.requireActual('../../../config/featureFlags').featureFlags.clientHomeRings).toBe(false);
});

it('coached: three dials with their own numbers and one forest button', async () => {
  await render(<HomeScreen />);
  expect(await screen.findByLabelText('Start Full Body A')).toBeTruthy();
  expect(screen.getByText('Message Jordan')).toBeTruthy();
  expect(screen.getByLabelText('Food, 820 kcal left, 1,030 of 1,850')).toBeTruthy();
  expect(screen.getByLabelText('Train, 1 of 2 workouts, This week')).toBeTruthy();
  expect(screen.queryByText('Opens with a coach')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Start Full Body A'));
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', {
    screen: 'WorkoutAssignmentDetail', initial: false, params: { assignmentId: 'a2' },
  });
});

it.each([
  ['home-dial-food', ['Log']],
  ['home-dial-train', ['WorkoutTab']],
  ['home-dial-sleep', ['MoreTab', { screen: 'Connections', initial: false }]],
] as const)('%s opens a real screen, with a light haptic', async (testID, destination) => {
  await render(<HomeScreen />);
  await screen.findByLabelText('Start Full Body A');
  await fireEvent.press(screen.getByTestId(testID));
  expect(mockNavigate).toHaveBeenCalledWith(...destination);
  expect(HapticService.selection).toHaveBeenCalledTimes(1);
});

it('Sleep with Health data shows recovered and asleep and opens Sleep and recovery', async () => {
  mockRecovery = 78; mockAsleep = 440;
  await render(<HomeScreen />);
  await fireEvent.press(await screen.findByLabelText('Sleep, 78% recovered, 7 h 20 m asleep'));
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'Health', initial: false, params: { bucket: 'recovery' } });
});

it('Sleep falls back to the check-in, and with neither shows Connect, never "coming soon"', async () => {
  mockCheckIn = { sleep_hours: 7.5 };
  const view = await render(<HomeScreen />);
  expect(await screen.findByLabelText('Sleep, 7.5 h asleep')).toBeTruthy();
  mockCheckIn = null;
  await view.rerender(<HomeScreen />);
  expect(await screen.findByLabelText('Sleep, Connect')).toBeTruthy();
  expect(screen.queryByText(/coming soon/i)).toBeNull();
});

it.each([
  ['loading', 'pending', 'ok'],
  ['failed', 'failed', 'ok'],
  ['check-in loading', 'ok', 'pending'],
  ['check-in failed', 'ok', 'failed'],
] as const)('Sleep while its read is %s shows "—", never Connect, and opens Sleep and recovery', async (_, sleepRead, checkInRead) => {
  mockSleepRead = sleepRead; mockCheckInRead = checkInRead;
  await render(<HomeScreen />);
  await fireEvent.press(await screen.findByLabelText('Sleep, —'));
  expect(screen.queryByText('Connect')).toBeNull();
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'Health', initial: false, params: { bucket: 'recovery' } });
});

it('Sleep keeps a verified check-in when the Health read failed', async () => {
  mockSleepRead = 'failed'; mockCheckIn = { sleep_hours: 6.5 };
  await render(<HomeScreen />);
  await fireEvent.press(await screen.findByLabelText('Sleep, 6.5 h asleep'));
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'Health', initial: false, params: { bucket: 'recovery' } });
});

it.each([
  ['history', () => mockHistory.mockRejectedValue(new Error('offline'))],
  ['assignments', () => mockAssignments.mockRejectedValue(new Error('offline'))],
] as const)('Train shows "—", not a count, when the %s read failed', async (_, fail) => {
  mockAssignments.mockResolvedValue([]);
  mockHistory.mockResolvedValue({ data: [{ date: weekStart }] });
  fail();
  await render(<HomeScreen />);
  expect(await screen.findByLabelText('Train, — workouts, This week')).toBeTruthy();
});

it('coachless: Roman shown locked in the header, never opens Roman, Join a coach under the dials', async () => {
  mockUser.coach_id = '';
  mockAssignments.mockResolvedValue([]);
  mockHistory.mockResolvedValue({ data: [{ date: weekStart }] });
  await render(<HomeScreen />);
  expect(await screen.findByLabelText('Open Train')).toBeTruthy();
  expect(screen.getByLabelText('Roman. Opens with a coach')).toBeTruthy();
  expect(screen.getByText('coachless-slot-join')).toBeTruthy();
  expect(screen.getByLabelText('Train, 1 of 3 workouts, This week')).toBeTruthy();
  expect(screen.queryByText('Ask Roman')).toBeNull();
  expect(screen.queryByLabelText('Chat with Roman')).toBeNull();
  expect(screen.queryByText(/^Message /)).toBeNull();
  expect(screen.getAllByTestId('roman-locked-avatar')).toHaveLength(2); // header and Roman's line
  await fireEvent.press(screen.getByLabelText('Roman. Opens with a coach'));
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('a failed day read shows the quiet error with Try again and dashes, not zero totals', async () => {
  mockDay.loadError = 'Today could not load. Try again.';
  await render(<HomeScreen />);
  expect(await screen.findByText('Today could not load. Try again.')).toBeTruthy();
  expect(screen.getByLabelText('Food, — kcal left')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('home-day-data-error-retry'));
  expect(mockDay.loadDayData).toHaveBeenCalledTimes(2); // on mount, then Try again
  expect(mockDay.loadDayData).toHaveBeenLastCalledWith('u1', getTodayString());
});

it('tiles show the real numbers: protein with carbs and fat, water to the Food log goal, weight, habits, check-in', async () => {
  mockCheckIn = { mood: 4, energy: 3, sleep_hours: 7.5 };
  await render(<HomeScreen />);
  expect(await screen.findByLabelText('Water, 48 of 100 oz')).toBeTruthy();
  expect(screen.getByLabelText('Protein, 73 g of 150, Carbs 100 g, Fat 38 g')).toBeTruthy();
  expect(screen.getByLabelText('Weight, 168.4 lb, Down 1.2 lb in 30 days')).toBeTruthy();
  expect(screen.getByTestId('home-tile-weight-trend')).toBeTruthy();
  expect(screen.getByLabelText('Habits, 2 of 3, Water and Steps done. Stretch open.')).toBeTruthy();
  expect(screen.getByLabelText('Check-in, Good, Energy normal, slept 7.5 h')).toBeTruthy();
});

it.each([
  ['home-tile-protein', ['Log']],
  ['home-tile-water', ['Log']],
  ['home-tile-weight', ['MoreTab', { screen: 'Progress', initial: false }]],
  ['home-tile-habits', ['Habits']],
  ['home-tile-checkin', ['Habits']],
] as const)('%s opens a real screen, with a light haptic', async (testID, destination) => {
  await render(<HomeScreen />);
  await screen.findByLabelText('Start Full Body A');
  await fireEvent.press(screen.getByTestId(testID));
  expect(mockNavigate).toHaveBeenCalledWith(...destination);
  expect(HapticService.selection).toHaveBeenCalledTimes(1);
});

it('Steps: "—" while Health loads, Connect without Health (connected devices), steps today (Health and fitness)', async () => {
  const view = await render(<HomeScreen />);
  await fireEvent.press(await screen.findByLabelText('Steps, —'));
  expect(mockNavigate).toHaveBeenLastCalledWith('MoreTab', { screen: 'Health', initial: false, params: { bucket: 'fitness' } });
  mockFitness = { series: [], freshness: { providers: [] } };
  await view.rerender(<HomeScreen />);
  await fireEvent.press(await screen.findByLabelText('Steps, Connect'));
  expect(mockNavigate).toHaveBeenLastCalledWith('MoreTab', { screen: 'Connections', initial: false });
  mockFitness = {
    series: [{ metric: 'STEPS', provider_used: 'APPLE_HEALTHKIT', samples: [],
      buckets: [{ bucket_start: `${getTodayString()}T00:00:00.000Z`, agg: 6412 }] }],
    freshness: { providers: [{ provider: 'APPLE_HEALTHKIT' }] },
  };
  await view.rerender(<HomeScreen />);
  await fireEvent.press(await screen.findByLabelText('Steps, 6,412, Of 5,000, Apple Health'));
  expect(mockNavigate).toHaveBeenLastCalledWith('MoreTab', { screen: 'Health', initial: false, params: { bucket: 'fitness' } });
});

it('the water chip adds 8 oz with a success haptic, and an error haptic when it was not saved', async () => {
  await render(<HomeScreen />);
  await screen.findByLabelText('Water, 48 of 100 oz');
  await fireEvent.press(screen.getByLabelText('Add 8 ounces of water'));
  expect(mockDay.logWater).toHaveBeenCalledWith('u1', '', 8);
  await waitFor(() => expect(HapticService.success).toHaveBeenCalledTimes(1));
  expect(mockNavigate).not.toHaveBeenCalled();
  mockDay.logWater.mockImplementationOnce(async () => { mockDay.loadError = WATER_NOT_SAVED; });
  await fireEvent.press(screen.getByLabelText('Add 8 ounces of water'));
  await waitFor(() => expect(HapticService.error).toHaveBeenCalledTimes(1));
});

it("coached: Roman's line is the existing insight sentence, Ask Roman opens Roman, no header avatar", async () => {
  mockInsights.mockReturnValue({ data: { status: 'ok', insights: [{ text: 'Your protein held steady this week.' }] } });
  await render(<HomeScreen />);
  expect(await screen.findByText('Your protein held steady this week.')).toBeTruthy();
  expect(screen.queryByTestId('home-roman-avatar')).toBeNull();
  await fireEvent.press(screen.getByText('Ask Roman'));
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'RomanChat', initial: false });
});

it("coached with Roman chat off and no sentence: no Roman's line", async () => {
  mockRomanChat = false;
  await render(<HomeScreen />);
  await screen.findByLabelText('Start Full Body A');
  expect(screen.queryByTestId('home-roman-line')).toBeNull();
});

it("coachless: Roman's line is locked, makes no insights read and is not a control", async () => {
  mockUser.coach_id = '';
  await render(<HomeScreen />);
  const locked = await screen.findByLabelText("Roman works with a coach. Roman reads your rings with a coach's guidance. Your own logging stays open.");
  expect(mockInsights).not.toHaveBeenCalled();
  await fireEvent.press(locked);
  expect(mockNavigate).not.toHaveBeenCalled();
});

const MIN = 60000;

it('Fasting: the last fast\'s length ("Last fast."), a running fast\'s time so far, and it opens Fasting', async () => {
  const end = Date.now() - 60 * MIN;
  mockFasts.mockResolvedValue({ data: [
    { start_time: new Date(end - 30 * 60 * MIN).toISOString(), end_time: new Date(end - 20 * 60 * MIN).toISOString() },
    { start_time: new Date(end - (16 * 60 + 5) * MIN).toISOString(), end_time: new Date(end).toISOString() },
  ] });
  const view = await render(<HomeScreen />);
  await fireEvent.press(await screen.findByLabelText('Fasting, 16 h 5 m, Last fast.'));
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'Fast', initial: false });
  view.unmount();
  mockFasts.mockResolvedValue({ data: [{ start_time: new Date(Date.now() - 90 * MIN).toISOString(), end_time: null }] });
  await render(<HomeScreen />);
  expect(await screen.findByLabelText('Fasting, 1 h 30 m')).toBeTruthy();
});

it('tiles read again when Home is focused again, so a fast ended elsewhere shows on return', async () => {
  await render(<HomeScreen />);
  expect(await screen.findByLabelText('Fasting, —')).toBeTruthy();
  expect(mockFasts).toHaveBeenCalledTimes(1);
  mockFasts.mockResolvedValue({ data: [{ startTime: new Date(Date.now() - 10 * 60 * MIN).toISOString(), endTime: new Date().toISOString() }] });
  await act(async () => { mockFocusCallbacks.forEach((cb) => cb()); });
  expect(await screen.findByLabelText('Fasting, 10 h, Last fast.')).toBeTruthy();
});

it('coached: Next session is the earliest scheduled session ahead and opens it; none opens Calendar', async () => {
  const at = new Date(Date.now() + 24 * 60 * MIN);
  at.setHours(9, 0, 0, 0);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][at.getDay()];
  mockSessions.mockResolvedValue([
    { id: 's3', status: 'scheduled', start_at: new Date(at.getTime() + 2 * 24 * 60 * MIN).toISOString(), title: 'Later call' },
    { id: 's1', status: 'scheduled', start_at: at.toISOString(), title: 'Check-in call with Jordan' },
    { id: 's0', status: 'canceled', start_at: new Date(Date.now() + 60 * MIN).toISOString(), title: 'Canceled call' },
  ]);
  const view = await render(<HomeScreen />);
  await fireEvent.press(await screen.findByLabelText(`Next session, ${day} 9:00 am, Check-in call with Jordan`));
  expect(mockNavigate).toHaveBeenCalledWith('CalendarTab', { screen: 'CalendarSession', initial: false, params: { sessionId: 's1' } });
  expect(screen.queryByTestId('home-tile-logging')).toBeNull();
  view.unmount();
  mockSessions.mockResolvedValue([]);
  await render(<HomeScreen />);
  await waitFor(() => expect(mockSessions).toHaveBeenCalledTimes(2));
  await fireEvent.press(await screen.findByLabelText('Next session, —'));
  expect(mockNavigate).toHaveBeenLastCalledWith('CalendarTab', { screen: 'CalendarHome' });
});

it('coachless: Logging counts the days in a row with food logged (two weekly reads) and opens the Food log', async () => {
  mockUser.coach_id = '';
  const today = getTodayString();
  mockWeekly.mockResolvedValue({ data: [today, shiftDay(today, -1), shiftDay(today, -2), shiftDay(today, -4)].map((date) => ({ date, calories: 900 })) });
  await render(<HomeScreen />);
  await fireEvent.press(await screen.findByLabelText('Logging, 3 days in a row, Food logged each day'));
  expect(mockNavigate).toHaveBeenCalledWith('Log');
  expect(mockWeekly.mock.calls.map(([start]) => start).sort()).toEqual([shiftDay(today, -13), shiftDay(today, -6)].sort());
  expect(screen.queryByTestId('home-tile-session')).toBeNull();
  expect(mockSessions).not.toHaveBeenCalled();
});

it('coached with the Calendar tab off: Logging instead of a Next session that could not open', async () => {
  mockCalendar = false;
  await render(<HomeScreen />);
  expect(await screen.findByLabelText('Logging, 0 days in a row')).toBeTruthy();
  expect(screen.queryByTestId('home-tile-session')).toBeNull();
  expect(mockSessions).not.toHaveBeenCalled();
});
