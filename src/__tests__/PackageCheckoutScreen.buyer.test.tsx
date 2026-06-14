// src/__tests__/PackageCheckoutScreen.buyer.test.tsx
//
// PR-18 M1 item 2 — buyer flow RTL mount. The screen loads a package via the
// public share-token route and renders PackageDetailSurface in mode="buyer".
// Pressing the pay CTA mints a Stripe Checkout Session and navigates to the
// branded webview. This is the path that the coachPreview mode MUST NOT take.

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

  it('mints a checkout session and navigates to the branded webview on pay', async () => {
    mockGetByShareToken.mockResolvedValue({ data: PKG });
    mockCreateCheckoutSession.mockResolvedValue({
      data: { url: 'https://checkout.stripe.com/c/pay/cs_test_123' },
    });
    const props = makeProps();
    const { getByLabelText, getByText } = await render(
      <PackageCheckoutScreen navigation={props.navigation} route={props.route} />,
    );
    await waitFor(() => expect(getByText('Strength Builder')).toBeTruthy());

    await fireEvent.press(getByLabelText('Continue to payment'));

    await waitFor(() =>
      expect(mockCreateCheckoutSession).toHaveBeenCalledWith('pkg_uuid_1'),
    );
    await waitFor(() =>
      expect(props._navigate).toHaveBeenCalledWith(
        'BrandedCheckoutWebView',
        expect.objectContaining({
          checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
        }),
      ),
    );
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
