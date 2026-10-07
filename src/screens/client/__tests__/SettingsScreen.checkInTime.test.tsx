import React from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeProvider';
import { profileApi, notificationsApi } from '../../../services/api';
import { signOut } from '../../../services/authActions';
import { updateSupabasePassword } from '../../../utils/supabaseAuth';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import SettingsScreen from '../SettingsScreen';
import { keepDayOneAnswers } from '../../day-one/answers';
import STRINGS from '../../day-one/i18n/en.json';

let mockUserId = 'client-a';
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: mockUserId, email: 'client@example.com' }),
}));
jest.mock('../../../services/api', () => ({
  profileApi: { update: jest.fn(async () => ({})) },
  notificationsApi: { updatePreferences: jest.fn(async () => ({})), getPreferences: jest.fn(async () => ({ data: {} })) },
}));
jest.mock('../../../services/authActions', () => ({
  signOut: jest.fn(), refreshProfile: jest.fn(),
}));
jest.mock('../../../utils/supabaseAuth', () => ({ updateSupabasePassword: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../../components/BiometricUnlockSetting', () => () => null);
jest.mock('../settings/ClientTutorialSetting', () => () => null);
jest.mock('../../../hooks/useIdentity', () => ({ useFoundingNumber: () => ({ data: null }) }));
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { consultationOnboarding: true, romanChat: true } }));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) =>
    require('react').createElement(require('react-native').Text, { testID: `icon-${name}` }),
}));

const navigationStub: Pick<NavigationProp<ParamListBase>, 'goBack' | 'navigate'> = {
  goBack: jest.fn(), navigate: jest.fn(),
};
const navigation = navigationStub as NavigationProp<ParamListBase>;

beforeEach(async () => {
  mockUserId = 'client-a';
  await AsyncStorage.clear();
});

describe('Settings uses this account’s retained Day-1 check-in choice', () => {
  it('preserves all other Settings navigation and preference actions', async () => {
    const view = await render(<SettingsScreen navigation={navigation} />);
    await fireEvent.press(view.getByTestId('icon-arrow-back'));
    expect(navigation.goBack).toHaveBeenCalled();
    for (const [label, route] of [
      ['Delete account', 'DeleteAccount'], ['Notification preferences', 'NotificationSettings'],
      ['Support inbox', 'SupportInbox'], ['Trust and Privacy', 'TrustCenter'],
      ['Roman and AI', 'RomanAiConsent'], ['Blocked users', 'BlockedUsers'],
      ['Request my data export', 'DataExport'],
    ]) {
      await fireEvent.press(view.getByLabelText(label));
      expect(navigation.navigate).toHaveBeenLastCalledWith(route);
    }
    const steps = [view.getAllByTestId('icon-remove')[0], view.getAllByTestId('icon-add')[0],
      view.getAllByTestId('icon-remove')[1], view.getAllByTestId('icon-add')[1]];
    for (const [index, payload] of [[0, { meals_per_day: 3 }], [1, { meals_per_day: 4 }],
      [2, { water_goal_oz: 90 }], [3, { water_goal_oz: 100 }]] as const) {
      await fireEvent.press(steps[index]);
      expect(profileApi.update).toHaveBeenLastCalledWith(payload);
    }
    const keys = ['dailyCheckin', 'fastingAlerts', 'weeklySummary', 'hapticsEnabled'];
    const labels = ['Check-in reminders', 'Fasting alerts', 'Summary emails', 'Haptics enabled'];
    for (let index = 0; index < keys.length; index += 1) {
      const toggle = view.getByLabelText(labels[index]), value = !toggle.props.value;
      await fireEvent(toggle, 'valueChange', value);
      await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem('gp_client_settings'))!)[keys[index]]).toBe(value));
    }
    expect(notificationsApi.updatePreferences).toHaveBeenCalledTimes(3);
  });

  it('preserves password, reset and sign-out controls without real account writes', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const view = await render(<SettingsScreen navigation={navigation} />);
    await fireEvent.press(view.getByText('Change password'));
    await fireEvent.press(view.getByLabelText('Close'));
    await fireEvent.press(view.getByText('Change password'));
    await fireEvent.changeText(view.getByLabelText('New password'), 'Test-passw0rd');
    await fireEvent.changeText(view.getByLabelText('Confirm new password'), 'Test-passw0rd');
    await fireEvent.press(view.getByLabelText('Update password'));
    expect(updateSupabasePassword).toHaveBeenCalledWith('Test-passw0rd');
    await fireEvent.press(view.getByText('Redo profile setup'));
    expect(alert).toHaveBeenLastCalledWith('Redo profile setup', expect.any(String), expect.any(Array));
    const resetButtons = alert.mock.calls[alert.mock.calls.length - 1][2]!;
    await resetButtons.find((button) => button.text === 'Redo setup')!.onPress!();
    expect(profileApi.update).toHaveBeenLastCalledWith({ onboardingCompleted: false });
    await fireEvent.press(view.getByText('Sign out'));
    const buttons = alert.mock.calls[alert.mock.calls.length - 1][2]!;
    buttons.find((button) => button.text === 'Sign out')!.onPress!();
    expect(signOut).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('offers working Light and System controls, and resolves a stored Dark to Light', async () => {
    await AsyncStorage.setItem('gp_appearance', 'dark');
    await render(<ThemeProvider><SettingsScreen navigation={navigation} /></ThemeProvider>);
    await waitFor(() => expect(screen.getByLabelText('Light').props.accessibilityState.checked).toBe(true));
    expect(screen.queryByLabelText('Dark')).toBeNull();
    for (const [label, value] of [['System', 'system'], ['Light', 'light']]) {
      await fireEvent.press(screen.getByLabelText(label));
      await waitFor(async () => expect(await AsyncStorage.getItem('gp_appearance')).toBe(value));
      expect(screen.getByLabelText(label).props.accessibilityState.checked).toBe(true);
    }
  });

  it.each<[number, number, string]>([
    [7, 30, '7:30 AM'],
    [18, 45, '6:45 PM'],
    [12, 0, '12:00 PM'],
    [0, 15, '12:15 AM'],
  ])('displays %i:%i as %s', async (hour, minute, label) => {
    await keepDayOneAnswers({ checkInTime: { hour, minute } }, mockUserId);
    await render(<SettingsScreen navigation={navigation} />);
    expect(await screen.findByText(label)).toBeTruthy();
    expect(screen.queryByText('9:00 AM')).toBeNull();
  });

  it('hides the row when this account has no saved choice, even if another does', async () => {
    await keepDayOneAnswers({ checkInTime: { hour: 7, minute: 30 } }, 'client-b');
    await render(<SettingsScreen navigation={navigation} />);
    await waitFor(() => expect(screen.queryByText('Check-in time')).toBeNull());
    expect(screen.queryByText('9:00 AM')).toBeNull();
  });

  it('reads the newly signed-in account’s choice instead of reusing the first account’s', async () => {
    await keepDayOneAnswers({ checkInTime: { hour: 7, minute: 30 } }, 'client-a');
    await keepDayOneAnswers({ checkInTime: { hour: 18, minute: 45 } }, 'client-b');
    await render(<SettingsScreen navigation={navigation} />);
    expect(await screen.findByText('7:30 AM')).toBeTruthy();
    mockUserId = 'client-b';
    await screen.rerender(<SettingsScreen navigation={navigation} />);
    expect(await screen.findByText('6:45 PM')).toBeTruthy();
    expect(screen.queryByText('7:30 AM')).toBeNull();
  });

  it('uses neutral check-in skip copy', () => {
    expect(STRINGS.checkInTime.skip).toBe('Skip for now');
  });
});
