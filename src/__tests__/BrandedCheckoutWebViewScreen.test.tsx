/* eslint-disable @typescript-eslint/no-var-requires */
// BrandedCheckoutWebViewScreen.test.tsx
//
// Render-based tests for the branded in-app Stripe checkout webview.
// Per PR #166 doctrine: assert on what the user sees (testIDs, rendered
// strings) rather than grepping the source. One narrow source-level
// regression guard remains at the bottom — it covers a single grep on
// the *client payment surface directory* (Rule 8: no expo-web-browser
// regression). It is surgical, not a whole-file scan.
//
// Coverage matrix:
//   Header
//     1. TGP badge + "Secure Checkout" + package subtitle render.
//     2. X button has 44pt min tap target + accessibilityLabel.
//     3. Tapping X navigates to CheckoutReturn with outcome=cancel.
//   WebView lifecycle
//     4. WebView mounts at the supplied URL.
//     5. WebView is rendered with sharedCookiesEnabled +
//        thirdPartyCookiesEnabled (Stripe 3DS / SCA requirement).
//     6. originWhitelist is HTTPS-only — no app-scheme entry.
//     7. Loading skeleton renders until onLoadEnd, then disappears.
//   Deep-link short-circuit
//     8. Success deep link routes to CheckoutReturn with session_id.
//     9. Cancel deep link routes to CheckoutReturn with outcome=cancel.
//    10. Settles exactly once even if the deep link fires twice.
//    11. onShouldStartLoadWithRequest returns FALSE for matched deep
//        links (so the WebView never attempts to load the app-scheme URL).
//    12. onShouldStartLoadWithRequest returns FALSE for a malicious
//        non-checkout URL and surfaces a structured TGPError.
//   Structured errors + recovery (Rule 9)
//    13. HTTP 5xx renders structured TGPError + Try-again + Cancel CTAs.
//    14. HTTP 4xx renders distinct copy from 5xx (session expired vs
//        Stripe unreachable).
//    15. Network failure renders structured TGPError + Try-again.
//    16. Tapping Try-again clears the error, calls webview.reload(),
//        and re-mounts the webview.
//   Exact deep-link parsing (security — phishing-prefix attack)
//    17. parseReturnDeepLink REJECTS prefix variants like
//        `…/success.evil.com` and `…/successful` (CRITICAL).
//    18. parseReturnDeepLink accepts trailing slash on path
//        (normalization).
//    19. parseReturnDeepLink is case-insensitive on scheme/host.
//   isOriginAllowed (HTTPS-only)
//    20. Accepts TGP + Stripe hosts.
//    21. Rejects http://, javascript:, data:, typosquats.
//   Regression guard
//    22. The client payment surface directory does not import
//        expo-web-browser anywhere (surgical grep).

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import * as fs from 'fs';
import * as path from 'path';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({
    params: {
      checkoutUrl: 'https://app.bradleytgpcoaching.com/checkout/cs_test_123',
      packageName: 'Elite Coaching',
      returnScheme: 'com.growthproject.app',
    },
  }),
}));

// Theme mock — vends the real design-token module + light semantic tokens so
// the screen's `useTheme().semanticColors` / `tokens` access resolves against
// the production shapes (Phase-11 semantic migration, PR-18 M1).
jest.mock('../theme/ThemeProvider', () => {
  const tokensModule = jest.requireActual('../theme/tokens');
  const realTokens = tokensModule.default;
  const CanonicalColors = jest.requireActual('../constants/colors').default;
  // Legacy flat `colors` map (still consumed by non-scoped child components
  // that have not yet migrated) PLUS the Phase-11 semantic tokens the scoped
  // PR-18 M1 screens now use.
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

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }: { children: React.ReactNode; style?: object }) =>
      React.createElement(View, { style }, children),
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

