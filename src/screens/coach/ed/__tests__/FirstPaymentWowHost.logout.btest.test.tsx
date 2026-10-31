import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockGet = jest.fn();

jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));
jest.mock('../../../../config/featureFlags', () => ({
  NOTIFICATIONS_MOCK_ENABLED: false,
  featureFlags: { romanFirstPaymentWow: true },
}));
jest.mock('../../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-logout', firstName: 'Coach' }),
}));
jest.mock('../FirstPaymentWowScreen', () => {
  const R = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ onDismiss, testID }: { onDismiss: () => void; testID: string }) => (
      R.createElement(Pressable, { testID, onPress: onDismiss }, R.createElement(Text, null, 'Dismiss'))
    ),
  };
});

import FirstPaymentWowHost from '../FirstPaymentWowHost';
import { hasSeenFirstPayment } from '../firstPaymentGate';
import { clearAllStorage, prefsStorage } from '../../../../storage/mmkv';

describe('B-LSNOTIFY5-M898-1: the first-payment gate survives ordinary logout cleanup', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockGet.mockReset();
    mockGet.mockResolvedValue({
      data: {
        items: [{
          id: 'saved-first-payment',
          kind: 'first_payment',
          body: 'A payment has cleared.',
          payload: { amount: 4900, currency: 'usd', clientId: 'client-logout' },
          read_at: null,
          created_at: '2026-10-28T18:00:00.000Z',
        }],
        nextCursor: null,
      },
    });
  });

  it('does not celebrate the retained row again after dismissal, the real logout storage sweep and sign-in', async () => {
    const first = await render(<FirstPaymentWowHost>{null}</FirstPaymentWowHost>);
    await waitFor(() => expect(first.queryByTestId('first-payment-wow')).not.toBeNull());
    await act(async () => { fireEvent.press(first.getByTestId('first-payment-wow')); });
    await waitFor(() => expect(first.queryByTestId('first-payment-wow')).toBeNull());
    expect(await hasSeenFirstPayment('coach-logout')).toBe(true);

    // authActions.signOutWhileHealthRetires calls this real sweep before
    // emitting logout (authActions.ts:548). Persistence is not mocked here.
    // Keep the privacy sweep: ordinary user preferences must still be removed.
    await prefsStorage.set('private-session-control', 'remove-on-logout');
    await clearAllStorage();
    expect(await prefsStorage.getStringAsync('private-session-control')).toBeUndefined();
    await first.unmount();

    // Signing in as the same coach mounts the shell afresh and reads the
    // same server-owned row; the successful dismissal must still be honored.
    const next = await render(<FirstPaymentWowHost>{null}</FirstPaymentWowHost>);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    expect(next.queryByTestId('first-payment-wow')).toBeNull();
    await next.unmount();
  });
});
