import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import NotificationPreferencesScreen from '../NotificationPreferencesScreen';
import { signOut } from '../../../services/authActions';
import { authEvents } from '../../../utils/authEvents';

jest.mock('../../../services/api', () => ({
  notificationsApi: {
    getPreferences: jest.fn(async () => ({
      data: { plan_renewal_offers_opt_in_at: null },
    })),
    updatePreferences: jest.fn(async () => ({
      data: { plan_renewal_offers_opt_in_at: '2026-10-29T18:00:00.000Z' },
    })),
  },
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
  coachApi: { getClients: jest.fn(async () => ({ data: [] })) },
  logApi: { getDaily: jest.fn(async () => ({ data: { entries: [] } })) },
  waterApi: { getDaily: jest.fn(async () => ({ data: { total_ml: 0 } })) },
}));
jest.mock('../../../services/sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ reset: jest.fn(), track: jest.fn() }));
jest.mock('../../../lib/userCache', () => ({
  readUserCacheSync: () => ({ id: 'person-A', role: 'student' }),
  readUserCache: async () => ({ id: 'person-A', role: 'student' }),
  clearUserCache: jest.fn(async () => undefined),
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ renewal: { state: 'none' } }),
}));
jest.mock('../../../offline/sync/sync-engine', () => ({
  countQueuedWorkouts: jest.fn(async () => 0),
  pushQueuedWorkouts: jest.fn(async () => undefined),
  deleteWorkoutLogsForUser: jest.fn(async () => 0),
}));
jest.mock('../../../db/fastingDb', () => ({
  getActiveFast: jest.fn(async () => null),
  getFastingHistory: jest.fn(async () => []),
  startFast: jest.fn(async () => undefined),
  endFast: jest.fn(async () => undefined),
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: require('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../utils/haptics', () => ({ mediumTap: jest.fn() }));
jest.mock('../../../lib/consultation/report', () => ({ reportUnexpected: jest.fn() }));

// Keep the real storage namespace clearing and real signOut. The screen writes
// the actual cache; no assumed key list or simulated logout is under test.
it('STORE-B2 KT-13: a saved renewal consent cache is gone before sign-out exposes another account', async () => {
  await AsyncStorage.clear();
  const screen = await render(
    <NotificationPreferencesScreen
      navigation={{ goBack: jest.fn() } as never}
      role={() => 'student'}
    />,
  );
  await fireEvent(await screen.findByLabelText('Plan renewal offers'), 'valueChange', true);
  await waitFor(async () => {
    expect(JSON.parse((await AsyncStorage.getItem('gp_notif_category_prefs')) ?? '{}').plan_renewal).toBe(true);
  });
  let atLogout: Promise<string | null> | undefined;
  const onLogout = () => { atLogout = AsyncStorage.getItem('gp_notif_category_prefs'); };
  authEvents.on('logout', onLogout);
  try {
    await signOut('person-A');
    expect(atLogout).toBeDefined();
    expect(await atLogout).toBeNull();
    expect(await AsyncStorage.getItem('gp_notif_category_prefs')).toBeNull();
  } finally {
    authEvents.off('logout', onLogout);
  }
});
