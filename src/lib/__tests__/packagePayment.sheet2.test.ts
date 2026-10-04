/**
 * B-SHEET2-119 (agent 119), split S1 (#342):
 *   B-342-1 (Sol)  a request with no HTTP answer (offline, timeout, dropped)
 *                  proves nothing about money: never "nothing was charged";
 *                  plan guidance, support and the attempt reference instead.
 *   B-342-3 (Sol)  Stripe amounts are minor units of each currency: JPY and
 *                  every zero-decimal currency are whole units, KWD and every
 *                  three-decimal currency are thousandths (docs.stripe.com/currencies).
 */
import { PACKAGE_PAYMENT_COPY, describeBackendFailure } from '../packagePayment';
import { money, planTerms, priceLabel, purchasableFromCoachPackage } from '../planTerms';
import { currencyMinorUnits, formatCurrencyCents } from '../../utils/currency';

jest.mock('../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/sentry', () => ({ captureError: jest.fn() }));

const NO_CHARGE = /nothing was charged|not charged|did not go through|did not start/i;
const numeric = (text: string) => Number(text.replace(/[^\d.-]/g, ''));

describe('B-342-1 no HTTP answer is not proof of no charge', () => {
  const timeout = Object.assign(new Error('Synthetic request timeout'), { code: 'ECONNABORTED', request: {} });
  const network = Object.assign(new Error('Network Error'), { config: {} });
  it.each([
    ['payment_intent', timeout],
    ['subscription_intent', timeout],
    ['payment_intent', network],
    ['claim_free', network],
  ] as const)('%s with no answer: neutral copy, plan + support, key reference', (step, err) => {
    const n = describeBackendFailure(err, step, '1234abcd');
    expect(n.message).not.toMatch(NO_CHARGE);
    expect(n.message).toBe(PACKAGE_PAYMENT_COPY.noAnswer('1234abcd'));
    expect(n).toEqual(expect.objectContaining({ cause: 'no_answer', openPlan: true, support: true, reference: '1234abcd' }));
    expect(n.retireKey).toBeUndefined();
    expect(n.message).not.toMatch(/!|\b(we|our|us)\b/i);
  });

  it('control: the missing production subscription route stays specific', () => {
    const n = describeBackendFailure(
      { response: { status: 404, data: { error: 'Not Found', message: 'Cannot POST /v1/checkout/subscription-intent' } } },
      'subscription_intent',
      '1234abcd',
    );
    expect(n.cause).toBe('renewing_unavailable');
  });
});

describe('B-342-3 every currency uses its own minor-unit exponent', () => {
  it.each(['jpy', 'krw', 'vnd', 'clp', 'xof'])('%s 4900 is 4900 whole units', (cur) => {
    expect(currencyMinorUnits(cur)).toEqual({ exponent: 0, fractionDigits: 0 });
    expect(numeric(money(4900, cur))).toBe(4900);
  });

  it.each(['kwd', 'bhd', 'jod', 'omr', 'tnd'])('%s 4900 is 4.900', (cur) => {
    expect(currencyMinorUnits(cur)).toEqual({ exponent: 3, fractionDigits: 3 });
    expect(numeric(money(4900, cur))).toBe(4.9);
  });

  it.each(['isk', 'ugx'])('%s is two-decimal in Stripe amounts and shown whole', (cur) => {
    expect(numeric(money(500, cur))).toBe(5);
    expect(money(500, cur)).not.toMatch(/[.,]\d{2}$/);
  });

  it('JPY terms, price label and CTA show the real amount', () => {
    const p = purchasableFromCoachPackage({
      id: '11111111-2222-4333-8444-555555555555', name: 'Synthetic yen plan',
      billing_type: 'recurring', amount_cents: 4900, currency: 'jpy', interval: 'month',
    });
    expect(p).not.toBeNull();
    const yen = money(4900, 'jpy');
    expect(planTerms(p!).cta).toContain(yen);
    expect(planTerms(p!).renewal).toContain(yen);
    expect(priceLabel(p!)).toBe(`${yen} a month`);
    expect(p!.amountCents).toBe(4900);
  });

  it('controls: USD 4900 is 49.00; unknown codes never throw', () => {
    expect(numeric(money(4900, 'usd'))).toBe(49);
    expect(money(4900, 'usd')).toMatch(/49\.00/);
    expect(numeric(money(4900, 'eur'))).toBe(49);
    expect(() => formatCurrencyCents(1234, 'zzz')).not.toThrow();
  });
});