// Capture the props the WebView receives so the tests can invoke its
// callbacks directly (a real WebView can't be mounted in jsdom).
const capturedWebViewProps: Record<string, unknown> = {};

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockWebView = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    Object.assign(capturedWebViewProps, props);
    React.useImperativeHandle(ref, () => ({
      stopLoading: jest.fn(),
      reload: jest.fn(),
    }));
    const source = props.source as { uri?: string } | undefined;
    return React.createElement(View, {
      testID: props.testID,
      'data-source-uri': source?.uri,
    });
  });
  MockWebView.displayName = 'MockWebView';
  return { __esModule: true, default: MockWebView };
});

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name, testID }: { name: string; testID?: string }) =>
      React.createElement(Text, { testID: testID ?? `icon-${name}` }, `icon:${name}`),
  };
});

// ── Imports under test ────────────────────────────────────────────────────────

import BrandedCheckoutWebViewScreen, {
  CHECKOUT_ALLOWED_HOSTS,
  isOriginAllowed,
  parseReturnDeepLink,
} from '../screens/client/BrandedCheckoutWebViewScreen';
import {
  PACKAGE_CHECKOUT_SUCCESS_URL,
  PACKAGE_CHECKOUT_CANCEL_URL,
  PACKAGE_CHECKOUT_RETURN_SCHEME,
} from '../api/packagesApi';

beforeEach(() => {
  mockNavigate.mockClear();
  for (const k of Object.keys(capturedWebViewProps)) delete capturedWebViewProps[k];
});

// ── Rendered output tests ─────────────────────────────────────────────────────

describe('BrandedCheckoutWebViewScreen — header', () => {
  it('renders TGP brand badge, "Secure Checkout" title, and package subtitle', () => {
    const { getByTestId, getByText } = render(<BrandedCheckoutWebViewScreen />);
    expect(getByTestId('branded-checkout-header')).toBeTruthy();
    // The branded skeleton also renders a "TGP" logo, so scope the badge
    // assertion to the header testID rather than a global text query.
    expect(getByTestId('branded-checkout-logo')).toBeTruthy();
    expect(getByText('Secure Checkout')).toBeTruthy();
    expect(getByText('Elite Coaching')).toBeTruthy();
  });

  it('close button has 44pt min tap target and accessibility label', () => {
    const { getByTestId } = render(<BrandedCheckoutWebViewScreen />);
    const close = getByTestId('branded-checkout-close');
    const flat = Array.isArray(close.props.style)
      ? Object.assign({}, ...close.props.style)
      : close.props.style;
    expect(flat.width).toBeGreaterThanOrEqual(44);
    expect(flat.height).toBeGreaterThanOrEqual(44);
    expect(close.props.accessibilityLabel).toBe('Close checkout');
    expect(close.props.accessibilityRole).toBe('button');
  });

  it('close button cancels checkout via CheckoutReturn navigation', () => {
    const { getByTestId } = render(<BrandedCheckoutWebViewScreen />);
    fireEvent.press(getByTestId('branded-checkout-close'));
    expect(mockNavigate).toHaveBeenCalledWith('CheckoutReturn', { outcome: 'cancel' });
  });
});

