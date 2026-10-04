/**
 * B-SHEET-118 (agent 118): every backend reply the payment sheet can get is
 * told truthfully, with a working next action.
 *   B-342-1  recurring PAYMENT_RETRY / STRIPE_CHECKOUT_ERROR /
 *            SUBSCRIPTION_SETUP_UNAVAILABLE and unmapped answers do not prove
 *            no charge (backend #679 B-679-6): never "nothing was charged".
 *   B-342-2  backend #661 replay answers PAYMENT_ALREADY_COMPLETE /
 *            PAYMENT_CHECKOUT_CLOSED / PAYMENT_REFUNDED_OR_IN_REVIEW.
 *   C-342-1  (Sol) only bounded machine labels reach Sentry.
 *   Recurring CHECKOUT_KEY_OTHER_PLAN and PLAN_CHANGE_UNCONFIRMED; today's
 *   production backend (no subscription-intent route).
 *   B-343-4  a resumed trial's pinned first-charge date is reviewed.
 */
import {
  PACKAGE_PAYMENT_COPY,
  describeBackendFailure,
} from '../packagePayment';
import {
  planTerms,
  reconcileIntentTerms,
  type PurchasablePackage,
} from '../planTerms';
import { scrubEvent } from '../../services/sentryPrivacy';
import { scrubEvent as scrubCredentials } from '../../services/sentryScrub';

jest.mock('../../services/api', () => ({ __esModule: true, default: {} }));
const mockCapture = jest.fn();
jest.mock('../../services/sentry', () => ({
  captureError: (...args: unknown[]) => mockCapture(...args),
}));

function failed(status: number, data: Record<string, unknown>) {
  return { response: { status, data: { request_id: 'aabbccdd-1234', ...data } } };
}
const coded = (status: number, code: string) => failed(status, { code, error: code });
const NO_CHARGE = /nothing was charged|not charged|did not go through/i;

beforeEach(() => jest.clearAllMocks());

