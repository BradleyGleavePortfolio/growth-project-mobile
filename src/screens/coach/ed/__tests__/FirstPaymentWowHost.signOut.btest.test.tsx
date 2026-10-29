/**
 * B-TEST (LO-NOTIFY5, m#898): once dismissed, the first-payment celebration
 * must not come back after the coach signs out and signs back in.
 *
 * Sign-out runs clearAllStorage() (src/services/authActions.ts signOut), which
 * wipes the whole prefs namespace, and the once-only gate lives there
 * (firstPaymentGate.ts). The server keeps the first_payment row, so on the next
 * sign-in the hook hands it over again. The real gate and the real
 * clearAllStorage are used; the hook is mocked only to capture its callback.
 */
import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../../client/wearables/components/useReduceMotion', () => ({
  useReduceMotion: () => true,
}));

jest.mock('../../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-signout', firstName: 'Marcus' }),
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
import { clearAllStorage } from '../../../../storage/mmkv';

const ROW: FirstPaymentPayload = { amount: 24000, currency: 'usd', clientId: 'client-dana' };

async function deliverRow() {
  await act(async () => {
    capturedOnFirstPayment?.(ROW);
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(async () => {
  capturedOnFirstPayment = undefined;
  await AsyncStorage.clear();
});

describe('B-TEST LO-NOTIFY5 m#898', () => {
  it('does not show the celebration again after dismiss when the coach signs out and back in', async () => {
    const first = await render(<FirstPaymentWowHost>{null}</FirstPaymentWowHost>);
    await deliverRow();
    expect(first.getByTestId('first-payment-wow')).toBeTruthy();

    await act(async () => {
      fireEvent.press(first.getByTestId('first-payment-dismiss'));
      await Promise.resolve();
    });
    await waitFor(() => expect(first.queryByTestId('first-payment-wow')).toBeNull());
    expect(await hasSeenFirstPayment('coach-signout')).toBe(true);

    // Sign out: the coach shell unmounts and sign-out wipes local storage.
    first.unmount();
    await clearAllStorage();

    // Sign back in as the same coach: the shell mounts fresh and the server row comes again.
    capturedOnFirstPayment = undefined;
    const second = await render(<FirstPaymentWowHost>{null}</FirstPaymentWowHost>);
    await deliverRow();

    expect(second.queryByTestId('first-payment-wow')).toBeNull();
  });
});