describe('BrandedCheckoutWebViewScreen — webview lifecycle', () => {
  it('mounts the WebView at the supplied checkout URL', () => {
    const { getByTestId } = render(<BrandedCheckoutWebViewScreen />);
    const webview = getByTestId('branded-checkout-webview');
    expect(webview).toBeTruthy();
    expect(capturedWebViewProps.source).toEqual({
      uri: 'https://app.bradleytgpcoaching.com/checkout/cs_test_123',
    });
  });

  it('passes sharedCookiesEnabled + thirdPartyCookiesEnabled for Stripe 3DS / SCA', () => {
    render(<BrandedCheckoutWebViewScreen />);
    // Both cookie props MUST be true on render — Stripe Elements stores
    // SCA / 3DS / Link session state in cookies and breaks silently
    // without them.
    expect(capturedWebViewProps.sharedCookiesEnabled).toBe(true);
    expect(capturedWebViewProps.thirdPartyCookiesEnabled).toBe(true);
  });

  it('originWhitelist is HTTPS-only — no app-scheme entry', () => {
    render(<BrandedCheckoutWebViewScreen />);
    const whitelist = capturedWebViewProps.originWhitelist as readonly string[];
    expect(whitelist).toEqual(['https://*']);
    // Defensive: make sure no entry begins with our custom scheme.
    expect(whitelist.some((p) => p.startsWith('com.growthproject.app'))).toBe(false);
  });

  it('renders the branded loading skeleton until onLoadEnd fires', () => {
    const { getByTestId, queryByTestId } = render(<BrandedCheckoutWebViewScreen />);
    expect(getByTestId('branded-checkout-skeleton')).toBeTruthy();
    const onLoadEnd = capturedWebViewProps.onLoadEnd as () => void;
    expect(typeof onLoadEnd).toBe('function');
    act(() => onLoadEnd());
    expect(queryByTestId('branded-checkout-skeleton')).toBeNull();
  });

  it('loading skeleton is TGP-branded (logo + card preview, not a generic spinner)', () => {
    const { getByTestId } = render(<BrandedCheckoutWebViewScreen />);
    // Visible branded logo and a card-shaped layout preview must render
    // — the previous generic ActivityIndicator is gone.
    expect(getByTestId('branded-checkout-skeleton-logo')).toBeTruthy();
    expect(getByTestId('branded-checkout-skeleton-card')).toBeTruthy();
    expect(getByTestId('branded-checkout-skeleton').props.accessibilityRole).toBe(
      'progressbar',
    );
    expect(getByTestId('branded-checkout-skeleton').props.accessibilityLabel).toBe(
      'Loading secure checkout',
    );
  });

  it('respects Reduce Motion — no looping animation when the user has it enabled', async () => {
    const spy = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const { getByTestId } = render(<BrandedCheckoutWebViewScreen />);
    // After AccessibilityInfo resolves, the logo's opacity must be the
    // static resting value (1), not an Animated interpolation. If the
    // pulse loop were still running, opacity would be an
    // AnimatedInterpolation node, not a primitive number.
    await waitFor(() => {
      const logo = getByTestId('branded-checkout-skeleton-logo');
      const flat = Array.isArray(logo.props.style)
        ? Object.assign({}, ...logo.props.style)
        : logo.props.style;
      expect(flat.opacity).toBe(1);
    });
    spy.mockRestore();
  });
});

