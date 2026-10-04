/**
 * L1 contract (B-LOCK-118): truthful copy against today's production backend
 * (no native card routes yet), dispute facts kept in the outcome copy
 * (B-353-2 / C-352-5), and the native flow's ownership port (B-353-2).
 */
import { normalizeCardUpdate, normalizePaymentQuote } from '../dunningApi';
import {
  cancelOutcomeCopy,
  cardUpdateOutcomeCopy,
  describeDunningError,
  disputeNotSettledLine,
  SUPPORT_EMAIL,
} from '../dunningErrorCopy';
import { confirmWithBank, runNativeCardUpdate, type StripeSdk } from '../updateCard';

jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));

const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: (...args: unknown[]) => mockPost(...args) },
}));

const SETUP = {
  setup_intent_id: 'seti_1',
  setup_intent_client_secret: 'seti_1_secret',
  ephemeral_key: 'ek_1',
  customer_id: 'cus_1',
  publishable_key: 'pk_test_backend',
  merchant_display_name: 'The Growth Project',
};
const PAID = {
  outcome: 'paid',
  amount_paid_cents: 15000,
  amount_due_cents: 0,
  currency: 'usd',
  paid_totals: [{ currency: 'usd', amount_cents: 15000 }],
  due_totals: [],
  access_restored: true,
  access_state: 'restored',
};

function sdkDouble(over: Partial<Record<keyof StripeSdk, jest.Mock>> = {}): StripeSdk {
  return {
    initStripe: jest.fn(async () => undefined),
    initPaymentSheet: jest.fn(async () => ({})),
    presentPaymentSheet: jest.fn(async () => ({})),
    handleNextAction: jest.fn(async () => ({ paymentIntent: { status: 'Succeeded' } })),
    handleURLCallback: jest.fn(async () => true),
    ...over,
  } as unknown as StripeSdk;
}

/** Production's envelope for a route it does not have (src/filters/not-found-envelope.ts). */
function productionRouteMissing(path: string) {
  return Object.assign(new Error('Request failed with status code 404'), {
    response: {
      status: 404,
      data: {
        statusCode: 404,
        message: `Cannot POST /api${path}`,
        error: 'Not Found',
        timestamp: '2026-10-04T17:00:00.000Z',
        path: `/api${path}`,
        request_id: 'req-404',
      },
      headers: {},
    },
  });
}

beforeEach(() => {
  mockPost.mockReset();
});

describe("today's production backend (no native card routes)", () => {
  it('a missing card route says the in-app update is not available yet, nothing was charged, and is not reported', () => {
    for (const action of ['update_card', 'confirm_card'] as const) {
      const c = describeDunningError(productionRouteMissing('/v1/checkout/payment-method/setup-intent'), action);
      expect(c.code).toBe('BILLING_ROUTE_NOT_AVAILABLE');
      expect(c.report).toBe(false);
      expect(c.message).toContain('not available yet, so nothing was charged');
      expect(c.message).toContain(SUPPORT_EMAIL);
    }
    const cancel = describeDunningError(productionRouteMissing('/v1/checkout/subscriptions/p1/cancel'), 'cancel_plan');
    expect(cancel.code).toBe('BILLING_ROUTE_NOT_AVAILABLE');
    expect(cancel.message).toContain('nothing changed');
  });

  it('a bare 503 on a money call (reason phrase, no code) is "not confirmed", never "nothing changed"', () => {
    const err = Object.assign(new Error('Request failed with status code 503'), {
      response: { status: 503, data: { statusCode: 503, error: 'Service Unavailable', message: 'x' }, headers: {} },
    });
    const c = describeDunningError(err, 'confirm_card');
    expect(c.code).toBe('RESULT_NOT_CONFIRMED');
    expect(c.message).not.toMatch(/nothing changed|nothing was charged/);
  });

  it('a 404 that carries a machine code keeps its specific copy', () => {
    const err = Object.assign(new Error('x'), {
      response: { status: 404, data: { code: 'PURCHASE_NOT_FOUND', error: 'PURCHASE_NOT_FOUND' }, headers: {} },
    });
    expect(describeDunningError(err, 'cancel_plan').code).toBe('PLAN_NOT_FOUND');
  });
});

