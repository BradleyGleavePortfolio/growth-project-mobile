/**
 * MONEY-CLIENT-124 (agent 124): the client plans screen after a plan ends,
 * while it is ending, alongside another plan, and while a payment is overdue.
 *
 * B-MC-1 — failing before: getPaymentStatus() fell back to the newest
 * `canceled` purchase, so a plan that had ENDED (no access) stayed the
 * "Current plan": its card said "Renews <past date>" and its buy button was
 * disabled as "Current plan", so the client could never start it again.
 * B-MC-2 — failing before: a plan the client ended (cancel at period end)
 * still read "Renews <date>" under Current plan.
 * U-MC-3: another plan says the renewing one keeps charging alongside it.
 * U-MC-4: a past-due plan offers Update card on the plan itself.
 * U-MC-5: the plans screen has a back control (the More stack hides headers).
 *
 * Real clientPaymentsApi and ClientPackagesScreen; only HTTP is mocked.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

jest.mock('../theme/ThemeProvider', () => {
  const realTokens = jest.requireActual('../theme/tokens').default;
  return {
    useTheme: () => ({ tokens: realTokens, semanticColors: realTokens.lightTokens, colorScheme: 'light' }),
  };
});
jest.mock('../ui/skeletons/Skeleton', () => ({ SkeletonScreen: () => null }));
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockCanGoBack = false;
jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, canGoBack: () => mockCanGoBack }),
    useFocusEffect: (cb: () => void) => ReactLib.useEffect(cb, []),
  };
});
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
}));
jest.mock('../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('@stripe/stripe-react-native', () => ({
  initStripe: jest.fn(async () => undefined),
  initPaymentSheet: jest.fn(async () => ({})),
  presentPaymentSheet: jest.fn(async () => ({})),
}));

import ClientPackagesScreen from '../screens/client/ClientPackagesScreen';
import { clientPaymentsApi } from '../api/clientPaymentsApi';

const MONTHLY = {
  id: 'pkg-monthly', name: 'Monthly coaching', amount_cents: 4900, currency: 'usd',
  billing_type: 'recurring', interval: 'month', description: null, features: [],
};
const QUARTERLY = {
  id: 'pkg-quarterly', name: 'Quarterly coaching', amount_cents: 12900, currency: 'usd',
  billing_type: 'recurring', interval: 'month', interval_count: 3, description: null, features: [],
};

function purchase(over: Record<string, unknown>) {
  return {
    id: 'purchase-1', package_id: 'pkg-monthly', status: 'active', entitlement_active: true,
    access_expires_at: null, current_period_end: '2026-11-02T12:00:00.000Z', cancel_at_period_end: false,
    canceled_at: null, created_at: '2026-10-02T12:00:00.000Z', ...over,
  };
}

let purchases: unknown[] = [];
let plans: unknown[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_build';
  purchases = [];
  plans = [];
  mockCanGoBack = false;
  mockGet.mockImplementation(async (url: string) => {
    if (url === '/v1/clients/me/coach') return { data: { name: 'Coach Lee' } };
    if (url === '/v1/clients/me/coach/packages') return { data: [MONTHLY, QUARTERLY] };
    if (url === '/v1/checkout/purchases') return { data: { purchases, next_cursor: null } };
    if (url === '/v1/checkout/subscriptions') return { data: { plans } };
    throw Object.assign(new Error('404'), { response: { status: 404, data: {} } });
  });
  mockPost.mockImplementation(async (url: string) => {
    throw new Error(`unexpected POST ${url}`);
  });
});

describe('B-MC-1: a plan that ended is not the current plan', () => {
  const ENDED = purchase({
    status: 'canceled', entitlement_active: false, current_period_end: '2026-09-02T12:00:00.000Z',
    canceled_at: '2026-09-02T12:00:00.000Z',
  });

  it('getPaymentStatus reports no current plan for a canceled purchase without access', async () => {
    purchases = [ENDED];
    const res = await clientPaymentsApi.getPaymentStatus();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.state).toBe('none');
      expect(res.data.package_id).toBeNull();
      expect(res.data.package_name).toBeNull();
    }
  });

  it('the plans screen lets the client start the ended plan again', async () => {
    purchases = [ENDED];
    const r = await render(<ClientPackagesScreen />);
    await waitFor(() => expect(r.getByTestId('buy-plan-pkg-monthly')).toBeTruthy());
    expect(r.queryAllByText('Current plan')).toHaveLength(0);
    expect(r.queryByTestId('current-plan-line')).toBeNull();
    expect(r.getByTestId('buy-plan-pkg-monthly').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    );
    expect(r.getByTestId('plan-terms-pkg-monthly-renewal')).toBeTruthy();
  });

  it('a live plan stays current, and an older ended row does not override it', async () => {
    purchases = [purchase({}), { ...ENDED, id: 'purchase-0', package_id: 'pkg-quarterly' }];
    const r = await render(<ClientPackagesScreen />);
    await waitFor(() => expect(r.getByTestId('current-plan-line')).toBeTruthy());
    expect(r.getByTestId('current-plan-line').props.children).toBe('Renews Nov 2, 2026');
    expect(r.getByTestId('buy-plan-pkg-monthly').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    expect(r.getByTestId('buy-plan-pkg-quarterly').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    );
  });
});

describe('B-MC-2: an ending plan never says Renews', () => {
  it('cancel at period end reads "Ends <date>. Nothing more is charged."', async () => {
    purchases = [purchase({ cancel_at_period_end: true })];
    const r = await render(<ClientPackagesScreen />);
    await waitFor(() => expect(r.getByTestId('current-plan-line')).toBeTruthy());
    expect(r.getByTestId('current-plan-line').props.children).toBe(
      'Ends Nov 2, 2026. Nothing more is charged.',
    );
    // It will not renew, so no "keeps renewing" notice on the other plan.
    expect(r.queryByTestId('plan-second-pkg-quarterly')).toBeNull();
  });
});

describe('U-MC-3: a second plan does not replace a renewing one', () => {
  it('another plan says the current one keeps renewing alongside it', async () => {
    purchases = [purchase({})];
    const r = await render(<ClientPackagesScreen />);
    await waitFor(() => expect(r.getByTestId('plan-second-pkg-quarterly')).toBeTruthy());
    expect(r.getByTestId('plan-second-pkg-quarterly').props.children).toBe(
      'Monthly coaching keeps renewing alongside this plan. To switch, end Monthly coaching in Your plans first.',
    );
    expect(r.queryByTestId('plan-second-pkg-monthly')).toBeNull();
  });
});

describe('U-MC-4: a past-due plan offers Update card on the plan', () => {
  it('Your plans shows Update card and opens the native card screen', async () => {
    purchases = [purchase({ status: 'past_due' })];
    plans = [
      {
        purchase_id: 'purchase-1', package_id: 'pkg-monthly', package_name: 'Monthly coaching', state: 'past_due',
        entitlement_active: true, amount_cents: 4900, currency: 'usd', interval: 'month', interval_count: 1,
        next_charge_at: null, cancel_at_period_end: false, access_ends_at: null, can_cancel: true, can_resume: false,
      },
    ];
    const r = await render(<ClientPackagesScreen />);
    await waitFor(() => expect(r.getByTestId('your-plan-update-card-purchase-1')).toBeTruthy());
    expect(r.getByTestId('your-plan-line-purchase-1').props.children).toBe(
      'The last payment did not go through. To keep this plan, choose Update card. To end it now, choose End my plan.',
    );
    expect(r.getByTestId('current-plan-line').props.children).toBe('The last payment did not go through.');
    await fireEvent.press(r.getByTestId('your-plan-update-card-purchase-1'));
    expect(mockNavigate).toHaveBeenCalledWith('UpdateCard', { autostart: true });
  });
});

describe('U-MC-5: the plans screen has a back control', () => {
  it('shows Back when there is a screen to return to', async () => {
    mockCanGoBack = true;
    const r = await render(<ClientPackagesScreen />);
    await waitFor(() => expect(r.getByTestId('client-packages-back')).toBeTruthy());
    await fireEvent.press(r.getByTestId('client-packages-back'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('shows no Back when opened from another tab with nothing beneath', async () => {
    const r = await render(<ClientPackagesScreen />);
    await waitFor(() => expect(r.getByTestId('client-packages-header')).toBeTruthy());
    expect(r.queryByTestId('client-packages-back')).toBeNull();
  });
});

describe('AUD-SOL-MONEY-124: ordinary plan actions update the charge summary', () => {
  const end = '2026-11-02T12:00:00.000Z';
  const livePlan = (ending: boolean) => ({
    purchase_id: 'purchase-1', package_id: 'pkg-monthly', package_name: 'Monthly coaching',
    state: 'active', entitlement_active: true, amount_cents: 4900, currency: 'usd',
    interval: 'month', interval_count: 1, next_charge_at: ending ? null : end,
    cancel_at_period_end: ending, access_ends_at: ending ? end : null,
    can_cancel: !ending, can_resume: ending,
  });

  it('after End my plan succeeds, Current plan no longer says Renews', async () => {
    purchases = [purchase({})];
    plans = [livePlan(false)];
    mockPost.mockImplementation(async (url: string) => {
      if (url === '/v1/checkout/subscriptions/purchase-1/cancel') {
        purchases = [purchase({ cancel_at_period_end: true })];
        plans = [livePlan(true)];
        return { data: {
          outcome: 'scheduled', access_ends_at: end, voided_amount_cents: 0,
          currency: 'usd', paid_period_kept: false,
        } };
      }
      throw new Error(`unexpected POST ${url}`);
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    try {
      const r = await render(<ClientPackagesScreen />);
      await waitFor(() => expect(r.getByTestId('your-plan-end-purchase-1')).toBeTruthy());
      await fireEvent.press(r.getByTestId('your-plan-end-purchase-1'));
      const confirm = alert.mock.calls[0][2]?.find((b) => b.style === 'destructive');
      expect(confirm?.onPress).toBeTruthy();
      await act(async () => { confirm?.onPress?.(); });
      await waitFor(() => expect(r.getByTestId('your-plan-line-purchase-1').props.children).toContain('will not renew'));
      // A normal completed cancel; the server purchase now agrees too.
      const actual = await clientPaymentsApi.getPaymentStatus();
      expect(actual.ok && actual.data.cancel_at_period_end).toBe(true);
      await waitFor(() => expect(r.getByTestId('current-plan-line').props.children).toBe(
        'Ends Nov 2, 2026. Nothing more is charged.',
      ));
      expect(r.queryByTestId('plan-second-pkg-quarterly')).toBeNull();
    } finally {
      alert.mockRestore();
    }
  });

  it('after Keep my plan succeeds, Current plan no longer says Nothing more is charged', async () => {
    purchases = [purchase({ cancel_at_period_end: true })];
    plans = [livePlan(true)];
    mockPost.mockImplementation(async (url: string) => {
      if (url === '/v1/checkout/subscriptions/purchase-1/resume') {
        purchases = [purchase({ cancel_at_period_end: false })];
        plans = [livePlan(false)];
        return { data: livePlan(false) };
      }
      throw new Error(`unexpected POST ${url}`);
    });
    const r = await render(<ClientPackagesScreen />);
    await waitFor(() => expect(r.getByTestId('your-plan-keep-purchase-1')).toBeTruthy());
    await fireEvent.press(r.getByTestId('your-plan-keep-purchase-1'));
    await waitFor(() => expect(r.getByTestId('your-plan-line-purchase-1').props.children).toBe(
      'Next charge of $49 on Nov 2, 2026.',
    ));
    const actual = await clientPaymentsApi.getPaymentStatus();
    expect(actual.ok && actual.data.cancel_at_period_end).toBe(false);
    await waitFor(() => expect(r.getByTestId('current-plan-line').props.children).toBe('Renews Nov 2, 2026'));
    expect(r.getByTestId('plan-second-pkg-quarterly')).toBeTruthy();
  });
});
