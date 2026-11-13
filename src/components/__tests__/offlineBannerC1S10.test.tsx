/**
 * WORKOUT-SUMMARY-M S13 (C1-S-10, drawn in C1 Style C v2 C2_offline_*): with no signal a client reads that workouts and
 * food logs are saved on this phone; a coach keeps the coach line (FIN-868R5); the band is still an alert read out
 * politely, as main's.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

const mockUser: { current: { role?: string } | null } = { current: null };
jest.mock('../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isConnected: false, isInternetReachable: false }),
  isEffectivelyOnline: () => false,
}));
jest.mock('../../lib/userCache', () => ({ readUserCacheSync: () => mockUser.current }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import OfflineBanner from '../OfflineBanner';

const C1_S_10 = 'You are offline. Workouts and food logs are saved on this phone and sync when you reconnect.';

it.each([{ role: 'client' }, { role: 'student' }, {}, null])('a client (or no saved account) reads C1-S-10', async (user) => {
  mockUser.current = user;
  const view = await render(<OfflineBanner />);
  expect(view.getByText(C1_S_10)).toBeTruthy();
  const band = view.getByRole('alert');
  expect(band.props.accessibilityLiveRegion).toBe('polite');
});

it.each(['coach', 'sub_coach', 'owner'])('a %s keeps the coach line', async (role) => {
  mockUser.current = { role };
  const view = await render(<OfflineBanner />);
  expect(view.getByText('You are offline. Reconnect to see the latest.')).toBeTruthy();
  expect(view.queryByText(C1_S_10)).toBeNull();
});
