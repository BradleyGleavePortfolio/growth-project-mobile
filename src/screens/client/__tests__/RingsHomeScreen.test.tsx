import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { getTodayString } from '../../../utils/date';
import type { WearableSamplesResponse } from '../../../api/wearablesSamplesApi';

const mockNavigate = jest.fn();
const mockHistory = jest.fn();
const mockAssignments = jest.fn();
let mockRomanChat = true;
let mockSleepData: WearableSamplesResponse | undefined;
let mockCheckIn: unknown = null;
let mockSleepRead: 'ok' | 'failed' | 'pending' = 'ok';
let mockCheckInRead: 'ok' | 'failed' | 'pending' = 'ok';
const mockUser: { id: string; coach_id: string; profile: Record<string, unknown> } = { id: 'u1', coach_id: 'c1', profile: {} };
const mockDay = {
  foodLogs: [], dailyTotals: { calories: 1030 }, waterOz: 0, selectedDate: getTodayString(), hasLoadedDay: true,
  loadDayData: jest.fn(), loadProfile: jest.fn(), isLoading: false, loadError: null as string | null,
};
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: {
    ...jest.requireActual('../../../config/featureFlags').featureFlags,
    clientHomeRings: true,
    get romanChat() { return mockRomanChat; },
  },
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => ({ calories: 1850, protein: 150, carbs: 200, fat: 60 }) }));
jest.mock('../../../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 0 }));
jest.mock('../../../store/clientStore', () => ({ useClientStore: () => mockDay }));
jest.mock('../../../hooks/useWearableSamples', () => ({
  useWearableSamples: () => ({ data: mockSleepData, isSuccess: mockSleepRead === 'ok', isError: mockSleepRead === 'failed', refetch: jest.fn() }),
}));
jest.mock('../../../hooks/useApi', () => ({
  ...jest.requireActual('../../../hooks/useApi'),
  useTodayCheckIn: () => ({ data: mockCheckIn, isSuccess: mockCheckInRead === 'ok', isError: mockCheckInRead === 'failed', refetch: jest.fn() }),
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ entitlementActive: true, confirmedActive: true, status: 'active' }),
}));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]),
}));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: async (url: string) => ({ data: url.includes('unread') ? { total: 1 } : { name: 'Jordan Lee' } }) },
  workoutApi: { getAll: () => mockHistory() },
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

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.coach_id = 'c1'; mockUser.profile = { workout_days_per_week: 3 };
  mockRomanChat = true; mockSleepData = undefined; mockCheckIn = null; mockSleepRead = 'ok'; mockCheckInRead = 'ok';
  mockDay.loadError = null;
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

function sleepData(day: string): WearableSamplesResponse {
  const start_at = `${day}T00:00:00.000Z`;
  const end_at = `${day}T23:59:59.999Z`;
  return {
    version: 1, user_id: 'u1', bucket: 'SLEEP_RECOVERY', window: { from: start_at, to: end_at },
    freshness: { providers: [] },
    series: [
      { metric: 'READINESS_SCORE', unit: 'score', provider_used: 'OURA', sample_count: 1,
        samples: [{ start_at, end_at, value: 78, provider: 'OURA' }] },
      { metric: 'SLEEP_TOTAL_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1,
        samples: [{ start_at, end_at, value: 440, provider: 'OURA' }] },
    ],
  };
}

it('Sleep with last night shows recovered and asleep and opens Sleep and recovery', async () => {
  mockSleepData = sleepData(getTodayString());
  await render(<HomeScreen />);
  await fireEvent.press(await screen.findByLabelText('Sleep, 78% recovered, 7 h 20 m asleep'));
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'Health', initial: false, params: { bucket: 'recovery' } });
});

it('Sleep with only an older night shows the existing empty state, with a matching spoken label and route', async () => {
  mockSleepData = sleepData('2020-01-01');
  await render(<HomeScreen />);
  await fireEvent.press(await screen.findByLabelText('Sleep, Connect'));
  expect(screen.queryByText('78%')).toBeNull();
  expect(screen.queryByText('7 h 20 m asleep')).toBeNull();
  expect(screen.queryByTestId('home-dial-sleep-fill')).toBeNull();
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'Connections', initial: false });
});

it('Sleep retains the 130% font limits and two-line supporting layout', async () => {
  mockSleepData = sleepData(getTodayString());
  await render(<HomeScreen />);
  expect(await screen.findByLabelText('Sleep, 78% recovered, 7 h 20 m asleep')).toHaveStyle({ minHeight: 44, width: '33%' });
  expect(screen.getByText('78%').props.maxFontSizeMultiplier).toBe(1.3);
  expect(screen.getByText('recovered').props.maxFontSizeMultiplier).toBe(1.3);
  expect(screen.getByText('7 h 20 m asleep').props.numberOfLines).toBe(2);
});

it('Sleep falls back to the check-in, and with neither shows Connect, never "coming soon"', async () => {
  mockSleepData = sleepData('2020-01-01');
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
  mockSleepData = sleepData('2020-01-01');
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
  expect(screen.getByTestId('roman-locked-avatar')).toBeTruthy();
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
