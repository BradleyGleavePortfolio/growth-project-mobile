/**
 * FirstPaymentWowHost — ED.3 overlay-owner contract (P1-3 dismiss ordering).
 *
 * Pins:
 *   1. On a gate-unseen INSERT (driven through the captured realtime callback)
 *      the host overlays FirstPaymentWowScreen.
 *   2. Dismiss AWAITS markFirstPaymentSeen before the overlay clears — the gate
 *      write must persist BEFORE the UI returns to coach home, so a re-render
 *      can never re-arm the celebration (P1-3). We hold the gate promise open
 *      and assert the overlay is still mounted until it resolves.
 *   3. A gate-write REJECTION is logged via console.warn (never swallowed —
 *      Bradley Law #36) AND the overlay still clears, so the coach is never
 *      trapped behind the modal.
 *
 * The realtime hook is mocked to capture its onFirstPayment callback, exactly
 * like the repo's gesture/handler-capture test pattern.
 */
import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { FIRST_PAYMENT_DISMISS_LABEL } from '../FirstPaymentWowScreen';

jest.mock('../../../client/wearables/components/useReduceMotion', () => ({
  useReduceMotion: () => true,
}));

jest.mock('../../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-xyz', firstName: 'Marcus' }),
}));

jest.mock('../../../../config/featureFlags', () => ({
  featureFlags: { romanFirstPaymentWow: true },
}));

// Capture the realtime callback so the test can drive a first-payment event.
let capturedOnFirstPayment:
  | ((e: { amount: string; clientName: string }) => void)
  | undefined;
jest.mock('../useFirstPaymentRealtime', () => ({
  useFirstPaymentRealtime: (args: {
    onFirstPayment: (e: { amount: string; clientName: string }) => void;
  }) => {
    capturedOnFirstPayment = args.onFirstPayment;
  },
}));

const mockMarkFirstPaymentSeen: jest.Mock<Promise<void>, [string]> = jest.fn(
  (_id: string): Promise<void> => Promise.resolve(),
);
jest.mock('../firstPaymentGate', () => ({
  markFirstPaymentSeen: (id: string) => mockMarkFirstPaymentSeen(id),
}));

import FirstPaymentWowHost from '../FirstPaymentWowHost';

beforeEach(() => {
  capturedOnFirstPayment = undefined;
  mockMarkFirstPaymentSeen.mockReset();
  mockMarkFirstPaymentSeen.mockReturnValue(Promise.resolve(undefined));
});

function renderHostWithEvent() {
  const utils = render(<FirstPaymentWowHost>{null}</FirstPaymentWowHost>);
  act(() => {
    capturedOnFirstPayment?.({ amount: '$240.00', clientName: 'Dana' });
  });
  return utils;
}

describe('FirstPaymentWowHost — ED.3 (P1-3 dismiss ordering)', () => {
  it('overlays the celebration on a gate-unseen first payment', () => {
    const { getByTestId } = renderHostWithEvent();
    expect(getByTestId('first-payment-wow')).toBeTruthy();
  });

  it('awaits markFirstPaymentSeen BEFORE clearing the overlay', async () => {
    // Hold the gate write open so we can observe the overlay is NOT cleared
    // until persistence resolves.
    let resolveGate: () => void = () => {};
    mockMarkFirstPaymentSeen.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveGate = resolve;
      }),
    );

    const { getByTestId, queryByTestId } = renderHostWithEvent();
    const button = getByTestId('first-payment-dismiss');
    expect(button.props.accessibilityLabel).toBe(FIRST_PAYMENT_DISMISS_LABEL);

    act(() => {
      fireEvent.press(button);
    });

    // Gate write was requested with the coach id...
    expect(mockMarkFirstPaymentSeen).toHaveBeenCalledWith('coach-xyz');
    // ...and the overlay is STILL up because the write has not resolved yet.
    expect(queryByTestId('first-payment-wow')).toBeTruthy();

    // Resolve the gate write — only now should the overlay clear.
    await act(async () => {
      resolveGate();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(queryByTestId('first-payment-wow')).toBeNull(),
    );
  });

  it('logs a warning but STILL clears the overlay when the gate write rejects', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockMarkFirstPaymentSeen.mockRejectedValue(new Error('storage offline'));

    const { getByTestId, queryByTestId } = renderHostWithEvent();

    await act(async () => {
      fireEvent.press(getByTestId('first-payment-dismiss'));
      await Promise.resolve();
    });

    // Never swallowed — the failure is recorded (Bradley Law #36)...
    expect(warnSpy).toHaveBeenCalledWith(
      '[FirstPaymentWowHost] markFirstPaymentSeen failed',
      expect.any(Error),
    );
    // ...and the coach is never trapped: the overlay still clears.
    await waitFor(() =>
      expect(queryByTestId('first-payment-wow')).toBeNull(),
    );
    warnSpy.mockRestore();
  });
});
