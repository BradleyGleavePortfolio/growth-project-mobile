import React from 'react';
import { RefreshControl } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { getTodayString } from '../../../utils/date';
const mockNavigate = jest.fn();
const mockHistory = jest.fn();
const mockAssignments = jest.fn();
const mockActive = jest.fn();
const mockUser = { id: 'u1', coach_id: 'c1', profile: {} };
const mockDay = { foodLogs: [{ mealType: 'lunch' }], dailyTotals: {}, waterOz: 24,
  loadDayData: jest.fn(), loadProfile: jest.fn(), isLoading: false, loadError: null };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 0 }));
jest.mock('../../../store/clientStore', () => ({ useClientStore: () => mockDay }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]),
}));
jest.mock('../../../services/api', () => ({
  __esModule: true, default: { get: async () => ({ data: { name: 'Bradley' } }) },
  workoutApi: { getAll: () => mockHistory() },
}));
jest.mock('../../../api/workoutBuilderApi', () => ({
  workoutBuilderApi: { listMyAssignments: () => mockAssignments() },
}));
jest.mock('../../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: () => mockActive() }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../entitlements/dunning/DunningBanner', () => ({ DunningBanner: () => null }));
jest.mock('../../../components/home/HolisticInsightsTile', () => () => null);
jest.mock('../../../components/home/PushPermissionCard', () => () => null);
jest.mock('../../../components/home/CoachIntroductionBanner', () => () => null);
jest.mock('../../../components/home/FullMacrosIntroCard', () => () => null);
jest.mock('../../../components/tutorial/TutorialHomeSlot', () => () => null);
jest.mock('../../../components/coachless/CoachlessHomeSlot', () => () => null);
jest.mock('../../../components/PendingInviteBanner', () => () => null);
import HomeScreen from '../HomeScreen';
beforeEach(() => {
  jest.clearAllMocks();
  mockUser.coach_id = 'c1';
  mockHistory.mockResolvedValue({ data: [] });
  mockAssignments.mockResolvedValue([]);
  mockActive.mockResolvedValue(null);
});
it('keeps Messages registered on Home and reachable from More/Membership', () => {
  const read = (file: string) => require('fs').readFileSync(require.resolve(file), 'utf8');
  expect(read('../../../navigation/ClientNavigator.tsx')).toMatch(/name="Messages"[\s\S]*name="Membership"/);
  expect(read('../MembershipScreen.tsx')).toContain("parent.navigate('Home', { screen: 'Messages' })");
});
it.each([
  ['assigned', 'One meal logged. Foundations is ready.', 'Start Foundations', 'WorkoutTab'],
  ['active', 'One meal logged. A workout is in progress.', 'Resume workout', 'WorkoutTab'],
  ['active-only', 'One meal logged. A workout is in progress.', 'Log a meal', 'Log'],
  ['done', 'One meal logged. Workout complete.', 'Open Train', 'WorkoutTab'],
  ['empty', 'One meal logged.', 'Log a meal', 'Log'],
  ['coachless', 'One meal logged.', 'Log a meal', 'Log'],
] as const)('%s: truthful line and the same CTA destination', async (state, line, label, destination) => {
  if (state === 'assigned' || state === 'done') mockAssignments.mockResolvedValue([
    { completed_at: null, workout_plan: { name: 'Foundations' } },
  ]);
  if (state === 'active') {
    mockHistory.mockResolvedValue({ data: [{ date: '2026-09-01' }] });
    mockActive.mockResolvedValue({ session: {} });
  }
  if (state === 'active-only') mockActive.mockResolvedValue({ session: {} });
  if (state === 'done') mockHistory.mockResolvedValue({ data: [{ date: getTodayString() }] });
  if (state === 'coachless') mockUser.coach_id = '';
  await render(<HomeScreen />);
  expect(await screen.findByText(line)).toBeTruthy();
  await fireEvent.press(await screen.findByLabelText(label));
  expect(mockNavigate).toHaveBeenCalledWith(destination);
  expect(screen.queryByText(/One workout to go|Explore the app/)).toBeNull();
});
it.each([false, true])('profile copy reflects coach plan presence: %s', async (hasPlan) => {
  mockAssignments.mockResolvedValue(hasPlan ? [{ completed_at: 'done', workout_plan: { name: 'Foundations' } }] : []);
  await render(<HomeScreen />);
  await screen.findByLabelText('Log a meal');
  expect(screen.getByText(hasPlan ? /so your plan reflects you/ : /to set daily targets/)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText(/^Complete your profile/));
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'EditProfile' });
});
it.each([0, 24])('keeps coachless Messages, notifications, macro logging and refresh; water is %s oz', async (oz) => {
  mockUser.coach_id = '';
  mockDay.waterOz = oz;
  await render(<HomeScreen />);
  await screen.findByLabelText('Log a meal');
  expect(screen.getByText(`${oz} oz`)).toBeTruthy();
  for (const [label, destination] of [['Message your coach', 'Messages'], ['Notifications', 'NotificationCenter'],
    ['Log a meal to see your protein', 'Log'], ['Log a meal to see your carbs', 'Log'], ['Log a meal to see your fat', 'Log']]) {
    await fireEvent.press(screen.getByLabelText(label));
    expect(mockNavigate).toHaveBeenLastCalledWith(destination);
  }
  await fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
  expect(mockDay.loadDayData).toHaveBeenCalledTimes(2);
  expect(mockDay.loadProfile).toHaveBeenCalledTimes(2);
});
