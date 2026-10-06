import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { usePackagePurchase } from '../usePackagePurchase';
import { PACKAGE_PAYMENT_COPY, STRIPE_RETURN_URL } from '../../lib/packagePayment';
import type { PurchasablePackage } from '../../lib/planTerms';

const mockPost = jest.fn();
const mockGet = jest.fn();
const mockPresent = jest.fn();
const mockHandleReturn = jest.fn();
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: {
    post: (...args: unknown[]) => mockPost(...args),
    get: (...args: unknown[]) => mockGet(...args),
  },
}));
jest.mock('../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: {
    getPurchases: async () => ({ ok: true, data: [] }),
    getEntitlement: async () => ({ ok: true, data: { active: false } }),
  },
}));
jest.mock('@stripe/stripe-react-native', () => ({
  initStripe: async () => undefined,
  initPaymentSheet: async () => ({}),
  presentPaymentSheet: () => mockPresent(),
  handleURLCallback: (url: string) => mockHandleReturn(url),
}));

const PURCHASE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const pkg: PurchasablePackage = {
  id: '11111111-2222-4333-8444-555555555555',
  name: 'Synthetic monthly coaching',
  amountCents: 4900,
  currency: 'usd',
  renewing: true,
  interval: 'month',
  intervalCount: 1,
  oneTimeCents: 0,
  trialDays: 0,
};
const intent = {
  mode: 'payment',
  purchase_id: PURCHASE,
  client_secret: 'pi_synthetic_secret_example',
  ephemeral_key: 'ek_synthetic',
  customer_id: 'cus_synthetic',
  publishable_key: 'pk_test_synthetic',
  plan: {
    amount_cents: 4900, currency: 'usd', interval: 'month', interval_count: 1,
    first_charge_cents: 4900, one_time_cents: 0, trial_days: 0,
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type SheetResult = { error?: { code: string; declineCode?: string } };
let returnListener: ((event: { url: string }) => void) | undefined;
const mockRemove = jest.fn();
let linkingSpy: jest.SpyInstance;
// The RN preset already makes this a jest.fn: capture its implementation,
// not the mutable mock function that spyOn will replace.
const addReturnListener = jest.mocked(Linking.addEventListener).getMockImplementation()
  ?? Linking.addEventListener.bind(Linking);

const mount = async () => {
  const onEntitled = jest.fn();
  const hook = await renderHook(() => usePackagePurchase({
    surface: 'plans', appearance: {}, colorScheme: 'light', onEntitled,
    planPollDelaysMs: [0], entitlementPollDelaysMs: [0], recheckDelaysMs: [0],
  }));
  return { ...hook, onEntitled };
};

beforeEach(() => {
  jest.clearAllMocks();
  returnListener = undefined;
  linkingSpy = jest.spyOn(Linking, 'addEventListener').mockImplementation((_type, listener) => {
    returnListener = listener;
    const subscription = addReturnListener(_type, listener);
    const remove = subscription.remove.bind(subscription);
    subscription.remove = () => {
      mockRemove();
      remove();
    };
    return subscription;
  });
  mockPost.mockResolvedValue({ data: intent });
  mockGet.mockResolvedValue({ data: {
    purchase_id: PURCHASE, package_id: pkg.id, package_name: pkg.name,
    state: 'active', entitlement_active: true, amount_cents: 4900, currency: 'usd',
  } });
  mockPresent.mockResolvedValue({});
  mockHandleReturn.mockResolvedValue(true);
});

afterEach(() => linkingSpy.mockRestore());

describe('HUNT-04 day-1 bank authentication returns to package PaymentSheet', () => {
  it('hands the bank return to Stripe so the held sheet completes and paid access is confirmed', async () => {
    const held = deferred<SheetResult>();
    mockPresent.mockReturnValueOnce(held.promise);
    mockHandleReturn.mockImplementation(async () => {
      held.resolve({});
      return true;
    });
    const h = await mount();
    let running!: Promise<void>;
    await act(async () => { running = h.result.current.start(pkg); });
    await waitFor(() => expect(mockPresent).toHaveBeenCalledTimes(1));
    const url = `${STRIPE_RETURN_URL}?payment_intent=pi_synthetic`;
    await act(async () => {
      returnListener?.({ url });
      // Always release the synthetic native call, including on unfixed main.
      await Promise.resolve();
      held.resolve({});
      await running;
    });
    expect(mockHandleReturn).toHaveBeenCalledWith(url);
    expect(h.result.current.state.phase).toBe('success');
    expect(h.onEntitled).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it('does not send unrelated app links or a lookalike host to the bank callback', async () => {
    const held = deferred<SheetResult>();
    mockPresent.mockReturnValueOnce(held.promise);
    const h = await mount();
    let running!: Promise<void>;
    await act(async () => { running = h.result.current.start(pkg); });
    await waitFor(() => expect(mockPresent).toHaveBeenCalledTimes(1));
    await act(async () => {
      returnListener?.({ url: 'tgp://reset-password?code=synthetic' });
      returnListener?.({ url: 'tgp://stripe-redirect-other?code=synthetic' });
      held.resolve({ error: { code: 'Canceled' } });
      await running;
    });
    expect(mockHandleReturn).not.toHaveBeenCalled();
    expect(h.onEntitled).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
    expect(h.result.current.state.phase).toBe('idle');
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it('bank decline after returning remains a specific failure, never paid access', async () => {
    const held = deferred<SheetResult>();
    mockPresent.mockReturnValueOnce(held.promise);
    mockHandleReturn.mockImplementation(async () => {
      held.resolve({ error: { code: 'Failed', declineCode: 'insufficient_funds' } });
      return true;
    });
    const h = await mount();
    let running!: Promise<void>;
    await act(async () => { running = h.result.current.start(pkg); });
    await waitFor(() => expect(mockPresent).toHaveBeenCalledTimes(1));
    await act(async () => {
      returnListener?.({ url: STRIPE_RETURN_URL });
      await Promise.resolve();
      held.resolve({ error: { code: 'Failed', declineCode: 'insufficient_funds' } });
      await running;
    });
    expect(mockHandleReturn).toHaveBeenCalledWith(STRIPE_RETURN_URL);
    expect(h.result.current.state.notice?.message).toBe(PACKAGE_PAYMENT_COPY.insufficientFunds);
    expect(h.onEntitled).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it('a callback failure keeps the existing uncertain-payment recovery instead of inventing success', async () => {
    const held = deferred<SheetResult>();
    mockPresent.mockReturnValueOnce(held.promise);
    mockHandleReturn.mockRejectedValueOnce(new Error('Synthetic callback failure'));
    mockGet.mockResolvedValue({ data: null });
    const h = await mount();
    let running!: Promise<void>;
    await act(async () => { running = h.result.current.start(pkg); });
    await waitFor(() => expect(mockPresent).toHaveBeenCalledTimes(1));
    await act(async () => {
      returnListener?.({ url: STRIPE_RETURN_URL });
      await Promise.resolve();
      held.resolve({ error: { code: 'Timeout' } });
      await running;
    });
    expect(mockHandleReturn).toHaveBeenCalledWith(STRIPE_RETURN_URL);
    expect(h.result.current.state.notice?.checkAgain).toBe(true);
    expect(h.result.current.state.notice?.message).not.toMatch(/nothing was charged/i);
    expect(h.onEntitled).not.toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it('after a bank return, a late webhook stays pending and Check again reads without charging again', async () => {
    const held = deferred<SheetResult>();
    mockPresent.mockReturnValueOnce(held.promise);
    mockHandleReturn.mockImplementation(async () => {
      held.resolve({});
      return true;
    });
    mockGet.mockResolvedValueOnce({ data: {
      purchase_id: PURCHASE, package_id: pkg.id,
      state: 'confirming', entitlement_active: false, checkout_state: 'paid',
    } });
    const h = await mount();
    let running!: Promise<void>;
    await act(async () => { running = h.result.current.start(pkg); });
    await waitFor(() => expect(mockPresent).toHaveBeenCalledTimes(1));
    await act(async () => {
      returnListener?.({ url: STRIPE_RETURN_URL });
      await Promise.resolve();
      held.resolve({});
      await running;
    });
    expect(mockHandleReturn).toHaveBeenCalledWith(STRIPE_RETURN_URL);
    expect(h.result.current.state.phase).toBe('confirm_slow');
    expect(h.result.current.state.success).toBeNull();
    await act(async () => { await h.result.current.checkAgain(); });
    expect(h.result.current.state.phase).toBe('success');
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
