/**
 * useFirstPaymentRealtime — ED.3 realtime trigger contract.
 *
 * The Supabase client + channel are mocked. The hook registers TWO
 * postgres_changes handlers on the ClientPurchase table (the real backend model,
 * schema.prisma:3449-3532, no @@map so the physical table name is the model
 * name): an UPDATE handler for the webhook's pending-to-paid transition
 * (checkout-webhook-handler.service.ts:850-865) and a DIAGNOSTIC-ONLY INSERT
 * handler that never celebrates (audit R5 P1). The mock captures both handlers
 * by event type so a test can drive either synchronously. We assert:
 *   1. A pending-to-paid UPDATE, gate UNSEEN and no earlier successful row,
 *      fires onFirstPayment EXACTLY ONCE with a formatted amount + client name
 *      (the real first-success path).
 *   2. A pending-to-paid UPDATE for an ESTABLISHED coach (an earlier successful
 *      row exists) does NOT celebrate, and closes the local gate.
 *   3. A paid-to-paid no-op UPDATE (OLD already successful) does NOT celebrate.
 *   4. An INSERT of an already-paid row does NOT celebrate (INSERT is a
 *      diagnostic-only path; the first success is always a transition UPDATE).
 *   5. A success carried ONLY in an alternate column (payment_status, no status)
 *      does NOT celebrate and does NOT mark the gate seen (ambiguous).
 *   6. Conflicting status fields (status pending + payment_status paid) do NOT
 *      celebrate and do NOT mark the gate seen (ambiguous).
 *   7. A non-success UPDATE (still pending) does NOT celebrate and does NOT mark
 *      the gate seen — a later genuine paid transition can still verify.
 *   8. A verification query ERROR fails closed — no celebration, gate untouched.
 *   9. When the gate is already SEEN, the channel is never opened (no-op).
 *  10. The hook subscribes with the correct table + tenant filter (coach_user_id).
 *  11. An UPDATE with the OLD status ABSENT (payload omitted prior status) fails
 *      closed — the transition is unprovable, so no celebration.
 *  12. A canceled-to-paid UPDATE on the SAME row does NOT celebrate (same-row
 *      re-activation, not a first success).
 *  13. A payment_failed-to-paid UPDATE DOES celebrate (first success ever).
 *  14. Two pending-to-paid payloads for the same row in the same tick fire
 *      onFirstPayment EXACTLY ONCE (synchronous fired latch).
 *
 * No mock-echo (#17): the hook is driven through a mocked supabase channel/client
 * and we assert specific behaviours (fires / does not, gate marked / not), never
 * that an input equals itself.
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

// ── supabase-js mock — capture each handler by event type + the filters. ────
type RealtimePayload = {
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
};
interface Captured {
  updateHandler?: (payload: RealtimePayload) => void;
  insertHandler?: (payload: RealtimePayload) => void;
  updateFilter?: Record<string, unknown>;
  insertFilter?: Record<string, unknown>;
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
  on: jest.fn(
    (
      _event: string,
      filter: Record<string, unknown>,
      handler: (p: RealtimePayload) => void,
    ) => {
      if (filter.event === 'UPDATE') {
        captured.updateFilter = filter;
        captured.updateHandler = handler;
      } else if (filter.event === 'INSERT') {
        captured.insertFilter = filter;
        captured.insertHandler = handler;
      }
      return mockChannel;
    },
  ),
  subscribe: jest.fn((cb?: (status: string) => void) => {
    captured.subscribed = true;
    cb?.('SUBSCRIBED');
    return mockChannel;
  }),
  unsubscribe: jest.fn(),
};
// Verification result, overridable per test. verifyFirstSuccessfulPayment issues
// client.from('ClientPurchase').select(cols).eq('coach_user_id').in('status',...)
// .lte('created_at',...).order().order().limit(2) and reads { data, error }.
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

function Harness({
  enabled,
  onEvent,
}: {
  enabled: boolean;
  onEvent: (e: unknown) => void;
}) {
  useFirstPaymentRealtime({
    coachId: 'coach-xyz',
    enabled,
    onFirstPayment: onEvent,
  });
  return <Text>harness</Text>;
}

// A well-formed PAID purchase row (has status + created_at + id for proof).
const paidRow = {
  id: 'pay-2',
  created_at: '2026-02-01T10:00:00.000Z',
  status: 'paid',
  amount_cents: 24000,
  currency: 'usd',
  client_name: 'Dana',
};
// The OLD record before the webhook transition (pending).
const pendingOld = { ...paidRow, status: 'pending' };

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  mockGateSeen = false;
  mockRows = [];
  mockQueryError = null;
  captured.updateHandler = undefined;
  captured.insertHandler = undefined;
  captured.updateFilter = undefined;
  captured.insertFilter = undefined;
  captured.channelName = undefined;
  captured.subscribed = false;
  jest.clearAllMocks();
});

describe('useFirstPaymentRealtime — ED.3', () => {
  it('fires onFirstPayment EXACTLY ONCE on a pending-to-paid UPDATE when first and gate unseen', async () => {
    const onEvent = jest.fn();
    // Only the event row itself comes back as a successful row at-or-before it.
    mockRows = [
      { id: 'pay-2', created_at: paidRow.created_at, status: 'paid' },
    ];
    render(<Harness enabled onEvent={onEvent} />);

    await waitFor(() => expect(captured.subscribed).toBe(true));

    // The channel filters BOTH events to this coach's purchases on the real
    // table + tenant column.
    expect(captured.channelName).toBe('ed3-first-payment-coach-xyz');
    expect(captured.updateFilter).toMatchObject({
      event: 'UPDATE',
      table: 'ClientPurchase',
      filter: 'coach_user_id=eq.coach-xyz',
    });
    expect(captured.insertFilter).toMatchObject({
      event: 'INSERT',
      table: 'ClientPurchase',
      filter: 'coach_user_id=eq.coach-xyz',
    });

    await act(async () => {
      captured.updateHandler?.({ new: { ...paidRow }, old: { ...pendingOld } });
      await flush();
    });

    await waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith({
        amount: '$240.00',
        clientName: 'Dana',
      }),
    );
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('does NOT celebrate a pending-to-paid UPDATE for an established coach, and closes the gate', async () => {
    const onEvent = jest.fn();
    mockRows = [
      { id: 'pay-1', created_at: '2026-01-01T09:00:00.000Z', status: 'paid' },
      { id: 'pay-2', created_at: paidRow.created_at, status: 'paid' },
    ];
    render(<Harness enabled onEvent={onEvent} />);
    await waitFor(() => expect(captured.subscribed).toBe(true));

    await act(async () => {
      captured.updateHandler?.({ new: { ...paidRow }, old: { ...pendingOld } });
      await flush();
    });

    expect(onEvent).not.toHaveBeenCalled();
    // The local gate is closed so the subscription stops re-arming.
    expect(markFirstPaymentSeen).toHaveBeenCalledWith('coach-xyz');
  });

  it('does NOT celebrate a paid-to-paid no-op UPDATE (OLD already successful)', async () => {
    // A later non-status field change on an already-paid row must not re-fire.
    const onEvent = jest.fn();
    mockRows = [
      { id: 'pay-2', created_at: paidRow.created_at, status: 'paid' },
    ];
    render(<Harness enabled onEvent={onEvent} />);
    await waitFor(() => expect(captured.subscribed).toBe(true));

    await act(async () => {
      captured.updateHandler?.({
        new: { ...paidRow },
        old: { ...paidRow, status: 'active' },
      });
      await flush();
    });

    expect(onEvent).not.toHaveBeenCalled();
    // No transition into success → no firstness query, no gate write.
    expect(mockClient.from).not.toHaveBeenCalled();
    expect(markFirstPaymentSeen).not.toHaveBeenCalled();
  });

  it('does NOT celebrate an INSERT of an already-paid row (INSERT is diagnostic-only)', async () => {
    // Audit R5 P1: the first success is ALWAYS a pending-to-paid transition
    // UPDATE on the same row. The INSERT subscription never calls
    // onFirstPayment, so a direct already-successful INSERT must not fire and
    // must not run the firstness query or mark the gate.
    const onEvent = jest.fn();
    mockRows = [
      { id: 'pay-2', created_at: paidRow.created_at, status: 'paid' },
    ];
    render(<Harness enabled onEvent={onEvent} />);
    await waitFor(() => expect(captured.subscribed).toBe(true));

    await act(async () => {
      captured.insertHandler?.({ new: { ...paidRow } });
      await flush();
    });

    expect(onEvent).not.toHaveBeenCalled();
    expect(mockClient.from).not.toHaveBeenCalled();
    expect(markFirstPaymentSeen).not.toHaveBeenCalled();
  });

  it('does NOT celebrate when success is carried ONLY in an alternate column', async () => {
    // No authoritative `status`, success only in `payment_status` → ambiguous.
    const onEvent = jest.fn();
    render(<Harness enabled onEvent={onEvent} />);
    await waitFor(() => expect(captured.subscribed).toBe(true));

    await act(async () => {
      captured.insertHandler?.({
        new: {
          id: 'pay-2',
          created_at: paidRow.created_at,
          payment_status: 'paid',
          amount_cents: 24000,
          currency: 'usd',
          client_name: 'Dana',
        },
      });
      await flush();
    });

    expect(onEvent).not.toHaveBeenCalled();
    expect(mockClient.from).not.toHaveBeenCalled();
    expect(markFirstPaymentSeen).not.toHaveBeenCalled();
  });

  it('does NOT celebrate when status fields conflict (status pending + payment_status paid)', async () => {
    const onEvent = jest.fn();
    render(<Harness enabled onEvent={onEvent} />);
    await waitFor(() => expect(captured.subscribed).toBe(true));

    await act(async () => {
      captured.insertHandler?.({
        new: {
          ...paidRow,
          status: 'pending',
          payment_status: 'paid',
        },
      });
      await flush();
    });

    expect(onEvent).not.toHaveBeenCalled();
    expect(mockClient.from).not.toHaveBeenCalled();
    expect(markFirstPaymentSeen).not.toHaveBeenCalled();
  });

  it('does NOT celebrate a still-pending UPDATE and leaves the gate unseen', async () => {
    // A pending-to-pending (or to a failed) update must not spend the
    // sanctioned exclamation, and must NOT mark the gate seen.
    const onEvent = jest.fn();
    render(<Harness enabled onEvent={onEvent} />);
    await waitFor(() => expect(captured.subscribed).toBe(true));

    await act(async () => {
      captured.updateHandler?.({
        new: { ...paidRow, status: 'payment_failed' },
        old: { ...pendingOld },
      });
      await flush();
    });

    expect(onEvent).not.toHaveBeenCalled();
    expect(mockClient.from).not.toHaveBeenCalled();
    expect(markFirstPaymentSeen).not.toHaveBeenCalled();
  });

  it('fails closed on an UPDATE whose OLD status is ABSENT (transition unprovable)', async () => {
    // Supabase UPDATE payloads may omit prior column values (primary-key-only
    // replica identity). Without an authoritative OLD status we cannot prove a
    // pending-to-paid transition, so we must FAIL CLOSED and not celebrate, nor
    // run the firstness query, nor mark the gate.
    const onEvent = jest.fn();
    mockRows = [
      { id: 'pay-2', created_at: paidRow.created_at, status: 'paid' },
    ];
    render(<Harness enabled onEvent={onEvent} />);
    await waitFor(() => expect(captured.subscribed).toBe(true));

    await act(async () => {
      // `old` carries the id only — no status field.
      captured.updateHandler?.({ new: { ...paidRow }, old: { id: 'pay-2' } });
      await flush();
    });

    expect(onEvent).not.toHaveBeenCalled();
    expect(mockClient.from).not.toHaveBeenCalled();
    expect(markFirstPaymentSeen).not.toHaveBeenCalled();
  });

  it('does NOT celebrate a canceled-to-paid UPDATE on the SAME row (re-activation)', async () => {
    // A row can only reach `canceled` after it was previously successful, so a
    // canceled-to-paid transition on the same row is a re-purchase / re-activation,
    // NOT the coach's first payment. The firstness query excludes the event row
    // itself, so the OLD-status replay guard is what blocks this.
    const onEvent = jest.fn();
    mockRows = [
      { id: 'pay-2', created_at: paidRow.created_at, status: 'paid' },
    ];
    render(<Harness enabled onEvent={onEvent} />);
    await waitFor(() => expect(captured.subscribed).toBe(true));

    await act(async () => {
      captured.updateHandler?.({
        new: { ...paidRow },
        old: { ...paidRow, status: 'canceled' },
      });
      await flush();
    });

    expect(onEvent).not.toHaveBeenCalled();
    expect(mockClient.from).not.toHaveBeenCalled();
    expect(markFirstPaymentSeen).not.toHaveBeenCalled();
  });

  it('fires on a payment_failed-to-paid UPDATE (first success ever)', async () => {
    // `payment_failed` is a charge that never cleared — it does NOT imply a
    // prior success, so a payment_failed-to-paid transition IS a genuine first
    // success and must celebrate (exactly once).
    const onEvent = jest.fn();
    mockRows = [
      { id: 'pay-2', created_at: paidRow.created_at, status: 'paid' },
    ];
    render(<Harness enabled onEvent={onEvent} />);
    await waitFor(() => expect(captured.subscribed).toBe(true));

    await act(async () => {
      captured.updateHandler?.({
        new: { ...paidRow },
        old: { ...paidRow, status: 'payment_failed' },
      });
      await flush();
    });

    await waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith({
        amount: '$240.00',
        clientName: 'Dana',
      }),
    );
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('fires EXACTLY ONCE for two same-tick pending-to-paid payloads on the same row', async () => {
    // Duplicate realtime delivery for the same first success (same tick, before
    // the async verification of the first resolves and before the dismissal
    // gate closes) must NOT double-call onFirstPayment — the synchronous
    // firedLatchRef collapses the duplicate.
    const onEvent = jest.fn();
    mockRows = [
      { id: 'pay-2', created_at: paidRow.created_at, status: 'paid' },
    ];
    render(<Harness enabled onEvent={onEvent} />);
    await waitFor(() => expect(captured.subscribed).toBe(true));

    await act(async () => {
      // Two deliveries in the SAME synchronous tick before any await resolves.
      captured.updateHandler?.({ new: { ...paidRow }, old: { ...pendingOld } });
      captured.updateHandler?.({ new: { ...paidRow }, old: { ...pendingOld } });
      await flush();
    });

    await waitFor(() => expect(onEvent).toHaveBeenCalled());
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('fails closed on a verification query error (no celebration, gate untouched)', async () => {
    mockQueryError = { message: 'network down' };
    const onEvent = jest.fn();
    render(<Harness enabled onEvent={onEvent} />);
    await waitFor(() => expect(captured.subscribed).toBe(true));

    await act(async () => {
      captured.updateHandler?.({ new: { ...paidRow }, old: { ...pendingOld } });
      await flush();
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
