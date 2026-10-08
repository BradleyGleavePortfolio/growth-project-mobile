import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import SettingsScreen from '../../SettingsScreen';
import { ThemeProvider } from '../../../../theme/ThemeProvider';
import { profileApi, notificationsApi } from '../../../../services/api';
import { signOut } from '../../../../services/authActions';
import { updateSupabasePassword } from '../../../../utils/supabaseAuth';
import { setBiometricOptIn } from '../../../../hooks/useBiometricGate';
import { dispatchTutorial, startClientTutorial } from '../../../../tutorial/tutorialStore';

const mockUpdateSetting = jest.fn();
const mockParentNavigate = jest.fn();
let mockRomanEnabled = true;
let mockTutorialEnabled = true;
let mockTutorialStatus = 'paused';
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
  notificationsApi: {
    updatePreferences: jest.fn(async () => ({})),
    getPreferences: jest.fn(async () => ({ data: { digest_email: true } })),
  },
}));
jest.mock('../../../../services/authActions', () => ({ signOut: jest.fn(), refreshProfile: jest.fn(),
  prepareSignOutConfirm: jest.fn(async () => 'Are you sure you want to sign out?') }));
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
  useTutorialStore: () => mockTutorialStatus, dispatchTutorial: jest.fn(), startClientTutorial: jest.fn(),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ getParent: () => ({ navigate: mockParentNavigate }) }),
}));
jest.mock('../../../../config/featureFlags', () => ({
  featureFlags: { get consultationOnboarding() { return mockRomanEnabled; },
    get romanChat() { return mockRomanEnabled; },
    get clientTutorial() { return mockTutorialEnabled; } },
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
  mockTutorialEnabled = true;
  mockTutorialStatus = 'paused';
});

it('groups every existing row into seven ordered sections without disclosure taps', async () => {
  const view = await render(<SettingsScreen navigation={navigation} />);
  await view.findByLabelText('Biometric unlock');
  await view.findByText('7:30 AM');
  // Part-1 row inventory, regrouped only. Existing action tests below prove effects.
  const groups = [
    ['account', 'Account', ['Name', 'Email', 'Change password', 'Appearance',
      'Light', 'System', 'Haptics enabled', 'Biometric unlock', 'Redo profile setup',
      'Delete account', 'Sign out']],
    ['training-food', 'Training and food', ['Meals per day', 'Water goal (fl oz)']],
    // CF-SETTINGS-128: each switch names what it controls; Meal Reminders is gone
    // (rule 2: no meal reminder is ever sent, eat_enabled is read by nothing).
    ['notifications', 'Notifications', ['Check-in reminders',
      'A reminder after two days without a check-in.', 'Check-in time',
      'The time you plan to check in each day.', 'Fasting alerts',
      'A notification on this phone when your fasting window ends.', 'Summary emails',
      'Progress summaries sent to your email.', 'Notification preferences']],
    ['privacy', 'Privacy and data', ['Trust & Privacy', 'Coach sharing', 'Blocked users', 'My data']],
    ['roman', 'Roman', ['Roman and AI']],
    ['support', 'Support', ['Resume the tour']],
    ['about', 'About', ['The Growth Project v1.0.0', 'A daily practice.']],
  ] as const;
  expect(view.getAllByRole('header').map((header) => header.props.children))
    .toEqual(['Settings', ...groups.map(([, title]) => title)]);
  for (const [id, title, rows] of groups) {
    const section = within(view.getByTestId(`settings-section-${id}`));
    expect(section.getByRole('header', { name: title })).toBeTruthy();
    for (const row of rows) expect(section.getByText(row)).toBeTruthy();
  }
  expect(within(view.getByTestId('settings-section-support')).getByLabelText('Support inbox')).toBeTruthy();
  const training = within(view.getByTestId('settings-section-training-food'));
  for (const label of ['Decrease meals per day', 'Increase meals per day',
    'Decrease water goal', 'Increase water goal']) expect(training.getByLabelText(label)).toBeTruthy();
  for (const label of ['Nutrition Preferences', 'App Preferences', 'Security', 'Notification settings', 'Tutorial',
    'Meal Reminders', 'Daily Check-in', 'Weekly Summary']) {
    expect(view.queryByText(label)).toBeNull();
  }
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
    ['Blocked users', 'BlockedUsers'], ['Request my data export', 'DataExport'],
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
  // Each switch writes the columns the backend reads (digest_email gates the
  // summary emails; nudge_missed_checkin_* gate the missed check-in reminder).
  for (const [label, key, payload] of [
    ['Check-in reminders', 'dailyCheckin', { nudge_missed_checkin_push: false,
      nudge_missed_checkin_inapp: false, nudge_missed_checkin_email: false, daily_checkin_enabled: false }],
    ['Fasting alerts', 'fastingAlerts', { fasting_enabled: false }],
    ['Summary emails', 'weeklySummary', { digest_email: false, weekly_summary_enabled: false }],
  ] as const) {
    await fireEvent(view.getByLabelText(label), 'valueChange', false);
    await waitFor(() => expect(mockUpdateSetting).toHaveBeenLastCalledWith(key, false));
    expect(notificationsApi.updatePreferences).toHaveBeenLastCalledWith(payload);
    // Server-backed switches hold the saved value (the local one comes from the mocked hook).
    if (key !== 'fastingAlerts') expect(view.getByLabelText(label).props.value).toBe(false);
  }
  await fireEvent(view.getByLabelText('Check-in reminders'), 'valueChange', true);
  expect(notificationsApi.updatePreferences).toHaveBeenLastCalledWith({ nudge_missed_checkin_push: true,
    nudge_missed_checkin_inapp: true, daily_checkin_enabled: true });
  await fireEvent(view.getByLabelText('Haptics enabled'), 'valueChange', false);
  expect(mockUpdateSetting).toHaveBeenLastCalledWith('hapticsEnabled', false);
  for (const [label, stored] of [['System', 'system'], ['Light', 'light']]) {
    await fireEvent.press(view.getByLabelText(label));
    await waitFor(async () => expect(await AsyncStorage.getItem('gp_appearance')).toBe(stored));
  }
  expect(view.queryByLabelText('Dark')).toBeNull();
  await fireEvent(await view.findByLabelText('Biometric unlock'), 'valueChange', true);
  expect(setBiometricOptIn).toHaveBeenCalledWith(true);
  await fireEvent(view.getByLabelText('Biometric unlock'), 'valueChange', false);
  expect(setBiometricOptIn).toHaveBeenLastCalledWith(false);
  await fireEvent.press(view.getByLabelText('Resume the tour'));
  expect(dispatchTutorial).toHaveBeenCalledWith({ type: 'RESUME' });
  expect(mockParentNavigate).toHaveBeenCalledWith('Home', { screen: 'HomeMain' });
  mockTutorialStatus = 'completed';
  await view.rerender(<ThemeProvider><SettingsScreen navigation={navigation} /></ThemeProvider>);
  await fireEvent.press(view.getByLabelText('Take the tour again'));
  expect(startClientTutorial).toHaveBeenCalledWith(null, { restart: true });
  mockTutorialStatus = 'active';
  await view.rerender(<ThemeProvider><SettingsScreen navigation={navigation} /></ThemeProvider>);
  expect(view.getByLabelText('The tour is in progress').props.accessibilityState.disabled).toBe(true);
});

it('keeps password inputs, close, validation, save and confirmed reset/sign-out handlers', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = await render(<SettingsScreen navigation={navigation} />);
  await fireEvent.press(view.getByText('Change password'));
  expect(view.getByText('At least 8 characters, with an uppercase letter, a number and a special character.')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Update password'));
  expect(view.getByText('At least 8 characters.')).toBeTruthy();
  // The sign-up and reset rules, not only a length check (FW-ACCOUNT U7).
  for (const [weak, rule] of [['test-password', 'At least one uppercase letter.'],
    ['Test-password', 'At least one number.'], ['Testpassw0rd', 'At least one special character.']]) {
    await fireEvent.changeText(view.getByLabelText('New password'), weak);
    await fireEvent.press(view.getByLabelText('Update password'));
    expect(view.getByText(rule)).toBeTruthy();
  }
  expect(updateSupabasePassword).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('Close'));
  await fireEvent.press(view.getByText('Change password'));
  await fireEvent.changeText(view.getByLabelText('New password'), 'Test-passw0rd');
  await fireEvent.changeText(view.getByLabelText('Confirm new password'), 'Test-passw0rd');
  await fireEvent.press(view.getByLabelText('Update password'));
  expect(updateSupabasePassword).toHaveBeenCalledWith('Test-passw0rd');
  for (const [label, confirm] of [['Redo profile setup', 'Redo setup'], ['Sign out', 'Sign out']]) {
    await fireEvent.press(view.getByText(label));
    await waitFor(() => expect(alert.mock.calls.at(-1)?.[2]?.some((button) => button.text === confirm)).toBe(true));
    const buttons = alert.mock.calls[alert.mock.calls.length - 1][2]!;
    expect(buttons.find((button) => button.text === 'Cancel')?.style).toBe('cancel');
    await buttons.find((button) => button.text === confirm)!.onPress!();
  }
  expect(profileApi.update).toHaveBeenLastCalledWith({ onboardingCompleted: false });
  expect(signOut).toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('Redo profile setup',
    'Answer the setup questions again. Your logs and coach plans are kept.',
    expect.any(Array));
  // B1 (LN-OPUS-B-130): targets a coach set do not change, so the confirm promises nothing about targets.
  expect(alert).not.toHaveBeenCalledWith('Redo profile setup', expect.stringMatching(/target/i), expect.any(Array));
  alert.mockRestore();
});

