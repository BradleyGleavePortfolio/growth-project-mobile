import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { getTodayString } from '../../../utils/date';
import type { EntitlementStatus } from '../../../entitlements/EntitlementProvider';

const mockNavigate = jest.fn();
const mockAssignments = jest.fn();
const mockUser = {
  id: 'home-food-client', coach_id: 'coach', profile: {
    calorie_target: 2000, protein_target: 150, carbs_target: 200, fat_target: 60,
  },
};
let mockMacroMode = 'full';
let mockSettingsLoaded = true;
const mockSettings = { unit: 'lbs' as 'lbs' | 'kg' };
const mockEntitlement = {
  entitlementActive: true as boolean | null,
  confirmedActive: true,
  status: 'active' as EntitlementStatus,
  refreshEntitlement: jest.fn(),
};
const mockDay = {
  selectedDate: getTodayString(), hasLoadedDay: false,
  foodLogs: [{ mealType: 'lunch' }], waterOz: 0,
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  isLoading: false, loadError: null as string | null,
  loadDayData: jest.fn(), loadProfile: jest.fn(),
};

jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../hooks/useSettings', () => ({
  useSettings: () => ({ settings: mockSettings, loaded: mockSettingsLoaded }),
}));
jest.mock('../../../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 0 }));
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => mockEntitlement }));
jest.mock('../../../store/clientStore', () => ({ useClientStore: () => mockDay }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => mockMacroMode }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]),
}));
jest.mock('../../../services/api', () => ({
  __esModule: true, default: { get: async () => ({ data: { name: 'Coach' } }) },
  workoutApi: { getAll: async () => ({ data: [] }) },
}));
jest.mock('../../../api/workoutBuilderApi', () => ({
  workoutBuilderApi: { listMyAssignments: () => mockAssignments() },
}));
jest.mock('../../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: async () => null }));
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
  mockMacroMode = 'full';
  mockSettings.unit = 'lbs';
  mockSettingsLoaded = true;
  Object.assign(mockEntitlement, { entitlementActive: true, confirmedActive: true, status: 'active' });
  mockEntitlement.refreshEntitlement.mockResolvedValue(true);
  Object.assign(mockDay, {
    selectedDate: getTodayString(), hasLoadedDay: false, isLoading: false, loadError: null, waterOz: 0,
    foodLogs: [{ mealType: 'lunch' }],
    dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  });
  mockAssignments.mockResolvedValue([]);
});

it.each(['full', 'simple'])('%s: shows no intake or meal claim before today loads', async (mode) => {
  mockMacroMode = mode;
  mockDay.isLoading = true;
  await render(<HomeScreen />);
  for (const label of mode === 'simple' ? ['CALORIES', 'PROTEIN', 'WATER'] : ['PROTEIN', 'CARBS', 'FAT', 'WATER']) {
    expect(screen.getByTestId(`home-value-${label}`).props.children).toBe('—');
  }
  expect(screen.queryByText('One meal logged.')).toBeNull();
  expect(mockDay.loadDayData).toHaveBeenCalledWith(mockUser.id, getTodayString());
});

it.each(['full', 'simple'])('%s: a verified empty day can show zero intake', async (mode) => {
  mockMacroMode = mode;
  mockDay.hasLoadedDay = true;
  mockDay.foodLogs = [];
  await render(<HomeScreen />);
  expect(screen.getByTestId('home-value-WATER').props.children).toBe('0 oz');
  expect(screen.getByTestId('home-value-PROTEIN').props.children).toBe('0 of 150g');
  expect(screen.queryByText('One meal logged.')).toBeNull();
  if (mode === 'simple') expect(screen.getByTestId('home-value-CALORIES').props.children).toBe('0');
});

it('does not present a previously selected food-log day as today', async () => {
  mockDay.hasLoadedDay = true;
  mockDay.selectedDate = '2026-10-01';
  mockDay.waterOz = 24;
  mockDay.dailyTotals.protein = 40;
  await render(<HomeScreen />);
  expect(screen.getByTestId('home-value-PROTEIN').props.children).toBe('—');
  expect(screen.getByTestId('home-value-WATER').props.children).toBe('—');
  expect(screen.queryByText('One meal logged.')).toBeNull();
});

it('retains verified same-day numbers while refreshing', async () => {
  mockDay.hasLoadedDay = true;
  mockDay.isLoading = true;
  mockDay.waterOz = 24;
  mockDay.dailyTotals.protein = 40;
  await render(<HomeScreen />);
  expect(screen.getByTestId('home-value-PROTEIN').props.children).toBe('40g');
  expect(screen.getByTestId('home-value-WATER').props.children).toBe('24 oz');
  expect(screen.getByText('One meal logged.')).toBeTruthy();
});

it.each(['checking', 'unavailable'] as const)('retains verified numbers during a confirmed-access %s recheck', async (status) => {
  mockDay.hasLoadedDay = true;
  mockDay.waterOz = 24;
  Object.assign(mockEntitlement, { entitlementActive: null, confirmedActive: true, status });
  await render(<HomeScreen />);
  expect(screen.getByTestId('home-value-WATER').props.children).toBe('24 oz');
  expect(await screen.findByLabelText('Log a meal')).toBeTruthy();
  expect(screen.queryByLabelText('View access')).toBeNull();
});

