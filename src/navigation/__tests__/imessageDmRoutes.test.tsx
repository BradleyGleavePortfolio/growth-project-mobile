/**
 * Apple App Review 1.2 wiring assertions for the iMessage-grade DM rebuild.
 *
 * Behavioural tests: for screens that own the user-visible affordance (the
 * Blocked Users row in Settings), render the screen and assert that pressing
 * the row calls navigation.navigate('BlockedUsers') (R26: tests must prove
 * behaviour, not strings).
 *
 * Type-level route safety is provided by `tsc --noEmit`; runtime Jest tests
 * are not needed for that.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest'),
);

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn(), delete: jest.fn() },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
  coachApi: { getClients: jest.fn(async () => ({ data: [] })) },
  notificationsApi: {
    getPreferences: jest.fn(async () => ({ data: {} })),
    updatePreferences: jest.fn(async () => ({ data: {} })),
  },
  usersApi: {
    getAccountStatus: jest.fn(async () => ({ data: { status: 'active' } })),
  },
  AccountStatus: {},
}));

jest.mock('../../services/authActions', () => ({
  signOut: jest.fn(async () => undefined),
  refreshProfile: jest.fn(async () => undefined),
}));

jest.mock('../../utils/haptics', () => ({
  mediumTap: jest.fn(),
  warningTap: jest.fn(),
  successTap: jest.fn(),
}));

jest.mock('../../utils/supabaseAuth', () => ({
  updateSupabasePassword: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      border: '#222',
      primary: '#0af',
      primaryDark: '#08c',
      textPrimary: '#fff',
      textSecondary: '#ccc',
      textMuted: '#888',
      textOnPrimary: '#000',
      error: '#f33',
      success: '#3f3',
    },
    appearanceOverride: 'system',
    setAppearanceOverride: jest.fn(),
    tokens: {},
  }),
  ThemeColors: {},
  AppearanceOverride: {},
}));

jest.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'me', email: 'me@example.com' }),
}));

jest.mock('../../hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { notifications_enabled: true },
    updateSetting: jest.fn(),
  }),
}));

jest.mock('../../utils/authEvents', () => ({
  authEvents: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
}));

jest.mock('../../components/BiometricUnlockSetting', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => React.createElement(View) };
});

jest.mock('../../config/env', () => ({ helpUrl: 'https://example.com/help' }));

// Coach settings sub-components — replace with minimal stubs so the screen
// renders without their internal data dependencies firing.
jest.mock('../../screens/coach/settings/ProfileSection', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { ProfileSection: () => React.createElement(View) };
});
jest.mock('../../screens/coach/settings/SettingsToggles', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { SettingsToggles: () => React.createElement(View) };
});
jest.mock('../../screens/coach/settings/BillingSection', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { BillingSection: () => React.createElement(View) };
});
jest.mock('../../screens/coach/settings/DangerZone', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { DangerZone: () => React.createElement(View) };
});

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  };
});

beforeEach(() => {
  mockNavigate.mockReset();
});

describe('Settings UI — Apple 1.2 discoverable blocked-users entry', () => {
  it('client SettingsScreen Blocked Users row calls navigation.navigate("BlockedUsers")', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ClientSettings = require('../../screens/client/SettingsScreen').default;
    const navProp = { navigate: mockNavigate, goBack: jest.fn() };
    const { getByLabelText } = await render(<ClientSettings navigation={navProp} />);
    await fireEvent.press(getByLabelText('Blocked Users'));
    expect(mockNavigate).toHaveBeenCalledWith('BlockedUsers');
  });

  it('coach SettingsScreen Blocked Users row calls navigation.navigate("BlockedUsers")', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const CoachSettings = require('../../screens/coach/SettingsScreen').default;
    const { getByLabelText } = await render(<CoachSettings />);
    await fireEvent.press(getByLabelText('Blocked Users'));
    expect(mockNavigate).toHaveBeenCalledWith('BlockedUsers');
  });
});
