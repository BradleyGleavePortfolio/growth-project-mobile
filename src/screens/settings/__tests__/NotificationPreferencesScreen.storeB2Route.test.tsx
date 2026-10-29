import React from 'react';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    semanticColors: require('../../../theme/tokens').lightTokens,
  }),
}));
jest.mock('../../../lib/userCache', () => ({
  readUserCacheSync: () => ({ id: 'person-a', role: 'student' }),
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ renewal: { state: 'none' } }),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../utils/haptics', () => ({ mediumTap: jest.fn() }));
jest.mock('../../../lib/consultation/report', () => ({ reportUnexpected: jest.fn() }));
jest.mock('../../../services/api', () => ({
  notificationsApi: {
    getPreferences: jest.fn(async () => ({
      data: { plan_renewal_offers_opt_in_at: null, plan_renewal_push: true },
    })),
    updatePreferences: jest.fn(async () => ({ data: {} })),
  },
}));
jest.mock('../../../services/notificationsApi', () => ({
  KIND_PREFS_PREFIX: { message: 'message' },
  fetchNotificationPreferences: jest.fn(async () => ({
    muteAll: false,
    quietHours: { enabled: true, startTime: '21:00', endTime: '08:00' },
    channels: { message: { push: true, email: false, in_app: true } },
  })),
  saveNotificationPreferences: jest.fn(),
}));

// Resolve the real component registered for the route the client actually opens.
// Rendering the category component directly would miss an unreachable control.
function clientNotificationSettings() {
  const file = path.resolve(__dirname, '../../../navigation/ClientNavigator.tsx');
  const source = fs.readFileSync(file, 'utf8');
  const route = /<MoreStackNav\.Screen\s+name="NotificationSettings"\s+component=\{(\w+)\}/.exec(source);
  if (!route) throw new Error('Client notification settings route was not found');
  const imports = [...source.matchAll(/import (\w+) from '([^']+)'/g)];
  const imported = imports.find((entry) => entry[1] === route[1]);
  if (!imported) throw new Error('Client notification settings component was not found');
  return require(path.resolve(path.dirname(file), imported[2])).default;
}

it('STORE-B2 B1: the client Settings notification destination exposes the renewal offer consent switch', async () => {
  const Screen = clientNotificationSettings();
  const screen = await render(
    <Screen navigation={{ navigate: jest.fn(), goBack: jest.fn() }} role={() => 'student'} />,
  );
  expect(await screen.findByLabelText('Plan renewal offers')).toBeTruthy();
});
