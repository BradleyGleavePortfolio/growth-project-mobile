import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGet = jest.fn();
const mockPrefs = new Map<string, string>();

jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));
jest.mock('../../../../config/featureFlags', () => ({
  NOTIFICATIONS_MOCK_ENABLED: false,
  featureFlags: { romanFirstPaymentWow: true },
}));
jest.mock('../../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-once', firstName: 'Coach' }),
}));
jest.mock('../../../../storage/mmkv', () => ({
  prefsStorage: {
    getStringAsync: async (key: string) => mockPrefs.get(key),
    set: async (key: string, value: string) => { mockPrefs.set(key, value); },
  },
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

describe('B-LSNOTIFY4-M898-1: the real backend row celebrates once across app opens', () => {
  beforeEach(() => {
    mockPrefs.clear();
    mockGet.mockReset();
    mockGet.mockResolvedValue({
      data: {
        items: [{
          id: 'first-payment-row',
          kind: 'first_payment',
          body: 'A payment has cleared.',
          payload: { amount: 4900, currency: 'usd', clientId: 'client-once' },
          read_at: null,
          created_at: '2026-10-28T18:00:00.000Z',
        }],
        nextCursor: null,
      },
    });
  });

  it('after successful dismissal, reopening the host does not show the same saved first-payment row again', async () => {
    const first = await render(<FirstPaymentWowHost>{null}</FirstPaymentWowHost>);
    await waitFor(() => expect(first.queryByTestId('first-payment-wow')).not.toBeNull());
    await act(async () => { fireEvent.press(first.getByTestId('first-payment-wow')); });
    await waitFor(() => expect(first.queryByTestId('first-payment-wow')).toBeNull());
    // The actual dismissal path persisted its per-coach flag successfully.
    expect(await hasSeenFirstPayment('coach-once')).toBe(true);
    await first.unmount();

    const reopened = await render(<FirstPaymentWowHost>{null}</FirstPaymentWowHost>);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    expect(reopened.queryByTestId('first-payment-wow')).toBeNull();
    await reopened.unmount();
  });
});
