/**
 * B-TEST LO-908R2 B1 (m#908 @ 3d2e29aa): a client who opened the app with no signal has a failed entitlement read
 * (status 'unavailable', no `renewal`). On Settings > Notifications the preferences read fails too and the screen offers
 * Try again. When signal is back and the person taps Try again, the screen loads but the plan renewal offers switch
 * never comes back: Try again re-reads the preferences only, never the entitlement read that gates the row, and nothing
 * says why the switch is missing. Expected: Try again (or the screen) also recovers the gating read, so the switch shows
 * the server's answer.
 */
import React from 'react';
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
jest.mock('../../../lib/consultation/report', () => ({ reportUnexpected: jest.fn() }));
jest.mock('../../../services/api', () => ({
  notificationsApi: { getPreferences: jest.fn(), updatePreferences: jest.fn() },
}));
jest.mock('../../../services/notificationsApi', () => ({
  KIND_PREFS_PREFIX: { message: 'message' },
  fetchNotificationPreferences: jest.fn(),
  saveNotificationPreferences: jest.fn(),
}));

// A stand-in for EntitlementProvider with real React state: the launch read failed ('unavailable', no renewal);
// calling refreshEntitlement now succeeds (signal is back) and the plan read carries `renewal`, as the real provider
// does (EntitlementProvider.tsx refreshEntitlement -> setRenewal(readRenewal(...))).
const mockRefresh = jest.fn();
jest.mock('../../../entitlements/EntitlementProvider', () => {
  const ReactLocal = require('react');
  const Ctx = ReactLocal.createContext({ renewal: undefined, status: 'unavailable', refreshEntitlement: async () => false });
  function FakeEntitlementProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = ReactLocal.useState({ renewal: undefined, status: 'unavailable' });
    const refreshEntitlement = ReactLocal.useCallback(async () => {
      mockRefresh();
      setState({ renewal: { state: 'none' }, status: 'inactive' });
      return false;
    }, []);
    return ReactLocal.createElement(Ctx.Provider, { value: { ...state, refreshEntitlement } }, children);
  }
  return {
    FakeEntitlementProvider,
    useEntitlement: () => ReactLocal.useContext(Ctx),
  };
});

const { notificationsApi } = require('../../../services/api') as {
  notificationsApi: { getPreferences: jest.Mock; updatePreferences: jest.Mock };
};
const kinds = require('../../../services/notificationsApi') as {
  fetchNotificationPreferences: jest.Mock;
};
const { FakeEntitlementProvider } = require('../../../entitlements/EntitlementProvider') as {
  FakeEntitlementProvider: React.ComponentType<{ children: React.ReactNode }>;
};
const Screen = require('../NotificationPreferencesScreen').default as React.ComponentType;

const PREFS = {
  muteAll: false,
  quietHours: { enabled: true, startTime: '21:00', endTime: '08:00' },
  channels: { message: { push: true, email: false, in_app: true } },
};
const offline = () => Object.assign(new Error('Network Error'), { isAxiosError: true });

it('LO-908R2 B1: after an offline launch, Try again on Settings > Notifications brings the plan renewal offers switch back', async () => {
  kinds.fetchNotificationPreferences.mockRejectedValueOnce(offline()).mockResolvedValue(PREFS);
  notificationsApi.getPreferences.mockResolvedValue({ data: { plan_renewal_offers_opt_in_at: '2026-10-29T00:00:00Z' } });

  const screen = await render(
    <FakeEntitlementProvider>
      <Screen />
    </FakeEntitlementProvider>,
  );
  const retry = await screen.findByRole('button', { name: 'Try again' });
  // Signal is back; the person taps Try again.
  fireEvent.press(retry);
  await screen.findByLabelText('Mute all notifications');
  await waitFor(() => expect(screen.queryByLabelText('Plan renewal offers')).not.toBeNull(), { timeout: 3000 });
  expect(screen.getByLabelText('Plan renewal offers').props.value).toBe(true);
});