it('an initial day-read failure keeps intake unknown and retry/food navigation reachable', async () => {
  mockDay.loadError = 'Food and water data could not refresh. Check your connection and try again.';
  await render(<HomeScreen />);
  expect(screen.getByText(mockDay.loadError)).toBeTruthy();
  expect(screen.getByTestId('home-value-PROTEIN').props.children).toBe('—');
  expect(screen.getByTestId('home-value-WATER').props.children).toBe('—');
  await fireEvent.press(screen.getByTestId('home-day-data-error-retry'));
  expect(mockDay.loadDayData).toHaveBeenCalledTimes(2);
  await fireEvent.press(await screen.findByLabelText('Log a meal'));
  expect(mockNavigate).toHaveBeenCalledWith('Log');
});

it('uses approximate whole milliliters for kilogram users, like the Food Log', async () => {
  mockDay.hasLoadedDay = true;
  mockDay.waterOz = 17;
  mockSettings.unit = 'kg';
  await render(<HomeScreen />);
  expect(screen.getByTestId('home-value-WATER').props.children).toBe('≈ 503 ml');
});

it('limits ounces to one decimal after a metric quick-add', async () => {
  mockDay.hasLoadedDay = true;
  mockDay.waterOz = 500 / 29.5735;
  await render(<HomeScreen />);
  expect(screen.getByTestId('home-value-WATER').props.children).toBe('16.9 oz');
});

it('does not guess the water unit before settings load', async () => {
  mockDay.hasLoadedDay = true;
  mockDay.waterOz = 17;
  mockSettingsLoaded = false;
  await render(<HomeScreen />);
  expect(screen.getByTestId('home-value-WATER').props.children).toBe('—');
});

it.each([false, true])('inactive access: an actionable Home instead of a connection error or locked CTA (assigned: %s)', async (assigned) => {
  Object.assign(mockEntitlement, { entitlementActive: false, confirmedActive: false, status: 'inactive' });
  mockDay.loadError = 'Food and water data could not refresh. Check your connection and try again.';
  if (assigned) mockAssignments.mockResolvedValue([
    { id: 'assignment', completed_at: null, workout_plan: { name: 'Foundations' } },
  ]);
  await render(<HomeScreen />);
  expect(screen.queryByText(mockDay.loadError)).toBeNull();
  expect(screen.getByText('Food and water logging need active access.')).toBeTruthy();
  expect(mockDay.loadDayData).not.toHaveBeenCalled();
  expect(mockAssignments).not.toHaveBeenCalled();
  await fireEvent.press(await screen.findByLabelText('View access'));
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'Membership', initial: false });
  for (const prompt of screen.getAllByLabelText('View access to log food')) {
    await fireEvent.press(prompt);
    expect(mockNavigate).toHaveBeenLastCalledWith('MoreTab', { screen: 'Membership', initial: false });
  }
  for (const [id, destination] of [
    ['home-message-coach', 'Messages'], ['home-notification-bell', 'NotificationCenter'],
  ]) {
    await fireEvent.press(screen.getByTestId(id));
    expect(mockNavigate).toHaveBeenLastCalledWith(destination);
  }
});

it('waits for the access check before reading food and loads when access is confirmed', async () => {
  Object.assign(mockEntitlement, { entitlementActive: null, confirmedActive: false, status: 'loading' });
  const view = await render(<HomeScreen />);
  expect(mockDay.loadDayData).not.toHaveBeenCalled();
  expect(screen.getByTestId('cta-skeleton')).toBeTruthy();
  Object.assign(mockEntitlement, { entitlementActive: true, confirmedActive: true, status: 'active' });
  await view.rerender(<HomeScreen />);
  expect(mockDay.loadDayData).toHaveBeenCalledWith(mockUser.id, getTodayString());
});

it('does not treat an unavailable access check as an inactive plan', async () => {
  Object.assign(mockEntitlement, { entitlementActive: null, confirmedActive: false, status: 'unavailable' });
  await render(<HomeScreen />);
  expect(mockDay.loadDayData).not.toHaveBeenCalled();
  expect(screen.queryByText('Food and water logging need active access.')).toBeNull();
  await fireEvent.press(await screen.findByLabelText('View access'));
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'Membership', initial: false });
});

it('pull-to-refresh rechecks inactive access without making locked food requests', async () => {
  Object.assign(mockEntitlement, { entitlementActive: false, confirmedActive: false, status: 'inactive' });
  mockEntitlement.refreshEntitlement.mockResolvedValue(false);
  await render(<HomeScreen />);
  await act(async () => screen.getByTestId('home-scroll').props.refreshControl.props.onRefresh());
  expect(mockEntitlement.refreshEntitlement).toHaveBeenCalledTimes(1);
  expect(mockDay.loadDayData).not.toHaveBeenCalled();
});
