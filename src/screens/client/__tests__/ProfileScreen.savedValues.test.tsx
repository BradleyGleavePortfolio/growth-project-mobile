import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { CurrentUser } from '../../../hooks/useCurrentUser';
import type { MacroTarget } from '../../../api/macrosApi';

type StoredProfile = NonNullable<CurrentUser['profile']> & { macro_target_calories?: number };
const mockNavigate = jest.fn();
const mockProfileGet = jest.fn<Promise<{ data: StoredProfile }>, []>();
const mockMacroGet = jest.fn<Promise<{ data: MacroTarget | null }>, []>();
const mockFocus = jest.fn<void, [() => void | (() => void)]>();
let mockUser: CurrentUser;
const savedProfile: StoredProfile = {
  sex: 'prefer_not_to_say', date_of_birth: '1990-05-12T00:00:00.000Z',
  height_cm: 180, current_weight_lbs: 175, target_weight_lbs: 165,
  activity_level: 'moderate', goal_type: 'fat_loss', dietary_pattern: 'none',
  dietary_restrictions: ['nut_allergy'], workout_days_per_week: 3,
  has_gym_membership: true, macro_target_calories: 1800,
};
const currentTarget: MacroTarget = {
  id: 'target', client_id: 'client', coach_id: 'coach', calories_kcal: 2200,
  protein_g: 145, carbs_g: 260, fats_g: 65, fiber_g: null, notes: null,
  effective_from: '2026-10-07', created_at: '2026-10-07', archived_at: null,
};
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (callback: () => void | (() => void)) => mockFocus(callback),
}));
jest.mock('../../../services/api', () => ({
  __esModule: true, default: { get: jest.fn() }, profileApi: { get: () => mockProfileGet() },
}));
jest.mock('../../../api/macrosApi', () => ({ macrosApi: { currentForSelf: () => mockMacroGet() } }));
jest.mock('../../../services/authActions', () => ({
  signOut: jest.fn(), prepareSignOutConfirm: jest.fn(async () => 'Are you sure you want to sign out?'),
}));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn() } }));
jest.mock('../../../hooks/useIdentity', () => ({ useFoundingNumber: () => ({ data: null }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/community/MilestoneCabinet', () => () => null);
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: require('../../../constants/colors').default }),
}));
jest.mock('../../../components/HapticPressable', () => {
  const React = require('react'), { View } = require('react-native');
  return { __esModule: true, default: ({ intent, ...props }: import('../../../components/HapticPressable').HapticPressableProps) =>
    React.createElement(View, props) };
});
import ProfileScreen from '../ProfileScreen';

function focusSaved() {
  const cleanup = mockFocus.mock.calls.at(-2)?.[0]();
  return typeof cleanup === 'function' ? cleanup : undefined;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'client', name: 'Client', email: 'client@example.test', profile: { current_weight: 150, calorie_target: 1200, tdee: 1700 } };
  mockProfileGet.mockResolvedValue({ data: savedProfile });
  mockMacroGet.mockResolvedValue({ data: currentTarget });
});

it('reads saved server answers and current daily targets on focus instead of stale cache', async () => {
  const view = await render(<ProfileScreen />);
  await act(async () => { focusSaved(); });
  for (const value of ['175 lbs', '165 lbs', '180 cm', 'May 12, 1990', 'Prefer not to say',
    'Moderately active', 'Lose weight', 'Omnivore', 'Nut allergy', '3 per week', 'Gym access',
    '2200 kcal', '145 g', '260 g', '65 g']) expect(view.getByText(value)).toBeTruthy();
  expect(mockProfileGet).toHaveBeenCalledTimes(1); expect(mockMacroGet).toHaveBeenCalledTimes(1);
  expect(view.queryByText('150 lbs')).toBeNull(); expect(view.queryByText('1200 kcal')).toBeNull();
  expect(view.queryByText('TDEE')).toBeNull(); expect(view.queryByText(/fields? to add/)).toBeNull();
  expect(StyleSheet.flatten(view.getByText('Allergies and restrictions').props.style).flex).toBe(1);
  expect(StyleSheet.flatten(view.getByText('Nut allergy').props.style).flexShrink).toBe(1);
});

