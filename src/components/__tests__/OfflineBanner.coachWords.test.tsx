/**
 * FIN-868R5 (C6): the app-wide offline banner told coaches "food logs will
 * sync" on the coach community screens. A coach has no food logs and nothing
 * of theirs waits to sync, so the banner says only what is true for them.
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

const CLIENT_WORDS = 'You\u2019re offline \u2014 food logs will sync when you reconnect.';

describe('Offline banner words fit who is signed in', () => {
  it.each(['coach', 'sub_coach', 'owner'])('a %s is not told food logs will sync', async (role) => {
    mockUser.current = { role };
    const { getByText, queryByText } = await render(<OfflineBanner />);
    expect(getByText('You\u2019re offline \u2014 reconnect to load the latest.')).toBeTruthy();
    expect(queryByText(/food logs/)).toBeNull();
  });

  it.each([{ role: 'client' }, {}, null])('a client (or no saved account) keeps the food log line', async (user) => {
    mockUser.current = user;
    const { getByText } = await render(<OfflineBanner />);
    expect(getByText(CLIENT_WORDS.replace('\u2019', "'"))).toBeTruthy();
  });
});
