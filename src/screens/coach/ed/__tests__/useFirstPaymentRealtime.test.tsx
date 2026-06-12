/**
 * useFirstPaymentRealtime — ED.3 realtime trigger contract.
 *
 * The Supabase client + channel are mocked. We assert:
 *   1. An INSERT on the coach's payments channel, while the gate is UNSEEN,
 *      fires onFirstPayment with a formatted amount + client name.
 *   2. When the gate is already SEEN, the channel is never opened (no-op) —
 *      the once-only contract holds at the subscription layer too.
 *   3. The hook subscribes with the correct INSERT filter (coach_id).
 *
 * The mock captures the registered postgres_changes handler so the test can
 * drive an INSERT synchronously, exactly like the tgpCharts gesture-capture
 * pattern already used in this repo.
 */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

// ── Gate mock — flip `seen` per test. ──────────────────────────────────────
let mockGateSeen = false;
jest.mock('../firstPaymentGate', () => ({
  hasSeenFirstPayment: jest.fn(async () => mockGateSeen),
  markFirstPaymentSeen: jest.fn(async () => undefined),
  firstPaymentSeenKey: (id: string) => `roman.ed3.first-payment-seen.${id}`,
}));

// ── secureStorage mock — provide a session token so the channel opens. ──────
jest.mock('../../../../services/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async (k: string) =>
      k === 'supabase_token' ? 'access-token' : 'refresh-token',
    ),
  },
}));

// ── supabase-js mock — capture the INSERT handler + the channel filter. ─────
interface Captured {
  handler?: (payload: { new: Record<string, unknown> }) => void;
  filterArg?: Record<string, unknown>;
  channelName?: string;
  subscribed: boolean;
}
const captured: Captured = { subscribed: false };

interface MockChannel {
  on: jest.Mock;
  subscribe: jest.Mock;
  unsubscribe: jest.Mock;
}
const mockChannel: MockChannel = {
  on: jest.fn((_event: string, filter: Record<string, unknown>, handler: (p: { new: Record<string, unknown> }) => void) => {
    captured.filterArg = filter;
    captured.handler = handler;
    return mockChannel;
  }),
  subscribe: jest.fn((cb?: (status: string) => void) => {
    captured.subscribed = true;
    cb?.('SUBSCRIBED');
    return mockChannel;
  }),
  unsubscribe: jest.fn(),
};
const mockClient = {
  channel: jest.fn((name: string) => {
    captured.channelName = name;
    return mockChannel;
  }),
  auth: { setSession: jest.fn(async () => undefined) },
  removeAllChannels: jest.fn(async () => undefined),
};
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockClient),
}));

import { useFirstPaymentRealtime } from '../useFirstPaymentRealtime';

function Harness({ enabled, onEvent }: { enabled: boolean; onEvent: (e: unknown) => void }) {
  useFirstPaymentRealtime({
    coachId: 'coach-xyz',
    enabled,
    onFirstPayment: onEvent,
  });
  return <Text>harness</Text>;
}

beforeEach(() => {
  mockGateSeen = false;
  captured.handler = undefined;
  captured.filterArg = undefined;
  captured.channelName = undefined;
  captured.subscribed = false;
  jest.clearAllMocks();
});

describe('useFirstPaymentRealtime — ED.3', () => {
  it('fires onFirstPayment on an INSERT when the gate is unseen', async () => {
    const onEvent = jest.fn();
    render(<Harness enabled onEvent={onEvent} />);

    // Let the async subscribe() resolve (gate check → token → createClient).
    await waitFor(() => expect(captured.subscribed).toBe(true));

    // The channel filters INSERTs to this coach's payments.
    expect(captured.channelName).toBe('ed3-first-payment-coach-xyz');
    expect(captured.filterArg).toMatchObject({
      event: 'INSERT',
      table: 'payments',
      filter: 'coach_id=eq.coach-xyz',
    });

    // Drive an INSERT.
    await act(async () => {
      captured.handler?.({
        new: { amount: 240, currency: 'usd', client_name: 'Dana' },
      });
      // allow the hasSeenFirstPayment re-check promise to resolve
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith({ amount: '$240.00', clientName: 'Dana' }),
    );
  });

  it('does NOT open the channel when the gate is already seen (no-op)', async () => {
    mockGateSeen = true;
    const onEvent = jest.fn();
    render(<Harness enabled onEvent={onEvent} />);

    // Give the async subscribe() a chance to run and bail on the gate.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockClient.channel).not.toHaveBeenCalled();
    expect(captured.subscribed).toBe(false);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('is inert when disabled (flag OFF)', async () => {
    const onEvent = jest.fn();
    render(<Harness enabled={false} onEvent={onEvent} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockClient.channel).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('tears down the subscription on unmount (unsubscribe + removeAllChannels)', async () => {
    // P1-4 cleanup: both the channel unsubscribe and the client teardown must
    // run on unmount, and neither rejection is swallowed (Bradley Law #36).
    const onEvent = jest.fn();
    const { unmount } = render(<Harness enabled onEvent={onEvent} />);
    await waitFor(() => expect(captured.subscribed).toBe(true));

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    expect(mockChannel.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mockClient.removeAllChannels).toHaveBeenCalledTimes(1);
  });
});
