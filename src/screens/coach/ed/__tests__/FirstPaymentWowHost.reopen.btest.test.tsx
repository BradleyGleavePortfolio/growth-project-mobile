/**
 * B-TEST (LO-NOTIFY4, m#898): once dismissed, the first-payment celebration
 * must not come back when the coach opens the app again.
 *
 * The real once-only gate (firstPaymentGate, AsyncStorage shim under Jest) is
 * used, not a mock. The notification hook is mocked only to capture its
 * callback: on every mount of the host the real hook reads the first page of
 * the inbox again and, while the backend first_payment row is on that page,
 * hands it to onFirstPayment again. A new mount is what a cold start or a
 * sign-out and sign-in does to the coach shell.
 */
import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../../client/wearables/components/useReduceMotion', () => ({
  useReduceMotion: () => true,
}));

jest.mock('../../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-reopen', firstName: 'Marcus' }),
}));

jest.mock('../../../../config/featureFlags', () => ({
  featureFlags: { romanFirstPaymentWow: true },
}));

interface FirstPaymentPayload {
  amount: number;
  currency: string;
  clientId: string;
}
let capturedOnFirstPayment: ((p: FirstPaymentPayload) => void) | undefined;
jest.mock('../../../../hooks/useNotifications', () => ({
  useFirstPaymentNotification: (args: {
    onFirstPayment: (p: FirstPaymentPayload) => void;
  }) => {
    capturedOnFirstPayment = args.onFirstPayment;
    return { error: null };
  },
}));

import FirstPaymentWowHost from '../FirstPaymentWowHost';
import { hasSeenFirstPayment } from '../firstPaymentGate';

const ROW: FirstPaymentPayload = { amount: 24000, currency: 'usd', clientId: 'client-dana' };

async function deliverRow() {
  await act(async () => {
    capturedOnFirstPayment?.(ROW);
    await Promise.resolve();
  });
}

beforeEach(async () => {
  capturedOnFirstPayment = undefined;
  await AsyncStorage.clear();
});

describe('B-TEST LO-NOTIFY4 m#898', () => {
  it('does not show the celebration again after dismiss when the app is opened again', async () => {
    // First app open: the row arrives and the celebration shows.
    const first = await render(<FirstPaymentWowHost>{null}</FirstPaymentWowHost>);
    await deliverRow();
    expect(first.getByTestId('first-payment-wow')).toBeTruthy();

    // The coach dismisses it; the once-only gate is written.
    await act(async () => {
      fireEvent.press(first.getByTestId('first-payment-dismiss'));
      await Promise.resolve();
    });
    await waitFor(() => expect(first.queryByTestId('first-payment-wow')).toBeNull());
    expect(await hasSeenFirstPayment('coach-reopen')).toBe(true);

    // App closed, then opened again: the coach shell mounts fresh and the
    // hook hands the same backend row over again.
    first.unmount();
    capturedOnFirstPayment = undefined;
    const second = await render(<FirstPaymentWowHost>{null}</FirstPaymentWowHost>);
    await deliverRow();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // The gate says seen, so the celebration must stay away.
    expect(second.queryByTestId('first-payment-wow')).toBeNull();
  });
});
