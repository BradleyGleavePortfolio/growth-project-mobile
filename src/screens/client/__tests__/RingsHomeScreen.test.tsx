import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { getTodayString } from '../../../utils/date';

const mockNavigate = jest.fn();
const mockHistory = jest.fn();
const mockAssignments = jest.fn();
let mockRomanChat = true;
let mockRecovery: number | null = null;
let mockAsleep: number | null = null;
let mockCheckIn: unknown = null;
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
jest.mock('../../../hooks/useWearableSamples', () => ({ useWearableSamples: () => ({ data: undefined, refetch: jest.fn() }) }));
jest.mock('../../../hooks/useApi', () => ({
  ...jest.requireActual('../../../hooks/useApi'),
  useTodayCheckIn: () => ({ data: mockCheckIn, refetch: jest.fn() }),
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
  mockRomanChat = true; mockRecovery = null; mockAsleep = null; mockCheckIn = null;
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
