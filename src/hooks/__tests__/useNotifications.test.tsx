/**
 * useFirstPaymentNotification — ED.3 notification-subscriber contract (Option C).
 *
 * The dangerous client-side ClientPurchase counting was removed from PR #242;
 * the mobile client now reacts to the backend's first-payment
 * notification instead. The notification stream (notificationsApi.fetchNotifications)
 * is mocked. We assert:
 *   1. A first-payment row with a well-formed payload fires
 *      onFirstPayment EXACTLY ONCE with the parsed { amount, currency, clientId }.
 *   2. The same notification observed again on a later poll does NOT re-fire
 *      (synchronous per-coach latch).
 *   3. A first-payment row with a MALFORMED payload does NOT fire
 *      (fail closed) and does NOT throw.
 *   4. When disabled (flag off) the stream is never read and nothing fires.
 *   5. A stream read error surfaces via the returned error state and does NOT
 *      fire onFirstPayment (Bradley Law #36 — logged, never swallowed).
 *   (B-LSNOTIFY3-2: rows carry the decoded firstPayment the normalizer sets;
 *   the decoder itself is tested in notificationsApi.firstPayment.test.ts and
 *   end to end in useFirstPaymentNotification.backendRow.test.tsx.)
 *
 * No mock-echo (#17): the hook is driven through a mocked stream and we assert
 * specific behaviours (fires / does not, parsed shape), never that an input
 * equals itself.
 */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

// ── notificationsApi mock — flip the page returned per test. ────────────────
let mockPageItems: Array<Record<string, unknown>> = [];
const mockFetchNotifications = jest.fn(
  async (..._args: unknown[]) => ({
    items: mockPageItems,
    nextCursor: null,
  }),
);
jest.mock('../../services/notificationsApi', () => ({
  fetchNotifications: (...args: unknown[]) => mockFetchNotifications(...args),
}));

import { useFirstPaymentNotification } from '../useNotifications';

function firstPaymentNotification(
  firstPayment: { amount: number; currency: string; clientId: string } | undefined,
  id = 'n_fp_1',
) {
  return {
    id,
    kind: 'system',
    title: 'Update',
    body: 'A payment has cleared.',
    read: false,
    createdAt: new Date().toISOString(),
    ...(firstPayment ? { firstPayment } : {}),
  };
}

interface HarnessProps {
  coachId: string | undefined;
  enabled: boolean;
  onFirstPayment: (p: {
    amount: number;
    currency: string;
    clientId: string;
  }) => void;
}

function Harness({ coachId, enabled, onFirstPayment }: HarnessProps) {
  const { error } = useFirstPaymentNotification({
    coachId,
    enabled,
    onFirstPayment,
    // Tight interval so test 2 can observe the second poll quickly.
    pollIntervalMs: 10,
  });
  return <Text testID="err">{error ?? 'none'}</Text>;
}

beforeEach(() => {
  mockPageItems = [];
  mockFetchNotifications.mockClear();
});

describe('useFirstPaymentNotification — ED.3 (Option C)', () => {
  it('fires onFirstPayment once with the parsed payload on a well-formed first-payment row', async () => {
    mockPageItems = [
      firstPaymentNotification({
        amount: 240,
        currency: 'USD',
        clientId: 'client-dana',
      }),
    ];
    const onFirstPayment = jest.fn();
    await render(
      <Harness coachId="coach-1" enabled onFirstPayment={onFirstPayment} />,
    );
    await waitFor(() => expect(onFirstPayment).toHaveBeenCalledTimes(1));
    expect(onFirstPayment).toHaveBeenCalledWith({
      amount: 240,
      currency: 'USD',
      clientId: 'client-dana',
    });
  });

  it('does not re-fire when the same notification is observed on a later poll', async () => {
    mockPageItems = [
      firstPaymentNotification({
        amount: 240,
        currency: 'USD',
        clientId: 'client-dana',
      }),
    ];
    const onFirstPayment = jest.fn();
    await render(
      <Harness coachId="coach-1" enabled onFirstPayment={onFirstPayment} />,
    );
    await waitFor(() => expect(onFirstPayment).toHaveBeenCalledTimes(1));
    // Let several poll ticks elapse — the latch must keep the count at one.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(onFirstPayment).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire on a row without a decoded first payment (fail closed) and never throws', async () => {
    mockPageItems = [
      // A malformed first_payment row normalizes without firstPayment.
      firstPaymentNotification(undefined),
    ];
    const onFirstPayment = jest.fn();
    await render(
      <Harness coachId="coach-1" enabled onFirstPayment={onFirstPayment} />,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(onFirstPayment).not.toHaveBeenCalled();
  });

  it('never reads the stream when disabled', async () => {
    mockPageItems = [
      firstPaymentNotification({
        amount: 240,
        currency: 'USD',
        clientId: 'client-dana',
      }),
    ];
    const onFirstPayment = jest.fn();
    await render(
      <Harness
        coachId="coach-1"
        enabled={false}
        onFirstPayment={onFirstPayment}
      />,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(mockFetchNotifications).not.toHaveBeenCalled();
    expect(onFirstPayment).not.toHaveBeenCalled();
  });

  it('surfaces a stream read error and does not fire (Law #36)', async () => {
    mockFetchNotifications.mockRejectedValueOnce(new Error('stream down'));
    const onFirstPayment = jest.fn();
    const { getByTestId } = await render(
      <Harness coachId="coach-1" enabled onFirstPayment={onFirstPayment} />,
    );
    await waitFor(() =>
      expect(getByTestId('err').props.children).toContain('stream down'),
    );
    expect(onFirstPayment).not.toHaveBeenCalled();
  });
});
