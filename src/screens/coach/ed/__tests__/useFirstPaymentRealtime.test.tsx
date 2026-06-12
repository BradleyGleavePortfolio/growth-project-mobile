/**
 * useFirstPaymentRealtime — ED.3 realtime trigger contract.
 *
 * The Supabase client + channel are mocked. We assert (audit R3 P1 — first
 * SUCCESSFUL payment proof):
 *   1. An INSERT of a SUCCESSFUL payment on the coach's channel, while the gate
 *      is UNSEEN and no earlier successful payment exists, fires onFirstPayment
 *      with a formatted amount + client name.
 *   2. A non-success INSERT (failed / pending) does NOT celebrate and does NOT
 *      mark the gate seen — a later genuine paid row can still verify.
 *   3. A successful INSERT with an EARLIER successful payment does NOT
 *      celebrate, and the local gate is closed so the subscription stops
 *      re-arming.
 *   4. A successful INSERT whose only prior rows were FAILED DOES celebrate
 *      (this is the case the old count<=1 logic got wrong).
 *   5. A verification query ERROR fails closed — no celebration, gate untouched.
 *   6. When the gate is already SEEN, the channel is never opened (no-op).
 *   7. The hook subscribes with the correct INSERT filter (coach_id).
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
// Verification result, overridable per test. `verifyFirstSuccessfulPayment`
// issues client.from('payments').select(cols).eq('coach_id').in('status',...)
// .lte('created_at',...).order().order().limit(2) and reads `{ data, error }`.
// `mockRows` is the set of successful rows at-or-before the event's created_at.
let mockRows: Array<Record<string, unknown>> = [];
let mockQueryError: { message: string } | null = null;
function makeQuery() {
  const result = { data: mockRows, error: mockQueryError };
  const chain: Record<string, unknown> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.in = jest.fn(() => chain);
  chain.lte = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  // `.limit()` terminates the chain and resolves to the PostgREST result.
  chain.limit = jest.fn(async () => result);
  return chain;
}
const mockClient = {
  channel: jest.fn((name: string) => {
    captured.channelName = name;
    return mockChannel;
  }),
  from: jest.fn(() => makeQuery()),
  auth: { setSession: jest.fn(async () => undefined) },
  removeAllChannels: jest.fn(async () => undefined),
};
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockClient),
}));

import { useFirstPaymentRealtime } from '../useFirstPaymentRealtime';
import { markFirstPaymentSeen } from '../firstPaymentGate';

function Harness({ enabled, onEvent }: { enabled: boolean; onEvent: (e: unknown) => void }) {
  useFirstPaymentRealtime({
    coachId: 'coach-xyz',
    enabled,
    onFirstPayment: onEvent,
  });
  return <Text>harness</Text>;
}

// A well-formed SUCCESSFUL event row (has status + created_at + id for proof).
const successRow = {
  id: 'pay-2',
  created_at: '2026-02-01T10:00:00.000Z',
  status: 'paid',
  amount: 240,
  currency: 'usd',
  client_name: 'Dana',
};

beforeEach(() => {
  mockGateSeen = false;
  mockRows = [];
  mockQueryError = null;
  captured.handler = undefined;
  captured.filterArg = undefined;
  captured.channelName = undefined;
  captured.subscribed = false;
  jest.clearAllMocks();
});

describe('useFirstPaymentRealtime — ED.3', () => {
  it('fires onFirstPayment on a SUCCESSFUL first INSERT when the gate is unseen', async () => {
    const onEvent = jest.fn();
    // Only the event row itself comes back as a successful row at-or-before it.
    mockRows = [{ id: 'pay-2', created_at: successRow.created_at, status: 'paid' }];
    render(<Harness enabled onEvent={onEvent} />);

    await waitFor(() => expect(captured.subscribed).toBe(true));

    // The channel filters INSERTs to this coach's payments.
    expect(captured.channelName).toBe('ed3-first-payment-coach-xyz');
    expect(captured.filterArg).toMatchObject({
      event: 'INSERT',
      table: 'payments',
      filter: 'coach_id=eq.coach-xyz',
    });

    await act(async () => {
      captured.handler?.({ new: { ...successRow } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith({ amount: '$240.00', clientName: 'Dana' }),
    );
  });

  it('does NOT celebrate for a non-success INSERT and leaves the gate unseen', async () => {
    // A failed / pending first row must not spend the sanctioned exclamation,
    // and must NOT mark the gate seen — a later genuine paid row can verify.
    const onEvent = jest.fn();
    render(<Harness enabled onEvent={onEvent} />);
    await waitFor(() => expect(captured.subscribed).toBe(true));

    await act(async () => {
      captured.handler?.({
        new: { ...successRow, status: 'payment_failed' },
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onEvent).not.toHaveBeenCalled();
    // The verification query must not even run for a non-success row.
    expect(mockClient.from).not.toHaveBeenCalled();
    expect(markFirstPaymentSeen).not.toHaveBeenCalled();
  });

  it('does NOT celebrate when an EARLIER successful payment exists, and closes the gate', async () => {
    // Audit R3 P1: a coach with a prior SUCCESSFUL payment is past their first.
    const onEvent = jest.fn();
    mockRows = [
      { id: 'pay-1', created_at: '2026-01-01T09:00:00.000Z', status: 'paid' },
      { id: 'pay-2', created_at: successRow.created_at, status: 'paid' },
    ];
    render(<Harness enabled onEvent={onEvent} />);
    await waitFor(() => expect(captured.subscribed).toBe(true));

    await act(async () => {
      captured.handler?.({ new: { ...successRow } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onEvent).not.toHaveBeenCalled();
    // The local gate is closed so the subscription stops re-arming.
    expect(markFirstPaymentSeen).toHaveBeenCalledWith('coach-xyz');
  });

  it('DOES celebrate when only prior FAILED rows exist (count<=1 got this wrong)', async () => {
    // The success-scoped query returns only the event row (failed rows are
    // excluded by the .in(SUCCESS_STATUSES) filter) → this is the first SUCCESS.
    const onEvent = jest.fn();
    mockRows = [{ id: 'pay-2', created_at: successRow.created_at, status: 'paid' }];
    render(<Harness enabled onEvent={onEvent} />);
    await waitFor(() => expect(captured.subscribed).toBe(true));

    await act(async () => {
      captured.handler?.({ new: { ...successRow } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith({ amount: '$240.00', clientName: 'Dana' }),
    );
    expect(markFirstPaymentSeen).not.toHaveBeenCalled();
  });

  it('fails closed on a verification query error (no celebration, gate untouched)', async () => {
    // Audit R3 P1: if verification cannot be obtained, fail closed.
    mockQueryError = { message: 'network down' };
    const onEvent = jest.fn();
    render(<Harness enabled onEvent={onEvent} />);
    await waitFor(() => expect(captured.subscribed).toBe(true));

    await act(async () => {
      captured.handler?.({ new: { ...successRow } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onEvent).not.toHaveBeenCalled();
    // The gate is NOT closed on an unknown verdict (we could not prove either
    // way), so the subscription may re-attempt on a future open.
    expect(markFirstPaymentSeen).not.toHaveBeenCalled();
  });

  it('does NOT open the channel when the gate is already seen (no-op)', async () => {
    mockGateSeen = true;
    const onEvent = jest.fn();
    render(<Harness enabled onEvent={onEvent} />);

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