it('shows the saved server values and puts a switch back with a plain line when a save fails', async () => {
  (notificationsApi.getPreferences as jest.Mock).mockResolvedValueOnce({ data: {
    digest_email: false, nudge_missed_checkin_push: false, nudge_missed_checkin_inapp: false } });
  const view = await render(<SettingsScreen navigation={navigation} />);
  // This phone's cached values say on; the account says off.
  await waitFor(() => expect(view.getByLabelText('Summary emails').props.value).toBe(false));
  expect(view.getByLabelText('Check-in reminders').props.value).toBe(false);
  (notificationsApi.updatePreferences as jest.Mock).mockRejectedValueOnce({ isAxiosError: true });
  await fireEvent(view.getByLabelText('Summary emails'), 'valueChange', true);
  expect(await view.findByText('Your summary email setting was not saved because the app could not reach the server, '
    + 'so it was left as it was. Check your connection, then try again.')).toBeTruthy();
  expect(view.getByLabelText('Summary emails').props.value).toBe(false);
  expect(mockUpdateSetting).not.toHaveBeenCalled();
});

it('keeps truthful summary-email copy and controls digest_email rather than the legacy mirror', async () => {
  (notificationsApi.getPreferences as jest.Mock).mockResolvedValueOnce({ data: {
    digest_email: false, weekly_summary_enabled: true,
  } });
  const view = await render(<SettingsScreen navigation={navigation} />);
  expect(view.getByText('Progress summaries sent to your email.')).toBeTruthy();
  await waitFor(() => expect(view.getByLabelText('Summary emails').props.value).toBe(false));
  await fireEvent(view.getByLabelText('Summary emails'), 'valueChange', true);
  expect(notificationsApi.updatePreferences).toHaveBeenLastCalledWith({
    digest_email: true, weekly_summary_enabled: true,
  });
  expect(mockUpdateSetting).toHaveBeenLastCalledWith('weeklySummary', true);
  expect(view.getByLabelText('Summary emails').props.value).toBe(true);
});