it('refreshes saved values after Edit and removes targets when the server confirms none', async () => {
  const view = await render(<ProfileScreen />);
  let blur: (() => void) | undefined;
  await act(async () => { blur = focusSaved(); });
  await fireEvent.press(view.getByLabelText('Edit personal info'));
  expect(mockNavigate).toHaveBeenLastCalledWith('EditProfile'); blur?.();
  mockProfileGet.mockResolvedValue({ data: { ...savedProfile, current_weight_lbs: 172 } });
  mockMacroGet.mockResolvedValue({ data: null });
  await act(async () => { focusSaved(); });
  expect(view.getByText('172 lbs')).toBeTruthy(); expect(view.queryByText('175 lbs')).toBeNull();
  expect(view.queryByText('2200 kcal')).toBeNull(); expect(view.queryByText('1800 kcal')).toBeNull();
  expect(view.getByText('No daily targets yet.')).toBeTruthy();
  expect(mockProfileGet).toHaveBeenCalledTimes(2); expect(mockMacroGet).toHaveBeenCalledTimes(2);
});

it('keeps cached saved values when the profile and target reads fail', async () => {
  mockUser.profile = savedProfile;
  mockProfileGet.mockRejectedValue(new Error('offline')); mockMacroGet.mockRejectedValue(new Error('offline'));
  const view = await render(<ProfileScreen />);
  await act(async () => { focusSaved(); });
  expect(view.getByText('175 lbs')).toBeTruthy(); expect(view.getByText('1800 kcal')).toBeTruthy();
});

it('distinguishes loading and failed targets from a server-confirmed empty state', async () => {
  mockUser.profile = {};
  let release: ((result: { data: MacroTarget | null }) => void) | undefined;
  mockMacroGet.mockReturnValue(new Promise((resolve) => { release = resolve; }));
  const view = await render(<ProfileScreen />);
  expect(view.queryByText('No daily targets yet.')).toBeNull();
  expect(view.getByText('Loading daily targets.')).toBeTruthy();
  await act(async () => { focusSaved(); });
  await act(async () => { release?.({ data: null }); });
  expect(view.getByText('No daily targets yet.')).toBeTruthy();
  mockProfileGet.mockResolvedValue({ data: {} }); mockMacroGet.mockRejectedValue(new Error('offline'));
  await act(async () => { focusSaved(); });
  await waitFor(() => expect(view.getByText('Daily targets did not load. Reopen Profile to try again.')).toBeTruthy());
  expect(view.queryByText('No daily targets yet.')).toBeNull();
});

it('keeps all quick routes, every personal row, Edit and confirmed sign-out reachable', async () => {
  const view = await render(<ProfileScreen />);
  for (const [label, route] of [['Settings', 'Settings'], ['My report', 'Report'], ['Widgets', 'Widgets'],
    ['Learn', 'Learn'], ['Edit personal info', 'EditProfile']]) {
    await fireEvent.press(view.getByLabelText(label)); expect(mockNavigate).toHaveBeenLastCalledWith(route);
  }
  const rows = view.getAllByLabelText(/Tap to edit\./);
  expect(rows).toHaveLength(13);
  for (const row of rows) {
    await fireEvent.press(row); expect(mockNavigate).toHaveBeenLastCalledWith('EditProfile');
    expect(require('../../../lib/analytics').track).toHaveBeenLastCalledWith('profile_edit_opened', {
      source: 'profile_row', field: row.props.accessibilityLabel.split(':')[0],
    });
  }
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await fireEvent.press(view.getByText('Sign out'));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Sign out', 'Are you sure you want to sign out?', expect.any(Array)));
  expect(require('../../../services/authActions').signOut).not.toHaveBeenCalled();
  expect(alert.mock.calls[0][2]?.find((button) => button.text === 'Cancel')?.style).toBe('cancel');
  alert.mock.calls[0][2]?.find((button) => button.text === 'Sign out')?.onPress?.();
  expect(require('../../../services/authActions').signOut).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});

it('SESSION-KEEP-130: the sign-out confirm names what has not synced and would be removed from this phone', async () => {
  const actions = require('../../../services/authActions') as { prepareSignOutConfirm: jest.Mock; signOut: jest.Mock };
  const left = '2 workouts and 1 food have not synced yet and will be removed from this phone.';
  actions.prepareSignOutConfirm.mockResolvedValueOnce(left);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = await render(<ProfileScreen />);
  await fireEvent.press(view.getByText('Sign out'));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Sign out', left, expect.any(Array)));
  expect(actions.prepareSignOutConfirm).toHaveBeenCalledWith('client');
  expect(actions.signOut).not.toHaveBeenCalled();
  alert.mockRestore();
});
