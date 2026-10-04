// src/__tests__/PackageCheckoutScreen.buyer.test.tsx
//
// PR-18 M1 item 2 — buyer flow RTL mount. The screen loads a package via the
// public share-token route and renders PackageDetailSurface in mode="buyer".
// Pressing the pay CTA runs the shared purchase flow in the native
// PaymentSheet (B-RECUR-MOB, OR-113-1): a renewing plan goes through
// POST /v1/checkout/subscription-intent, never hosted Checkout or a webview.
// This is the path that the coachPreview mode MUST NOT take.
// Failing before: pay minted a hosted Checkout Session and navigated to
// BrandedCheckoutWebView.

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// ── Theme mock ──────────────────────────────────────────────────────────────
jest.mock('../theme/ThemeProvider', () => {
  const tokensModule = jest.requireActual('../theme/tokens');
  const realTokens = tokensModule.default;
  const CanonicalColors = jest.requireActual('../constants/colors').default;
  const colors = {
    ...CanonicalColors,
    dark: CanonicalColors.textPrimary,
    white: CanonicalColors.textOnPrimary,
    gold: CanonicalColors.warning,
    orange: CanonicalColors.error,
  };
  return {
    useTheme: () => ({
      colors,
      tokens: realTokens,
      semanticColors: realTokens.lightTokens,
      tierColors: {
        accentBorder: realTokens.colors.forest,
        accentBg: 'rgba(44,74,54,0.06)',
        accentFg: realTokens.colors.forest,
        badgeShadow: realTokens.shadows.sm,
      },
      colorScheme: 'light',
    }),
  };
});

jest.mock('expo-font', () => ({ isLoaded: () => true }));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../utils/haptics', () => ({
  lightTap: jest.fn(),
  mediumTap: jest.fn(),
  warningTap: jest.fn(),
  successTap: jest.fn(),
}));

const mockGetByShareToken = jest.fn();
const mockCreateCheckoutSession = jest.fn();
jest.mock('../api/packagesApi', () => ({
  __esModule: true,
  publicPackagesApi: {
    getByShareToken: (...a: unknown[]) => mockGetByShareToken(...a),
    createCheckoutSession: (...a: unknown[]) => mockCreateCheckoutSession(...a),
  },
}));

