/**
 * B-RECUR-MOB (agent 114): Membership plans sells through the shared native
 * purchase flow. Renewing plans -> POST /v1/checkout/subscription-intent ->
 * PaymentSheet; terms are visible before paying; no hosted Checkout and no
 * BrandedCheckoutWebView. The Your plans panel ends a plan at period end.
 *
 * Failing before: handleBuy called clientPaymentsApi.createCheckoutSession
 * and navigated to BrandedCheckoutWebView with a hosted Checkout URL; there
 * was no Your plans panel.
 */
import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../theme/ThemeProvider', () => {
  const realTokens = jest.requireActual('../theme/tokens').default;
  return {
    useTheme: () => ({ tokens: realTokens, semanticColors: realTokens.lightTokens, colorScheme: 'light' }),
  };
});
jest.mock('../ui/skeletons/Skeleton', () => ({ SkeletonScreen: () => null }));
jest.mock('../config/featureFlags', () => {
  const actual = jest.requireActual('../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, deliverables: true } };
});
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockNoCoach = false;
jest.mock('../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => mockNoCoach }));
jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, canGoBack: () => true,
      getParent: () => ({ navigate: mockNavigate }) }),
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
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client-plans', role: 'student', coach_id: 'coach-1' }),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
const mockCreateCheckoutSession = jest.fn();
jest.mock('../api/clientPaymentsApi', () => {
  const { purchasableFromCoachPackage } = jest.requireActual('../lib/planTerms');
  const raw = {
    id: 'pkg-monthly', name: 'Monthly coaching', amount_cents: 9900, currency: 'usd',
    billing_type: 'recurring', interval: 'month', description: null, features: [],
  };
  const pkg = {
    id: raw.id, name: raw.name, description: null, price: 99, currency: 'usd', type: 'recurring',
    interval: 'month', trial_days: null, features: [], purchasable: purchasableFromCoachPackage(raw),
  };
  return {
    clientPaymentsApi: {
      getPackages: jest.fn(async () => ({ ok: true, data: [pkg] })),
      getPaymentStatus: jest.fn(async () => ({
        ok: true,
        data: { active: false, package_id: null, package_name: null, current_period_end: null, trial_ends_at: null, dunning: null },
      })),
      createCheckoutSession: (...a: unknown[]) => mockCreateCheckoutSession(...a),
      getEntitlement: jest.fn(async () => ({ ok: true, data: { active: true } })),
    },
  };
});
const mockInitPaymentSheet = jest.fn();
jest.mock('@stripe/stripe-react-native', () => ({
  initStripe: jest.fn(async () => undefined),
  initPaymentSheet: (...a: unknown[]) => mockInitPaymentSheet(...a),
  presentPaymentSheet: jest.fn(async () => ({})),
}));

import ClientPackagesScreen from '../screens/client/ClientPackagesScreen';
import { clientPaymentsApi } from '../api/clientPaymentsApi';

const defaultPackages = jest.mocked(clientPaymentsApi.getPackages).getMockImplementation();
const defaultStatus = jest.mocked(clientPaymentsApi.getPaymentStatus).getMockImplementation();

const PLAN = {
  purchase_id: 'purchase-1', package_id: 'pkg-monthly', package_name: 'Monthly coaching', state: 'active',
  entitlement_active: true, amount_cents: 9900, currency: 'usd', interval: 'month', interval_count: 1,
  next_charge_at: '2026-11-02T12:00:00.000Z', cancel_at_period_end: false, access_ends_at: null,
  can_cancel: true, can_resume: false,
};
let plans: unknown[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  mockNoCoach = false;
  if (defaultPackages) jest.mocked(clientPaymentsApi.getPackages).mockImplementation(defaultPackages);
  if (defaultStatus) jest.mocked(clientPaymentsApi.getPaymentStatus).mockImplementation(defaultStatus);
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_build';
  plans = [];
  mockGet.mockImplementation(async (url: string) => {
    if (url === '/v1/clients/me/coach') return { data: { name: 'Coach Lee' } };
    if (url === '/v1/checkout/subscriptions') return { data: { plans } };
    if (url === '/v1/checkout/subscriptions/purchase-1') return { data: PLAN };
    throw Object.assign(new Error('404'), { response: { status: 404, data: {} } });
  });
  mockPost.mockImplementation(async (url: string) => {
    if (url === '/v1/checkout/subscription-intent') {
      return {
        data: {
          mode: 'payment', client_secret: 'pi_plans_secret', ephemeral_key: 'ek_plans', customer_id: 'cus_plans',
          publishable_key: 'pk_test_plans', purchase_id: 'purchase-1', subscription_id: 'sub_1', status: 'incomplete',
          reused: false,
          plan: { amount_cents: 9900, currency: 'usd', interval: 'month', interval_count: 1, first_charge_cents: 9900, one_time_cents: 0, trial_days: 0, trial_ends_at: null, package_id: 'pkg-monthly', package_name: 'Monthly coaching' },
        },
      };
    }
    if (url === '/v1/checkout/subscriptions/purchase-1/cancel') return { data: {} };
    throw new Error(`unexpected POST ${url}`);
  });
  mockInitPaymentSheet.mockResolvedValue({});
});

