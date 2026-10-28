/**
 * B-LSNOTIFY3-2 (backend b#1169 LS-NOTIFY3; FR-NOTIFY4, agent 180): the
 * backend's real first-payment row, read through the real fetchNotifications
 * and normalizer into the real hook, fires the coach's celebration once.
 *
 * The row is what growth-project-backend src/notifications/emitters/
 * first-payment.emitter.ts writes (cited, not imported): kind 'first_payment',
 * payload { amount, currency, clientId }, amount in the currency's minor units
 * (Stripe's amount: 4900 is $49.00), currency as Stripe sends it ('usd'). The
 * celebration (FirstPaymentWowHost.formatPaymentAmount) reads major units.
 * Only the HTTP client is mocked.
 */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockGet = jest.fn();
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));

import { useFirstPaymentNotification } from '../useNotifications';
import { normalizeNotification } from '../../services/notificationsApi';

const CLIENT = '6f1c1a8e-2b7d-4c3e-9a51-0d2f4e6b8a10';
const BODY = 'You just landed your first client. Your first payment is on its way.';

function backendRow(payload: Record<string, unknown>, id = 'n-fp-1') {
  return {
    id,
    user_id: 'coach-1',
    kind: 'first_payment',
    channel: 'inapp',
    body: BODY,
    deep_link: `tgp://coach/clients/${CLIENT}`,
    payload,
    read_at: null,
    created_at: '2026-10-28T18:00:00.000Z',
    inbox_hidden: false,
  };
}

function serve(items: unknown[]): void {
  mockGet.mockResolvedValue({ data: { items, nextCursor: null } });
}

interface Paid {
  amount: number;
  currency: string;
  clientId: string;
}

function Harness({ onFirstPayment }: { onFirstPayment: (p: Paid) => void }) {
  const { error } = useFirstPaymentNotification({
    coachId: 'coach-1',
    enabled: true,
    onFirstPayment,
    pollIntervalMs: 10,
  });
  return <Text testID="err">{error ?? 'none'}</Text>;
}

beforeEach(() => {
  mockGet.mockReset();
});

describe('B-LSNOTIFY3-2: the backend first-payment row reaches the celebration', () => {
  it('(failed before) $49.00 fires once with { amount: 49, currency: USD, clientId }', async () => {
    serve([backendRow({ amount: 4900, currency: 'usd', clientId: CLIENT })]);
    const onFirstPayment = jest.fn();
    await render(<Harness onFirstPayment={onFirstPayment} />);
    await waitFor(() => expect(onFirstPayment).toHaveBeenCalledTimes(1));
    expect(onFirstPayment).toHaveBeenCalledWith({ amount: 49, currency: 'USD', clientId: CLIENT });
    expect(mockGet).toHaveBeenCalledWith(expect.stringMatching(/^\/notifications/));
    // Later polls see the same row; the celebration still fires once.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(mockGet.mock.calls.length).toBeGreaterThan(0);
    expect(onFirstPayment).toHaveBeenCalledTimes(1);
  });

  it('(failed before) the amount follows the currency: yen has no minor unit, dinar has three', async () => {
    const cases: Array<[Record<string, unknown>, Paid]> = [
      [{ amount: 500, currency: 'jpy', clientId: CLIENT }, { amount: 500, currency: 'JPY', clientId: CLIENT }],
      [{ amount: 12345, currency: 'kwd', clientId: CLIENT }, { amount: 12.345, currency: 'KWD', clientId: CLIENT }],
    ];
    for (const [payload, expected] of cases) {
      serve([backendRow(payload)]);
      const onFirstPayment = jest.fn();
      const view = await render(<Harness onFirstPayment={onFirstPayment} />);
      await waitFor(() => expect(onFirstPayment).toHaveBeenCalledTimes(1));
      expect(onFirstPayment).toHaveBeenCalledWith(expected);
      view.unmount();
    }
  });

  it('(failed before) in the inbox it stays a plain row with the server words and the client link', () => {
    const n = normalizeNotification(backendRow({ amount: 4900, currency: 'usd', clientId: CLIENT }));
    expect(n).toMatchObject({
      id: 'n-fp-1',
      kind: 'system',
      body: BODY,
      read: false,
      deepLink: `tgp://coach/clients/${CLIENT}`,
      firstPayment: { amount: 49, currency: 'USD', clientId: CLIENT },
    });
    expect(n?.actionParams).toBeUndefined();
  });

  it('a malformed first-payment row never fires and never throws', async () => {
    const malformed: Array<Record<string, unknown>> = [
      { amount: 4900, currency: 'usd' },
      { amount: '4900', currency: 'usd', clientId: CLIENT },
      { amount: 49.5, currency: 'usd', clientId: CLIENT },
      { amount: 4900, currency: 'dollars', clientId: CLIENT },
    ];
    for (const payload of malformed) {
      serve([backendRow(payload)]);
      const onFirstPayment = jest.fn();
      const view = await render(<Harness onFirstPayment={onFirstPayment} />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(onFirstPayment).not.toHaveBeenCalled();
      expect(view.getByTestId('err').props.children).toBe('none');
      view.unmount();
    }
  });

  it('another kind carrying the same payload keys is not a first payment', async () => {
    serve([{ ...backendRow({ amount: 4900, currency: 'usd', clientId: CLIENT }), kind: 'coach_new_purchase' }]);
    const onFirstPayment = jest.fn();
    await render(<Harness onFirstPayment={onFirstPayment} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(onFirstPayment).not.toHaveBeenCalled();
  });
});
