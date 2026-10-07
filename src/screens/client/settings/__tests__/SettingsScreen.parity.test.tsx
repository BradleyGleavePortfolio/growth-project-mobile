import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import SettingsScreen from '../../SettingsScreen';
import { ThemeProvider } from '../../../../theme/ThemeProvider';
import { profileApi, notificationsApi } from '../../../../services/api';
import { signOut } from '../../../../services/authActions';
import { updateSupabasePassword } from '../../../../utils/supabaseAuth';
import { setBiometricOptIn } from '../../../../hooks/useBiometricGate';
import { dispatchTutorial } from '../../../../tutorial/tutorialStore';

const mockUpdateSetting = jest.fn();
const mockParentNavigate = jest.fn();
let mockRomanEnabled = true;
jest.mock('../../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'settings-client', name: 'Alex', email: 'alex@example.com' }),
}));
jest.mock('../../../../hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { mealsPerDay: 4, waterGoalOz: 100, dailyCheckin: true,
      mealReminders: true, fastingAlerts: true, weeklySummary: true, hapticsEnabled: true },
    updateSetting: mockUpdateSetting,
  }),
}));
jest.mock('../../../day-one/answers', () => ({
  readDayOneAnswers: jest.fn(async () => ({ checkInTime: { hour: 7, minute: 30 } })),
}));
jest.mock('../../../../services/api', () => ({
  profileApi: { update: jest.fn(async () => ({})) },
  notificationsApi: { updatePreferences: jest.fn(async () => ({})) },
}));
jest.mock('../../../../services/authActions', () => ({ signOut: jest.fn(), refreshProfile: jest.fn() }));
jest.mock('../../../../utils/supabaseAuth', () => ({
  updateSupabasePassword: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../../../hooks/useIdentity', () => ({ useFoundingNumber: () => ({ data: null }) }));
jest.mock('../../../../hooks/useBiometricGate', () => ({
  isBiometricSupportedOnDevice: jest.fn(async () => true),
  getBiometricOptIn: jest.fn(async () => false), setBiometricOptIn: jest.fn(async () => {}),
}));
jest.mock('expo-local-authentication', () => ({
  authenticateAsync: jest.fn(async () => ({ success: true })),
}), { virtual: true });
jest.mock('../../../../tutorial/tutorialStore', () => ({
  useTutorialStore: () => 'paused', dispatchTutorial: jest.fn(), startClientTutorial: jest.fn(),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ getParent: () => ({ navigate: mockParentNavigate }) }),
}));
jest.mock('../../../../config/featureFlags', () => ({
  featureFlags: { get consultationOnboarding() { return mockRomanEnabled; },
    get romanChat() { return mockRomanEnabled; }, clientTutorial: true },
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) =>
    require('react').createElement(require('react-native').Text, { testID: `icon-${name}` }),
}));

const navigationStub: Pick<NavigationProp<ParamListBase>, 'goBack' | 'navigate'> = {
  goBack: jest.fn(), navigate: jest.fn(),
};
const navigation = navigationStub as NavigationProp<ParamListBase>;
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockRomanEnabled = true;
});

it('uses a serif heading, flat themed sections and accessible 44-point controls', async () => {
  const view = await render(<SettingsScreen navigation={navigation} />);
  const title = view.getByRole('header', { name: 'Settings' });
  expect(StyleSheet.flatten(title.props.style).fontFamily).toBe('CormorantGaramond_400Regular');
  const section = view.getByTestId('settings-section-account');
  expect(StyleSheet.flatten(section.props.style).backgroundColor).toBeUndefined();
  for (const label of ['Back', 'Decrease meals per day', 'Increase meals per day',
    'Decrease water goal', 'Increase water goal']) {
    const style = StyleSheet.flatten(view.getByRole('button', { name: label }).props.style);
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
  }
  expect(view.getByText('Alex')).toBeTruthy();
  expect(view.getByText('alex@example.com')).toBeTruthy();
  expect(await view.findByText('7:30 AM')).toBeTruthy();
  expect(view.getByText('The Growth Project v1.0.0')).toBeTruthy();
  expect(view.getByText('A daily practice.')).toBeTruthy();
});

