/**
 * C5-S1 (slice 2, Style C) — the success moment shows the server's numbers
 * only: Paid is purchases[].first_charge_cents (never amount_cents, which is
 * a subscription's renewal), no paid line in a trial or when the server sends
 * none, Next charge from the purchase's period end. See what unlocks opens the
 * purchase, Done leaves, one success haptic, the ring draws once unless
 * Reduce Motion is on. With clientBillingV2 off the old success block stays.
 */
import React from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ClientPurchase } from '../../../api/clientPaymentsApi';
import type { PackagePurchase, PurchaseSuccess } from '../../../hooks/usePackagePurchase';
import { formatPlanDate } from '../../../lib/planTerms';
import PlanActiveMoment from '../PlanActiveMoment';
import PurchaseFeedback from '../PurchaseFeedback';

const mockFlags = { clientBillingV2: true, deliverables: true };
jest.mock('../../../config/featureFlags', () => ({
  get featureFlags() {
    return mockFlags;
  },
}));
jest.mock('../../../theme/ThemeProvider', () => {
  const realTokens = jest.requireActual('../../../theme/tokens').default;
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
const mockGetPurchases = jest.fn();
jest.mock('../../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getPurchases: () => mockGetPurchases() },
}));
const mockGet = jest.fn();
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a) },
}));
const mockSuccessHaptic = jest.fn(async () => undefined);
jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: {
    success: () => mockSuccessHaptic(),
    lightImpact: jest.fn(async () => undefined),
    mediumImpact: jest.fn(async () => undefined),
    selection: jest.fn(async () => undefined),
  },
}));

const NEXT = '2026-11-14T12:00:00Z';
const row = (over: Partial<ClientPurchase> = {}): ClientPurchase => ({
  id: 'pur-1',
  package_id: 'pkg-1',
  status: 'active',
  entitlement_active: true,
  access_expires_at: null,
  current_period_end: NEXT,
  cancel_at_period_end: false,
  canceled_at: null,
  created_at: '2026-10-14T12:00:00Z',
  amount_cents: 14900,
  currency: 'usd',
  billing_type: 'recurring',
  first_charge_cents: 44900,
  ...over,
});
const success = (over: Partial<PurchaseSuccess> = {}): PurchaseSuccess => ({
  kind: 'subscription',
  title: 'Your plan is active',
  body: 'Welcome to Monthly coaching. Your coach can see you are on board.',
  packageId: 'pkg-1',
  purchaseId: 'pur-1',
  ...over,
});

let reduceMotion = false;
beforeEach(() => {
  mockFlags.clientBillingV2 = true;
  mockFlags.deliverables = true;
  reduceMotion = false;
  mockGetPurchases.mockReset();
  mockGet.mockReset().mockResolvedValue({ data: { name: 'Sam' } });
  mockSuccessHaptic.mockClear();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(async () => reduceMotion);
});
afterEach(() => jest.restoreAllMocks());

