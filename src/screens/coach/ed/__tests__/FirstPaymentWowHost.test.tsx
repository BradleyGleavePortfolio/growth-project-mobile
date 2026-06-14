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
 *   3. A gate-write REJECTION is logged via the shared logger (never swallowed
 *      — Bradley Law #36) AND the overlay still clears, so the coach is never
 *      trapped behind the modal.
 *
 * The notification hook (useFirstPaymentNotification) is mocked to capture its
 * onFirstPayment callback, exactly like the repo's gesture/handler-capture test
 * pattern. The hook now delivers the fixed FIRST_PAYMENT payload shape
 * { amount: number; currency: string; clientId: string }; the host formats it
 * into the celebration's display strings (Option C — no client-side payment
 * reads).
 */
import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { FIRST_PAYMENT_DISMISS_LABEL } from '../FirstPaymentWowScreen';

jest.mock('../../../client/wearables/components/useReduceMotion', () => ({
  useReduceMotion: () => true,
}));

// Mutable current-coach identity so a test can simulate switching coaches
// within one app session (audit R3 P2 — per-coach dismissal latch).
let mockCurrentUser: { id: string; firstName: string } = {
  id: 'coach-xyz',
  firstName: 'Marcus',
};
jest.mock('../../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockCurrentUser,
}));

jest.mock('../../../../config/featureFlags', () => ({
  featureFlags: { romanFirstPaymentWow: true },
}));

// Capture the notification callback so the test can drive a first-payment event.
interface FirstPaymentPayload {
  amount: number;
  currency: string;
  clientId: string;
}
let capturedOnFirstPayment:
  | ((p: FirstPaymentPayload) => void)
  | undefined;
jest.mock('../../../../hooks/useNotifications', () => ({
  useFirstPaymentNotification: (args: {
    onFirstPayment: (p: FirstPaymentPayload) => void;
  }) => {
    capturedOnFirstPayment = args.onFirstPayment;
    // The host now consumes the returned error state (audit R2 P2), so the
    // mock must return the documented shape.
    return { error: null };
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
  mockCurrentUser = { id: 'coach-xyz', firstName: 'Marcus' };
  mockMarkFirstPaymentSeen.mockReset();
  mockMarkFirstPaymentSeen.mockReturnValue(Promise.resolve(undefined));
});

async function renderHostWithEvent() {
  const utils = await render(<FirstPaymentWowHost>{null}</FirstPaymentWowHost>);
  act(() => {
    capturedOnFirstPayment?.({
      amount: 240,
      currency: 'USD',
      clientId: 'client-dana',
    });
  });
  return utils;
}

describe('FirstPaymentWowHost — ED.3 (P1-3 dismiss ordering)', () => {
  it('overlays the celebration on a gate-unseen first payment', async () => {
    const { getByTestId } = await renderHostWithEvent();
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

    const { getByTestId, queryByTestId } = await renderHostWithEvent();
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

    const { getByTestId, queryByTestId } = await renderHostWithEvent();

    await act(async () => {
      fireEvent.press(getByTestId('first-payment-dismiss'));
      await Promise.resolve();
    });

    // Never swallowed — the failure is recorded via the shared logger, which
    // forwards to the native warn channel under __DEV__ (Bradley Law #36)...
    expect(warnSpy).toHaveBeenCalledWith(
      '[ed3]',
      'markFirstPaymentSeen failed',
      { error: expect.any(Error) },
    );
    // ...and the coach is never trapped: the overlay still clears.
    await waitFor(() =>
      expect(queryByTestId('first-payment-wow')).toBeNull(),
    );
    warnSpy.mockRestore();
  });

  it('does NOT re-show after dismiss when the gate write failed (session latch)', async () => {
    // Audit R2 P1: even when markFirstPaymentSeen rejects (so the persisted
    // gate stays unseen), a SECOND first-payment event in the same session
    // must not re-arm the celebration — the in-memory session latch blocks it.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockMarkFirstPaymentSeen.mockRejectedValue(new Error('storage offline'));

    const { getByTestId, queryByTestId } = await renderHostWithEvent();

    // Dismiss — the persisted gate write rejects, but the latch is set.
    await act(async () => {
      fireEvent.press(getByTestId('first-payment-dismiss'));
      await Promise.resolve();
    });
    await waitFor(() => expect(queryByTestId('first-payment-wow')).toBeNull());

    // A later notification fires the captured callback again...
    act(() => {
      capturedOnFirstPayment?.({
        amount: 300,
        currency: 'USD',
        clientId: 'client-riley',
      });
    });

    // ...and the celebration must STILL be absent (no re-show this session).
    expect(queryByTestId('first-payment-wow')).toBeNull();
    warnSpy.mockRestore();
  });

  it('does NOT suppress a DIFFERENT coach after the first coach dismisses (per-coach latch)', async () => {
    // Audit R3 P2: the dismissal latch must be keyed by coach. After coach A
    // dismisses, coach B's legitimate first-payment celebration in the SAME
    // app session must still show; a re-fire for coach A stays blocked.
    const { getByTestId, queryByTestId, rerender } = await render(
      <FirstPaymentWowHost>{null}</FirstPaymentWowHost>,
    );

    // Coach A celebrates, then dismisses.
    act(() => {
      capturedOnFirstPayment?.({
        amount: 240,
        currency: 'USD',
        clientId: 'client-dana',
      });
    });
    expect(getByTestId('first-payment-wow')).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId('first-payment-dismiss'));
      await Promise.resolve();
    });
    await waitFor(() => expect(queryByTestId('first-payment-wow')).toBeNull());

    // A re-fire for coach A stays blocked (same-coach latch holds).
    act(() => {
      capturedOnFirstPayment?.({
        amount: 260,
        currency: 'USD',
        clientId: 'client-dana',
      });
    });
    expect(queryByTestId('first-payment-wow')).toBeNull();

    // Switch to coach B in the same session and re-render the host.
    mockCurrentUser = { id: 'coach-bbb', firstName: 'Nadia' };
    await rerender(<FirstPaymentWowHost>{null}</FirstPaymentWowHost>);

    // Coach B's first payment MUST celebrate — coach A's dismissal does not
    // suppress it.
    act(() => {
      capturedOnFirstPayment?.({
        amount: 300,
        currency: 'USD',
        clientId: 'client-riley',
      });
    });
    expect(getByTestId('first-payment-wow')).toBeTruthy();
  });
});
