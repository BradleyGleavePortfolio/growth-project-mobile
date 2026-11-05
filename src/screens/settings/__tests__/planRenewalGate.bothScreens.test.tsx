/**
 * LO-908R2 B1, class-first (STORE-B2): every notification screen that gates the plan renewal offers switch on the plan
 * read (EntitlementProvider `renewal`) reads it again when that read failed: on open, and on its Try again. While it
 * still fails the screen says so, with Try again; the switch is never shown on before the server says so.
 * One table over both screens (settings/NotificationPreferencesScreen, notifications/NotificationPreferencesScreen).
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: require('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../lib/userCache', () => ({
  readUserCacheSync: () => ({ id: 'person-a', role: 'student' }),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../utils/haptics', () => ({ mediumTap: jest.fn() }));
jest.mock('../../../lib/consultation/report', () => ({ reportUnexpected: jest.fn() }));
jest.mock('../../../services/api', () => ({
  notificationsApi: { getPreferences: jest.fn(), updatePreferences: jest.fn() },
}));
jest.mock('../../../services/notificationsApi', () => ({
  KIND_PREFS_PREFIX: { message: 'message' },
  fetchNotificationPreferences: jest.fn(),
  saveNotificationPreferences: jest.fn(),
}));

// The plan read, with real React state as in EntitlementProvider: each refreshEntitlement takes the next answer.
const mockAnswers: Array<'fail' | 'renewal'> = [];
const mockRefresh = jest.fn();
jest.mock('../../../entitlements/EntitlementProvider', () => {
  const ReactLocal = require('react');
  const Ctx = ReactLocal.createContext(null);
  function FakeEntitlementProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = ReactLocal.useState({ renewal: undefined, status: 'unavailable' });
    const refreshEntitlement = ReactLocal.useCallback(async () => {
      mockRefresh();
      setState((s: object) => ({ ...s, status: 'checking' }));
      await Promise.resolve();
      const answer = mockAnswers.shift() ?? 'fail';
      setState(answer === 'renewal' ? { renewal: { state: 'none' }, status: 'inactive' } : { renewal: undefined, status: 'unavailable' });
      return false;
    }, []);
    return ReactLocal.createElement(Ctx.Provider, { value: { ...state, refreshEntitlement } }, children);
  }
  return { FakeEntitlementProvider, useEntitlement: () => ReactLocal.useContext(Ctx) };
});

const { notificationsApi } = require('../../../services/api') as {
  notificationsApi: { getPreferences: jest.Mock; updatePreferences: jest.Mock };
};
const kinds = require('../../../services/notificationsApi') as { fetchNotificationPreferences: jest.Mock };
const { FakeEntitlementProvider } = require('../../../entitlements/EntitlementProvider') as {
  FakeEntitlementProvider: React.ComponentType<{ children: React.ReactNode }>;
};
const CategoryScreen = require('../NotificationPreferencesScreen').default as React.ComponentType<{
  navigation: unknown;
  role: () => string;
}>;
const DestinationScreen = require('../../notifications/NotificationPreferencesScreen').default as React.ComponentType;

const OFFERS = 'Plan renewal offers';
const READ_FAILED = 'Notification preferences could not be loaded. Check your connection, then try again.';
const YES = { data: { plan_renewal_offers_opt_in_at: '2026-10-29T00:00:00Z', plan_renewal_push: true } };

const SCREENS: Array<{ screen: string; element: () => React.ReactElement; loaded: string }> = [
  {
    screen: 'Settings > Notification categories',
    element: () => <CategoryScreen navigation={{ goBack: jest.fn() }} role={() => 'student'} />,
    loaded: 'Coach Messages',
  },
  { screen: 'Settings > Notifications', element: () => <DestinationScreen />, loaded: 'Mute all notifications' },
];

beforeEach(async () => {
  jest.clearAllMocks();
  mockAnswers.length = 0;
  await AsyncStorage.clear();
  kinds.fetchNotificationPreferences.mockResolvedValue({
    muteAll: false,
    quietHours: { enabled: true, startTime: '21:00', endTime: '08:00' },
    channels: { message: { push: true, email: false, in_app: true } },
  });
  notificationsApi.getPreferences.mockResolvedValue(YES);
});

describe.each(SCREENS)('$screen, after a launch whose plan read failed', ({ element, loaded }) => {
  const open = () => render(<FakeEntitlementProvider>{element()}</FakeEntitlementProvider>);

  it('reads the plan again on open; when it answers, the switch shows the server value', async () => {
    mockAnswers.push('renewal');
    const screen = await open();
    expect((await screen.findByLabelText(OFFERS)).props.value).toBe(true);
    expect(screen.queryByText(READ_FAILED)).toBeNull();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('while it still fails: no switch (even with a saved and a server yes), the failure told, Try again recovers it', async () => {
    await AsyncStorage.setItem('gp_notif_category_prefs', JSON.stringify({ plan_renewal: true }));
    mockAnswers.push('fail', 'renewal');
    const screen = await open();
    await screen.findByLabelText(loaded);
    expect(screen.queryByLabelText(OFFERS)).toBeNull();
    expect(screen.getByText(READ_FAILED)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findByLabelText(OFFERS)).props.value).toBe(true);
    await waitFor(() => expect(screen.queryByText(READ_FAILED)).toBeNull());
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    expect(notificationsApi.updatePreferences).not.toHaveBeenCalled();
  });
});