it('shows the plan terms and sells the renewing plan in the native PaymentSheet', async () => {
  const r = await render(<ClientPackagesScreen />);
  await waitFor(() => expect(r.getByTestId('buy-plan-pkg-monthly')).toBeTruthy());
  expect(r.getByTestId('plan-terms-pkg-monthly-renewal').props.children).toMatch(/Renews automatically/);
  expect(r.getByText('Subscribe for $99.00 a month')).toBeTruthy();
  expect(StyleSheet.flatten(r.getByText('Monthly coaching').props.style).fontFamily).toMatch(/^Cormorant/);
  expect(StyleSheet.flatten(r.getAllByText('$99.00 a month')[0].props.style).fontVariant).toEqual(['tabular-nums']);
  expect(StyleSheet.flatten(r.getByTestId('buy-plan-pkg-monthly').props.style).minHeight).toBe(44);

  await fireEvent.press(r.getByTestId('buy-plan-pkg-monthly'));
  await waitFor(() => expect(r.getByTestId('payment-success')).toBeTruthy());
  expect(mockPost.mock.calls[0][0]).toBe('/v1/checkout/subscription-intent');
  expect(mockInitPaymentSheet).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentClientSecret: 'pi_plans_secret' }));
  expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalledWith('BrandedCheckoutWebView', expect.anything());
});

it('Your plans: End my plan confirms, then cancels at period end through the #628 route', async () => {
  plans = [PLAN];
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _b, buttons) => {
    const end = (buttons ?? []).find((b) => b.style === 'destructive');
    end?.onPress?.();
  });
  const r = await render(<ClientPackagesScreen />);
  await waitFor(() => expect(r.getByTestId('your-plan-purchase-1')).toBeTruthy());
  expect(r.getByText(/Next charge of \$99\.00 a month on November 2, 2026/)).toBeTruthy();
  await fireEvent.press(r.getByTestId('your-plan-end-purchase-1'));
  await waitFor(() =>
    expect(mockPost).toHaveBeenCalledWith('/v1/checkout/subscriptions/purchase-1/cancel', {}),
  );
  expect(alertSpy.mock.calls[0][1]).toBe(
    'Your plan stays active until November 2, 2026, and nothing more is charged after that. If a payment is overdue, ending it ends access now instead and cancels the unpaid charge.',
  );
  alertSpy.mockRestore();
});

it('keeps Back, message-coach, coach-code and list retry paths reachable', async () => {
  jest.mocked(clientPaymentsApi.getPackages).mockResolvedValue({ ok: true, data: [] });
  jest.mocked(clientPaymentsApi.getPaymentStatus).mockResolvedValue({ ok: true, data: {
    state: 'none', purchase_id: null, package_id: null, package_name: null,
    current_period_end: null, trial_ends_at: null, dunning: null,
  } });
  const r = await render(<ClientPackagesScreen />);
  await waitFor(() => expect(r.getByLabelText('Message your coach')).toBeTruthy());
  await fireEvent.press(r.getByLabelText('Back'));
  expect(mockGoBack).toHaveBeenCalledTimes(1);
  await fireEvent.press(r.getByLabelText('Message your coach'));
  expect(mockNavigate).toHaveBeenCalledWith('Home', { screen: 'Messages' });
  mockNoCoach = true;
  await r.rerender(<ClientPackagesScreen />);
  await fireEvent.press(r.getByRole('button', { name: /coach code/i }));
  expect(mockNavigate).toHaveBeenCalledWith('Home', { screen: 'Messages', params: { openCoachCode: true } });
  mockNoCoach = false;
  jest.mocked(clientPaymentsApi.getPackages).mockResolvedValue({
    ok: false, reason: 'error', message: 'Plans did not load.',
  });
  await r.unmount();
  const retry = await render(<ClientPackagesScreen />);
  await waitFor(() => expect(retry.getByText('Plans did not load. Tap to retry.')).toBeTruthy());
  jest.mocked(clientPaymentsApi.getPackages).mockClear();
  await fireEvent.press(retry.getByText('Plans did not load. Tap to retry.'));
  expect(clientPaymentsApi.getPackages).toHaveBeenCalled();
});

it('keeps current-plan inclusions and native card-update destinations', async () => {
  jest.mocked(clientPaymentsApi.getPaymentStatus).mockResolvedValue({ ok: true, data: {
    state: 'past_due', purchase_id: 'purchase-1', package_id: 'pkg-monthly', package_name: 'Monthly coaching',
    current_period_end: null, trial_ends_at: null,
    dunning: { summary: 'Payment needs attention.', update_card_url: null, grace_until: null },
  } });
  const r = await render(<ClientPackagesScreen />);
  await waitFor(() => expect(r.getByLabelText('Update card')).toBeTruthy());
  await fireEvent.press(r.getByLabelText('Update card'));
  expect(mockNavigate).toHaveBeenCalledWith('UpdateCard', { autostart: true });
  await fireEvent.press(r.getByTestId('view-deliverables-cta'));
  expect(mockNavigate).toHaveBeenCalledWith('Deliverables', {
    purchaseId: 'purchase-1', packageName: 'Monthly coaching',
  });
  expect(r.getByTestId('buy-plan-pkg-monthly').props.accessibilityState.disabled).toBe(true);
});

it('Your plans: a plan that already ended gets its own copy, never a generic error', async () => {
  plans = [PLAN];
  mockPost.mockImplementation(async () => {
    throw Object.assign(new Error('409'), {
      response: { status: 409, data: { code: 'PLAN_ALREADY_ENDED', error: 'PLAN_ALREADY_ENDED', message: 'x' }, headers: {} },
      config: { headers: {} },
    });
  });
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _b, buttons) => {
    (buttons ?? []).find((b) => b.style === 'destructive')?.onPress?.();
  });
  const r = await render(<ClientPackagesScreen />);
  await waitFor(() => expect(r.getByTestId('your-plan-purchase-1')).toBeTruthy());
  await fireEvent.press(r.getByTestId('your-plan-end-purchase-1'));
  await waitFor(() => expect(r.getByTestId('your-plan-error')).toBeTruthy());
  expect(r.getByTestId('your-plan-error').props.children[0]).toBe(
    'This plan has already ended, so nothing changed and nothing more is charged. Choose a plan below to start again.',
  );
  alertSpy.mockRestore();
});
