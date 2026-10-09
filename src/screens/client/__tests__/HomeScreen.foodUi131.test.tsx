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
  Object.assign(mockUser, { coach_id: 'coach' });
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

it.each(['lbs', 'kg'] as const)('%s: a failed water read stays unknown after food loads', async (unit) => {
  mockSettings.unit = unit;
  mockDay.hasLoadedDay = true;
  mockDay.dailyTotals.protein = 40;
  mockDay.loadError = 'Water data could not refresh. Check your connection and try again.';
  await render(<HomeScreen />);
  expect(screen.getByText(mockDay.loadError)).toBeTruthy();
  expect(screen.getByTestId('home-value-PROTEIN').props.children).toBe('40g');
  expect(screen.getByTestId('home-value-WATER').props.children).toBe('—');
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

// B1 (owner ruling 10-08 23:5x): food, water and workouts are the client's own
// basic functions and open to every client, so Home never waits on the
// entitlement check and never shows an access line or a View access button.
const ACCESS_LINES = ['Food and water logging need active access.', 'Your access could not be checked.'];
it.each<[string, string | null, Partial<typeof mockEntitlement>]>([
  ['coached, no package (inactive)', 'coach', { entitlementActive: false, confirmedActive: false, status: 'inactive' }],
  ['coached, check failed', 'coach', { entitlementActive: null, confirmedActive: false, status: 'unavailable' }],
  ['coached, check running', 'coach', { entitlementActive: null, confirmedActive: false, status: 'loading' }],
  ['coached, active', 'coach', { entitlementActive: true, confirmedActive: true, status: 'active' }],
  ['coachless, inactive', null, { entitlementActive: false, confirmedActive: false, status: 'inactive' }],
  ['coachless, check failed', null, { entitlementActive: null, confirmedActive: false, status: 'unavailable' }],
])('%s: today and workouts load and logging stays open', async (_label, coachId, state) => {
  Object.assign(mockUser, { coach_id: coachId });
  Object.assign(mockEntitlement, state);
  mockAssignments.mockResolvedValue([]);
  await render(<HomeScreen />);
  expect(mockDay.loadDayData).toHaveBeenCalledWith(mockUser.id, getTodayString());
  expect(mockAssignments).toHaveBeenCalled();
  expect(screen.queryByTestId('home-access-note')).toBeNull();
  expect(screen.queryByTestId('home-access-cta')).toBeNull();
  for (const line of ACCESS_LINES) expect(screen.queryByText(line)).toBeNull();
  expect(screen.queryByLabelText('View access')).toBeNull();
  expect(screen.queryByLabelText('View access to log food')).toBeNull();
  await fireEvent.press(await screen.findByLabelText('Log a meal'));
  expect(mockNavigate).toHaveBeenLastCalledWith('Log');
  for (const prompt of screen.getAllByLabelText(/^Log a meal to see your /)) {
    await fireEvent.press(prompt);
    expect(mockNavigate).toHaveBeenLastCalledWith('Log');
  }
  expect(mockNavigate).not.toHaveBeenCalledWith('MoreTab', { screen: 'Membership', initial: false });
});

it('a coached client without a package sees the assigned workout on Home', async () => {
  Object.assign(mockEntitlement, { entitlementActive: false, confirmedActive: false, status: 'inactive' });
  mockAssignments.mockResolvedValue([{ id: 'assignment', completed_at: null, workout_plan: { name: 'Foundations' } }]);
  await render(<HomeScreen />);
  expect(await screen.findByLabelText('Start Foundations')).toBeTruthy();
});

it('pull-to-refresh reloads today without an access recheck', async () => {
  Object.assign(mockEntitlement, { entitlementActive: false, confirmedActive: false, status: 'inactive' });
  await render(<HomeScreen />);
  mockDay.loadDayData.mockClear();
  await act(async () => screen.getByTestId('home-scroll').props.refreshControl.props.onRefresh());
  expect(mockDay.loadDayData).toHaveBeenCalledWith(mockUser.id, getTodayString());
  expect(mockEntitlement.refreshEntitlement).not.toHaveBeenCalled();
});
