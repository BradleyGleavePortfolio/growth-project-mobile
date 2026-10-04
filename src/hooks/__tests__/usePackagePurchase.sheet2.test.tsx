/**
 * B-SHEET2-119 (agent 119), split S2 (#343), real hook, synthetic network:
 *   B-343-1 (Sol)   a rejected plan read is fenced like a fulfilled one: after
 *                   an account change no further read, callback or state.
 *   B-343-6 (Sol)   an ended plan is not proof that nothing was charged.
 *   B-343-6 (Opus)  a paid plan rerouted to claim-free is told as a free claim.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { usePackagePurchase } from '../usePackagePurchase';
import { PACKAGE_PAYMENT_COPY } from '../../lib/packagePayment';
import type { PurchasablePackage } from '../../lib/planTerms';
import { authEvents } from '../../utils/authEvents';

const mockPost = jest.fn();
const mockGet = jest.fn();
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => mockPost(...a), get: (...a: unknown[]) => mockGet(...a) },
}));
jest.mock('../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: {
    getPurchases: async () => ({ ok: true, data: [] }),
    getEntitlement: async () => ({ ok: true, data: { active: false } }),
  },
}));
const mockPresent = jest.fn();
jest.mock('@stripe/stripe-react-native', () => ({
  initStripe: async () => undefined,
  initPaymentSheet: async () => ({}),
  presentPaymentSheet: () => mockPresent(),
}));

const PURCHASE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const oneTime: PurchasablePackage = {
  id: '11111111-2222-4333-8444-555555555555', name: 'Synthetic plan', amountCents: 4900, currency: 'usd',
  renewing: false, interval: null, intervalCount: 1, oneTimeCents: 0, trialDays: 0,
};
const renewing: PurchasablePackage = { ...oneTime, renewing: true, interval: 'month' };
const intent = {
  mode: 'payment', purchase_id: PURCHASE, client_secret: 'pi_synthetic_secret_example',
  ephemeral_key: 'ek_synthetic', customer_id: 'cus_synthetic', publishable_key: 'pk_test_synthetic',
  plan: { amount_cents: 4900, currency: 'usd', interval: 'month', interval_count: 1, first_charge_cents: 4900, one_time_cents: 0, trial_days: 0 },
};
const NO_CHARGE = /nothing was charged|not charged|did not go through/i;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}

async function mount(planPollDelaysMs = [0]) {
  const onEntitled = jest.fn();
  const h = await renderHook(() =>
    usePackagePurchase({
      surface: 'sheet', appearance: {}, colorScheme: 'light', onEntitled,
      planPollDelaysMs, entitlementPollDelaysMs: [0], recheckDelaysMs: [0],
    }),
  );
  return { ...h, onEntitled };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockResolvedValue({ data: intent });
  mockGet.mockResolvedValue({ data: null });
  mockPresent.mockResolvedValue({});
});

describe('B-343-1 (Sol) a rejected plan read is fenced', () => {
  it.each(['logout', 'login'])('%s, then the held read rejects: no old-account progress or callback', async (event) => {
    const held = deferred<{ data: unknown }>();
    mockGet.mockReturnValueOnce(held.promise);
    const h = await mount();
    let running!: Promise<void>;
    await act(async () => { running = h.result.current.start(renewing); });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    await act(async () => { authEvents.emit(event); held.reject(new Error('lost')); await running; });
    expect(h.onEntitled).not.toHaveBeenCalled();
    expect(h.result.current.state).toEqual(expect.objectContaining({ phase: 'idle', packageId: null, notice: null }));
  });

  it('account change during a failed first poll: no second old-account read', async () => {
    const held = deferred<{ data: unknown }>();
    mockGet.mockReturnValueOnce(held.promise);
    const h = await mount([0, 0, 0]);
    let running!: Promise<void>;
    await act(async () => { running = h.result.current.start(renewing); });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    await act(async () => { authEvents.emit('logout'); held.reject(new Error('lost')); await running; });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('control: rejected reads on the same account still end in the slow state', async () => {
    mockGet.mockRejectedValue(new Error('slow'));
    const h = await mount([0, 0]);
    await act(async () => { await h.result.current.start(renewing); });
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(h.result.current.state.phase).toBe('confirm_slow');
    expect(h.onEntitled).toHaveBeenCalledTimes(1);
  });
});

describe('B-343-6 (Sol) an ended plan is not proof of no charge', () => {
  it.each([
    ['ended', null],
    ['confirming', 'ended'],
  ])('state %s / checkout %s after an unclear card step: support, reference, no no-charge claim', async (state, checkout) => {
    mockPresent.mockRejectedValueOnce(new Error('lost answer'));
    mockGet.mockResolvedValue({ data: { purchase_id: PURCHASE, package_id: renewing.id, state, entitlement_active: false, checkout_state: checkout } });
    const h = await mount();
    await act(async () => { await h.result.current.start(renewing); });
    const n = h.result.current.state.notice;
    expect(n?.message).not.toMatch(NO_CHARGE);
    expect(n).toEqual(expect.objectContaining({
      cause: 'plan_ended_while_confirming', support: true, reference: 'aaaaaaaa',
      message: PACKAGE_PAYMENT_COPY.endedWhileConfirming('aaaaaaaa'),
    }));
    // The ended attempt's key is retired: the next tap is a new checkout.
    await act(async () => { await h.result.current.start(renewing); });
    const keys = mockPost.mock.calls.map(([, b]) => (b as { idempotency_key: string }).idempotency_key);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('control: awaiting_payment keeps the proven no-charge copy and the key', async () => {
    mockPresent.mockRejectedValueOnce(new Error('lost answer'));
    mockGet.mockResolvedValue({ data: { purchase_id: PURCHASE, package_id: renewing.id, state: 'confirming', entitlement_active: false, checkout_state: 'awaiting_payment' } });
    const h = await mount();
    await act(async () => { await h.result.current.start(renewing); });
    expect(h.result.current.state.notice?.message).toBe(PACKAGE_PAYMENT_COPY.sheetNotFinished);
  });
});

describe('B-343-6 (Opus) a reroute to claim-free is a free claim', () => {
  it.each([
    ['one-time', oneTime, '/v1/checkout/payment-intent'],
    ['renewing', renewing, '/v1/checkout/subscription-intent'],
  ])('%s plan made free since the list loaded: saleKind free while claiming', async (_l, pkg, route) => {
    const claim = deferred<{ data: unknown }>();
    mockPost.mockImplementation((url: string) => {
      if (url === route) return Promise.reject({ response: { status: 400, data: { error: 'PACKAGE_IS_FREE' } } });
      return claim.promise;
    });
    const h = await mount();
    let running!: Promise<void>;
    await act(async () => { running = h.result.current.start(pkg); });
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
    expect(h.result.current.state).toEqual(expect.objectContaining({ phase: 'confirming', saleKind: 'free' }));
    await act(async () => { claim.resolve({ data: { active: true, status: 'created' } }); await running; });
    expect(h.result.current.state.success?.kind).toBe('free');
  });
});