describe('PlanActiveMoment', () => {
  it('Paid is the server first charge (one-time + first month), never the renewal; Next charge is the period end', async () => {
    mockGetPurchases.mockResolvedValue({ ok: true, data: [row()] });
    const view = await render(<PlanActiveMoment success={success()} onContinue={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId('payment-success-paid')).toBeTruthy());
    expect(view.getByText('$449.00')).toBeTruthy();
    expect(view.queryByText('$149.00')).toBeNull();
    expect(view.getByTestId('payment-success-next').props.accessibilityLabel).toBe(
      `Next charge, ${formatPlanDate(new Date(NEXT))}`,
    );
    expect(view.getByText('Your plan is active')).toBeTruthy();
    // The mark is decorative (hidden from screen readers), so hidden elements are included.
    await waitFor(() => expect(view.getByText('S', { includeHiddenElements: true })).toBeTruthy());
    expect(mockSuccessHaptic).toHaveBeenCalledTimes(1);
  });

  it('shows no paid line in a trial or when the server sends no first charge', async () => {
    mockGetPurchases.mockResolvedValue({
      ok: true,
      data: [row({ status: 'trialing', first_charge_cents: 0 })],
    });
    const trial = await render(<PlanActiveMoment success={success({ kind: 'trial' })} onContinue={jest.fn()} />);
    await waitFor(() => expect(trial.getByTestId('payment-success-next')).toBeTruthy());
    expect(trial.queryByTestId('payment-success-paid')).toBeNull();
    trial.unmount();

    mockGetPurchases.mockResolvedValue({
      ok: true,
      data: [row({ first_charge_cents: undefined, billing_type: 'one_time', current_period_end: null })],
    });
    const old = await render(<PlanActiveMoment success={success()} onContinue={jest.fn()} />);
    await waitFor(() => expect(old.getByText('S', { includeHiddenElements: true })).toBeTruthy());
    expect(old.queryByTestId('payment-success-receipt')).toBeNull();
    expect(old.queryByText('$149.00')).toBeNull();
  });

  it('See what unlocks opens the newest entitled purchase of the package; Done leaves', async () => {
    mockGetPurchases.mockResolvedValue({
      ok: true,
      data: [
        row({ id: 'pur-other', package_id: 'pkg-2' }),
        row({ id: 'pur-pending', entitlement_active: false }),
        row({ id: 'pur-new' }),
      ],
    });
    const onSeeUnlocks = jest.fn();
    const onContinue = jest.fn();
    const view = await render(
      <PlanActiveMoment
        success={success({ kind: 'one_time', purchaseId: null })}
        onContinue={onContinue}
        onSeeUnlocks={onSeeUnlocks}
      />,
    );
    await waitFor(() => expect(view.getByTestId('payment-see-unlocks')).toBeTruthy());
    await fireEvent.press(view.getByTestId('payment-see-unlocks'));
    expect(onSeeUnlocks).toHaveBeenCalledWith('pur-new');
    await fireEvent.press(view.getByTestId('payment-continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(view.getByText('Done')).toBeTruthy();
  });

  it('without deliverables or a place to open, Done is the only action', async () => {
    mockFlags.deliverables = false;
    mockGetPurchases.mockResolvedValue({ ok: true, data: [row()] });
    const view = await render(
      <PlanActiveMoment success={success()} onContinue={jest.fn()} onSeeUnlocks={jest.fn()} />,
    );
    await waitFor(() => expect(view.getByTestId('payment-success-paid')).toBeTruthy());
    expect(view.queryByTestId('payment-see-unlocks')).toBeNull();
    expect(view.getByTestId('payment-continue')).toBeTruthy();
  });

  it('the ring draws once in 300 ms, and not at all under Reduce Motion', async () => {
    mockGetPurchases.mockResolvedValue({ ok: true, data: [row()] });
    const timing = jest.spyOn(Animated, 'timing');
    const a = await render(<PlanActiveMoment success={success()} onContinue={jest.fn()} />);
    await waitFor(() => expect(timing).toHaveBeenCalledTimes(1));
    expect(timing.mock.calls[0][1]).toMatchObject({ toValue: 0, duration: 300 });
    a.unmount();

    timing.mockClear();
    reduceMotion = true;
    const b = await render(<PlanActiveMoment success={success()} onContinue={jest.fn()} />);
    await waitFor(() => expect(b.getByTestId('payment-success-paid')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 0));
    expect(timing).not.toHaveBeenCalled();
  });
});

describe('PurchaseFeedback success with clientBillingV2', () => {
  const purchase = {
    state: { phase: 'success', success: success(), notice: null, priceChange: null, alreadyActive: null },
    checkAgain: jest.fn(),
  } as unknown as PackagePurchase;

  it('on: the Style C moment; off: the existing block with Continue', async () => {
    mockGetPurchases.mockResolvedValue({ ok: true, data: [row()] });
    const on = await render(
      <PurchaseFeedback purchase={purchase} onContinue={jest.fn()} onOpenPlan={jest.fn()} />,
    );
    await waitFor(() => expect(on.getByTestId('payment-success-paid')).toBeTruthy());
    expect(on.getByTestId('coach-mark', { includeHiddenElements: true })).toBeTruthy();
    on.unmount();

    mockFlags.clientBillingV2 = false;
    const off = await render(
      <PurchaseFeedback purchase={purchase} onContinue={jest.fn()} onOpenPlan={jest.fn()} />,
    );
    expect(off.getByTestId('payment-success')).toBeTruthy();
    expect(off.queryByTestId('coach-mark')).toBeNull();
    expect(off.getByText('Continue')).toBeTruthy();
  });
});