describe('B-353-2 / C-352-5: dispute facts survive into the outcome copy', () => {
  it('a dispute-only Save card says nothing was charged and that saving a card does not settle the reversal', () => {
    const r = normalizeCardUpdate({
      outcome: 'saved',
      amount_paid_cents: 0,
      amount_due_cents: 0,
      currency: 'usd',
      paid_totals: [],
      due_totals: [],
      access_restored: false,
      access_state: 'unchanged',
      plans: [{ purchase_id: 'p1', dispute_open: true, currency: 'usd' }],
      quote: {
        quote_id: 'q',
        complete: true,
        lines: [],
        totals: [],
        disputes: [{ purchase_id: 'p1', coach_name: 'Avery', currency: 'usd', amount_cents: 15000 }],
      },
    });
    expect(r.disputes).toEqual([{ purchase_id: 'p1', coach_name: 'Avery', currency: 'usd', amount_cents: 15000 }]);
    const c = cardUpdateOutcomeCopy(r);
    expect(c.body).toContain('There was no open invoice to pay, so nothing was charged.');
    expect(c.body).toContain('Your bank reversed an earlier payment of $150.00. Saving a card does not settle that.');
    expect(c.body).not.toContain('Your next payment will use it');
    expect(c.tone).toBe('action');
  });

  it('a mixed update names what was paid and keeps the dispute line', () => {
    const r = normalizeCardUpdate({
      ...PAID,
      access_restored: false,
      access_state: 'partial',
      plans: [
        { purchase_id: 'p1', dispute_open: false },
        { purchase_id: 'p2', dispute_open: true },
      ],
    });
    const c = cardUpdateOutcomeCopy(r);
    expect(c.body).toContain('$150.00 went through');
    expect(c.body).toContain('Your bank reversed an earlier payment. Saving a card does not settle that.');
  });

  it('when the answer reports no plans, the quote read before the card form supplies the disputes', () => {
    const r = normalizeCardUpdate({ ...PAID, outcome: 'saved', paid_totals: [], amount_paid_cents: 0 });
    expect(r.disputes).toBeNull();
    const quote = normalizePaymentQuote({
      quote_id: 'q',
      complete: true,
      lines: [],
      totals: [],
      disputes: [{ purchase_id: 'p1', coach_name: null, currency: 'eur', amount_cents: 8000 }],
    });
    expect(cardUpdateOutcomeCopy(r, quote.disputes).body).toContain('reversed an earlier payment of 80.00 EUR');
    expect(cardUpdateOutcomeCopy(r).body).toContain('Your next payment will use it');
  });

  it('ending a disputed plan keeps the server limitation', () => {
    const ended = {
      outcome: 'ended' as const,
      purchase_id: 'p1',
      access_ends_at: null,
      voided_invoice_count: 0,
      voided_amount_cents: 0,
      currency: 'usd',
      paid_period_kept: false,
      message: null,
    };
    expect(cancelOutcomeCopy(ended, { dispute: true }).body).toContain(
      'Ending the plan does not settle the payment your bank reversed.',
    );
    expect(cancelOutcomeCopy(ended).body).not.toContain('reversed');
    expect(disputeNotSettledLine([])).toBeNull();
  });
});

describe('B-353-2: a retired screen starts no further native or payment step', () => {
  const base = {
    surface: 'test',
    colorScheme: 'light' as const,
    primaryButtonLabel: 'Save card and pay $150.00',
    approved: [{ invoice_id: 'in_1', amount_cents: 15000, currency: 'usd' }],
    retryDelaysMs: [0, 0],
  };

  it('retired while the SetupIntent is created: no card form, no confirm', async () => {
    let current = true;
    mockPost.mockImplementation(async (url: string) => {
      current = false;
      return { data: url.endsWith('/setup-intent') ? SETUP : PAID };
    });
    const sdk = sdkDouble();
    const out = await runNativeCardUpdate({ ...base, sdk, isCurrent: () => current });
    expect(out).toEqual({ kind: 'retired' });
    expect(sdk.presentPaymentSheet).not.toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('retired while the card form is open: the late native return sends no confirm', async () => {
    let current = true;
    mockPost.mockImplementation(async (url: string) => ({ data: url.endsWith('/setup-intent') ? SETUP : PAID }));
    const sdk = sdkDouble({
      presentPaymentSheet: jest.fn(async () => {
        current = false;
        return {};
      }),
    });
    const out = await runNativeCardUpdate({ ...base, sdk, isCurrent: () => current });
    expect(out).toEqual({ kind: 'retired' });
    expect(mockPost.mock.calls.map(([url]) => url)).toEqual(['/v1/checkout/payment-method/setup-intent']);
  });

  it('retired during the bank step: no re-confirm', async () => {
    let current = true;
    mockPost.mockImplementation(async () => ({ data: PAID }));
    const sdk = sdkDouble({
      handleNextAction: jest.fn(async () => {
        current = false;
        return { paymentIntent: { status: 'Succeeded' } };
      }),
    });
    const out = await confirmWithBank({
      sdk,
      surface: 'test',
      setupIntentId: 'seti_1',
      clientSecret: 'pi_1_secret',
      approved: base.approved,
      retryDelaysMs: [0, 0],
      isCurrent: () => current,
    });
    expect(out).toEqual({ kind: 'retired' });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('CONTROL: a current screen completes the paid flow', async () => {
    mockPost.mockImplementation(async (url: string) => ({ data: url.endsWith('/setup-intent') ? SETUP : PAID }));
    const out = await runNativeCardUpdate({ ...base, sdk: sdkDouble(), isCurrent: () => true });
    expect(out.kind).toBe('done');
    expect(mockPost).toHaveBeenCalledWith('/v1/checkout/payment-method/confirm', {
      setup_intent_id: 'seti_1',
      approved_invoices: base.approved,
    });
  });
});
