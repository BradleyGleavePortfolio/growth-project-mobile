/**
 * LO-914R2 B1 (m#914 review round 2, Opus lens). A one-time card sheet that
 * ends clearly paid, bought while another plan of the account is already in
 * force (a second plan, or buying plan A again while plan B is current). The
 * account-wide entitlement is already on, so the hook shows success at once,
 * and the success moment reads the purchase list one time, while this
 * purchase's own row is still pending. Expected: the success moment for this
 * payment shows its own Paid line and See what unlocks for this purchase
 * (GOAL C5 Style C success frame), once the payment is in force.
 * Real hook + real PlanActiveMoment, synthetic boundaries only.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { usePackagePurchase } from '../usePackagePurchase';
import type { PurchasablePackage } from '../../lib/planTerms';
import PlanActiveMoment from '../../components/purchase/PlanActiveMoment';

const mockFlags = { clientBillingV2: true, deliverables: true };
jest.mock('../../config/featureFlags', () => ({
  get featureFlags() {
    return mockFlags;
  },
}));
jest.mock('../../theme/ThemeProvider', () => {
  const realTokens = jest.requireActual('../../theme/tokens').default;
  return {
    useTheme: () => ({ tokens: realTokens, semanticColors: realTokens.lightTokens, colorScheme: 'light' }),
  };
});
jest.mock('react-native-svg', () => {
  const mockReact = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const El = ({ children }: { children?: React.ReactNode }) => mockReact.createElement(View, null, children);
  return { __esModule: true, default: El, Circle: El };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('../../ui/haptics/haptics.service', () => ({
  HapticService: {
    success: jest.fn(async () => undefined),
    softImpact: jest.fn(async () => undefined),
    lightImpact: jest.fn(async () => undefined),
    mediumImpact: jest.fn(async () => undefined),
    selection: jest.fn(async () => undefined),
  },
}));
const mockPost = jest.fn();
const mockGet = jest.fn();
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => mockPost(...a), get: (...a: unknown[]) => mockGet(...a) },
}));
jest.mock('../../services/sentry', () => ({ captureError: jest.fn() }));
const mockPurchases = jest.fn();
jest.mock('../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: {
    getPurchases: () => mockPurchases(),
    // Another plan of this account is in force: the account-wide flag is on.
    getEntitlement: async () => ({ ok: true, data: { active: true } }),
  },
}));
jest.mock('@stripe/stripe-react-native', () => ({
  initStripe: async () => undefined,
  initPaymentSheet: async () => ({}),
  presentPaymentSheet: async () => ({}),
}));

const A: PurchasablePackage = {
  id: '11111111-2222-4333-8444-555555555555', name: 'Synthetic A', amountCents: 4900, currency: 'usd',
  renewing: false, interval: null, intervalCount: 1, oneTimeCents: 0, trialDays: 0,
};
const secrets = {
  client_secret: 'pi_synthetic_secret_example', ephemeral_key: 'ek_synthetic',
  customer_id: 'cus_synthetic', publishable_key: 'pk_test_synthetic',
};
const base = {
  access_expires_at: null, current_period_end: null, cancel_at_period_end: false, canceled_at: null,
  currency: 'usd', amount_cents: 4900, first_charge_cents: 4900,
};
// The other plan already in force (another package, bought earlier).
const otherPlan = {
  ...base, id: 'pur-other-plan', package_id: '99999999-8888-4777-8666-555555555555', status: 'active',
  entitlement_active: true, billing_type: 'recurring', amount_cents: 14900, first_charge_cents: 14900,
  created_at: '2026-10-01T12:00:00.000Z',
};
const ownPending = {
  ...base, id: 'pur-own', package_id: A.id, status: 'pending', entitlement_active: false,
  billing_type: 'one_time', created_at: '2026-10-30T12:00:00.000Z',
};
const ownPaid = { ...ownPending, status: 'paid', entitlement_active: true };

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockResolvedValue({ data: secrets });
  mockGet.mockResolvedValue({ data: { name: 'Sam' } });
  // The webhook lands just after the sheet: the first read still sees this
  // purchase pending, every later read sees it paid and in force.
  let reads = 0;
  mockPurchases.mockImplementation(async () => {
    reads += 1;
    return { ok: true, data: reads === 1 ? [ownPending, otherPlan] : [ownPaid, otherPlan] };
  });
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(async () => true);
});
afterEach(() => jest.restoreAllMocks());

describe('LO-914R2 B1: a clear one-time payment shows its own receipt when another plan is in force', () => {
  it('a clear one-time payment made while another plan is in force shows its own Paid line and See what unlocks', async () => {
    const hook = await renderHook(() =>
      usePackagePurchase({
        surface: 'sheet', appearance: {}, colorScheme: 'light',
        entitlementPollDelaysMs: [0, 0, 0], planPollDelaysMs: [0], recheckDelaysMs: [0], onEntitled: jest.fn(),
      }),
    );
    await act(async () => { await hook.result.current.start(A); });
    await waitFor(() => expect(hook.result.current.state.phase).toBe('success'));
    const success = hook.result.current.state.success!;
    expect(success.packageId).toBe(A.id);

    const onSeeUnlocks = jest.fn();
    const view = await render(
      <PlanActiveMoment success={success} onContinue={jest.fn()} onSeeUnlocks={onSeeUnlocks} />,
    );
    await waitFor(() => expect(view.getByTestId('payment-success-paid')).toBeTruthy());
    expect(view.getByText('$49.00')).toBeTruthy();
    expect(view.queryByText('$149.00')).toBeNull();
    await fireEvent.press(view.getByTestId('payment-see-unlocks'));
    expect(onSeeUnlocks).toHaveBeenCalledWith('pur-own');
  });
});