describe('BrandedCheckoutWebViewScreen — deep link short-circuit', () => {
  it('routes success deep link to CheckoutReturn with session_id', () => {
    render(<BrandedCheckoutWebViewScreen />);
    const onNav = capturedWebViewProps.onNavigationStateChange as (n: {
      url: string;
    }) => void;
    onNav({
      url: 'com.growthproject.app://checkout/success?session_id=cs_test_abc',
    });
    expect(mockNavigate).toHaveBeenCalledWith('CheckoutReturn', {
      outcome: 'success',
      session_id: 'cs_test_abc',
    });
  });

  it('routes cancel deep link to CheckoutReturn with outcome=cancel', () => {
    render(<BrandedCheckoutWebViewScreen />);
    const onNav = capturedWebViewProps.onNavigationStateChange as (n: {
      url: string;
    }) => void;
    onNav({ url: 'com.growthproject.app://checkout/cancel' });
    expect(mockNavigate).toHaveBeenCalledWith('CheckoutReturn', { outcome: 'cancel' });
  });

  it('only settles once even if the deep link fires twice', () => {
    render(<BrandedCheckoutWebViewScreen />);
    const onNav = capturedWebViewProps.onNavigationStateChange as (n: {
      url: string;
    }) => void;
    onNav({ url: 'com.growthproject.app://checkout/success?session_id=cs_1' });
    onNav({ url: 'com.growthproject.app://checkout/success?session_id=cs_1' });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('onShouldStartLoadWithRequest returns FALSE for matched deep links (does not load app-scheme)', () => {
    render(<BrandedCheckoutWebViewScreen />);
    const onShouldStart = capturedWebViewProps.onShouldStartLoadWithRequest as (r: {
      url: string;
    }) => boolean;
    expect(
      onShouldStart({ url: 'com.growthproject.app://checkout/success?session_id=abc' }),
    ).toBe(false);
    expect(onShouldStart({ url: 'com.growthproject.app://checkout/cancel' })).toBe(false);
    // And the callback still fired:
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('onShouldStartLoadWithRequest BLOCKS malicious prefix variants and surfaces structured error', () => {
    const { getByTestId } = render(<BrandedCheckoutWebViewScreen />);
    const onShouldStart = capturedWebViewProps.onShouldStartLoadWithRequest as (r: {
      url: string;
    }) => boolean;
    // Phishing attempt — host is a typosquat, not on the allow-list.
    act(() => {
      expect(onShouldStart({ url: 'https://stripe.evil.example.com/pay' })).toBe(false);
    });
    expect(getByTestId('branded-checkout-error')).toBeTruthy();
    expect(getByTestId('branded-checkout-error-code').props.children).toMatch(
      /TGPError: blocked_origin/,
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// ── Dunning update-card flow — Stripe Billing Portal in branded webview ──────

describe('BrandedCheckoutWebViewScreen — dunning update-card via Stripe Billing Portal', () => {
  // The past-due dunning flow routes `dunning.update_card_url` (a
  // billing.stripe.com URL) into this screen. The audit (round-2 check
  // C12) caught that the allow-list did not include billing.stripe.com,
  // so the webview blocked the navigation and the recovery flow
  // dead-ended.
  it('onShouldStartLoadWithRequest ALLOWS a billing.stripe.com portal URL (no error rendered)', () => {
    const { queryByTestId } = render(<BrandedCheckoutWebViewScreen />);
    const onShouldStart = capturedWebViewProps.onShouldStartLoadWithRequest as (r: {
      url: string;
    }) => boolean;
    act(() => {
      expect(
        onShouldStart({
          url: 'https://billing.stripe.com/p/session/test_YWNjdF8xRXhhbXBsZQ',
        }),
      ).toBe(true);
    });
    // No blocked-origin error and no navigation away.
    expect(queryByTestId('branded-checkout-error')).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('returns to the app via deep-link after the user saves a new card in the portal', () => {
    // Stripe Customer Portal redirects to the configured return URL after
    // a successful card update. In our flow that URL is the same checkout
    // success deep-link, which the screen intercepts and routes through
    // CheckoutReturn so payment-status is re-fetched.
    render(<BrandedCheckoutWebViewScreen />);
    const onShouldStart = capturedWebViewProps.onShouldStartLoadWithRequest as (r: {
      url: string;
    }) => boolean;
    // 1) Portal loads inside the branded webview.
    expect(
      onShouldStart({
        url: 'https://billing.stripe.com/p/session/test_YWNjdF8xRXhhbXBsZQ',
      }),
    ).toBe(true);
    // 2) User saves the new card → portal redirects to the return URL.
    //    The webview gate intercepts it, blocks the navigation, and
    //    settles via CheckoutReturn (so the dunning state refreshes).
    expect(
      onShouldStart({
        url: 'com.growthproject.app://checkout/success?session_id=cs_billing_xyz',
      }),
    ).toBe(false);
    expect(mockNavigate).toHaveBeenCalledWith('CheckoutReturn', {
      outcome: 'success',
      session_id: 'cs_billing_xyz',
    });
  });
});

describe('BrandedCheckoutWebViewScreen — structured error states (Rule 9)', () => {
  it('renders a 5xx-specific TGPError with Try again + Cancel CTAs', () => {
    const { getByTestId, queryByTestId, getByText } = render(<BrandedCheckoutWebViewScreen />);
    const onHttpError = capturedWebViewProps.onHttpError as (e: {
      nativeEvent: { statusCode: number };
    }) => void;
    act(() => {
      onHttpError({ nativeEvent: { statusCode: 502 } });
    });
    expect(getByTestId('branded-checkout-error')).toBeTruthy();
    expect(getByTestId('branded-checkout-error-code').props.children).toMatch(
      /TGPError: http_502/,
    );
    expect(getByText('Stripe is temporarily unreachable')).toBeTruthy();
    expect(getByTestId('branded-checkout-error-retry')).toBeTruthy();
    expect(getByTestId('branded-checkout-error-cancel')).toBeTruthy();
    expect(queryByTestId('branded-checkout-webview')).toBeNull();
  });

  it('renders distinct 4xx copy (session expired) versus 5xx (unreachable)', () => {
    const { getByText } = render(<BrandedCheckoutWebViewScreen />);
    const onHttpError = capturedWebViewProps.onHttpError as (e: {
      nativeEvent: { statusCode: number };
    }) => void;
    act(() => {
      onHttpError({ nativeEvent: { statusCode: 410 } });
    });
    expect(getByText('Checkout session expired')).toBeTruthy();
  });

  it('renders a network-failure TGPError with Try again', () => {
    const { getByTestId } = render(<BrandedCheckoutWebViewScreen />);
    const onError = capturedWebViewProps.onError as (e: {
      nativeEvent: { code: number };
    }) => void;
    act(() => {
      onError({ nativeEvent: { code: -1009 } });
    });
    expect(getByTestId('branded-checkout-error-code').props.children).toMatch(
      /TGPError: net_-1009/,
    );
    expect(getByTestId('branded-checkout-error-retry')).toBeTruthy();
  });

  it('tapping Try again clears the error and re-mounts the webview (fresh load)', () => {
    const { getByTestId, queryByTestId } = render(<BrandedCheckoutWebViewScreen />);
    const onError = capturedWebViewProps.onError as (e: {
      nativeEvent: { code: number };
    }) => void;
    act(() => {
      onError({ nativeEvent: { code: -1009 } });
    });
    expect(getByTestId('branded-checkout-error')).toBeTruthy();
    expect(queryByTestId('branded-checkout-webview')).toBeNull();
    // Reset captured props so we can confirm a *new* WebView instance is
    // mounted with the original checkoutUrl after retry. A re-mount is
    // how the load actually happens — calling `reload()` on a stale ref
    // (the error branch unmounts the WebView) would be a no-op.
    for (const k of Object.keys(capturedWebViewProps)) delete capturedWebViewProps[k];
    act(() => {
      fireEvent.press(getByTestId('branded-checkout-error-retry'));
    });
    expect(queryByTestId('branded-checkout-error')).toBeNull();
    expect(getByTestId('branded-checkout-webview')).toBeTruthy();
    expect(capturedWebViewProps.source).toEqual({
      uri: 'https://app.bradleytgpcoaching.com/checkout/cs_test_123',
    });
    // The fresh webview also reasserts the cookie props (regression
    // guard against losing them in a refactor of the retry branch).
    expect(capturedWebViewProps.sharedCookiesEnabled).toBe(true);
    expect(capturedWebViewProps.thirdPartyCookiesEnabled).toBe(true);
  });
});

// ── Pure-function tests — origin allow-list & deep-link parsing ───────────────

describe('isOriginAllowed', () => {
  it('accepts TGP-branded checkout host and its subdomains', () => {
    expect(isOriginAllowed('https://app.bradleytgpcoaching.com/checkout/x')).toBe(true);
    expect(isOriginAllowed('https://bradleytgpcoaching.com/checkout/x')).toBe(true);
    expect(isOriginAllowed('https://app.trygrowthproject.com/checkout')).toBe(true);
  });

  it('accepts Stripe payment iframe hosts', () => {
    expect(isOriginAllowed('https://checkout.stripe.com/c/pay/cs_test')).toBe(true);
    expect(isOriginAllowed('https://js.stripe.com/v3/')).toBe(true);
    expect(isOriginAllowed('https://m.stripe.network/inner.html')).toBe(true);
  });

  it('accepts Stripe Customer Billing Portal (dunning update-card flow)', () => {
    // Past-due clients tap "Update card" and the backend mints a
    // billing.stripe.com session URL. The branded webview must allow it
    // or the dunning recovery flow dead-ends (audit C12).
    expect(isOriginAllowed('https://billing.stripe.com/p/session/test_xyz')).toBe(true);
    expect(isOriginAllowed('https://billing.stripe.com/p/login/test_abc')).toBe(true);
  });

  it('rejects http:// (HTTPS-only for checkout)', () => {
    expect(isOriginAllowed('http://app.bradleytgpcoaching.com/checkout')).toBe(false);
    expect(isOriginAllowed('http://checkout.stripe.com/c/pay')).toBe(false);
  });

  it('rejects unknown origins (phishing / typosquat / non-http scheme)', () => {
    expect(isOriginAllowed('https://evil.example.com/pay')).toBe(false);
    expect(isOriginAllowed('https://stripe.evil.com/pay')).toBe(false);
    expect(isOriginAllowed('https://app.bradleytgpcoaching.com.attacker.com/x')).toBe(false);
    expect(isOriginAllowed('javascript:alert(1)')).toBe(false);
    expect(isOriginAllowed('data:text/html,<script>')).toBe(false);
    expect(isOriginAllowed('not a url')).toBe(false);
  });

  it('exports the canonical allow-list (8+ hosts)', () => {
    // Sanity guard against accidental shrink — Rule 11 (never shrink features).
    expect(CHECKOUT_ALLOWED_HOSTS.length).toBeGreaterThanOrEqual(8);
    expect(CHECKOUT_ALLOWED_HOSTS).toContain('checkout.stripe.com');
    expect(CHECKOUT_ALLOWED_HOSTS).toContain('app.bradleytgpcoaching.com');
    expect(CHECKOUT_ALLOWED_HOSTS).toContain('billing.stripe.com');
  });
});

describe('parseReturnDeepLink — exact, not prefix', () => {
  it('extracts session_id from a success deep link', () => {
    expect(
      parseReturnDeepLink(
        'com.growthproject.app://checkout/success?session_id=cs_test_xyz',
        'com.growthproject.app',
      ),
    ).toEqual({ outcome: 'success', sessionId: 'cs_test_xyz' });
  });

  it('returns success with null session_id when missing', () => {
    expect(
      parseReturnDeepLink(
        'com.growthproject.app://checkout/success',
        'com.growthproject.app',
      ),
    ).toEqual({ outcome: 'success', sessionId: null });
  });

  it('recognises the cancel deep link', () => {
    expect(
      parseReturnDeepLink(
        'com.growthproject.app://checkout/cancel',
        'com.growthproject.app',
      ),
    ).toEqual({ outcome: 'cancel' });
  });

  it('accepts a trailing slash on the path (normalization)', () => {
    expect(
      parseReturnDeepLink(
        'com.growthproject.app://checkout/success/',
        'com.growthproject.app',
      ),
    ).toEqual({ outcome: 'success', sessionId: null });
    expect(
      parseReturnDeepLink(
        'com.growthproject.app://checkout/cancel/',
        'com.growthproject.app',
      ),
    ).toEqual({ outcome: 'cancel' });
  });

  it('is case-insensitive on scheme and host', () => {
    expect(
      parseReturnDeepLink(
        'COM.GROWTHPROJECT.APP://CHECKOUT/success',
        'com.growthproject.app',
      ),
    ).toEqual({ outcome: 'success', sessionId: null });
  });

  // ─── CRITICAL SECURITY TESTS — phishing-prefix attack must be rejected ───

  it('REJECTS phishing variant `…/success.evil.com` (path is not exact)', () => {
    expect(
      parseReturnDeepLink(
        'com.growthproject.app://checkout/success.evil.com',
        'com.growthproject.app',
      ),
    ).toBeNull();
  });

  it('REJECTS phishing variant `…/successful` (path is not exact)', () => {
    expect(
      parseReturnDeepLink(
        'com.growthproject.app://checkout/successful?session_id=cs_x',
        'com.growthproject.app',
      ),
    ).toBeNull();
  });

  it('REJECTS phishing variant `…/cancelled` (path is not exact)', () => {
    expect(
      parseReturnDeepLink(
        'com.growthproject.app://checkout/cancelled',
        'com.growthproject.app',
      ),
    ).toBeNull();
  });

  it('REJECTS wrong host (must be `checkout`)', () => {
    expect(
      parseReturnDeepLink(
        'com.growthproject.app://attacker/success',
        'com.growthproject.app',
      ),
    ).toBeNull();
  });

  it('REJECTS wrong scheme (must match returnScheme exactly)', () => {
    expect(
      parseReturnDeepLink(
        'com.attacker.app://checkout/success',
        'com.growthproject.app',
      ),
    ).toBeNull();
  });

  it('returns null for unrelated URLs (Stripe internal navigation)', () => {
    expect(
      parseReturnDeepLink(
        'https://checkout.stripe.com/pay/cs_test_xyz',
        'com.growthproject.app',
      ),
    ).toBeNull();
  });

  // P0 fix: the public-package checkout redirect URLs minted by packagesApi
  // MUST round-trip through this parser under the returnScheme the
  // PackageCheckoutScreen passes. The audited bug minted
  // `growthproject://checkout/return` (scheme + path mismatch) so a completed
  // payment was never intercepted and the buyer never reached CheckoutReturn.
  it('parses the packagesApi-minted public checkout redirect URLs (P0)', () => {
    const mintedSuccess = PACKAGE_CHECKOUT_SUCCESS_URL.replace(
      '{CHECKOUT_SESSION_ID}',
      'cs_test_abc123',
    );
    expect(parseReturnDeepLink(mintedSuccess, PACKAGE_CHECKOUT_RETURN_SCHEME)).toEqual(
      { outcome: 'success', sessionId: 'cs_test_abc123' },
    );
    expect(
      parseReturnDeepLink(PACKAGE_CHECKOUT_CANCEL_URL, PACKAGE_CHECKOUT_RETURN_SCHEME),
    ).toEqual({ outcome: 'cancel' });
  });
});

// ── Regression guard — Rule 8 (no expo-web-browser on client payment surface) ─

describe('client payment surface — no expo-web-browser regression', () => {
  // Surgical: a single grep over the *client payment surface* directory.
  // Per Rule 8, payments must stay inside the app via the branded webview.
  // If a regression imports `expo-web-browser` anywhere in `src/screens/client`
  // or `src/api` (payments), this test will fail and explain why.
  it('does not import expo-web-browser anywhere in the client screens directory', () => {
    const clientDir = path.resolve(__dirname, '..', 'screens', 'client');
    const files = fs
      .readdirSync(clientDir, { withFileTypes: true })
      .filter((f) => f.isFile() && /\.tsx?$/.test(f.name));
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(clientDir, f.name), 'utf8');
      if (/from ['"]expo-web-browser['"]/.test(src)) offenders.push(f.name);
    }
    expect(offenders).toEqual([]);
  });

  it('does not import expo-web-browser anywhere in clientPaymentsApi.ts', () => {
    const apiFile = path.resolve(__dirname, '..', 'api', 'clientPaymentsApi.ts');
    const src = fs.readFileSync(apiFile, 'utf8');
    expect(src).not.toMatch(/from ['"]expo-web-browser['"]/);
  });
});