it('switching Fasting alerts off cancels the alert already set for this account\'s current fast', async () => {
  const notifications = jest.requireMock('expo-notifications') as { cancelScheduledNotificationAsync: jest.Mock };
  // The Fasting screen saves the scheduled alert id per account (FastingScreen.tsx fastingNotifIdKey).
  await AsyncStorage.setItem('fasting:scheduled_notification_id:settings-client', 'fast-end-1');
  await AsyncStorage.setItem('fasting:scheduled_notification_id:other-client', 'fast-end-2');
  const view = await render(<SettingsScreen navigation={navigation} />);
  await fireEvent(view.getByLabelText('Fasting alerts'), 'valueChange', false);
  await waitFor(() => expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('fast-end-1'));
  await waitFor(async () => expect(
    await AsyncStorage.getItem('fasting:scheduled_notification_id:settings-client')).toBeNull());
  expect(await AsyncStorage.getItem('fasting:scheduled_notification_id:other-client')).toBe('fast-end-2');
  expect(mockUpdateSetting).toHaveBeenLastCalledWith('fastingAlerts', false);
  expect(notificationsApi.updatePreferences).toHaveBeenLastCalledWith({ fasting_enabled: false });
  // Switching it back on cancels nothing else.
  await fireEvent(view.getByLabelText('Fasting alerts'), 'valueChange', true);
  expect(mockUpdateSetting).toHaveBeenLastCalledWith('fastingAlerts', true);
  expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
});

it('keeps the existing Roman consent visibility gate', async () => {
  mockRomanEnabled = false;
  const view = await render(<SettingsScreen navigation={navigation} />);
  expect(view.queryByTestId('settings-roman-ai')).toBeNull();
  expect(view.queryByTestId('settings-section-roman')).toBeNull();
  expect(view.getByTestId('settings-coach-sharing')).toBeTruthy();
});

it('keeps Support available when the tutorial flag is off', async () => {
  mockTutorialEnabled = false;
  const view = await render(<SettingsScreen navigation={navigation} />);
  expect(view.queryByTestId('tutorial-settings-button')).toBeNull();
  await fireEvent.press(view.getByLabelText('Support inbox'));
  expect(navigationStub.navigate).toHaveBeenLastCalledWith('SupportInbox');
});
