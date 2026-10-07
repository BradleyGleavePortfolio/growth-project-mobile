import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen, waitFor } from '@testing-library/react-native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import SettingsScreen from '../SettingsScreen';
import { keepDayOneAnswers } from '../../day-one/answers';
import STRINGS from '../../day-one/i18n/en.json';

let mockUserId = 'client-a';
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: mockUserId, email: 'client@example.com' }),
}));
jest.mock('../../../services/api', () => ({
  profileApi: { update: jest.fn() },
  notificationsApi: { updatePreferences: jest.fn() },
}));
jest.mock('../../../services/authActions', () => ({
  signOut: jest.fn(), refreshProfile: jest.fn(),
}));
jest.mock('../../../utils/supabaseAuth', () => ({ updateSupabasePassword: jest.fn() }));
jest.mock('../../../components/BiometricUnlockSetting', () => () => null);
jest.mock('../../../components/tutorial/TutorialSettingsRow', () => () => null);

const navigation = { goBack: jest.fn(), navigate: jest.fn() } as NavigationProp<ParamListBase>;

beforeEach(async () => {
  mockUserId = 'client-a';
  await AsyncStorage.clear();
});

describe('Settings uses this account’s retained Day-1 check-in choice', () => {
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
    await waitFor(() => expect(screen.queryByText('Check-in Time')).toBeNull());
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