const mockPost = jest.fn();
const mockGet = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
}));
jest.mock('../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
const mockInitPaymentSheet = jest.fn();
const mockPresent = jest.fn();
jest.mock('@stripe/stripe-react-native', () => ({
  initStripe: jest.fn(async () => undefined),
  initPaymentSheet: (...a: unknown[]) => mockInitPaymentSheet(...a),
  presentPaymentSheet: (...a: unknown[]) => mockPresent(...a),
}));

import PackageCheckoutScreen from '../screens/client/PackageCheckoutScreen';

const PKG = {
  id: 'pkg_uuid_1',
  title: 'Strength Builder',
  description: 'Get strong.',
  priceCents: 9900,
  currency: 'usd',
  billingInterval: 'monthly' as const,
  intervalCount: 1,
  trialDays: null,
  features: ['Programming', 'Form checks'],
  coach: { id: null, displayName: 'Coach Lee', bio: null, verified: true },
  stripePublishableKey: null,
};

function makeProps() {
  const navigate = jest.fn();
  const goBack = jest.fn();
  return {
    navigation: { navigate, goBack } as never,
    route: { params: { shareToken: 'abc-123_DEF' } } as never,
    _navigate: navigate,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PackageCheckoutScreen — buyer flow', () => {
  it('loads the package and renders it via PackageDetailSurface (buyer mode)', async () => {
    mockGetByShareToken.mockResolvedValue({ data: PKG });
    const props = makeProps();
    const { getByText, getByLabelText } = await render(
      <PackageCheckoutScreen navigation={props.navigation} route={props.route} />,
    );
    await waitFor(() => expect(getByText('Strength Builder')).toBeTruthy());
    expect(getByText('Coach Lee')).toBeTruthy();
    // Buyer mode → functional pay CTA present.
    expect(getByLabelText('Continue to payment')).toBeTruthy();
  });

  it('sells the renewing plan through subscription-intent and the native PaymentSheet (no webview)', async () => {
    mockGetByShareToken.mockResolvedValue({ data: PKG });
    mockPost.mockResolvedValue({
      data: {
        mode: 'payment',
        client_secret: 'pi_share_secret_1',
        ephemeral_key: 'ek_share',
        customer_id: 'cus_share',
        publishable_key: 'pk_test_share',
        purchase_id: 'purchase-1',
        subscription_id: 'sub_1',
        status: 'incomplete',
        reused: false,
        plan: { amount_cents: 9900, currency: 'usd', interval: 'month', interval_count: 1, first_charge_cents: 9900, one_time_cents: 0, trial_days: 0, trial_ends_at: null, package_id: 'pkg_uuid_1', package_name: 'Strength Builder' },
      },
    });
    mockGet.mockResolvedValue({
      data: { purchase_id: 'purchase-1', package_id: 'pkg_uuid_1', package_name: 'Strength Builder', state: 'active', entitlement_active: true, amount_cents: 9900, currency: 'usd', interval: 'month', interval_count: 1, next_charge_at: '2026-11-02T12:00:00.000Z' },
    });
    mockInitPaymentSheet.mockResolvedValue({});
    mockPresent.mockResolvedValue({});
    const props = makeProps();
    const { getByLabelText, getByText, getByTestId } = await render(
      <PackageCheckoutScreen navigation={props.navigation} route={props.route} />,
    );
    await waitFor(() => expect(getByText('Strength Builder')).toBeTruthy());
    // Terms before paying, CTA from the terms.
    expect(getByText(/Renews automatically/)).toBeTruthy();
    expect(getByText('Subscribe for $99.00 a month')).toBeTruthy();

    await fireEvent.press(getByLabelText('Continue to payment'));
    await waitFor(() => expect(getByTestId('payment-success')).toBeTruthy());

    expect(mockPost.mock.calls[0][0]).toBe('/v1/checkout/subscription-intent');
    expect(mockPost.mock.calls[0][1]).toEqual(expect.objectContaining({ package_id: 'pkg_uuid_1', expected_amount_cents: 9900 }));
    expect(mockInitPaymentSheet).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentClientSecret: 'pi_share_secret_1' }));
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
    expect(props._navigate).not.toHaveBeenCalledWith('BrandedCheckoutWebView', expect.anything());

    await fireEvent.press(getByTestId('payment-continue'));
    expect(props._navigate).toHaveBeenCalledWith('ClientPackages');
  });

  it('a share link from a coach this account is not with gets its own copy', async () => {
    mockGetByShareToken.mockResolvedValue({ data: PKG });
    mockPost.mockRejectedValue(
      Object.assign(new Error('404'), { response: { status: 404, data: { code: 'PACKAGE_NOT_FOUND', error: 'PACKAGE_NOT_FOUND', message: 'x' }, headers: {} }, config: { headers: {} } }),
    );
    const props = makeProps();
    const { getByLabelText, getByText, getByTestId } = await render(
      <PackageCheckoutScreen navigation={props.navigation} route={props.route} />,
    );
    await waitFor(() => expect(getByText('Strength Builder')).toBeTruthy());
    await fireEvent.press(getByLabelText('Continue to payment'));
    await waitFor(() => expect(getByTestId('payment-error')).toBeTruthy());
    // B-342-1 (Sol, 119): never a no-charge claim; plan check and support offered.
    expect(getByTestId('payment-error').props.children).toMatch(
      /^This plan cannot be bought from this account\. It is either no longer offered or it belongs to a coach you are not connected with\. If an earlier payment for it did not show a clear result, open your plan in Membership to check it, or email support and quote reference [0-9a-f]{8}\. Otherwise, message the coach who shared the link\.$/,
    );
    expect(mockInitPaymentSheet).not.toHaveBeenCalled();
  });

  it('shows an actionable error when the share token is empty (never a silent 404)', async () => {
    const props = makeProps();
    props.route = { params: { shareToken: '' } } as never;
    const { getByText } = await render(
      <PackageCheckoutScreen navigation={props.navigation} route={props.route} />,
    );
    await waitFor(() => expect(getByText('This link is not yet active')).toBeTruthy());
    expect(mockGetByShareToken).not.toHaveBeenCalled();
  });
});
