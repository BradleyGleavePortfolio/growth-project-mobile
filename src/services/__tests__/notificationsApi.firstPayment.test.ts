/**
 * B-LSNOTIFY3-2: decodeFirstPayment, the one decoder for the backend's
 * first_payment row payload (Stripe minor units -> major units).
 */
jest.mock('../api', () => ({ __esModule: true, default: { get: jest.fn() } }));

import { decodeFirstPayment, normalizeNotification } from '../notificationsApi';

const CLIENT = 'c-1';

describe('decodeFirstPayment', () => {
  it.each([
    [4900, 'usd', 49, 'USD'],
    [4999, 'EUR', 49.99, 'EUR'],
    [500, 'jpy', 500, 'JPY'],
    [70000, 'krw', 70000, 'KRW'],
    [12345, 'kwd', 12.345, 'KWD'],
    [2500, 'bhd', 2.5, 'BHD'],
    // Stripe still sends these two with two decimals.
    [50000, 'isk', 500, 'ISK'],
    [50000, 'ugx', 500, 'UGX'],
  ])('%p %s -> %p %s', (amount, currency, major, code) => {
    expect(decodeFirstPayment({ amount, currency, clientId: CLIENT })).toEqual({
      amount: major,
      currency: code,
      clientId: CLIENT,
    });
  });

  it.each([
    [null],
    [[4900, 'usd', CLIENT]],
    [{ amount: 0, currency: 'usd', clientId: CLIENT }],
    [{ amount: -4900, currency: 'usd', clientId: CLIENT }],
    [{ amount: Number.NaN, currency: 'usd', clientId: CLIENT }],
    [{ amount: 2 ** 60, currency: 'usd', clientId: CLIENT }],
    [{ amount: 4900, currency: 'us', clientId: CLIENT }],
    [{ amount: 4900, currency: 'us1', clientId: CLIENT }],
    [{ amount: 4900, currency: 'usd', clientId: '   ' }],
    [{ amount: 4900, currency: 'usd', clientId: 7 }],
    [{ amount: 4900, currency: 'usd', clientId: 'x'.repeat(201) }],
  ])('rejects %p', (payload) => {
    expect(decodeFirstPayment(payload)).toBeNull();
  });

  it('only the first_payment kind gets firstPayment; the row keeps its server body', () => {
    const row = (kind: string) => ({
      id: 'n-1',
      kind,
      body: 'server words',
      payload: { amount: 4900, currency: 'usd', clientId: CLIENT },
      read_at: null,
      created_at: '2026-10-28T18:00:00.000Z',
    });
    expect(normalizeNotification(row('first_payment'))).toMatchObject({
      kind: 'system',
      body: 'server words',
      firstPayment: { amount: 49, currency: 'USD', clientId: CLIENT },
    });
    for (const kind of ['coach_new_purchase', 'FIRST_PAYMENT', 'first_payment_x']) {
      expect(normalizeNotification(row(kind))).not.toHaveProperty('firstPayment');
    }
  });
});
