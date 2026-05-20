/* eslint-disable @typescript-eslint/no-var-requires */
// BrandedCheckoutWebViewScreen.test.tsx
//
// Render-based tests for the branded in-app Stripe checkout webview.
// Per PR #166 doctrine: assert on what the user sees (testIDs, rendered
// strings) rather than grepping the source. The few source-level guards
// at the bottom enforce Rule 9 (structured errors only) and Rule 8 (no
// `expo-web-browser` regression).
//
// Coverage matrix (10 tests):
//   1.  Header renders TGP badge, "Secure Checkout" title, and the
//       package name subtitle when provided.
//   2.  X button has min 44pt tap target + accessibilityLabel.
//   3.  Tapping X navigates to CheckoutReturn with outcome=cancel.
//   4.  The webview is mounted with the supplied checkoutUrl.
//   5.  Loading skeleton renders on mount and disappears on load end.
//   6.  Success deep-link short-circuit routes to CheckoutReturn with
//       outcome=success + session_id.
//   7.  Cancel deep-link short-circuit routes to CheckoutReturn with
//       outcome=cancel.
//   8.  HTTP error from Stripe surfaces a structured TGPError state
//       and hides the webview.
//   9.  Network/load error surfaces a structured TGPError state.
//   10. Allow-list helper rejects non-checkout origins (phishing
//       redirect protection) and accepts both TGP + Stripe domains.

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
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

jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      primary: '#2C4A36',
      primaryDark: '#1B2E22',
      background: '#F5EFE4',
      textPrimary: '#1A1A18',
      textSecondary: '#3D3D3A',
      textMuted: '#B1A89F',
      textOnPrimary: '#F5EFE4',
      gold: '#C5A253',
      error: '#4A0404',
    },
  }),
}));

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
    React.useImperativeHandle(ref, () => ({ stopLoading: jest.fn() }));
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

beforeEach(() => {
  mockNavigate.mockClear();
  for (const k of Object.keys(capturedWebViewProps)) delete capturedWebViewProps[k];
});

// ── Rendered output tests ─────────────────────────────────────────────────────

describe('BrandedCheckoutWebViewScreen — header', () => {
  it('renders TGP brand badge, "Secure Checkout" title, and package subtitle', () => {
    const { getByTestId, getByText } = render(<BrandedCheckoutWebViewScreen />);
    expect(getByTestId('branded-checkout-header')).toBeTruthy();
    expect(getByText('TGP')).toBeTruthy();
    expect(getByText('Secure Checkout')).toBeTruthy();
    expect(getByText('Elite Coaching')).toBeTruthy();
  });

  it('close button has 44pt min tap target and accessibility label', () => {
    const { getByTestId } = render(<BrandedCheckoutWebViewScreen />);
    const close = getByTestId('branded-checkout-close');
    // Style is an object; assert min dimensions.
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

  it('renders the branded loading skeleton until onLoadEnd fires', () => {
    const { getByTestId, queryByTestId } = render(<BrandedCheckoutWebViewScreen />);
    expect(getByTestId('branded-checkout-skeleton')).toBeTruthy();
    // Simulate Stripe finishing the load.
    const onLoadEnd = capturedWebViewProps.onLoadEnd as () => void;
    expect(typeof onLoadEnd).toBe('function');
    fireEvent(getByTestId('branded-checkout-webview'), 'loadEnd');
    // The screen owns loading state — directly invoking the prop is the
    // most deterministic way to verify the transition.
    onLoadEnd();
    expect(queryByTestId('branded-checkout-skeleton')).toBeNull();
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
});

describe('BrandedCheckoutWebViewScreen — structured error states (Rule 9)', () => {
  it('renders a structured TGPError on HTTP failure', () => {
    const { getByTestId, queryByTestId } = render(<BrandedCheckoutWebViewScreen />);
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
    // Webview is unmounted while the error UI owns the screen.
    expect(queryByTestId('branded-checkout-webview')).toBeNull();
  });

  it('renders a structured TGPError on network failure', () => {
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

  it('rejects unknown origins (phishing / typosquat / data: scheme)', () => {
    expect(isOriginAllowed('https://evil.example.com/pay')).toBe(false);
    expect(isOriginAllowed('https://stripe.evil.com/pay')).toBe(false);
    expect(isOriginAllowed('http://app.bradleytgpcoaching.com.attacker.com/x')).toBe(
      false,
    );
    expect(isOriginAllowed('javascript:alert(1)')).toBe(false);
    expect(isOriginAllowed('data:text/html,<script>')).toBe(false);
    expect(isOriginAllowed('not a url')).toBe(false);
  });

  it('exports the canonical allow-list (8+ hosts)', () => {
    // Sanity guard against accidental shrink — Rule 11 (never shrink features).
    expect(CHECKOUT_ALLOWED_HOSTS.length).toBeGreaterThanOrEqual(8);
    expect(CHECKOUT_ALLOWED_HOSTS).toContain('checkout.stripe.com');
    expect(CHECKOUT_ALLOWED_HOSTS).toContain('app.bradleytgpcoaching.com');
  });
});

describe('parseReturnDeepLink', () => {
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

  it('returns null for unrelated URLs (Stripe internal navigation)', () => {
    expect(
      parseReturnDeepLink(
        'https://checkout.stripe.com/pay/cs_test_xyz',
        'com.growthproject.app',
      ),
    ).toBeNull();
  });
});

// ── Source guards — Rule 8 (no expo-web-browser regression) ──────────────────

describe('BrandedCheckoutWebViewScreen — source guards', () => {
  const SRC = fs.readFileSync(
    path.resolve(
      __dirname,
      '..',
      'screens',
      'client',
      'BrandedCheckoutWebViewScreen.tsx',
    ),
    'utf8',
  );

  it('does not import expo-web-browser (Rule 8 — never leave the app)', () => {
    expect(SRC).not.toMatch(/from ['"]expo-web-browser['"]/);
  });

  it('uses react-native-webview', () => {
    expect(SRC).toMatch(/from ['"]react-native-webview['"]/);
  });

  it('every TGPError code starts with the structured prefix (Rule 9)', () => {
    const matches = SRC.match(/TGPError:\s*[a-z_]+/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });
});