it('keeps every navigation row, preference, biometric and tutorial action on this screen', async () => {
  const view = await render(<ThemeProvider><SettingsScreen navigation={navigation} /></ThemeProvider>);
  await fireEvent.press(view.getByRole('button', { name: 'Back' }));
  expect(navigationStub.goBack).toHaveBeenCalled();
  for (const [label, route] of [
    ['Delete account', 'DeleteAccount'], ['Notification preferences', 'NotificationSettings'],
    ['Support inbox', 'SupportInbox'], ['Trust and Privacy', 'TrustCenter'],
    ['Coach sharing', 'CoachSharing'], ['Roman and AI', 'RomanAiConsent'],
    ['Blocked Users', 'BlockedUsers'], ['Request my data export', 'DataExport'],
  ]) {
    await fireEvent.press(view.getByLabelText(label));
    expect(navigationStub.navigate).toHaveBeenLastCalledWith(route);
  }
  for (const [label, key, value, payload] of [
    ['Decrease meals per day', 'mealsPerDay', 3, { meals_per_day: 3 }],
    ['Increase meals per day', 'mealsPerDay', 5, { meals_per_day: 5 }],
    ['Decrease water goal', 'waterGoalOz', 90, { water_goal_oz: 90 }],
    ['Increase water goal', 'waterGoalOz', 110, { water_goal_oz: 110 }],
  ] as const) {
    await fireEvent.press(view.getByLabelText(label));
    expect(mockUpdateSetting).toHaveBeenLastCalledWith(key, value);
    expect(profileApi.update).toHaveBeenLastCalledWith(payload);
  }
  for (const [label, key, backendKey] of [
    ['Daily Check-in', 'dailyCheckin', 'daily_checkin_enabled'],
    ['Meal Reminders', 'mealReminders', 'eat_enabled'],
    ['Fasting Alerts', 'fastingAlerts', 'fasting_enabled'],
    ['Weekly Summary', 'weeklySummary', 'weekly_summary_enabled'],
  ]) {
    await fireEvent(view.getByLabelText(label), 'valueChange', false);
    expect(mockUpdateSetting).toHaveBeenLastCalledWith(key, false);
    expect(notificationsApi.updatePreferences).toHaveBeenLastCalledWith({ [backendKey]: false });
  }
  await fireEvent(view.getByLabelText('Haptics enabled'), 'valueChange', false);
  expect(mockUpdateSetting).toHaveBeenLastCalledWith('hapticsEnabled', false);
  for (const [label, stored] of [['System', 'system'], ['Light', 'light']]) {
    await fireEvent.press(view.getByLabelText(label));
    await waitFor(async () => expect(await AsyncStorage.getItem('gp_appearance')).toBe(stored));
  }
  expect(view.queryByLabelText('Dark')).toBeNull();
  await fireEvent(await view.findByLabelText('Biometric unlock'), 'valueChange', true);
  expect(setBiometricOptIn).toHaveBeenCalledWith(true);
  await fireEvent.press(view.getByLabelText('Resume the tour'));
  expect(dispatchTutorial).toHaveBeenCalledWith({ type: 'RESUME' });
  expect(mockParentNavigate).toHaveBeenCalledWith('Home', { screen: 'HomeMain' });
});

it('keeps password inputs, close, validation, save and confirmed reset/sign-out handlers', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = await render(<SettingsScreen navigation={navigation} />);
  await fireEvent.press(view.getByText('Change Password'));
  await fireEvent.press(view.getByLabelText('Update password'));
  expect(view.getByText('Password must be at least 8 characters.')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Close'));
  await fireEvent.press(view.getByText('Change Password'));
  await fireEvent.changeText(view.getByLabelText('New password'), 'test-password');
  await fireEvent.changeText(view.getByLabelText('Confirm new password'), 'test-password');
  await fireEvent.press(view.getByLabelText('Update password'));
  expect(updateSupabasePassword).toHaveBeenCalledWith('test-password');
  for (const [label, confirm] of [['Reset Onboarding', 'Reset'], ['Sign Out', 'Sign Out']]) {
    await fireEvent.press(view.getByText(label));
    const buttons = alert.mock.calls[alert.mock.calls.length - 1][2]!;
    expect(buttons.find((button) => button.text === 'Cancel')?.style).toBe('cancel');
    await buttons.find((button) => button.text === confirm)!.onPress!();
  }
  expect(profileApi.update).toHaveBeenLastCalledWith({ onboardingCompleted: false });
  expect(signOut).toHaveBeenCalled();
  alert.mockRestore();
});

it('keeps the existing Roman consent visibility gate', async () => {
  mockRomanEnabled = false;
  const view = await render(<SettingsScreen navigation={navigation} />);
  expect(view.queryByTestId('settings-roman-ai')).toBeNull();
  expect(view.getByTestId('settings-coach-sharing')).toBeTruthy();
});