describe('B-342-1 unconfirmed recurring answers never claim no charge', () => {
  it.each([
    ['PAYMENT_RETRY', 503],
    ['STRIPE_CHECKOUT_ERROR', 502],
    ['SUBSCRIPTION_SETUP_UNAVAILABLE', 503],
  ])('%s on subscription-intent: not confirmed, check the plan, support, key kept', (code, status) => {
    const n = describeBackendFailure(coded(status, code), 'subscription_intent', '1234abcd');
    expect(n.message).not.toMatch(NO_CHARGE);
    expect(n.message).not.toMatch(/trial/i);
    expect(n.message).toBe(PACKAGE_PAYMENT_COPY.notConfirmed('aabbccdd'));
    expect(n).toEqual(expect.objectContaining({ support: true, reference: 'aabbccdd', openPlan: true }));
    expect(n.retireKey).toBeUndefined();
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it('control: on one-time payment-intent PAYMENT_RETRY means the key was freed before any secret', () => {
    expect(describeBackendFailure(coded(503, 'PAYMENT_RETRY'), 'payment_intent', null).message).toBe(
      PACKAGE_PAYMENT_COPY.retrySameAttempt,
    );
    expect(describeBackendFailure(coded(502, 'STRIPE_CHECKOUT_ERROR'), 'payment_intent', null).cause).toBe(
      'stripe_unavailable',
    );
  });

  it.each(['subscription_intent', 'payment_intent', 'plan_action', 'claim_free'] as const)(
    'an unmapped 500 on %s is neutral, keeps support and the server reference',
    (step) => {
      const n = describeBackendFailure(coded(500, 'INTERNAL'), step, '1234abcd');
      expect(n.message).not.toMatch(NO_CHARGE);
      expect(n.message).toBe(PACKAGE_PAYMENT_COPY.unknown('aabbccdd'));
      expect(n).toEqual(expect.objectContaining({ support: true, reference: 'aabbccdd', openPlan: true }));
      expect(mockCapture.mock.calls[0][1]).toEqual(expect.objectContaining({ code: 'INTERNAL', status: 500 }));
    },
  );

  it('control: a definite refusal keeps its specific no-charge copy', () => {
    const n = describeBackendFailure(coded(409, 'COACH_NOT_CONNECTED'), 'subscription_intent', null);
    expect(n.message).toBe(PACKAGE_PAYMENT_COPY.coachNotConnected);
    expect(n.support).toBe(false);
  });
});

describe('B-342-2 backend #661 finished one-time replays', () => {
  it('PAYMENT_ALREADY_COMPLETE: already paid, open the plan, refresh, retire the key', () => {
    const n = describeBackendFailure(coded(409, 'PAYMENT_ALREADY_COMPLETE'), 'payment_intent', null);
    expect(n.message).toBe(PACKAGE_PAYMENT_COPY.alreadyComplete);
    expect(n).toEqual(expect.objectContaining({ openPlan: true, completed: true, retireKey: true, support: false }));
  });

  it('PAYMENT_REFUNDED_OR_IN_REVIEW: status and support, never a new charge or a no-charge claim', () => {
    const n = describeBackendFailure(coded(409, 'PAYMENT_REFUNDED_OR_IN_REVIEW'), 'payment_intent', null);
    expect(n.message).toMatch(/refunded or is under review/);
    expect(n.message).not.toMatch(NO_CHARGE);
    expect(n).toEqual(expect.objectContaining({ openPlan: true, support: true, reference: 'aabbccdd' }));
    expect(n.retireKey).toBeUndefined();
  });

  it('PAYMENT_CHECKOUT_CLOSED: the next tap starts a new checkout', () => {
    const n = describeBackendFailure(coded(409, 'PAYMENT_CHECKOUT_CLOSED'), 'payment_intent', null);
    expect(n.message).toBe(PACKAGE_PAYMENT_COPY.checkoutClosed);
    expect(n.message).not.toMatch(NO_CHARGE);
    expect(n.retireKey).toBe(true);
  });
});

describe('recurring reply codes', () => {
  it('CHECKOUT_KEY_OTHER_PLAN retires the key with its own copy', () => {
    const n = describeBackendFailure(coded(409, 'CHECKOUT_KEY_OTHER_PLAN'), 'subscription_intent', null);
    expect(n).toEqual(expect.objectContaining({ cause: 'key_other_plan', retireKey: true }));
  });

  it('SUBSCRIPTION_ATTEMPT_EXPIRED retires the key', () => {
    expect(describeBackendFailure(coded(409, 'SUBSCRIPTION_ATTEMPT_EXPIRED'), 'subscription_intent', null).retireKey).toBe(true);
  });

  it('PLAN_CHANGE_UNCONFIRMED: sent but not confirmed, refresh the plans', () => {
    const n = describeBackendFailure(coded(503, 'PLAN_CHANGE_UNCONFIRMED'), 'plan_action', null);
    expect(n.message).toBe(PACKAGE_PAYMENT_COPY.planChangeUnconfirmed);
    expect(n.reload).toBe(true);
  });

  it("today's production backend has no subscription-intent route: a specific, proven no-charge answer", () => {
    const n = describeBackendFailure(
      failed(404, { statusCode: 404, error: 'Not Found', message: 'Cannot POST /v1/checkout/subscription-intent' }),
      'subscription_intent',
      null,
    );
    expect(n.cause).toBe('renewing_unavailable');
    expect(n.message).toBe(PACKAGE_PAYMENT_COPY.renewingUnavailable);
    expect(describeBackendFailure(coded(404, 'PACKAGE_NOT_FOUND'), 'subscription_intent', null).cause).toBe(
      'package_unavailable',
    );
  });
});

describe('C-342-1 only machine labels reach Sentry', () => {
  it('a free-form code or Stripe label never enters the event', () => {
    const marker = 'synthetic-person@example.invalid private coaching note';
    describeBackendFailure(failed(500, { code: marker }), 'subscription_intent', '1234abcd');
    const [err, extra] = mockCapture.mock.calls[0];
    const event = scrubCredentials(scrubEvent({ exception: { values: [{ value: String(err.message) }] }, extra }));
    expect(JSON.stringify(event)).not.toContain('synthetic-person');
    expect(JSON.stringify(event)).not.toContain('coaching note');
    expect(extra).toEqual(expect.objectContaining({ cause: 'http_500', code: null, reference: 'aabbccdd' }));
  });
});

describe('copy rules', () => {
  it('no first person, no exclamation marks, no generic error text', () => {
    for (const v of Object.values(PACKAGE_PAYMENT_COPY)) {
      const text = typeof v === 'function' ? (v as (...a: unknown[]) => string)('ref12345', 'ref12345') : v;
      expect(text).not.toMatch(/\b(we|We|us|our|Our)\b|!|went wrong/);
    }
  });
});

describe('B-343-4 a resumed trial keeps its pinned first-charge date', () => {
  const trial: PurchasablePackage = {
    id: 'p1', name: 'Trial plan', currency: 'usd', amountCents: 9900, renewing: true,
    interval: 'month', intervalCount: 1, oneTimeCents: 0, trialDays: 7,
  };
  const plan = (trialEndsAt: string | null) => ({
    amountCents: 9900, currency: 'usd', interval: 'month' as const, intervalCount: 1,
    firstChargeCents: 0, oneTimeCents: 0, trialDays: 7, trialEndsAt,
  });
  const now = new Date(2026, 9, 4, 1, 0, 0);
  const pinned = new Date(2026, 9, 3, 13, 0, 0);
  pinned.setDate(pinned.getDate() + 7);

  it('a pinned date before the shown date needs review, and the review shows the pinned date', () => {
    const r = reconcileIntentTerms(trial, plan(pinned.toISOString()), 'setup', now);
    expect(r).toEqual(expect.objectContaining({ changed: true, trialDateMoved: true, inconsistent: false }));
    expect(r.adopted.trialEndsAt).toBe(pinned.toISOString());
    expect(planTerms(r.adopted, now).firstCharge).toContain('October 10, 2026');
    expect(planTerms(trial, now).firstCharge).toContain('October 11, 2026');
    // Confirming the reviewed date replays the same attempt: no second review.
    expect(reconcileIntentTerms(r.adopted, plan(pinned.toISOString()), 'setup', now).changed).toBe(false);
  });

  it('the same calendar date, or no pinned date, needs no review', () => {
    const same = new Date(now.getTime());
    same.setDate(same.getDate() + 7);
    expect(reconcileIntentTerms(trial, plan(same.toISOString()), 'setup', now).changed).toBe(false);
    expect(reconcileIntentTerms(trial, plan(null), 'setup', now).changed).toBe(false);
  });
});
