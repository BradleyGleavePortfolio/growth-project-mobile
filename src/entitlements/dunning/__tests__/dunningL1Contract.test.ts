/**
 * L1 contract (B-LOCK-118, B-LOCK2-120): truthful copy against today's
 * production backend (no native card routes yet), R-DISPUTE-PAUSE dispute
 * facts in every outcome (B-352-2 / B-352-7 / C-352-5), and the native flow's
 * ownership port (B-353-2) including the shared native sheet (B-352-3).
 */
import { normalizeCardUpdate, normalizeDunningStatus, normalizePaymentQuote } from '../dunningApi';
import {
  cancelOutcomeCopy,
  cardUpdateOutcomeCopy,
  describeDunningError,
  disputeNotSettledLine,
  disputePauseFacts,
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

/** R-DISPUTE-PAUSE: the three facts, with the words both lenses' probes look for. */
function expectDisputePause(text: string) {
  expect(text).toMatch(/access has ended/i);
  expect(text).toMatch(/billing is paused/i);
  expect(text).toMatch(/coach[^.]*\bdecides whether to restart/i);
  expect(text).toMatch(/does not restart on its own or with a new card/);
  // B-352-7: no support fix, no settlement, no restore promise.
  expect(text).not.toMatch(/sort it out|settle|Email /i);
}

describe('B-352-2 / B-352-7 / C-352-5: dispute outcomes say R-DISPUTE-PAUSE', () => {
  it('a dispute-only Save card: nothing charged, access ended, billing paused, the coach decides; no future payment', () => {
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
    expect(c.body).toContain(
      'Your bank opened a dispute or inquiry about a payment of $150.00 to Avery. For that plan, access has ended and billing is paused. Your coach, Avery, decides whether to restart it.',
    );
    expectDisputePause(c.body);
    expect(c.body).not.toContain('Your next payment will use it');
    expect(c.tone).toBe('action');
  });

  it('mixed paid + disputed (partial): the paid amount stays, access news is scoped to the paid plan only', () => {
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
    expect(c.body).toContain('$150.00 went through. The plan you paid for updates within a few minutes.');
    expect(c.body).not.toMatch(/Your plan updates within a few minutes/);
    expect(c.title).toBe('Payment received');
    expectDisputePause(c.body);
  });

  it('mixed restored / processing / in progress: no outcome promises the disputed plan comes back', () => {
    const plans = [{ purchase_id: 'p1' }, { purchase_id: 'p2', dispute_open: true }];
    const restored = cardUpdateOutcomeCopy(normalizeCardUpdate({ ...PAID, plans }));
    expect(restored.body).toContain('The plan you paid for is active again.');
    expect(restored.body).not.toContain('Your plan is active again');
    const processing = cardUpdateOutcomeCopy(
      normalizeCardUpdate({
        ...PAID,
        outcome: 'processing',
        due_totals: [{ currency: 'usd', amount_cents: 9000 }],
        access_restored: false,
        access_state: 'updating',
        plans,
      }),
    );
    expect(processing.body).toContain('The plan it pays for updates as soon as it clears');
    expect(processing.body).not.toMatch(/Your plan updates/);
    const busy = cardUpdateOutcomeCopy(
      normalizeCardUpdate({ ...PAID, outcome: 'in_progress', access_restored: false, access_state: 'partial', plans }),
    );
    expect(busy.body).toContain('The plan you paid for updates within a few minutes.');
    for (const c of [restored, processing, busy]) expectDisputePause(c.body);
  });

  it('two disputed plans in two currencies: per-currency amounts, each coach decides', () => {
    const line = disputeNotSettledLine([
      { purchase_id: 'p1', coach_name: 'Avery', currency: 'usd', amount_cents: 15000 },
      { purchase_id: 'p2', coach_name: 'Blake', currency: 'eur', amount_cents: 8000 },
    ]);
    expect(line).toBe(
      'Your bank opened disputes or inquiries about payments of $150.00 and 80.00 EUR. For those plans, access has ended and billing is paused. Each coach decides whether to restart them. They do not restart on their own or with a new card.',
    );
    expect(disputePauseFacts(null, 'account')).toBe(
      'Your access has ended and billing is paused. Your coach decides whether to restart it. It does not restart on its own or with a new card.',
    );
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
    const body = cardUpdateOutcomeCopy(r, quote.disputes).body;
    expect(body).toContain('Your bank opened a dispute or inquiry about a payment of 80.00 EUR. For that plan, access has ended');
    expectDisputePause(body);
    expect(cardUpdateOutcomeCopy(r).body).toContain('Your next payment will use it');
  });

  it('ending a disputed plan: access had already ended, billing paused, only the coach restarts; no support fix', () => {
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
    const body = cancelOutcomeCopy(ended, { dispute: true }).body;
    expect(body).toContain('its access had already ended and its billing was paused. Only your coach can restart it.');
    expect(body).not.toMatch(/sort it out|settle|Email /i);
    expect(cancelOutcomeCopy(ended).body).not.toContain('reversed');
    expect(disputeNotSettledLine([])).toBeNull();
  });

  it('B-352-9: an inquiry (same envelope, no amount, no money moved) is never called a reversal', () => {
    const quote = normalizePaymentQuote({
      quote_id: 'q_inquiry',
      complete: true,
      lines: [],
      totals: [],
      disputes: [{ purchase_id: 'p_inquiry', coach_name: 'Avery', amount_cents: null, currency: null }],
    });
    const line = disputeNotSettledLine(quote.disputes) ?? '';
    expect(line).toBe(
      'Your bank opened a dispute or inquiry about a payment to Avery. For that plan, access has ended and billing is paused. Your coach, Avery, decides whether to restart it. It does not restart on its own or with a new card.',
    );
    const saved = cardUpdateOutcomeCopy(
      normalizeCardUpdate({
        ...PAID,
        outcome: 'saved',
        amount_paid_cents: 0,
        paid_totals: [],
        access_restored: false,
        access_state: 'unchanged',
        quote: { quote_id: 'q_inquiry', complete: true, lines: [], totals: [], disputes: quote.disputes },
        plans: [{ purchase_id: 'p_inquiry', dispute_open: true }],
      }),
    ).body;
    const mixed = cardUpdateOutcomeCopy(normalizeCardUpdate({ ...PAID, plans: [{ purchase_id: 'p1' }, { purchase_id: 'p2', dispute_open: true }] })).body;
    const cancel = cancelOutcomeCopy(
      { outcome: 'ended', purchase_id: 'p_inquiry', access_ends_at: null, voided_invoice_count: 0, voided_amount_cents: 0, currency: null, paid_period_kept: false, message: null },
      { dispute: true },
    ).body;
    const twoOnOnePlan = disputeNotSettledLine([quote.disputes[0], { ...quote.disputes[0], amount_cents: 5000, currency: 'usd' }]);
    expect(twoOnOnePlan).toMatch(/^Your bank opened disputes or inquiries about payments of \$50\.00 to Avery\. For that plan,/);
    expect(saved).toContain('nothing was charged');
    expect(mixed).toContain('$150.00 went through');
    expect(cancel).toContain('Your bank had opened a dispute or inquiry about a payment on this plan');
    for (const body of [line, saved, mixed]) expectDisputePause(body);
    for (const body of [line, saved, mixed, cancel]) expect(body).not.toMatch(/revers|took back|taken back|withdr|refund/i);
  });
});

describe('R-DISPUTE-PAUSE status contract (backend D2c #705) and older envelopes', () => {
  const D2C = {
    enabled: true,
    state: 'locked',
    kind: 'dispute',
    lock_waived: false,
    purchase_id: 'p1',
    amount_cents: null,
    currency: 'usd',
    failed_at: '2026-10-04T15:00:00.000Z',
    lockout_at: null,
    locked_at: '2026-10-04T15:00:00.000Z',
    day: null,
    coach_name: 'Avery',
    card_last4: null,
    card_brand: null,
    update_payment_route: null,
    update_card_url: null,
    cancel_route: null,
    reason: 'dispute_paused',
    access_ended: true,
    billing_paused: true,
    restart_by: 'coach',
  };

  it('a D2c dispute pause reads as a dispute with its reason and no lock date', () => {
    const s = normalizeDunningStatus(D2C);
    expect(s).toMatchObject({ state: 'locked', kind: 'dispute', reason: 'dispute_paused', lockout_at: null });
    expect(normalizeDunningStatus({ ...D2C, kind: null }).kind).toBe('dispute');
  });

  it("an older envelope's dispute grace date is dropped; a failed payment keeps its lock date", () => {
    const legacy = { ...D2C, state: 'past_due', reason: undefined, lockout_at: '2030-10-11T15:00:00.000Z' };
    expect(normalizeDunningStatus(legacy)).toMatchObject({ kind: 'dispute', reason: null, lockout_at: null });
    const payment = { ...legacy, kind: 'payment', reason: 'payment_failed' };
    expect(normalizeDunningStatus(payment)).toMatchObject({
      kind: 'payment',
      reason: 'payment_failed',
      lockout_at: '2030-10-11T15:00:00.000Z',
    });
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

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  it('B-352-3: retired while initStripe awaits: the shared sheet is never initialized or presented', async () => {
    let current = true;
    const stripe = deferred<void>();
    mockPost.mockResolvedValue({ data: SETUP });
    const sdk = sdkDouble({ initStripe: jest.fn(() => stripe.promise) });
    const run = runNativeCardUpdate({ ...base, sdk, isCurrent: () => current });
    await new Promise((r) => setImmediate(r));
    expect(sdk.initStripe).toHaveBeenCalledTimes(1);
    current = false;
    stripe.resolve();
    expect(await run).toEqual({ kind: 'retired' });
    expect(sdk.initPaymentSheet).not.toHaveBeenCalled();
    expect(sdk.presentPaymentSheet).not.toHaveBeenCalled();
  });

  it("B-352-3: account A resuming late never replaces account B's sheet; B presents its own customer", async () => {
    const aStripe = deferred<void>();
    const bSheet = deferred<Record<string, unknown>>();
    let aCurrent = true;
    let nativeCustomer: string | undefined;
    const shown: Array<string | undefined> = [];
    const setupB = { ...SETUP, setup_intent_id: 'seti_B', customer_id: 'cus_B', ephemeral_key: 'ek_B' };
    mockPost
      .mockResolvedValueOnce({ data: SETUP })
      .mockResolvedValueOnce({ data: setupB })
      .mockResolvedValue({ data: PAID });
    const sdk = sdkDouble({
      initStripe: jest.fn().mockImplementationOnce(() => aStripe.promise).mockResolvedValue(undefined),
      initPaymentSheet: jest.fn((p: { customerId?: string }) => {
        nativeCustomer = p.customerId;
        return p.customerId === 'cus_B' ? bSheet.promise : Promise.resolve({});
      }),
      presentPaymentSheet: jest.fn(async () => {
        shown.push(nativeCustomer);
        return {};
      }),
    });
    const a = runNativeCardUpdate({ ...base, sdk, isCurrent: () => aCurrent });
    await new Promise((r) => setImmediate(r));
    aCurrent = false;
    const b = runNativeCardUpdate({ ...base, sdk, isCurrent: () => true });
    await new Promise((r) => setImmediate(r));
    aStripe.resolve();
    expect(await a).toEqual({ kind: 'retired' });
    bSheet.resolve({});
    expect((await b).kind).toBe('done');
    expect(shown).toEqual(['cus_B']);
    expect(sdk.initPaymentSheet).toHaveBeenCalledTimes(1);
  });

  it('B-352-3: a newer update supersedes an older live one before it touches the sheet', async () => {
    const first = deferred<void>();
    mockPost.mockResolvedValueOnce({ data: SETUP }).mockResolvedValueOnce({ data: SETUP }).mockResolvedValue({ data: PAID });
    const sdk = sdkDouble({ initStripe: jest.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined) });
    const older = runNativeCardUpdate({ ...base, sdk, isCurrent: () => true });
    await new Promise((r) => setImmediate(r));
    const newer = await runNativeCardUpdate({ ...base, sdk, isCurrent: () => true });
    first.resolve();
    expect(await older).toEqual({ kind: 'retired' });
    expect(newer.kind).toBe('done');
    expect(sdk.initPaymentSheet).toHaveBeenCalledTimes(1);
    expect(sdk.presentPaymentSheet).toHaveBeenCalledTimes(1);
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
